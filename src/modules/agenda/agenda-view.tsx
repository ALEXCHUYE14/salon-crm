"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { addDays, isSameDay, isToday, startOfDay } from "date-fns";
import { CalendarDays, CalendarOff, CalendarPlus, ChevronLeft, ChevronRight, Clock, Columns3, Layers, List } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { EmptyState, PageHeader, Spinner, Tabs } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { useCatalog } from "@/hooks/use-catalog";
import { APPOINTMENT_STATUS, TIME_OFF_LABELS, WEEKDAYS_SHORT } from "@/lib/constants";
import {
  dayBounds,
  formatDate,
  formatDuration,
  formatLongDate,
  formatTime,
  fromDateKey,
  minutesOfDay,
  minutesToTime,
  timeToMinutes,
  toDateKey,
  weekBounds,
} from "@/lib/dates";
import { cn, getErrorMessage } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import type { Appointment, StaffMember, StaffTimeOff } from "@/types/domain";
import { listAppointments, listTimeOff, subscribeToAppointments } from "./api";
import { AppointmentModal, type AppointmentDefaults } from "./components/appointment-modal";
import { TimeOffModal, type TimeOffDefaults } from "./components/time-off-modal";

type View = "day" | "week";

const HOUR_HEIGHT = 72;
const PX_PER_MIN = HOUR_HEIGHT / 60;
const MS_PER_MIN = 60_000;

/** Tramo [inicio, fin) en minutos del día `day` que ocupa un bloqueo (null si no lo toca). */
function blockMinutesOnDay(block: StaffTimeOff, day: Date): { start: number; end: number } | null {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = startOfDay(addDays(day, 1)).getTime();
  const start = Math.max(Date.parse(block.starts_at), dayStart);
  const end = Math.min(Date.parse(block.ends_at), dayEnd);
  if (end <= start) return null;
  return {
    start: Math.round((start - dayStart) / MS_PER_MIN),
    end: Math.round((end - dayStart) / MS_PER_MIN),
  };
}

function blockLabel(block: StaffTimeOff): string {
  return block.reason ? `${TIME_OFF_LABELS[block.kind]} · ${block.reason}` : TIME_OFF_LABELS[block.kind];
}

