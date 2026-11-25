"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { addDays, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { CalendarCheck2, CalendarDays, Clock, HandCoins, Lock, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader, Spinner, StatCard } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { APPOINTMENT_STATUS } from "@/lib/constants";
import { formatDate, formatLongDate, formatTime, toDateKey } from "@/lib/dates";
import { firstName, getErrorMessage } from "@/lib/utils";
import { listAppointments } from "@/modules/agenda/api";
import { fetchCommissionSummary, listPayouts } from "@/modules/team/api";
import { useApp } from "@/providers/app-provider";
import type { Appointment, CommissionPayout, CommissionSummaryRow } from "@/types/domain";

interface PanelData {
  today: Appointment[];
  upcoming: Appointment[];
  week: CommissionSummaryRow | null;
  month: CommissionSummaryRow | null;
  payouts: CommissionPayout[];
}

/** Agenda propia y comisiones del profesional que inició sesión. */
export function MyPanelView() {
  const toast = useToast();
  const { staff: me, money } = useApp();
  const [data, setData] = useState<PanelData | null>(null);

  const ranges = useMemo(() => {
    const now = new Date();
    const today = startOfDay(now);
    return {
      todayStart: today,
      tomorrow: addDays(today, 1),
      weekAhead: addDays(today, 8),
      weekFrom: toDateKey(startOfWeek(now, { weekStartsOn: 1 })),
      monthFrom: toDateKey(startOfMonth(now)),
      to: toDateKey(now),
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const [todayRows, upcomingRows, week, month, payouts] = await Promise.all([
        listAppointments(ranges.todayStart.toISOString(), ranges.tomorrow.toISOString(), me.id),
        listAppointments(ranges.tomorrow.toISOString(), ranges.weekAhead.toISOString(), me.id),
        fetchCommissionSummary(ranges.weekFrom, ranges.to),
        fetchCommissionSummary(ranges.monthFrom, ranges.to),
        listPayouts(10),
      ]);
      setData({
        today: todayRows.filter((a) => a.status !== "cancelled"),
        upcoming: upcomingRows.filter((a) => !["cancelled", "no_show"].includes(a.status)),
        week: week.find((r) => r.staff_id === me.id) ?? null,
        month: month.find((r) => r.staff_id === me.id) ?? null,
        payouts: payouts.filter((p) => p.staff_id === me.id).slice(0, 5),
      });
    } catch (error) {
      toast.error(getErrorMessage(error));
      setData({ today: [], upcoming: [], week: null, month: null, payouts: [] });
    }
  }, [me.id, ranges, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!me.is_bookable) {
    return (
      <Card>
        <EmptyState
          icon={Lock}
          title="Tu perfil no atiende citas"
          description="Mi panel muestra la agenda y las comisiones del personal que atiende clientes."
          action={
            <Link href="/dashboard" className={buttonClasses({ variant: "outline" })}>
              Volver al inicio
            </Link>
          }
        />
      </Card>
    );
  }

  if (!data) return <Spinner />;

  const pendingToday = data.today.filter((a) => !["completed", "no_show"].includes(a.status));
  const next = pendingToday.find((a) => Date.parse(a.ends_at) > Date.now());

  return (
    <div>
      <PageHeader title={`Hola, ${firstName(me.full_name)}`} description={formatLongDate(new Date())} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Citas de hoy"
          value={String(data.today.length)}
          hint={pendingToday.length > 0 ? `${pendingToday.length} por atender` : "Todas atendidas"}
          icon={CalendarCheck2}
          tone="sage"
        />
        <StatCard label="Comisión de la semana" value={money(data.week?.commission_total ?? 0)} hint={`${data.week?.items_count ?? 0} servicios y productos`} icon={HandCoins} tone="ochre" />
        <StatCard label="Propinas de la semana" value={money(data.week?.tips_total ?? 0)} icon={Wallet} />
        <StatCard
          label="Por liquidar este mes"
          value={money((data.month?.commission_pending ?? 0) + (data.month?.tips_pending ?? 0))}
          hint={`Comisión del mes: ${money(data.month?.commission_total ?? 0)}`}
          icon={HandCoins}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader
            title="Tu agenda de hoy"
            description={next ? `Siguiente: ${formatTime(next.starts_at)} · ${next.client?.full_name ?? next.walk_in_name}` : undefined}
            action={
              <Link href="/agenda" className={buttonClasses({ variant: "outline", size: "sm" })}>
                Ver agenda
              </Link>
            }
          />
          {data.today.length === 0 ? (
            <EmptyState icon={CalendarDays} title="No tienes citas hoy" />
          ) : (
            <ul className="divide-y divide-line">
              {data.today.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="w-14 shrink-0">
                    <p className="text-sm font-semibold tabular-nums text-ink">{formatTime(a.starts_at)}</p>
                    <p className="text-[11px] tabular-nums text-muted">{formatTime(a.ends_at)}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{a.client?.full_name ?? a.walk_in_name}</p>
                    <p className="flex items-center gap-1 truncate text-xs text-muted">
                      {a.service?.name}
                      {a.processing_minutes > 0 ? (
                        <>
                          {" "}
                          · <Clock className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" /> pose {a.processing_minutes} min
                        </>
                      ) : null}
                    </p>
                  </div>
                  <Badge tone={APPOINTMENT_STATUS[a.status].tone}>{APPOINTMENT_STATUS[a.status].label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader title="Próximos 7 días" />
            {data.upcoming.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">Sin citas agendadas.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {data.upcoming.slice(0, 8).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="min-w-0 truncate text-ink">
                      {a.client?.full_name ?? a.walk_in_name} <span className="text-muted">· {a.service?.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-muted">
                      {formatDate(a.starts_at, "EEE d")} {formatTime(a.starts_at)}
                    </span>
                  </li>
                ))}
                {data.upcoming.length > 8 ? <li className="px-5 py-2.5 text-xs text-muted">y {data.upcoming.length - 8} más…</li> : null}
              </ul>
            )}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="Últimas liquidaciones" />
            {data.payouts.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">Aún no tienes liquidaciones registradas.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {data.payouts.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="text-muted">
                      {formatDate(p.period_start + "T00:00:00", "d MMM")} – {formatDate(p.period_end + "T00:00:00", "d MMM")}
                    </span>
                    <span className="font-semibold tabular-nums text-ink">{money(p.total_amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
