"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addMinutes } from "date-fns";
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CalendarOff,
  CheckCircle2,
  Clock,
  HandCoins,
  Layers,
  MessageCircle,
  PlayCircle,
  Plus,
  Save,
  Trash2,
  UserCheck,
  UserX,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  APPOINTMENT_SOURCES,
  APPOINTMENT_STATUS,
  APPOINTMENT_STATUS_ORDER,
  DEPOSIT_STATUS,
  PAYABLE_METHODS,
  PAYMENT_METHOD_LABELS,
  TIME_OFF_LABELS,
} from "@/lib/constants";
import {
  buildTimeSlots,
  combineDateTime,
  formatDate,
  formatDuration,
  formatTime,
  minutesToTime,
  timeToMinutes,
  toDateKey,
} from "@/lib/dates";
import { buildWhatsAppUrl, fillTemplate, getErrorMessage, nullIfEmpty, round2, toNumber, uuidv4 } from "@/lib/utils";
import { ClientPicker } from "@/modules/clients/components/client-picker";
import { useApp } from "@/providers/app-provider";
import type {
  Appointment,
  AppointmentDeposit,
  AppointmentSource,
  AppointmentStatus,
  ClientRef,
  PaymentMethodKey,
  Service,
  ServiceCategory,
  StaffMember,
  StaffTimeOff,
} from "@/types/domain";
import {
  createAppointments,
  fetchClientNoShows,
  findConflicts,
  listAppointmentDeposits,
  listBookingAppointments,
  recordDeposit,
  resolveDeposit,
  listTimeOff,
  saveAppointment,
  updateAppointmentStatus,
} from "../api";

export interface AppointmentDefaults {
  staffId?: string;
  dateKey: string;
  time?: string;
}

interface AppointmentModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  appointment: Appointment | null;
  defaults: AppointmentDefaults;
  staff: StaffMember[];
  services: Service[];
  categories: ServiceCategory[];
}

interface FormState {
  client: ClientRef | null;
  walkIn: boolean;
  walkInName: string;
  serviceId: string;
  staffId: string;
  dateKey: string;
  time: string;
  duration: number;
  processing: number;
  price: number;
  status: AppointmentStatus;
  source: AppointmentSource;
  notes: string;
}

/** Servicio adicional de una reserva (solo al crear). */
interface ExtraLine {
  key: string;
  serviceId: string;
  staffId: string;
  time: string;
  duration: number;
  processing: number;
  price: number;
}

const MAX_EXTRA_SERVICES = 5;
const ACTIVE_FOR_BOOKING: AppointmentStatus[] = ["scheduled", "confirmed", "waiting", "in_service"];

function lineEnd(time: string, duration: number, processing: number): number {
  return timeToMinutes(time) + duration + processing;
}

function buildInitialState(appointment: Appointment | null, defaults: AppointmentDefaults, staff: StaffMember[]): FormState {
  if (appointment) {
    const start = new Date(appointment.starts_at);
    return {
      client: appointment.client,
      walkIn: !appointment.client_id,
      walkInName: appointment.walk_in_name ?? "",
      serviceId: appointment.service_id,
      staffId: appointment.staff_id,
      dateKey: toDateKey(start),
      time: formatTime(appointment.starts_at),
      duration: appointment.duration_minutes,
      processing: appointment.processing_minutes,
      price: Number(appointment.price),
      status: appointment.status,
      source: appointment.source,
      notes: appointment.notes ?? "",
    };
  }
  return {
    client: null,
    walkIn: false,
    walkInName: "",
    serviceId: "",
    staffId: defaults.staffId ?? staff[0]?.id ?? "",
    dateKey: defaults.dateKey,
    time: defaults.time ?? "09:00",
    duration: 30,
    processing: 0,
    price: 0,
    status: "scheduled",
    source: "walk_in",
    notes: "",
  };
}

