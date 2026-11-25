"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, BarChart3, Coins, Download, HandCoins, Receipt, Scissors, Star, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState, PageHeader, Spinner, StatCard } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { CASH_CATEGORY_LABELS, CASH_MOVEMENT_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/constants";
import { formatDate, rangeFromPreset, type RangePreset } from "@/lib/dates";
import { cn, downloadCsv, getErrorMessage } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import type { CashMovementReportRow, PaymentMethodRow, RevenueByDayRow, StaffPerformanceRow, TopServiceRow } from "@/types/domain";
import { fetchSurveySummary, listSurveyComments, type SurveyComment, type SurveySummaryRow } from "@/modules/surveys/api";
import { fetchCashMovementReport, fetchPaymentMethods, fetchRevenueByDay, fetchStaffPerformance, fetchTopServices } from "./api";

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: "today", label: "Hoy" },
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
  { value: "month", label: "Este mes" },
  { value: "prev_month", label: "Mes anterior" },
];

export function ReportsView() {
  const toast = useToast();
  const { money, terms, branches } = useApp();
  const [reportBranch, setReportBranch] = useState<string>("all");
  const rb = reportBranch === "all" ? null : reportBranch;
  const initial = rangeFromPreset("30d");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [preset, setPreset] = useState<RangePreset | null>("30d");
  const [loading, setLoading] = useState(true);
  const [daily, setDaily] = useState<RevenueByDayRow[]>([]);
  const [staffRows, setStaffRows] = useState<StaffPerformanceRow[]>([]);
  const [topServices, setTopServices] = useState<TopServiceRow[]>([]);
  const [methods, setMethods] = useState<PaymentMethodRow[]>([]);
  const [movements, setMovements] = useState<CashMovementReportRow[]>([]);
  const [surveys, setSurveys] = useState<SurveySummaryRow[]>([]);
  const [comments, setComments] = useState<SurveyComment[]>([]);

  const load = useCallback(async () => {
    if (from > to) return;
    setLoading(true);
    try {
      const [d, s, t, m, cm] = await Promise.all([
        fetchRevenueByDay(from, to, rb),
        fetchStaffPerformance(from, to, rb),
        fetchTopServices(from, to, 10, rb),
        fetchPaymentMethods(from, to, rb),
        // Si la migración 003 aún no se aplicó, el resto del reporte sigue funcionando
        fetchCashMovementReport(from, to, rb).catch(() => [] as CashMovementReportRow[]),
      ]);
      const [sv, sc] = await Promise.all([
        fetchSurveySummary(from, to).catch(() => [] as SurveySummaryRow[]),
        listSurveyComments(new Date(from + "T00:00:00").toISOString(), new Date(to + "T23:59:59.999").toISOString()).catch(() => [] as SurveyComment[]),
      ]);
      setSurveys(sv);
      setComments(sc);
      setDaily(d);
      setStaffRows(s);
      setTopServices(t);
      setMethods(m);
      setMovements(cm);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [from, to, toast, rb]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const revenue = daily.reduce((s, d) => s + d.revenue, 0);
    const tips = daily.reduce((s, d) => s + d.tips, 0);
    const tx = daily.reduce((s, d) => s + d.tx_count, 0);
    const commission = staffRows.reduce((s, r) => s + r.commission, 0);
    return { revenue, tips, tx, commission, avg: tx > 0 ? revenue / tx : 0 };
  }, [daily, staffRows]);

  const maxDay = Math.max(1, ...daily.map((d) => d.revenue));
  const maxService = Math.max(1, ...topServices.map((s) => s.quantity));
  const methodsTotal = methods.reduce((s, m) => s + m.amount, 0);
  const expenses = movements.filter((m) => m.movement_type === "expense");
  const expensesTotal = expenses.reduce((s, m) => s + m.amount, 0);
  const withdrawalsTotal = movements.filter((m) => m.movement_type === "withdrawal").reduce((s, m) => s + m.amount, 0);
  const maxExpense = Math.max(1, ...expenses.map((m) => m.amount));

  function applyPreset(value: RangePreset) {
    const r = rangeFromPreset(value);
    setPreset(value);
    setFrom(r.from);
    setTo(r.to);
  }

  const suffix = `${from}_${to}`;

  return (
    <div>
      <PageHeader title="Reportes" description={`${formatDate(from + "T00:00:00")} – ${formatDate(to + "T00:00:00")}`} />

      <Card className="mb-4 flex flex-col gap-3 p-3 lg:flex-row lg:items-end">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button key={p.value} size="sm" variant={preset === p.value ? "primary" : "outline"} onClick={() => applyPreset(p.value)}>
              {p.label}
            </Button>
          ))}
        </div>
        {branches.length > 1 ? (
          <Field label="Sede" className="lg:w-48">
            <Select value={reportBranch} onChange={(e) => setReportBranch(e.target.value)} aria-label="Sede">
              <option value="all">Todas las sedes</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <div className="grid grid-cols-2 gap-3 lg:ml-auto lg:w-80">
          <Field label="Desde">
            <Input
              type="date"
              value={from}
              max={to}
              onChange={(e) => {
                setFrom(e.target.value);
                setPreset(null);
              }}
            />
          </Field>
          <Field label="Hasta">
            <Input
              type="date"
              value={to}
              min={from}
              onChange={(e) => {
                setTo(e.target.value);
                setPreset(null);
              }}
            />
          </Field>
        </div>
      </Card>

      {loading ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Ventas netas" value={money(totals.revenue)} hint="Sin propinas, con descuentos" icon={Coins} tone="sage" />
            <StatCard label="Tickets" value={String(totals.tx)} hint={`Promedio ${money(totals.avg)}`} icon={Receipt} />
            <StatCard label="Comisiones" value={money(totals.commission)} icon={HandCoins} tone="ochre" />
            <StatCard label="Propinas" value={money(totals.tips)} icon={Wallet} />
          </div>

          <Card className="mb-6">
            <CardHeader
              title="Ingresos por día"
              action={
                <Button
                  size="sm"
                  variant="outline"
                  icon={Download}
                  onClick={() =>
                    downloadCsv(
                      `ingresos_diarios_${suffix}`,
                      daily.map((d) => ({ Fecha: d.day.slice(0, 10), Ventas: d.revenue.toFixed(2), Propinas: d.tips.toFixed(2), Tickets: d.tx_count })),
                    )
                  }
                >
                  CSV
                </Button>
              }
            />
            <CardBody>
              {totals.tx === 0 ? (
                <EmptyState icon={BarChart3} title="Sin ventas en el periodo" />
              ) : (
                <div className="scrollbar-thin overflow-x-auto">
                  <div className="flex h-56 min-w-full items-end gap-1" style={{ minWidth: daily.length * 18 }}>
                    {daily.map((d) => {
                      const h = (d.revenue / maxDay) * 100;
                      return (
                        <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end">
                          <div
                            className={cn("w-full rounded-t-md transition-colors", d.revenue > 0 ? "bg-sage/80 group-hover:bg-sage" : "bg-line")}
                            style={{ height: `${Math.max(h, d.revenue > 0 ? 2 : 1)}%` }}
                          />
                          <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] text-white group-hover:block">
                            {formatDate(d.day.slice(0, 10) + "T00:00:00", "dd MMM")} · {money(d.revenue)} · {d.tx_count} tickets
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex justify-between text-[11px] text-muted">
                    <span>{formatDate(from + "T00:00:00", "dd MMM")}</span>
                    <span>{formatDate(to + "T00:00:00", "dd MMM")}</span>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="overflow-hidden">
              <CardHeader
                title={`Rendimiento por ${terms.professional.toLowerCase()}`}
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    icon={Download}
                    onClick={() =>
                      downloadCsv(
                        `rendimiento_${suffix}`,
                        staffRows.map((r) => ({
                          Profesional: r.full_name,
                          Servicios: r.services_count,
                          Ventas_servicios: r.services_revenue.toFixed(2),
                          Ventas_productos: r.products_revenue.toFixed(2),
                          Comision: r.commission.toFixed(2),
                          Propinas: r.tips.toFixed(2),
                        })),
                      )
                    }
                  >
                    CSV
                  </Button>
                }
              />
              {staffRows.length === 0 ? (
                <EmptyState icon={Users} title="Sin datos" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th className="px-4 py-3 font-medium">{terms.professional}</th>
                        <th className="px-4 py-3 text-right font-medium">Servicios</th>
                        <th className="px-4 py-3 text-right font-medium">Ventas</th>
                        <th className="px-4 py-3 text-right font-medium">Productos</th>
                        <th className="px-4 py-3 text-right font-medium">Comisión</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {staffRows.map((r) => (
                        <tr key={r.staff_id}>
                          <td className="px-4 py-3 font-medium text-ink">{r.full_name}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.services_count}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{money(r.services_revenue)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{money(r.products_revenue)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{money(r.commission)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Servicios más solicitados"
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    icon={Download}
                    onClick={() =>
                      downloadCsv(
                        `servicios_top_${suffix}`,
                        topServices.map((s) => ({ Servicio: s.service_name, Cantidad: s.quantity, Ventas: s.revenue.toFixed(2) })),
                      )
                    }
                  >
                    CSV
                  </Button>
                }
              />
              {topServices.length === 0 ? (
                <EmptyState icon={Scissors} title="Sin datos" />
              ) : (
                <CardBody className="space-y-3">
                  {topServices.map((s) => (
                    <div key={s.service_id ?? s.service_name}>
                      <div className="mb-1 flex justify-between gap-3 text-sm">
                        <span className="truncate text-ink">{s.service_name}</span>
                        <span className="shrink-0 tabular-nums text-muted">
                          {s.quantity} · {money(s.revenue)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-clay/80" style={{ width: `${(s.quantity / maxService) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </CardBody>
              )}
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader
                title="Métodos de pago"
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    icon={Download}
                    onClick={() =>
                      downloadCsv(
                        `metodos_pago_${suffix}`,
                        methods.map((m) => ({ Metodo: PAYMENT_METHOD_LABELS[m.method], Monto: m.amount.toFixed(2), Pagos: m.payments })),
                      )
                    }
                  >
                    CSV
                  </Button>
                }
              />
              {methods.length === 0 ? (
                <EmptyState icon={Wallet} title="Sin pagos en el periodo" />
              ) : (
                <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {methods.map((m) => (
                    <div key={m.method} className="rounded-xl border border-line p-4">
                      <p className="text-sm text-muted">{PAYMENT_METHOD_LABELS[m.method]}</p>
                      <p className="mt-1 font-display text-xl font-semibold tabular-nums">{money(m.amount)}</p>
                      <p className="text-xs text-muted">
                        {m.payments} pagos · {methodsTotal > 0 ? Math.round((m.amount / methodsTotal) * 100) : 0}%
                      </p>
                    </div>
                  ))}
                </CardBody>
              )}
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader
                title="Satisfacción de clientes"
                description={(() => {
                  const n = surveys.reduce((s, r) => s + r.responses, 0);
                  if (n === 0) return undefined;
                  const avg = surveys.reduce((s, r) => s + r.average * r.responses, 0) / n;
                  return `${n} respuestas · promedio ${avg.toFixed(1)} de 5`;
                })()}
              />
              {surveys.length === 0 ? (
                <EmptyState icon={Star} title="Sin encuestas respondidas en el periodo" description="Envíalas desde el recibo, con el botón «Encuesta»." />
              ) : (
                <CardBody className="grid gap-6 lg:grid-cols-2">
                  <ul className="space-y-3">
                    {surveys.map((r) => (
                      <li key={r.staff_id ?? "none"}>
                        <div className="mb-1 flex justify-between gap-3 text-sm">
                          <span className="truncate text-ink">{r.full_name}</span>
                          <span className="shrink-0 tabular-nums text-muted">
                            {r.average.toFixed(1)} ★ · {r.responses} {r.responses === 1 ? "respuesta" : "respuestas"}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full rounded-full bg-ochre/80" style={{ width: `${(r.average / 5) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                  <ul className="space-y-3 text-sm">
                    {comments.length === 0 ? <li className="text-muted">Sin comentarios escritos.</li> : null}
                    {comments.map((c) => (
                      <li key={c.id} className="rounded-xl bg-surface-2 px-4 py-3">
                        <p className="text-ink">“{c.comment}”</p>
                        <p className="mt-1 text-xs text-muted">
                          {"★".repeat(c.rating)} · {c.staff?.full_name ?? "Sin asignar"} · {formatDate(c.answered_at)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              )}
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader
                title="Gastos de caja"
                description={
                  expensesTotal > 0 || withdrawalsTotal > 0
                    ? `Ventas netas menos gastos: ${money(totals.revenue - expensesTotal)}${withdrawalsTotal > 0 ? ` · Retiros: ${money(withdrawalsTotal)}` : ""}`
                    : undefined
                }
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    icon={Download}
                    disabled={movements.length === 0}
                    onClick={() =>
                      downloadCsv(
                        `movimientos_caja_${suffix}`,
                        movements.map((m) => ({
                          Tipo: CASH_MOVEMENT_LABELS[m.movement_type].label,
                          Categoria: CASH_CATEGORY_LABELS[m.category],
                          Monto: m.amount.toFixed(2),
                          Movimientos: m.movements,
                        })),
                      )
                    }
                  >
                    CSV
                  </Button>
                }
              />
              {expenses.length === 0 ? (
                <EmptyState icon={ArrowLeftRight} title="Sin gastos en el periodo" description="Se registran desde Caja → Gastos y retiros." />
              ) : (
                <CardBody className="space-y-3">
                  {expenses.map((m) => (
                    <div key={m.category}>
                      <div className="mb-1 flex justify-between gap-3 text-sm">
                        <span className="truncate text-ink">{CASH_CATEGORY_LABELS[m.category]}</span>
                        <span className="shrink-0 tabular-nums text-muted">
                          {m.movements} · {money(m.amount)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-ochre/80" style={{ width: `${(m.amount / maxExpense) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                  <p className="flex justify-between border-t border-line pt-3 text-sm font-semibold">
                    <span>Total de gastos</span>
                    <span className="tabular-nums">{money(expensesTotal)}</span>
                  </p>
                </CardBody>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
