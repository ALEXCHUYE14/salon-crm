"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadCatalog, readCatalogCache, type CatalogData } from "@/lib/catalog-cache";
import { isSegmentVisible } from "@/lib/terminology";
import { getErrorMessage } from "@/lib/utils";
import { listCategories, listServices } from "@/modules/services/api";
import { listStaff } from "@/modules/team/api";
import { useApp } from "@/providers/app-provider";
import type { Service, ServiceCategory, StaffMember } from "@/types/domain";

interface CatalogState {
  staff: StaffMember[];
  bookableStaff: StaffMember[];
  services: Service[];
  categories: ServiceCategory[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

async function fetchCatalog(): Promise<CatalogData> {
  const [staff, services, categories] = await Promise.all([
    listStaff({ activeOnly: true }),
    listServices({ activeOnly: true }),
    listCategories(),
  ]);
  return { staff, services, categories };
}

/** Equipo + servicios activos, filtrados por el modo operativo del negocio (con caché compartida). */
export function useCatalog(): CatalogState {
  const { settings, branch } = useApp();
  const branchId = branch?.id ?? null;
  const mode = settings.operating_mode;
  // Si hay datos frescos en caché, la pantalla se pinta al instante sin spinner
  const [data, setData] = useState<CatalogData | null>(() => readCatalogCache());
  const [loading, setLoading] = useState(() => readCatalogCache() === null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force: boolean) => {
    if (force || !readCatalogCache()) setLoading(true);
    setError(null);
    try {
      setData(await loadCatalog(fetchCatalog, force));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const reload = useCallback(() => load(true), [load]);

  const filtered = useMemo(() => {
    const staff = data?.staff ?? [];
    return {
      staff,
      // Con varias sedes, solo se agenda/cobra al personal de la sede actual
      bookableStaff: staff.filter((s) => s.is_bookable && (!branchId || !s.branch_id || s.branch_id === branchId)),
      services: (data?.services ?? []).filter((s) => isSegmentVisible(s.segment, mode)),
      categories: (data?.categories ?? []).filter((c) => c.is_active && isSegmentVisible(c.segment, mode)),
    };
  }, [data, branchId, mode]);

  return { ...filtered, loading, error, reload };
}
