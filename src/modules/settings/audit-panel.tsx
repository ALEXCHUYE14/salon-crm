"use client";

import { useCallback, useEffect, useState } from "react";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/dates";
import { getSupabase, unwrap } from "@/lib/supabase/client";
import { getErrorMessage } from "@/lib/utils";

interface AuditEntry {
  id: number;
  occurred_at: string;
  actor_name: string | null;
  table_name: string;
  record_id: string | null;
  action: "insert" | "update" | "delete";
  changes: Record<string, unknown>;
}

const TABLE_LABELS: Record<string, string> = {
  business_settings: "Ajustes",
  staff_members: "Equipo",
  services: "Servicios",
  transactions: "Ventas",
  cash_registers: "Caja",
  cash_movements: "Gastos y retiros",
  appointments: "Citas",
  clients: "Clientes",
  inventory_items: "Inventario",
  commission_payouts: "Liquidaciones",
  appointment_deposits: "Adelantos",
  prepaid_plans: "Paquetes",
  purchase_orders: "Compras",
};

const ACTION: Record<AuditEntry["action"], { label: string; tone: "sage" | "ochre" | "clay" }> = {
  insert: { label: "Creó", tone: "sage" },
  update: { label: "Cambió", tone: "ochre" },
  delete: { label: "Eliminó", tone: "clay" },
};

const FIELD_LABELS: Record<string, string> = {
  price: "precio",
  cost: "costo",
  status: "estado",
  void_reason: "motivo",
  voided_by: "anulado por",
  name: "nombre",
  full_name: "nombre",
  role: "rol",
  is_active: "activo",
  commission_type: "tipo de comisión",
  commission_value: "comisión",
  product_commission_rate: "comisión de productos",
  starts_at: "hora",
  staff_id: "profesional",
  amount: "monto",
  counted_cash: "efectivo contado",
  expected_cash: "efectivo esperado",
  difference: "diferencia",
  opening_amount: "fondo inicial",
  min_stock: "stock mínimo",
  duration_minutes: "duración",
  cancellation_reason: "motivo de cancelación",
};

const PAGE = 50;

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "sí" : "no";
  if (typeof value === "object") return "…";
  const text = String(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function summarize(entry: AuditEntry): string {
  if (entry.action === "update") {
    return Object.entries(entry.changes)
      .slice(0, 4)
      .map(([key, pair]) => {
        const [before, after] = Array.isArray(pair) ? pair : [null, pair];
        return `${FIELD_LABELS[key] ?? key}: ${show(before)} → ${show(after)}`;
      })
      .join(" · ");
  }
  const c = entry.changes;
  const label = c.name ?? c.full_name ?? c.description ?? (c.amount !== undefined ? `monto ${show(c.amount)}` : null);
  return label ? show(label) : "";
}

/** Historial de cambios sensibles (solo lectura). */
export function AuditPanel() {
  const toast = useToast();
  const [table, setTable] = useState("all");
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const fetchPage = useCallback(
    async (beforeId?: number) => {
      let query = getSupabase()
        .from("audit_log")
        .select("id,occurred_at,actor_name,table_name,record_id,action,changes")
        .order("id", { ascending: false })
        .limit(PAGE);
      if (table !== "all") query = query.eq("table_name", table);
      if (beforeId) query = query.lt("id", beforeId);
      return unwrap<AuditEntry[]>(await query);
    },
    [table],
  );

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    fetchPage()
      .then((page) => {
        if (cancelled) return;
        setRows(page);
        setHasMore(page.length === PAGE);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast.error(getErrorMessage(error));
        setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage, toast]);

  async function loadMore() {
    if (!rows || rows.length === 0) return;
    try {
      const page = await fetchPage(rows[rows.length - 1].id);
      setRows([...rows, ...page]);
      setHasMore(page.length === PAGE);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Auditoría"
        description="Quién cambió precios, anuló ventas, movió caja o editó al equipo. El registro no se puede modificar."
        action={
          <div className="w-44">
            <Select value={table} onChange={(e) => setTable(e.target.value)} aria-label="Filtrar por sección">
              <option value="all">Todo</option>
              {Object.entries(TABLE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        }
      />
      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon={History} title="Sin cambios registrados" />
      ) : (
        <>
          <ul className="divide-y divide-line text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:gap-4">
                <span className="w-36 shrink-0 tabular-nums text-muted">{formatDateTime(r.occurred_at)}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{r.actor_name ?? "Sistema"}</span>
                    <Badge tone={ACTION[r.action].tone}>{ACTION[r.action].label}</Badge>
                    <span className="text-muted">{TABLE_LABELS[r.table_name] ?? r.table_name}</span>
                  </p>
                  <p className="mt-0.5 break-words text-muted">{summarize(r)}</p>
                </div>
              </li>
            ))}
          </ul>
          {hasMore ? (
            <div className="border-t border-line p-3 text-center">
              <Button variant="outline" size="sm" onClick={() => void loadMore()}>
                Ver más
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