export function AppointmentModal({ open, onClose, onSaved, appointment, defaults, staff, services, categories }: AppointmentModalProps) {
  const router = useRouter();
  const toast = useToast();
  const { settings, terms, can, staff: me } = useApp();
  const [form, setForm] = useState<FormState>(() => buildInitialState(appointment, defaults, staff));
  const [conflicts, setConflicts] = useState<Appointment[]>([]);
  const [blocks, setBlocks] = useState<StaffTimeOff[]>([]);
  const [extras, setExtras] = useState<ExtraLine[]>([]);
  const [siblings, setSiblings] = useState<Appointment[]>([]);
  const [applyToBooking, setApplyToBooking] = useState(true);
  const [deposits, setDeposits] = useState<AppointmentDeposit[] | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositMethod, setDepositMethod] = useState<PaymentMethodKey>("cash");
  const [depositBusy, setDepositBusy] = useState<string | null>(null);
  const [noShows, setNoShows] = useState(0);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState<AppointmentStatus | null>(null);

  useEffect(() => {
    if (open) {
      setForm(buildInitialState(appointment, defaults, staff));
      setConflicts([]);
      setBlocks([]);
      setExtras([]);
      setSiblings([]);
      setApplyToBooking(true);
      setDeposits(null);
      setDepositAmount("");
    }
    // Reinicia el formulario solo al abrir o cambiar de cita
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, appointment?.id]);

  // Otras citas de la misma reserva (varios servicios en una visita)
  useEffect(() => {
    if (!open || !appointment?.booking_id) return;
    let cancelled = false;
    listBookingAppointments(appointment.booking_id)
      .then((rows) => {
        if (!cancelled) setSiblings(rows.filter((r) => r.id !== appointment.id));
      })
      .catch(() => {
        if (!cancelled) setSiblings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, appointment?.id, appointment?.booking_id]);

  // Adelantos de la cita (si la tabla aún no existe, la sección no se muestra)
  const loadDeposits = useCallback(async () => {
    if (!appointment) return;
    try {
      setDeposits(await listAppointmentDeposits([appointment.id]));
    } catch {
      setDeposits(null);
    }
  }, [appointment]);

  useEffect(() => {
    if (open && appointment) void loadDeposits();
  }, [open, appointment, loadDeposits]);

  // Inasistencias previas del cliente
  const clientId = form.walkIn ? null : (form.client?.id ?? null);
  useEffect(() => {
    if (!open || !clientId) {
      setNoShows(0);
      return;
    }
    let cancelled = false;
    fetchClientNoShows(clientId)
      .then((n) => {
        if (!cancelled) setNoShows(n);
      })
      .catch(() => {
        if (!cancelled) setNoShows(0);
      });
    return () => {
      cancelled = true;
    };
  }, [open, clientId]);

  async function handleRecordDeposit() {
    if (!appointment) return;
    const amount = round2(toNumber(depositAmount));
    if (amount <= 0) return toast.error("Ingresa el monto del adelanto");
    setDepositBusy("new");
    try {
      await recordDeposit(appointment.id, amount, depositMethod, null);
      toast.success("Adelanto registrado en caja");
      setDepositAmount("");
      await loadDeposits();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setDepositBusy(null);
    }
  }

  async function handleResolveDeposit(deposit: AppointmentDeposit, action: "refund" | "forfeit") {
    const question =
      action === "refund"
        ? `¿Devolver ${settings.currency_symbol} ${deposit.amount.toFixed(2)} al cliente? Sale de la caja abierta.`
        : `¿Retener el adelanto de ${settings.currency_symbol} ${deposit.amount.toFixed(2)} por inasistencia?`;
    if (!window.confirm(question)) return;
    setDepositBusy(deposit.id);
    try {
      await resolveDeposit(deposit.id, action, null);
      toast.success(action === "refund" ? "Adelanto devuelto" : "Adelanto retenido");
      await loadDeposits();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setDepositBusy(null);
    }
  }

  const isSpecialist = me.role === "specialist";
  const staffOptions = isSpecialist ? staff.filter((s) => s.id === me.id) : staff;
  const selectedStaff = staff.find((s) => s.id === form.staffId) ?? null;
  const selectedService = services.find((s) => s.id === form.serviceId) ?? null;

  const startDate = useMemo(() => combineDateTime(form.dateKey, form.time), [form.dateKey, form.time]);
  const endDate = useMemo(() => addMinutes(startDate, form.duration + form.processing), [startDate, form.duration, form.processing]);

  // Prevención de choques: verificación en vivo (la BD también lo impide con EXCLUDE)
  useEffect(() => {
    if (!open || !form.staffId || !form.dateKey || !form.time) return;
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const [rows, blockRows] = await Promise.all([
          findConflicts(form.staffId, startDate.toISOString(), endDate.toISOString(), appointment?.id),
          listTimeOff(startDate.toISOString(), endDate.toISOString(), form.staffId).catch(() => [] as StaffTimeOff[]),
        ]);
        if (!cancelled) {
          setConflicts(rows);
          setBlocks(blockRows);
        }
      } catch {
        if (!cancelled) {
          setConflicts([]);
          setBlocks([]);
        }
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, form.staffId, form.dateKey, form.time, startDate, endDate, appointment?.id]);

  const warnings = useMemo(() => {
    const list: string[] = [];
    const day = startDate.getDay();
    const startMin = timeToMinutes(form.time);
    const endMin = startMin + form.duration + form.processing;
    const hours = settings.business_hours.find((h) => h.day === day);
    if (!hours || !hours.open) list.push("El negocio figura cerrado ese día.");
    else if (startMin < timeToMinutes(hours.start) || endMin > timeToMinutes(hours.end))
      list.push(`Fuera del horario de atención (${hours.start}–${hours.end}).`);
    if (selectedStaff && selectedStaff.work_schedule.length > 0) {
      const shift = selectedStaff.work_schedule.find((w) => w.day === day);
      if (!shift) list.push(`${selectedStaff.full_name} no trabaja ese día.`);
      else if (startMin < timeToMinutes(shift.start) || endMin > timeToMinutes(shift.end))
        list.push(`Fuera del turno de ${selectedStaff.full_name} (${shift.start}–${shift.end}).`);
    }
    return list;
  }, [form.time, form.duration, form.processing, startDate, settings.business_hours, selectedStaff]);

  const baseSlots = useMemo(() => buildTimeSlots(6 * 60, 23 * 60, settings.slot_interval_minutes), [settings.slot_interval_minutes]);
  const optionsFor = (time: string) => (baseSlots.includes(time) ? baseSlots : [...baseSlots, time].sort());
  const timeOptions = useMemo(() => optionsFor(form.time), [baseSlots, form.time]); // eslint-disable-line react-hooks/exhaustive-deps

  const overallEnd = Math.max(
    lineEnd(form.time, form.duration, form.processing),
    ...extras.map((x) => lineEnd(x.time, x.duration, x.processing)),
  );

  function addExtra() {
    if (extras.length >= MAX_EXTRA_SERVICES) return;
    const last = extras[extras.length - 1];
    const end = last ? lineEnd(last.time, last.duration, last.processing) : lineEnd(form.time, form.duration, form.processing);
    setExtras((current) => [
      ...current,
      {
        key: uuidv4(),
        serviceId: "",
        staffId: last?.staffId ?? form.staffId,
        time: minutesToTime(Math.min(end, 23 * 60 + 55)),
        duration: 30,
        processing: 0,
        price: 0,
      },
    ]);
  }

  function updateExtra(key: string, patch: Partial<ExtraLine>) {
    setExtras((current) => current.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }

  function changeExtraService(key: string, serviceId: string) {
    const service = services.find((s) => s.id === serviceId);
    updateExtra(key, {
      serviceId,
      ...(service ? { duration: service.duration_minutes, processing: service.processing_minutes, price: Number(service.price) } : {}),
    });
  }

  /** Valida los servicios adicionales; devuelve un mensaje de error o null. */
  async function validateExtras(): Promise<string | null> {
    const lines = [{ label: "el primer servicio", staffId: form.staffId, time: form.time, duration: form.duration, processing: form.processing }];
    for (const [i, x] of extras.entries()) {
      if (!x.serviceId) return `Elige el servicio adicional ${i + 1}`;
      if (!x.staffId) return `Elige el ${terms.professional.toLowerCase()} del servicio adicional ${i + 1}`;
      lines.push({ label: `el servicio adicional ${i + 1}`, staffId: x.staffId, time: x.time, duration: x.duration, processing: x.processing });
    }
    // Dos servicios del mismo profesional no pueden solaparse
    for (let a = 0; a < lines.length; a++) {
      for (let b = a + 1; b < lines.length; b++) {
        const la = lines[a];
        const lb = lines[b];
        if (la.staffId !== lb.staffId) continue;
        const aStart = timeToMinutes(la.time);
        const bStart = timeToMinutes(lb.time);
        if (aStart < lineEnd(lb.time, lb.duration, lb.processing) && bStart < lineEnd(la.time, la.duration, la.processing)) {
          const text = `${lines[a].label} y ${lines[b].label} se cruzan con el mismo ${terms.professional.toLowerCase()}`;
          return text.charAt(0).toUpperCase() + text.slice(1);
        }
      }
    }
    // Choques con otras citas y bloqueos ya guardados
    const checks = await Promise.all(
      extras.map(async (x) => {
        const start = combineDateTime(form.dateKey, x.time);
        const end = addMinutes(start, x.duration + x.processing);
        const [busy, off] = await Promise.all([
          findConflicts(x.staffId, start.toISOString(), end.toISOString()),
          listTimeOff(start.toISOString(), end.toISOString(), x.staffId).catch(() => [] as StaffTimeOff[]),
        ]);
        return { busy: busy.length > 0, off: off.length > 0 };
      }),
    );
    const bad = checks.findIndex((c) => c.busy || c.off);
    if (bad >= 0) {
      const who = staff.find((s) => s.id === extras[bad].staffId)?.full_name ?? terms.professional;
      return checks[bad].off
        ? `${who} tiene el horario bloqueado para el servicio adicional ${bad + 1}`
        : `El servicio adicional ${bad + 1} se cruza con otra cita de ${who}`;
    }
    return null;
  }

  const groupedServices = useMemo(() => {
    const groups = categories.map((c) => ({ id: c.id, name: c.name, items: services.filter((s) => s.category_id === c.id) }));
    const uncategorized = services.filter((s) => !s.category_id || !categories.some((c) => c.id === s.category_id));
    if (uncategorized.length) groups.push({ id: "none", name: "Sin categoría", items: uncategorized });
    return groups.filter((g) => g.items.length > 0);
  }, [categories, services]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleServiceChange(serviceId: string) {
    const service = services.find((s) => s.id === serviceId);
    setForm((current) => ({
      ...current,
      serviceId,
      duration: service?.duration_minutes ?? current.duration,
      processing: service?.processing_minutes ?? current.processing,
      price: service ? Number(service.price) : current.price,
    }));
  }

  async function handleSave() {
    if (!form.serviceId) return toast.error("Selecciona un servicio");
    if (!form.staffId) return toast.error(`Selecciona un ${terms.professional.toLowerCase()}`);
    if (!form.walkIn && !form.client) return toast.error("Selecciona un cliente o marca «Cliente de paso»");
    if (form.walkIn && !form.walkInName.trim()) return toast.error("Escribe el nombre del cliente de paso");
    if (conflicts.length > 0) return toast.error("El horario se cruza con otra cita. Elige otra hora.");
    // Una cita ya existente puede quedar dentro de un bloqueo creado después: solo se valida si cambia el horario o el profesional
    const scheduleChanged =
      !appointment ||
      appointment.staff_id !== form.staffId ||
      Date.parse(appointment.starts_at) !== startDate.getTime() ||
      Date.parse(appointment.ends_at) !== endDate.getTime();
    if (blocks.length > 0 && scheduleChanged && !["cancelled", "no_show"].includes(form.status)) {
      return toast.error(`${selectedStaff?.full_name ?? "El profesional"} tiene el horario bloqueado. Elige otra hora.`);
    }

    setSaving(true);
    try {
      if (!appointment && extras.length > 0) {
        const problem = await validateExtras();
        if (problem) {
          toast.error(problem);
          return;
        }
        const bookingId = uuidv4();
        const shared = {
          booking_id: bookingId,
          client_id: form.walkIn ? null : (form.client?.id ?? null),
          walk_in_name: form.walkIn ? form.walkInName.trim() : null,
          status: form.status,
          source: form.source,
          notes: nullIfEmpty(form.notes),
        };
        await createAppointments([
          {
            ...shared,
            staff_id: form.staffId,
            service_id: form.serviceId,
            starts_at: startDate.toISOString(),
            duration_minutes: form.duration,
            processing_minutes: form.processing,
            price: form.price,
          },
          ...extras.map((x) => ({
            ...shared,
            staff_id: x.staffId,
            service_id: x.serviceId,
            starts_at: combineDateTime(form.dateKey, x.time).toISOString(),
            duration_minutes: x.duration,
            processing_minutes: x.processing,
            price: x.price,
          })),
        ]);
        toast.success(`Reserva agendada con ${extras.length + 1} servicios`);
        onSaved();
        onClose();
        return;
      }

      await saveAppointment(
        {
          client_id: form.walkIn ? null : (form.client?.id ?? null),
          walk_in_name: form.walkIn ? form.walkInName.trim() : null,
          staff_id: form.staffId,
          service_id: form.serviceId,
          starts_at: startDate.toISOString(),
          duration_minutes: form.duration,
          processing_minutes: form.processing,
          price: form.price,
          status: form.status,
          source: form.source,
          notes: nullIfEmpty(form.notes),
        },
        appointment?.id,
      );
      toast.success(appointment ? "Cita actualizada" : "Cita agendada");
      onSaved();
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleStatus(status: AppointmentStatus) {
    if (!appointment) return;
    let reason: string | undefined;
    if (status === "cancelled") {
      const input = window.prompt("Motivo de la cancelación (opcional)") ?? undefined;
      reason = input?.trim() || undefined;
    }
    // Confirmar, llegada, cancelar o inasistencia se aplican a toda la visita; "En atención" solo a esta cita
    const withSiblings = applyToBooking && status !== "in_service" && siblings.length > 0;
    const ids = withSiblings
      ? [appointment.id, ...siblings.filter((s) => ACTIVE_FOR_BOOKING.includes(s.status) && s.status !== status).map((s) => s.id)]
      : [appointment.id];
    setStatusBusy(status);
    try {
      await updateAppointmentStatus(ids, status, reason);
      toast.success(
        ids.length > 1 ? `${ids.length} citas marcadas como «${APPOINTMENT_STATUS[status].label}»` : `Cita marcada como «${APPOINTMENT_STATUS[status].label}»`,
      );
      onSaved();
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setStatusBusy(null);
    }
  }

  function openWhatsApp() {
    if (!appointment) return;
    const template = settings.message_templates.find((t) => t.key === "reminder") ?? settings.message_templates[0];
    const body = fillTemplate(template?.body ?? "Hola {cliente}, te esperamos el {fecha} a las {hora}.", {
      cliente: appointment.client?.full_name ?? appointment.walk_in_name ?? "",
      negocio: settings.business_name,
      fecha: formatDate(appointment.starts_at, "EEEE d 'de' MMMM"),
      hora: formatTime(appointment.starts_at),
      servicio: appointment.service?.name ?? "",
      profesional: appointment.staff?.full_name ?? "",
      dias: "",
    });
    window.open(buildWhatsAppUrl(appointment.client?.phone ?? null, body, settings.default_country_code), "_blank", "noopener,noreferrer");
  }

  const canCharge = Boolean(appointment) && can("pos") && !["completed", "cancelled", "no_show"].includes(appointment?.status ?? "");
  const quickStatuses: { status: AppointmentStatus; icon: typeof CheckCircle2 }[] = [
    { status: "confirmed", icon: CheckCircle2 },
    { status: "waiting", icon: UserCheck },
    { status: "in_service", icon: PlayCircle },
    { status: "no_show", icon: UserX },
    { status: "cancelled", icon: Ban },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={appointment ? "Detalle de la cita" : "Nueva cita"}
      description={`${formatDate(startDate, "EEEE d 'de' MMMM")} · ${form.time} – ${minutesToTime(Math.min(overallEnd, 24 * 60 - 1))}`}
      footer={
        <>
          {appointment ? (
            <Button variant="outline" icon={MessageCircle} onClick={openWhatsApp} className="mr-auto">
              Recordatorio
            </Button>
          ) : null}
          {canCharge && appointment ? (
            <Button variant="secondary" icon={Wallet} onClick={() => router.push(`/caja?cita=${appointment.id}`)}>
              Cobrar
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          <Button icon={Save} loading={saving} onClick={() => void handleSave()}>
            {appointment ? "Guardar cambios" : extras.length > 0 ? `Agendar ${extras.length + 1} servicios` : "Agendar"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {appointment ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-3">
            <span className="mr-1 text-sm text-muted">Estado:</span>
            <Badge tone={APPOINTMENT_STATUS[appointment.status].tone}>{APPOINTMENT_STATUS[appointment.status].label}</Badge>
            <div className="ml-auto flex flex-wrap gap-1.5">
              {quickStatuses
                .filter((q) => q.status !== appointment.status)
                .map((q) => (
                  <Button
                    key={q.status}
                    size="sm"
                    variant={q.status === "cancelled" || q.status === "no_show" ? "ghost" : "outline"}
                    icon={q.icon}
                    loading={statusBusy === q.status}
                    onClick={() => void handleStatus(q.status)}
                  >
                    {APPOINTMENT_STATUS[q.status].label}
                  </Button>
                ))}
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <Field label="Cliente" required>
            {form.walkIn ? (
              <Input value={form.walkInName} onChange={(e) => update("walkInName", e.target.value)} placeholder="Nombre del cliente de paso" />
            ) : (
              <ClientPicker value={form.client} onChange={(c) => update("client", c)} />
            )}
          </Field>
          <Checkbox checked={form.walkIn} onChange={(v) => update("walkIn", v)} label="Cliente de paso (sin ficha)" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Servicio" required>
            <Select value={form.serviceId} onChange={(e) => handleServiceChange(e.target.value)}>
              <option value="">Selecciona un servicio</option>
              {groupedServices.map((group) => (
                <optgroup key={group.id} label={group.name}>
                  {group.items.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {formatDuration(s.duration_minutes + s.processing_minutes)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label={terms.professional} required>
            <Select value={form.staffId} onChange={(e) => update("staffId", e.target.value)} disabled={isSpecialist}>
              <option value="">Selecciona</option>
              {staffOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                  {s.station_label ? ` · ${s.station_label}` : ""}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Fecha" className="col-span-2 sm:col-span-1">
            <Input type="date" value={form.dateKey} onChange={(e) => update("dateKey", e.target.value)} />
          </Field>
          <Field label="Hora">
            <Select value={form.time} onChange={(e) => update("time", e.target.value)}>
              {timeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Duración (min)">
            <Input
              type="number"
              min={5}
              step={5}
              value={form.duration}
              onChange={(e) => update("duration", Math.max(5, toNumber(e.target.value, 5)))}
            />
          </Field>
          <Field label="Pose (min)" hint="Tiempo de procesamiento">
            <Input
              type="number"
              min={0}
              step={5}
              value={form.processing}
              onChange={(e) => update("processing", Math.max(0, toNumber(e.target.value, 0)))}
            />
          </Field>
        </div>

        {siblings.length > 0 ? (
          <div className="rounded-xl border border-line p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <Layers className="h-4 w-4 text-sage" strokeWidth={1.75} aria-hidden="true" />
              Esta visita incluye {siblings.length + 1} servicios
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {siblings.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-2 text-muted">
                  <span className="tabular-nums text-ink">
                    {formatTime(s.starts_at)}–{formatTime(s.ends_at)}
                  </span>
                  <span>
                    {s.service?.name} · {s.staff?.full_name}
                  </span>
                  <Badge tone={APPOINTMENT_STATUS[s.status].tone}>{APPOINTMENT_STATUS[s.status].label}</Badge>
                </li>
              ))}
            </ul>
            <div className="mt-1">
              <Checkbox checked={applyToBooking} onChange={setApplyToBooking} label="Aplicar los cambios de estado a toda la visita" />
            </div>
          </div>
        ) : null}

        {noShows > 0 ? (
          <Alert tone="ochre" icon={UserX}>
            Este cliente no asistió a {noShows} {noShows === 1 ? "cita anterior" : "citas anteriores"}. Considera pedir un adelanto.
          </Alert>
        ) : null}

        {appointment && deposits !== null && can("pos") ? (
          <div className="rounded-xl border border-line p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <HandCoins className="h-4 w-4 text-sage" strokeWidth={1.75} aria-hidden="true" />
              Adelantos
            </p>
            {deposits.length > 0 ? (
              <ul className="mt-2 divide-y divide-line text-sm">
                {deposits.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="font-semibold tabular-nums text-ink">
                      {settings.currency_symbol} {d.amount.toFixed(2)}
                    </span>
                    <span className="text-muted">
                      {PAYMENT_METHOD_LABELS[d.method]} · {formatDate(d.received_at, "d MMM HH:mm")}
                    </span>
                    <Badge tone={DEPOSIT_STATUS[d.status].tone}>{DEPOSIT_STATUS[d.status].label}</Badge>
                    {d.status === "held" ? (
                      <span className="ml-auto flex gap-1">
                        {["no_show", "cancelled"].includes(appointment.status) ? (
                          <Button size="sm" variant="outline" loading={depositBusy === d.id} onClick={() => void handleResolveDeposit(d, "forfeit")}>
                            Retener
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" loading={depositBusy === d.id} onClick={() => void handleResolveDeposit(d, "refund")}>
                          Devolver
                        </Button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-muted">Sin adelantos. Se descuentan automáticamente al cobrar la cita.</p>
            )}
            {!["completed", "cancelled", "no_show"].includes(appointment.status) ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  inputMode="decimal"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="Monto"
                  className="w-28"
                  aria-label="Monto del adelanto"
                />
                <div className="w-40">
                  <Select value={depositMethod} onChange={(e) => setDepositMethod(e.target.value as PaymentMethodKey)} aria-label="Método del adelanto">
                    {PAYABLE_METHODS.filter((m) => settings.payment_methods.some((p) => p.key === m && p.enabled)).map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button size="sm" variant="outline" icon={Plus} loading={depositBusy === "new"} onClick={() => void handleRecordDeposit()}>
                  Registrar adelanto
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {!appointment ? (
          <div className="space-y-3">
            {extras.map((x, i) => {
              const service = services.find((s) => s.id === x.serviceId);
              return (
                <div key={x.key} className="rounded-xl border border-line p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium text-ink">Servicio adicional {i + 1}</p>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9"
                      aria-label={`Quitar servicio adicional ${i + 1}`}
                      onClick={() => setExtras((current) => current.filter((e) => e.key !== x.key))}
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_120px]">
                    <Select value={x.serviceId} onChange={(e) => changeExtraService(x.key, e.target.value)} aria-label={`Servicio adicional ${i + 1}`}>
                      <option value="">Selecciona un servicio</option>
                      {groupedServices.map((group) => (
                        <optgroup key={group.id} label={group.name}>
                          {group.items.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} · {formatDuration(s.duration_minutes + s.processing_minutes)}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </Select>
                    <Select
                      value={x.staffId}
                      onChange={(e) => updateExtra(x.key, { staffId: e.target.value })}
                      disabled={isSpecialist}
                      aria-label={`${terms.professional} del servicio adicional ${i + 1}`}
                    >
                      <option value="">{terms.professional}</option>
                      {staffOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.full_name}
                        </option>
                      ))}
                    </Select>
                    <Select value={x.time} onChange={(e) => updateExtra(x.key, { time: e.target.value })} aria-label={`Hora del servicio adicional ${i + 1}`}>
                      {optionsFor(x.time).map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {service ? (
                    <p className="mt-2 text-xs text-muted">
                      {x.time} – {minutesToTime(Math.min(lineEnd(x.time, x.duration, x.processing), 24 * 60 - 1))} · {formatDuration(x.duration + x.processing)} ·{" "}
                      {settings.currency_symbol} {x.price.toFixed(2)}
                    </p>
                  ) : null}
                </div>
              );
            })}
            {extras.length < MAX_EXTRA_SERVICES ? (
              <Button variant="outline" size="sm" icon={Plus} onClick={addExtra} disabled={!form.serviceId}>
                Agregar otro servicio a la visita
              </Button>
            ) : null}
          </div>
        ) : null}

        {conflicts.length > 0 ? (
          <Alert tone="clay" icon={AlertTriangle}>
            <p className="font-medium">Choque de horario con {selectedStaff?.full_name}:</p>
            <ul className="mt-1 space-y-0.5">
              {conflicts.map((c) => (
                <li key={c.id}>
                  {formatTime(c.starts_at)}–{formatTime(c.ends_at)} · {c.client?.full_name ?? c.walk_in_name} ({c.service?.name})
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {blocks.length > 0 ? (
          <Alert tone="clay" icon={CalendarOff}>
            <p className="font-medium">{selectedStaff?.full_name ?? "El profesional"} no está disponible en ese horario:</p>
            <ul className="mt-1 space-y-0.5">
              {blocks.map((b) => (
                <li key={b.id}>
                  {TIME_OFF_LABELS[b.kind]}
                  {b.reason ? ` (${b.reason})` : ""}: {formatDate(b.starts_at, "d MMM")} {formatTime(b.starts_at)} – {formatDate(b.ends_at, "d MMM")}{" "}
                  {formatTime(b.ends_at)}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {warnings.map((w) => (
          <Alert key={w} tone="ochre" icon={Clock}>
            {w}
          </Alert>
        ))}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={`Precio (${settings.currency_symbol})`}>
            <Input
              type="number"
              min={0}
              step="0.5"
              value={form.price}
              onChange={(e) => update("price", Math.max(0, toNumber(e.target.value, 0)))}
            />
          </Field>
          <Field label="Origen">
            <Select value={form.source} onChange={(e) => update("source", e.target.value as AppointmentSource)}>
              {(Object.keys(APPOINTMENT_SOURCES) as AppointmentSource[]).map((key) => (
                <option key={key} value={key}>
                  {APPOINTMENT_SOURCES[key]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estado">
            <Select value={form.status} onChange={(e) => update("status", e.target.value as AppointmentStatus)}>
              {APPOINTMENT_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {APPOINTMENT_STATUS[s].label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Notas">
          <Textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Indicaciones, preferencias, referencia de fórmula…" />
        </Field>

        {selectedService && selectedService.processing_minutes > 0 ? (
          <p className="flex items-center gap-2 text-xs text-muted">
            <CalendarClock className="h-4 w-4" strokeWidth={1.75} />
            El bloque incluye {selectedService.processing_minutes} min de pose; el horario del {terms.professional.toLowerCase()} queda
            reservado hasta las {minutesToTime(timeToMinutes(form.time) + form.duration + form.processing)}.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
