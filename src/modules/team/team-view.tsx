"use client";

import { useCallback, useEffect, useState } from "react";
import { startOfMonth, startOfWeek } from "date-fns";
import { BadgeCheck, CalendarRange, Download, HandCoins, History, Pencil, UserPlus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Avatar, EmptyState, PageHeader, Spinner, Tabs } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { ROLE_LABELS, SPECIALTY_LABELS, WEEKDAYS_SHORT } from "@/lib/constants";
import { formatDate, formatDateTime, toDateKey } from "@/lib/dates";
import { cn, downloadCsv, getErrorMessage, nullIfEmpty } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import type { CommissionPayout, CommissionSummaryRow, StaffMember } from "@/types/domain";
import { fetchCommissionSummary, listPayouts, listStaff, settleCommissions } from "./api";
import { StaffFormModal } from "./components/staff-form-modal";

type Tab = "team" | "commissions" | "payouts";

function fortnightStart(today: Date): Date {
  return today.getDate() <= 15 ? startOfMonth(today) : new Date(today.getFullYear(), today.getMonth(), 16);
}

export function TeamView() {
  const toast = useToast();
  const { terms, isAdmin, money, staff: me } = useApp();
  const [tab, setTab] = useState<Tab>("team");
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; member: StaffMember | null }>({ open: false, member: null });

  const today = new Date();
  const [from, setFrom] = useState(toDateKey(fortnightStart(today)));
  const [to, setTo] = useState(toDateKey(today));
  const [summary, setSummary] = useState<CommissionSummaryRow[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [payouts, setPayouts] = useState<CommissionPayout[]>([]);
  const [settleTarget, setSettleTarget] = useState<CommissionSummaryRow | null>(null);
  const [settleNotes, setSettleNotes] = useState("");
  const [settling, setSettling] = useState(false);

  const loadTeam = useCallback(async () => {
    try {
      setMembers(await listStaff());
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadSummary = useCallback(async () => {
    if (from > to) return;
    setSummaryLoading(true);
    try {
      const rows = await fetchCommissionSummary(from, to);
      setSummary(me.role === "specialist" ? rows.filter((r) => r.staff_id === me.id) : rows.filter((r) => r.items_count > 0 || r.tips_total > 0 || r.role === "specialist"));
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSummaryLoading(false);
    }
  }, [from, to, me.id, me.role, toast]);

  const loadPayouts = useCallback(async () => {
    try {
      setPayouts(await listPayouts());
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }, [toast]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  useEffect(() => {
    if (tab === "commissions") void loadSummary();
    if (tab === "payouts") void loadPayouts();
  }, [tab, loadSummary, loadPayouts]);

  async function handleSettle() {
    if (!settleTarget) return;
    setSettling(true);
    try {
      await settleCommissions(settleTarget.staff_id, from, to, nullIfEmpty(settleNotes));
      toast.success(`Liquidación registrada para ${settleTarget.full_name}`);
      setSettleTarget(null);
      setSettleNotes("");
      void loadSummary();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSettling(false);
    }
  }

  function applyPreset(preset: "week" | "fortnight" | "month") {
    const now = new Date();
    const start = preset === "week" ? startOfWeek(now, { weekStartsOn: 1 }) : preset === "fortnight" ? fortnightStart(now) : startOfMonth(now);
    setFrom(toDateKey(start));
    setTo(toDateKey(now));
  }

  const visibleMembers = members.filter((m) => showInactive || m.is_active);
  const totals = summary.reduce(
    (acc, r) => ({ base: acc.base + r.base_amount, commission: acc.commission + r.commission_total, pending: acc.pending + r.commission_pending + r.tips_pending }),
    { base: 0, commission: 0, pending: 0 },
  );

  return (
    <div>
      <PageHeader
        title={`${terms.professionals} y comisiones`}
        description={`${members.filter((m) => m.is_active).length} miembros activos`}
        actions={
          isAdmin ? (
            <Button icon={UserPlus} onClick={() => setModal({ open: true, member: null })}>
              Nuevo miembro
            </Button>
          ) : null
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4"
        items={[
          { value: "team", label: "Equipo", icon: Users },
          { value: "commissions", label: "Comisiones", icon: HandCoins },
          { value: "payouts", label: "Liquidaciones", icon: History },
        ]}
      />

      {tab === "team" ? (
        loading ? (
          <Spinner />
        ) : (
          <>
            <div className="mb-3 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setShowInactive((v) => !v)}>
                {showInactive ? "Ocultar inactivos" : "Mostrar inactivos"}
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visibleMembers.map((m) => (
                <Card key={m.id} className={cn("flex flex-col p-4", !m.is_active && "opacity-60")}>
                  <div className="flex items-start gap-3">
                    <Avatar name={m.full_name} color={m.color} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{m.full_name}</p>
                      <p className="truncate text-xs text-muted">
                        {SPECIALTY_LABELS[m.specialty]}
                        {m.station_label ? ` · ${m.station_label}` : ""}
                      </p>
                    </div>
                    {isAdmin ? (
                      <Button size="icon" variant="ghost" aria-label={`Editar ${m.full_name}`} onClick={() => setModal({ open: true, member: m })}>
                        <Icon icon={Pencil} />
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge tone={m.role === "owner" || m.role === "admin" ? "ink" : "neutral"}>{ROLE_LABELS[m.role]}</Badge>
                    {m.is_bookable ? <Badge tone="sage">Recibe citas</Badge> : null}
                    {m.user_id ? (
                      <Badge tone="outline">
                        <Icon icon={BadgeCheck} className="h-3 w-3" /> Con acceso
                      </Badge>
                    ) : (
                      <Badge tone="ochre">Sin cuenta</Badge>
                    )}
                    {!m.is_active ? <Badge tone="clay">Inactivo</Badge> : null}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-muted">Comisión servicios</dt>
                      <dd className="text-ink">
                        {m.commission_type ? (m.commission_type === "percentage" ? `${m.commission_value}%` : money(m.commission_value)) : "Heredada"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Productos</dt>
                      <dd className="text-ink">{m.product_commission_rate !== null ? `${m.product_commission_rate}%` : "Heredada"}</dd>
                    </div>
                  </dl>
                  {m.work_schedule.length ? (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                        const on = m.work_schedule.some((w) => w.day === d);
                        return (
                          <span key={d} className={cn("rounded px-1.5 py-0.5 text-[11px]", on ? "bg-sage-soft text-sage-dark" : "bg-surface-2 text-muted/60")}>
                            {WEEKDAYS_SHORT[d]}
                          </span>
                        );
                      })}
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          </>
        )
      ) : null}

      {tab === "commissions" ? (
        <>
          <Card className="mb-4 flex flex-col gap-3 p-3 lg:flex-row lg:items-end">
            <div className="grid flex-1 grid-cols-2 gap-3 sm:max-w-md">
              <Field label="Desde">
                <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="Hasta">
                <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => applyPreset("week")}>
                Semana
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyPreset("fortnight")}>
                Quincena
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyPreset("month")}>
                Mes
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={Download}
                disabled={summary.length === 0}
                onClick={() =>
                  downloadCsv(
                    `comisiones_${from}_${to}`,
                    summary.map((r) => ({
                      Profesional: r.full_name,
                      Servicios_y_productos: r.items_count,
                      Base: r.base_amount.toFixed(2),
                      Comision: r.commission_total.toFixed(2),
                      Comision_pendiente: r.commission_pending.toFixed(2),
                      Propinas: r.tips_total.toFixed(2),
                      Propinas_pendientes: r.tips_pending.toFixed(2),
                    })),
                  )
                }
              >
                CSV
              </Button>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader
              title="Comisiones del periodo"
              description={`Base ${money(totals.base)} · comisión ${money(totals.commission)} · por liquidar ${money(totals.pending)}`}
            />
            {summaryLoading ? (
              <Spinner />
            ) : summary.length === 0 ? (
              <EmptyState icon={CalendarRange} title="Sin movimientos en el periodo" />
            ) : (
              <>
              {/* Tarjetas (móvil) */}
              <ul className="divide-y divide-line md:hidden">
                {summary.map((r) => {
                  const pending = r.commission_pending + r.tips_pending;
                  return (
                    <li key={r.staff_id} className="px-4 py-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{r.full_name}</p>
                          <p className="text-xs text-muted">{r.items_count} ítems · base {money(r.base_amount)}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={cn("font-semibold tabular-nums", pending > 0 ? "text-clay" : "text-muted")}>{money(pending)}</p>
                          <p className="text-xs text-muted">por liquidar</p>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <p className="text-xs text-muted">
                          Comisión <span className="tabular-nums text-ink">{money(r.commission_total)}</span> · propinas{" "}
                          <span className="tabular-nums text-ink">{money(r.tips_total)}</span>
                        </p>
                        {isAdmin ? (
                          <Button size="sm" variant={pending > 0 ? "primary" : "ghost"} disabled={pending <= 0} onClick={() => setSettleTarget(r)}>
                            Liquidar
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {/* Tabla (tableta/PC) */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-4 py-3 font-medium">{terms.professional}</th>
                      <th className="px-4 py-3 text-right font-medium">Ítems</th>
                      <th className="px-4 py-3 text-right font-medium">Base</th>
                      <th className="px-4 py-3 text-right font-medium">Comisión</th>
                      <th className="px-4 py-3 text-right font-medium">Propinas</th>
                      <th className="px-4 py-3 text-right font-medium">Por liquidar</th>
                      {isAdmin ? <th className="px-4 py-3" /> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {summary.map((r) => {
                      const pending = r.commission_pending + r.tips_pending;
                      return (
                        <tr key={r.staff_id}>
                          <td className="px-4 py-3 font-medium text-ink">{r.full_name}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.items_count}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{money(r.base_amount)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{money(r.commission_total)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{money(r.tips_total)}</td>
                          <td className={cn("px-4 py-3 text-right font-semibold tabular-nums", pending > 0 ? "text-clay" : "text-muted")}>{money(pending)}</td>
                          {isAdmin ? (
                            <td className="px-4 py-3 text-right">
                              <Button size="sm" variant={pending > 0 ? "primary" : "ghost"} disabled={pending <= 0} onClick={() => setSettleTarget(r)}>
                                Liquidar
                              </Button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </Card>
        </>
      ) : null}

      {tab === "payouts" ? (
        <Card className="overflow-hidden">
          <CardHeader title="Historial de liquidaciones" description="Últimos 30 pagos registrados" />
          {payouts.length === 0 ? (
            <EmptyState icon={History} title="Aún no hay liquidaciones" />
          ) : (
            <ul className="divide-y divide-line">
              {payouts.map((p) => (
                <li key={p.id} className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{p.staff?.full_name}</p>
                    <p className="text-xs text-muted">
                      {formatDate(p.period_start)} – {formatDate(p.period_end)} · {p.items_count} ítems · pagado {formatDateTime(p.paid_at)}
                    </p>
                    {p.notes ? <p className="text-xs text-muted">{p.notes}</p> : null}
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums text-ink">{money(p.total_amount)}</p>
                    <p className="text-xs text-muted">
                      Comisión {money(p.commission_amount)} · propinas {money(p.tips_amount)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <StaffFormModal open={modal.open} member={modal.member} onClose={() => setModal({ open: false, member: null })} onSaved={() => void loadTeam()} />

      <Modal
        open={Boolean(settleTarget)}
        onClose={() => setSettleTarget(null)}
        size="sm"
        title="Liquidar comisiones"
        description={settleTarget ? `${settleTarget.full_name} · ${formatDate(from)} – ${formatDate(to)}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSettleTarget(null)}>
              Cancelar
            </Button>
            <Button loading={settling} onClick={() => void handleSettle()}>
              Confirmar pago
            </Button>
          </>
        }
      >
        {settleTarget ? (
          <div className="space-y-4">
            <dl className="space-y-2 rounded-xl bg-surface-2 p-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Comisión pendiente</dt>
                <dd className="tabular-nums">{money(settleTarget.commission_pending)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Propinas pendientes</dt>
                <dd className="tabular-nums">{money(settleTarget.tips_pending)}</dd>
              </div>
              <div className="flex justify-between border-t border-line pt-2 font-semibold">
                <dt>Total a pagar</dt>
                <dd className="tabular-nums">{money(settleTarget.commission_pending + settleTarget.tips_pending)}</dd>
              </div>
            </dl>
            <Field label="Notas (opcional)">
              <Textarea rows={2} value={settleNotes} onChange={(e) => setSettleNotes(e.target.value)} placeholder="Medio de pago, observaciones…" />
            </Field>
            <p className="text-xs text-muted">Las ventas incluidas quedan marcadas como liquidadas y ya no podrán anularse.</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
