"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Phone, Search, UserPlus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Avatar, EmptyState, PageHeader, Pagination, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { useCatalog } from "@/hooks/use-catalog";
import { PAGE_SIZE, SEGMENT_LABELS } from "@/lib/constants";
import { daysSince, formatDate } from "@/lib/dates";
import { segmentsForMode } from "@/lib/terminology";
import { getErrorMessage } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import type { Client, Segment } from "@/types/domain";
import { listClients } from "./api";
import { ClientFormModal } from "./components/client-form-modal";

export function ClientsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { settings, money } = useApp();
  const { staff } = useCatalog();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [segment, setSegment] = useState<Segment | "all">("all");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Client[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listClients({ search: debounced, segment, page, pageSize: PAGE_SIZE });
      setRows(result.rows);
      setCount(result.count);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [debounced, segment, page, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (searchParams.get("nuevo") === "1") {
      setFormOpen(true);
      router.replace(pathname);
    }
  }, [searchParams, router, pathname]);

  const segmentOptions = segmentsForMode(settings.operating_mode).filter((s) => s !== "both");

  return (
    <div>
      <PageHeader
        title="Clientes"
        description={`${count} clientes registrados`}
        actions={
          <Button icon={UserPlus} onClick={() => setFormOpen(true)}>
            Nuevo cliente
          </Button>
        }
      />

      <Card className="mb-4 flex flex-col gap-3 p-3 sm:flex-row">
        <div className="relative flex-1">
          <Icon icon={Search} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, teléfono o correo" className="pl-9" />
        </div>
        {segmentOptions.length > 1 ? (
          <div className="sm:w-52">
            <Select
              value={segment}
              onChange={(e) => {
                setSegment(e.target.value as Segment | "all");
                setPage(1);
              }}
              aria-label="Área"
            >
              <option value="all">Todas las áreas</option>
              {segmentOptions.map((s) => (
                <option key={s} value={s}>
                  {SEGMENT_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={debounced ? "Sin resultados" : "Aún no hay clientes"}
            description={debounced ? "Prueba con otro nombre o número." : "Registra tu primer cliente para empezar su ficha técnica."}
          />
        ) : (
          <>
            {/* Tabla (tableta/PC) */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Contacto</th>
                    <th className="px-4 py-3 font-medium">Área</th>
                    <th className="px-4 py-3 text-right font-medium">Visitas</th>
                    <th className="px-4 py-3 text-right font-medium">Consumo</th>
                    <th className="px-4 py-3 font-medium">Última visita</th>
                    <th className="w-10 px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((client) => {
                    const since = daysSince(client.last_visit_at);
                    const inactive = since !== null && since > settings.inactive_client_days;
                    return (
                      <tr key={client.id} className="cursor-pointer hover:bg-surface-2/50" onClick={() => router.push(`/clientes/${client.id}`)}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={client.full_name} size="sm" color="#3F5E4D" />
                            <div className="min-w-0">
                              <p className="font-medium text-ink">{client.full_name}</p>
                              <div className="mt-0.5 flex flex-wrap gap-1">
                                {client.tags.slice(0, 3).map((tag) => (
                                  <Badge key={tag} tone="outline">
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted">
                          <p>{client.phone ?? "—"}</p>
                          {client.email ? <p className="text-xs">{client.email}</p> : null}
                        </td>
                        <td className="px-4 py-3 text-muted">{SEGMENT_LABELS[client.segment]}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{client.visits_count}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{money(client.total_spent)}</td>
                        <td className="px-4 py-3">
                          {client.last_visit_at ? (
                            <span className={inactive ? "text-clay" : "text-muted"}>
                              {formatDate(client.last_visit_at)}
                              {inactive ? ` · ${since} días` : ""}
                            </span>
                          ) : (
                            <span className="text-muted">Sin visitas</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted">
                          <Icon icon={ChevronRight} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Tarjetas (móvil) */}
            <ul className="divide-y divide-line md:hidden">
              {rows.map((client) => (
                <li key={client.id}>
                  <Link href={`/clientes/${client.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-surface-2">
                    <Avatar name={client.full_name} size="md" color="#3F5E4D" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{client.full_name}</p>
                      <p className="flex items-center gap-1 text-xs text-muted">
                        <Icon icon={Phone} className="h-3 w-3" />
                        {client.phone ?? "Sin teléfono"} · {client.visits_count} visitas
                      </p>
                    </div>
                    <Icon icon={ChevronRight} className="text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count} onPageChange={setPage} />
          </>
        )}
      </Card>

      <ClientFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        client={null}
        staff={staff.filter((s) => s.is_bookable)}
        onSaved={(client) => router.push(`/clientes/${client.id}`)}
      />
    </div>
  );
}
