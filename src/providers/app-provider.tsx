"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, LogOut, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/misc";
import { getSupabase } from "@/lib/supabase/client";
import { getTerminology, type Terminology } from "@/lib/terminology";
import { formatMoney, getErrorMessage } from "@/lib/utils";
import { invalidateCatalog } from "@/lib/catalog-cache";
import { listBranches } from "@/modules/branches/api";
import { fetchSettings } from "@/modules/settings/api";
import { fetchCurrentStaff } from "@/modules/team/api";
import type { Branch, BusinessSettings, ConfigurableRole, ModuleKey, StaffMember, ToggleableModule } from "@/types/domain";

const BRANCH_STORAGE_KEY = "salon.branch";

function readStoredBranch(): string | null {
  try {
    return window.localStorage.getItem(BRANCH_STORAGE_KEY);
  } catch {
    return null;
  }
}

interface AppContextValue {
  settings: BusinessSettings;
  staff: StaffMember;
  terms: Terminology;
  can: (module: ModuleKey) => boolean;
  isAdmin: boolean;
  money: (amount: number | null | undefined) => string;
  setSettings: (settings: BusinessSettings) => void;
  signOut: () => Promise<void>;
  /** Todas las sedes (incluye inactivas). */
  allBranches: Branch[];
  /** Sedes activas. */
  branches: Branch[];
  /** Sede de trabajo actual (null si la base aún no tiene sedes). */
  branch: Branch | null;
  setBranchId: (id: string) => void;
  reloadBranches: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

type LoadState =
  | { status: "loading" }
  | { status: "ready"; settings: BusinessSettings; staff: StaffMember }
  | { status: "unlinked"; email: string | null }
  | { status: "error"; message: string };

function isToggleable(module: ModuleKey): module is ToggleableModule {
  return module !== "dashboard" && module !== "settings";
}

export function AppProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [allBranches, setAllBranches] = useState<Branch[]>([]);
  const [branchId, setBranchIdState] = useState<string | null>(null);

  const reloadBranches = useCallback(async () => {
    // Sin la migración de sedes la lista queda vacía y todo funciona como antes
    setAllBranches(await listBranches().catch(() => [] as Branch[]));
  }, []);

  const setBranchId = useCallback((id: string) => {
    setBranchIdState(id);
    try {
      window.localStorage.setItem(BRANCH_STORAGE_KEY, id);
    } catch {
      // Navegación privada: la elección dura solo esta sesión
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const [{ staff, email }, settings] = await Promise.all([fetchCurrentStaff(), fetchSettings().catch(() => null), reloadBranches()]);
      if (!staff) {
        // Sin sesión válida (expirada o cookie inválida): directo al login
        if (!email) {
          router.replace("/login");
          return;
        }
        setState({ status: "unlinked", email });
        return;
      }
      if (!settings) {
        setState({ status: "error", message: "No se encontraron los ajustes del negocio. Ejecuta supabase/seed.sql." });
        return;
      }
      setState({ status: "ready", settings, staff });
    } catch (error) {
      setState({ status: "error", message: getErrorMessage(error) });
    }
  }, [reloadBranches, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = useCallback(async () => {
    invalidateCatalog();
    await getSupabase().auth.signOut();
    router.replace("/login");
    router.refresh();
  }, [router]);

  const setSettings = useCallback((settings: BusinessSettings) => {
    setState((current) => (current.status === "ready" ? { ...current, settings } : current));
  }, []);

  const value = useMemo<AppContextValue | null>(() => {
    if (state.status !== "ready") return null;
    const { settings, staff } = state;
    const branches = allBranches.filter((b) => b.is_active);
    const pick = (id: string | null | undefined) => (id ? branches.find((b) => b.id === id) : undefined);
    const branch =
      pick(branchId) ?? pick(readStoredBranch()) ?? pick(staff.branch_id) ?? branches.find((b) => b.is_main) ?? branches[0] ?? null;
    const isOwner = staff.role === "owner";
    const can = (module: ModuleKey): boolean => {
      if (isToggleable(module) && !settings.enabled_modules?.[module]) return false;
      if (isOwner) return true;
      return (settings.role_permissions?.[staff.role as ConfigurableRole] ?? []).includes(module);
    };
    return {
      settings,
      staff,
      terms: getTerminology(settings.operating_mode),
      can,
      isAdmin: staff.role === "owner" || staff.role === "admin",
      money: (amount) => formatMoney(amount, settings.currency_symbol, settings.locale),
      setSettings,
      signOut,
      allBranches,
      branches,
      branch,
      setBranchId,
      reloadBranches,
    };
  }, [state, setSettings, signOut, allBranches, branchId, setBranchId, reloadBranches]);

  if (state.status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas">
        <Spinner label="Preparando tu espacio" />
      </div>
    );
  }

  if (state.status === "unlinked" || state.status === "error") {
    const unlinked = state.status === "unlinked";
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-card">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-clay-soft text-clay">
            <Icon icon={unlinked ? UserX : AlertTriangle} className="h-5 w-5" />
          </div>
          <h1 className="font-display text-xl font-semibold text-ink">{unlinked ? "Usuario sin acceso" : "No se pudo cargar el sistema"}</h1>
          <p className="mt-2 text-sm text-muted">
            {unlinked
              ? `La cuenta ${state.email ?? ""} no está vinculada a ningún miembro activo del equipo. Pide a la administración que te registre con este correo.`
              : state.message}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            {!unlinked ? (
              <Button variant="outline" onClick={() => void load()}>
                Reintentar
              </Button>
            ) : null}
            <Button variant="secondary" icon={LogOut} onClick={() => void signOut()}>
              Cerrar sesión
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp debe usarse dentro de AppProvider");
  return ctx;
}
