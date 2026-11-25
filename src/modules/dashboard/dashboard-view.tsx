"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarCheck2,
  CalendarDays,
  CalendarPlus,
  Coins,
  HandCoins,
  PackageOpen,
  Receipt,
  RefreshCw,
  UserPlus,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { EmptyState, PageHeader, Spinner, StatCard } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { APPOINTMENT_STATUS, APPOINTMENT_STATUS_ORDER } from "@/lib/constants";
import { dayBounds, formatLongDate, formatTime } from "@/lib/dates";
import { cn, firstName, formatNumber, getErrorMessage } from "@/lib/utils";
import { listAppointments, subscribeToAppointments } from "@/modules/agenda/api";
import { fetchDashboard } from "@/modules/reports/api";
import { useApp } from "@/providers/app-provider";
import type { Appointment, DashboardData } from "@/types/domain";

export function DashboardView() {
  const { staff, money, can, settings, terms, branch } = useApp();
  const branchId = branch?.id ?? null;
  const toast = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { start, end } = dayBounds(new Date());
      const [dashboard, todays] = await Promise.all([
        fetchDashboard(undefined, branchId),
        can("agenda") ? listAppointments(start, end, staff.role === "specialist" ? staff.id : undefined, branchId) : Promise.resolve([]),
      ]);
      setData(dashboard);
      setAppointments(todays);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [can, staff.id, staff.role, toast, branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!can("agenda")) return;
    const { start } = dayBounds(new Date());
    let timer: number | undefined;
    const unsubscribe = subscribeToAppointments(start, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 600);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [can, load]);

  if (loading || !data) return <Spinner />;

  const totalAppointments = Object.entries(data.appointments)
    .filter(([status]) => status !== "cancelled")
    .reduce((sum, [, n]) => sum + Number(n ?? 0), 0);
  const completed = Number(data.appointments.completed ?? 0);
  const avgTicket = data.transactions > 0 ? data.revenue / data.transactions : 0;
  const visible = appointments.filter((a) => a.status !== "cancelled");

  return (
    <div>
      <PageHeader
        title={`Hola, ${firstName(staff.full_name)}`}
        description={`${formatLongDate(new Date())} · ${settings.business_name}`}
        actions={
          <>
            <Button variant="ghost" size="icon" onClick={() => void load()} aria-label="Actualizar" title="Actualizar">
              <Icon icon={RefreshCw} />
            </Button>
            {can("agenda") ? (
              <Link href="/agenda?nueva=1" className={buttonClasses({ variant: "outline" })}>
                <Icon icon={CalendarPlus} /> Nueva cita
              </Link>
            ) : null}
            {can("clients") ? (
              <Link href="/clientes?nuevo=1" className={buttonClasses({ variant: "outline" })}>
                <Icon icon={UserPlus} /> Nuevo cliente
              </Link>
            ) : null}
            {can("pos") ? (
              <Link href="/caja" className={buttonClasses()}>
                <Icon icon={Wallet} /> Cobrar
              </Link>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Ventas del día"
          value={money(data.revenue)}
          hint={`${formatNumber(data.transactions, settings.locale)} tickets · propinas ${money(data.tips)}`}
          icon={Coins}
          tone="sage"
        />
        <StatCard
          label="Citas de hoy"
          value={`${completed}/${totalAppointments}`}
          hint="Completadas / agendadas"
          icon={CalendarCheck2}
          tone="neutral"
        />
        <StatCard label="Comisiones acumuladas" value={money(data.commissions)} hint={`Generadas hoy por ${terms.professionals.toLowerCase()}`} icon={HandCoins} tone="ochre" />
        <StatCard label="Ticket promedio" value={money(avgTicket)} hint="Sin propinas" icon={Receipt} tone="neutral" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader
            title="Agenda de hoy"
            description={`${visible.length} citas activas`}
            action={
              can("agenda") ? (
                <Link href="/agenda" className={buttonClasses({ variant: "ghost", size: "sm" })}>
                  <Icon icon={CalendarDays} /> Ver agenda
                </Link>
              ) : null
            }
          />
          {visible.length === 0 ? (
            <EmptyState icon={CalendarDays} title="Sin citas para hoy" description="Las citas nuevas aparecerán aquí en tiempo real." />
          ) : (
            <ul className="divide-y divide-line">
              {visible.map((appt) => {
                const status = APPOINTMENT_STATUS[appt.status];
                return (
                  <li key={appt.id} className="flex items-center gap-4 px-5 py-3">
                    <div className="w-14 shrink-0 text-sm font-semibold tabular-nums text-ink">{formatTime(appt.starts_at)}</div>
                    <span className="h-9 w-1 shrink-0 rounded-full" style={{ backgroundColor: appt.staff?.color ?? "#5C5852" }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{appt.client?.full_name ?? appt.walk_in_name}</p>
                      <p className="truncate text-xs text-muted">
                        {appt.service?.name} · {appt.staff?.full_name}
                      </p>
                    </div>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Estado de citas" />
            <CardBody className="space-y-2">
              {APPOINTMENT_STATUS_ORDER.map((status) => {
                const n = Number(data.appointments[status] ?? 0);
                const pct = totalAppointments > 0 ? Math.round((n / Math.max(totalAppointments, 1)) * 100) : 0;
                return (
                  <div key={status} className="flex items-center gap-3 text-sm">
                    <span className="w-24 shrink-0 text-muted">{APPOINTMENT_STATUS[status].label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className={cn("h-full rounded-full", status === "cancelled" || status === "no_show" ? "bg-clay" : "bg-sage")}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <span className="w-6 text-right tabular-nums text-ink">{n}</span>
                  </div>
                );
              })}
            </CardBody>
          </Card>

          {can("inventory") ? (
            <Card>
              <CardHeader
                title="Alertas de stock"
                description={data.low_stock_count > 0 ? `${data.low_stock_count} productos en el mínimo` : "Inventario en orden"}
                action={
                  <Link href="/inventario?bajo=1" className={buttonClasses({ variant: "ghost", size: "sm" })}>
                    Ver
                  </Link>
                }
              />
              {data.low_stock.length === 0 ? (
                <EmptyState icon={PackageOpen} title="Sin alertas" />
              ) : (
                <ul className="divide-y divide-line">
                  {data.low_stock.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon icon={AlertTriangle} className="text-ochre" />
                        <span className="truncate text-ink">{item.name}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-ochre-dark">
                        {formatNumber(item.stock, settings.locale, 1)} / {formatNumber(item.min_stock, settings.locale, 0)} {item.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