export function AgendaView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { settings, terms, staff: me, branch } = useApp();
  const branchId = branch?.id ?? null;
  const catalog = useCatalog();

  const [date, setDate] = useState<Date>(() => new Date());
  const [view, setView] = useState<View>("day");
  const [staffFilter, setStaffFilter] = useState<string>(me.role === "specialist" ? me.id : "all");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [timeOff, setTimeOff] = useState<StaffTimeOff[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [defaults, setDefaults] = useState<AppointmentDefaults>({
    dateKey: toDateKey(new Date()),
  });
  const [blockOpen, setBlockOpen] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<StaffTimeOff | null>(null);
  const [blockDefaults, setBlockDefaults] = useState<TimeOffDefaults>({
    dateKey: toDateKey(new Date()),
  });

  const range = useMemo(() => {
    if (view === "day") return dayBounds(date);
    const { start, end } = weekBounds(date);
    return { start: start.toISOString(), end: end.toISOString() };
  }, [date, view]);

  const load = useCallback(async () => {
    try {
      const staffId = staffFilter === "all" ? undefined : staffFilter;
      const [rows, blocks] = await Promise.all([
        listAppointments(range.start, range.end, staffId, branchId),
        // Los bloqueos no deben impedir ver la agenda si su tabla aún no existe
        listTimeOff(range.start, range.end, staffId).catch(() => [] as StaffTimeOff[]),
      ]);
      setAppointments(rows);
      setTimeOff(blocks);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end, staffFilter, toast, branchId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Realtime filtrado desde el inicio del rango visible
  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = subscribeToAppointments(
      range.start,
      () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void load(), 500);
      },
      { timeOff: true },
    );
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [range.start, load]);

  // Abrir "nueva cita" desde accesos rápidos (?nueva=1)
  useEffect(() => {
    if (searchParams.get("nueva") === "1" && !catalog.loading) {
      openCreate({ dateKey: toDateKey(new Date()) });
      router.replace(pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, catalog.loading]);

  const visibleStaff = useMemo<StaffMember[]>(() => {
    const bookable = catalog.bookableStaff;
    if (staffFilter === "all") return bookable;
    return bookable.filter((s) => s.id === staffFilter);
  }, [catalog.bookableStaff, staffFilter]);

  function openCreate(next: AppointmentDefaults) {
    setSelected(null);
    setDefaults({
      ...next,
      staffId: next.staffId ?? (staffFilter !== "all" ? staffFilter : undefined),
    });
    setModalOpen(true);
  }

  function openBlockCreate(next: TimeOffDefaults) {
    setSelectedBlock(null);
    setBlockDefaults({
      ...next,
      staffId: next.staffId ?? (staffFilter !== "all" ? staffFilter : undefined),
    });
    setBlockOpen(true);
  }

  function openBlockEdit(block: StaffTimeOff) {
    setSelectedBlock(block);
    setBlockDefaults({ dateKey: toDateKey(new Date(block.starts_at)) });
    setBlockOpen(true);
  }

  function openEdit(appt: Appointment) {
    setSelected(appt);
    setDefaults({ dateKey: toDateKey(new Date(appt.starts_at)) });
    setModalOpen(true);
  }

  function shift(direction: -1 | 1) {
    setDate((d) => addDays(d, direction * (view === "day" ? 1 : 7)));
  }

  const hoursForDay = settings.business_hours.find((h) => h.day === date.getDay());
  const dayStartMin = Math.floor(timeToMinutes(hoursForDay?.open ? hoursForDay.start : "09:00") / 60) * 60;
  const dayEndMin = Math.ceil(timeToMinutes(hoursForDay?.open ? hoursForDay.end : "19:00") / 60) * 60;
  const gridStart = Math.min(dayStartMin, ...appointments.map((a) => Math.floor(minutesOfDay(a.starts_at) / 60) * 60));
  const gridEnd = Math.max(dayEndMin, ...appointments.map((a) => Math.ceil(minutesOfDay(a.ends_at) / 60) * 60));
  const hours = Array.from({ length: Math.max(1, (gridEnd - gridStart) / 60) }, (_, i) => gridStart + i * 60);

  const active = appointments.filter((a) => a.status !== "cancelled");
  const title = view === "day" ? formatLongDate(date) : `Semana del ${formatDate(weekBounds(date).start, "d 'de' MMMM")}`;

  return (
    <div>
      <PageHeader
        title="Agenda"
        description={`${title} · ${active.length} citas`}
        actions={
          <>
            <Button variant="outline" icon={CalendarOff} onClick={() => openBlockCreate({ dateKey: toDateKey(date) })}>
              Bloquear horario
            </Button>
            <Button icon={CalendarPlus} onClick={() => openCreate({ dateKey: toDateKey(date) })}>
              Nueva cita
            </Button>
          </>
        }
      />

      <Card className="mb-4 flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Anterior">
            <Icon icon={ChevronLeft} />
          </Button>
          <Button variant="outline" onClick={() => setDate(new Date())}>
            Hoy
          </Button>
          <Button variant="outline" size="icon" onClick={() => shift(1)} aria-label="Siguiente">
            <Icon icon={ChevronRight} />
          </Button>
          <Input
            type="date"
            value={toDateKey(date)}
            onChange={(e) => e.target.value && setDate(fromDateKey(e.target.value))}
            className="w-auto"
            aria-label="Ir a fecha"
          />
        </div>
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center lg:justify-end">
          <div className="sm:w-56">
            <Select
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              disabled={me.role === "specialist"}
              aria-label={terms.professional}
            >
              <option value="all">Todos los {terms.professionals.toLowerCase()}</option>
              {catalog.bookableStaff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </Select>
          </div>
          <Tabs
            value={view}
            onChange={setView}
            items={[
              { value: "day", label: "Día", icon: Columns3 },
              { value: "week", label: "Semana", icon: CalendarDays },
            ]}
          />
        </div>
      </Card>

      {loading || catalog.loading ? (
        <Spinner />
      ) : view === "day" ? (
        <>
          {/* Móvil: lista cronológica */}
          <div className="md:hidden">
            <DayList
              date={date}
              appointments={appointments}
              blocks={timeOff}
              staff={catalog.staff}
              onSelect={openEdit}
              onSelectBlock={openBlockEdit}
              onCreate={() => openCreate({ dateKey: toDateKey(date) })}
            />
          </div>
          {/* Tableta / PC: grilla por profesional */}
          <Card className="hidden overflow-hidden md:block">
            {visibleStaff.length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title={`No hay ${terms.professionals.toLowerCase()} con agenda`}
                description="Activa «Recibe citas» en su ficha del equipo."
              />
            ) : (
              <div className="scrollbar-thin overflow-x-auto">
                <div className="min-w-max">
                  <div className="sticky top-0 z-10 flex border-b border-line bg-surface">
                    <div className="w-16 shrink-0" />
                    {visibleStaff.map((s) => (
                      <div key={s.id} className="flex w-56 shrink-0 items-center gap-2 border-l border-line px-3 py-3 xl:w-64">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">{s.full_name}</p>
                          {s.station_label ? <p className="truncate text-xs text-muted">{s.station_label}</p> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="relative flex">
                    <div className="w-16 shrink-0">
                      {hours.map((h) => (
                        <div
                          key={h}
                          className="relative border-b border-line/60 pr-2 text-right text-xs text-muted"
                          style={{ height: HOUR_HEIGHT }}
                        >
                          <span className="relative -top-2 bg-surface px-1">{minutesToTime(h)}</span>
                        </div>
                      ))}
                    </div>
                    {visibleStaff.map((s) => (
                      <StaffColumn
                        key={s.id}
                        staff={s}
                        date={date}
                        gridStart={gridStart}
                        hours={hours}
                        interval={settings.slot_interval_minutes}
                        appointments={appointments.filter((a) => a.staff_id === s.id && a.status !== "cancelled")}
                        blocks={timeOff.filter((b) => b.staff_id === s.id)}
                        onSelect={openEdit}
                        onSelectBlock={openBlockEdit}
                        onCreate={(time) =>
                          openCreate({
                            dateKey: toDateKey(date),
                            time,
                            staffId: s.id,
                          })
                        }
                      />
                    ))}
                    {isToday(date) ? <NowLine gridStart={gridStart} gridEnd={gridEnd} /> : null}
                  </div>
                </div>
              </div>
            )}
          </Card>
        </>
      ) : (
        <WeekView
          date={date}
          appointments={appointments}
          blocks={timeOff}
          staff={catalog.staff}
          onSelect={openEdit}
          onSelectBlock={openBlockEdit}
          onPickDay={(d) => {
            setDate(d);
            setView("day");
          }}
        />
      )}

      <AppointmentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => void load()}
        appointment={selected}
        defaults={defaults}
        staff={catalog.bookableStaff}
        services={catalog.services}
        categories={catalog.categories}
      />

      <TimeOffModal
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        onSaved={() => void load()}
        block={selectedBlock}
        defaults={blockDefaults}
        staff={catalog.bookableStaff}
      />
    </div>
  );
}

interface StaffColumnProps {
  staff: StaffMember;
  date: Date;
  gridStart: number;
  hours: number[];
  interval: number;
  appointments: Appointment[];
  blocks: StaffTimeOff[];
  onSelect: (appt: Appointment) => void;
  onSelectBlock: (block: StaffTimeOff) => void;
  onCreate: (time: string) => void;
}

function StaffColumn({
  staff,
  date,
  gridStart,
  hours,
  interval,
  appointments,
  blocks,
  onSelect,
  onSelectBlock,
  onCreate,
}: StaffColumnProps) {
  const shiftDay = staff.work_schedule.find((w) => w.day === date.getDay());
  const offStart = shiftDay ? (timeToMinutes(shiftDay.start) - gridStart) * PX_PER_MIN : 0;
  const offEnd = shiftDay ? (timeToMinutes(shiftDay.end) - gridStart) * PX_PER_MIN : 0;
  const totalHeight = hours.length * HOUR_HEIGHT;

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const minutes = gridStart + (event.clientY - rect.top) / PX_PER_MIN;
    const rounded = Math.floor(minutes / interval) * interval;
    onCreate(minutesToTime(Math.max(0, rounded)));
  }

  return (
    <div
      className="relative w-56 shrink-0 cursor-crosshair border-l border-line xl:w-64"
      style={{ height: totalHeight }}
      onClick={handleClick}
    >
      {hours.map((h) => (
        <div key={h} className="border-b border-line/60" style={{ height: HOUR_HEIGHT }}>
          <div className="h-1/2 border-b border-dashed border-line/40" />
        </div>
      ))}
      {staff.work_schedule.length > 0 ? (
        shiftDay ? (
          <>
            <div
              className="hatched pointer-events-none absolute inset-x-0 top-0 bg-surface-2/60"
              style={{ height: Math.max(0, offStart) }}
            />
            <div
              className="hatched pointer-events-none absolute inset-x-0 bottom-0 bg-surface-2/60"
              style={{ top: Math.min(totalHeight, offEnd) }}
            />
          </>
        ) : (
          <div className="hatched pointer-events-none absolute inset-0 bg-surface-2/60" />
        )
      ) : null}
      {blocks.map((block) => {
        const span = blockMinutesOnDay(block, date);
        if (!span) return null;
        const gridEndMin = gridStart + hours.length * 60;
        const startMin = Math.max(span.start, gridStart);
        const endMin = Math.min(span.end, gridEndMin);
        if (endMin <= startMin) return null;
        const height = (endMin - startMin) * PX_PER_MIN;
        return (
          <button
            key={block.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectBlock(block);
            }}
            className="hatched absolute inset-x-0 z-[1] overflow-hidden border-y border-clay/30 bg-clay-soft/80 px-2 text-left hover:bg-clay-soft"
            style={{ top: (startMin - gridStart) * PX_PER_MIN, height }}
            title={blockLabel(block)}
          >
            <span className="mt-1 inline-flex max-w-full items-center gap-1 rounded bg-surface/90 px-1.5 py-0.5 text-[11px] font-medium text-clay-dark">
              <CalendarOff className="h-3 w-3 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <span className="truncate">{blockLabel(block)}</span>
            </span>
          </button>
        );
      })}
      {appointments.map((appt) => {
        const top = (minutesOfDay(appt.starts_at) - gridStart) * PX_PER_MIN;
        const height = Math.max((appt.duration_minutes + appt.processing_minutes) * PX_PER_MIN, 30);
        const status = APPOINTMENT_STATUS[appt.status];
        const muted = appt.status === "completed" || appt.status === "no_show";
        return (
          <button
            key={appt.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(appt);
            }}
            className={cn(
              "absolute inset-x-1.5 z-[2] overflow-hidden rounded-lg border border-line bg-surface text-left shadow-card transition-shadow hover:shadow-pop",
              muted && "opacity-60",
            )}
            style={{
              top,
              height,
              borderLeft: `4px solid ${appt.staff?.color ?? staff.color}`,
            }}
          >
            <div className="px-2 py-1.5">
              <p className="flex items-center gap-1 truncate text-xs font-semibold text-ink">
                {appt.booking_id ? (
                  <Layers className="h-3 w-3 shrink-0 text-sage" strokeWidth={2} aria-label="Visita con varios servicios" />
                ) : null}
                <span className="truncate">{appt.client?.full_name ?? appt.walk_in_name}</span>
              </p>
              <p className="truncate text-[11px] text-muted">
                {formatTime(appt.starts_at)} · {appt.service?.name}
              </p>
              {height > 56 ? (
                <Badge tone={status.tone} className="mt-1">
                  {status.label}
                </Badge>
              ) : null}
            </div>
            {appt.processing_minutes > 0 ? (
              <div
                className="hatched absolute inset-x-0 bottom-0 border-t border-dashed border-line"
                style={{ height: appt.processing_minutes * PX_PER_MIN }}
                title={`Pose: ${appt.processing_minutes} min`}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function NowLine({ gridStart, gridEnd }: { gridStart: number; gridEnd: number }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < gridStart || minutes > gridEnd) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 z-[5] flex items-center" style={{ top: (minutes - gridStart) * PX_PER_MIN }}>
      <span className="ml-14 h-2.5 w-2.5 rounded-full bg-clay" />
      <span className="h-px flex-1 bg-clay" />
    </div>
  );
}

interface DayListProps {
  date: Date;
  appointments: Appointment[];
  blocks: StaffTimeOff[];
  staff: StaffMember[];
  onSelect: (a: Appointment) => void;
  onSelectBlock: (b: StaffTimeOff) => void;
  onCreate: () => void;
}

function DayList({ date, appointments, blocks, staff, onSelect, onSelectBlock, onCreate }: DayListProps) {
  const dayBlocks = blocks.filter((b) => blockMinutesOnDay(b, date) !== null);
  const blockList =
    dayBlocks.length > 0 ? (
      <ul className="mb-2 space-y-2">
        {dayBlocks.map((b) => {
          const span = blockMinutesOnDay(b, date);
          const who = staff.find((s) => s.id === b.staff_id)?.full_name ?? "";
          return (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => onSelectBlock(b)}
                className="hatched flex w-full items-center gap-3 rounded-xl border border-clay/30 bg-clay-soft/70 p-3 text-left"
              >
                <Icon icon={CalendarOff} className="text-clay-dark" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-clay-dark">{blockLabel(b)}</p>
                  <p className="truncate text-xs text-clay-dark/80">
                    {who}
                    {span
                      ? ` · ${span.start === 0 && span.end >= 1440 ? "Todo el día" : `${minutesToTime(span.start)}–${minutesToTime(Math.min(span.end, 1439))}`}`
                      : ""}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    ) : null;

  if (appointments.length === 0) {
    return (
      <>
        {blockList}
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="Sin citas en este día"
            action={
              <Button icon={CalendarPlus} onClick={onCreate}>
                Agendar
              </Button>
            }
          />
        </Card>
      </>
    );
  }
  return (
    <>
      {blockList}
      <ul className="space-y-2">
        {appointments.map((appt) => {
          const status = APPOINTMENT_STATUS[appt.status];
          return (
            <li key={appt.id}>
              <button
                type="button"
                onClick={() => onSelect(appt)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left shadow-card active:bg-surface-2",
                  appt.status === "cancelled" && "opacity-50",
                )}
                style={{
                  borderLeft: `4px solid ${appt.staff?.color ?? "#5C5852"}`,
                }}
              >
                <div className="w-14 shrink-0">
                  <p className="text-sm font-semibold tabular-nums text-ink">{formatTime(appt.starts_at)}</p>
                  <p className="text-[11px] text-muted">{formatTime(appt.ends_at)}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{appt.client?.full_name ?? appt.walk_in_name}</p>
                  <p className="truncate text-xs text-muted">
                    {appt.service?.name} · {appt.staff?.full_name}
                  </p>
                  {appt.processing_minutes > 0 ? (
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ochre-dark">
                      <Icon icon={Clock} className="h-3 w-3" /> Pose {formatDuration(appt.processing_minutes)}
                    </p>
                  ) : null}
                </div>
                <Badge tone={status.tone}>{status.label}</Badge>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function WeekView({
  date,
  appointments,
  blocks,
  staff,
  onSelect,
  onSelectBlock,
  onPickDay,
}: {
  date: Date;
  appointments: Appointment[];
  blocks: StaffTimeOff[];
  staff: StaffMember[];
  onSelect: (a: Appointment) => void;
  onSelectBlock: (b: StaffTimeOff) => void;
  onPickDay: (d: Date) => void;
}) {
  const { days } = weekBounds(date);
  return (
    <div className="grid gap-3 md:grid-cols-7">
      {days.map((day) => {
        const items = appointments.filter((a) => isSameDay(new Date(a.starts_at), day) && a.status !== "cancelled");
        const dayBlocks = blocks.filter((b) => blockMinutesOnDay(b, day) !== null);
        return (
          <Card key={day.toISOString()} className={cn("flex flex-col", isToday(day) && "border-sage/50")}>
            <button
              type="button"
              onClick={() => onPickDay(day)}
              className="flex items-center justify-between border-b border-line px-3 py-2.5 text-left hover:bg-surface-2"
            >
              <span className="text-sm font-medium text-ink">
                {WEEKDAYS_SHORT[day.getDay()]} {day.getDate()}
              </span>
              <span className="flex items-center gap-1 text-xs text-muted">
                <Icon icon={List} className="h-3.5 w-3.5" />
                {items.length}
              </span>
            </button>
            <ul className="flex-1 space-y-1.5 p-2">
              {dayBlocks.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => onSelectBlock(b)}
                    className="hatched w-full rounded-lg bg-clay-soft/80 px-2 py-1.5 text-left hover:bg-clay-soft"
                  >
                    <p className="truncate text-[11px] font-semibold text-clay-dark">{TIME_OFF_LABELS[b.kind]}</p>
                    <p className="truncate text-[11px] text-clay-dark/80">{staff.find((s) => s.id === b.staff_id)?.full_name ?? ""}</p>
                  </button>
                </li>
              ))}
              {items.length === 0 && dayBlocks.length === 0 ? <li className="px-1 py-2 text-xs text-muted">Libre</li> : null}
              {items.map((appt) => (
                <li key={appt.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(appt)}
                    className="w-full rounded-lg bg-surface-2 px-2 py-1.5 text-left hover:bg-line"
                    style={{
                      borderLeft: `3px solid ${appt.staff?.color ?? "#5C5852"}`,
                    }}
                  >
                    <p className="text-[11px] font-semibold tabular-nums text-ink">{formatTime(appt.starts_at)}</p>
                    <p className="truncate text-xs text-ink">{appt.client?.full_name ?? appt.walk_in_name}</p>
                    <p className="truncate text-[11px] text-muted">{appt.service?.name}</p>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
