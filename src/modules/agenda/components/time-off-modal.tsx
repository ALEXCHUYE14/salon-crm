"use client";

import { useEffect, useState } from "react";
import { addDays, differenceInCalendarDays } from "date-fns";
import { AlertTriangle, CalendarOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { TIME_OFF_LABELS } from "@/lib/constants";
import { combineDateTime, formatDate, formatTime, fromDateKey, toDateKey } from "@/lib/dates";
import { getErrorMessage, nullIfEmpty } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import type { Appointment, StaffMember, StaffTimeOff, StaffTimeOffInput, TimeOffKind } from "@/types/domain";
import { createTimeOff, deleteTimeOff, findAppointmentsInRanges, updateTimeOff } from "../api";

const MAX_REPEAT_DAYS = 62;

export interface TimeOffDefaults {
  staffId?: string;
  dateKey: string;
}

interface TimeOffModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  block: StaffTimeOff | null;
  defaults: TimeOffDefaults;
  staff: StaffMember[];
}

interface FormState {
  staffId: string;
  kind: TimeOffKind;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  repeat: boolean;
  repeatUntil: string;
  reason: string;
}

function isMidnight(date: Date): boolean {
  return date.getHours() === 0 && date.getMinutes() === 0;
}

function initialState(block: StaffTimeOff | null, defaults: TimeOffDefaults, staffId: string): FormState {
  if (block) {
    const start = new Date(block.starts_at);
    const end = new Date(block.ends_at);
    const allDay = isMidnight(start) && isMidnight(end);
    return {
      staffId: block.staff_id,
      kind: block.kind,
      allDay,
      startDate: toDateKey(start),
      startTime: formatTime(block.starts_at),
      endDate: toDateKey(allDay ? addDays(end, -1) : end),
      endTime: formatTime(block.ends_at),
      repeat: false,
      repeatUntil: toDateKey(start),
      reason: block.reason ?? "",
    };
  }
  return {
    staffId,
    kind: "personal",
    allDay: false,
    startDate: defaults.dateKey,
    startTime: "13:00",
    endDate: defaults.dateKey,
    endTime: "14:00",
    repeat: false,
    repeatUntil: defaults.dateKey,
    reason: "",
  };
}

/** Convierte el formulario en rangos [inicio, fin) o devuelve un mensaje de error. */
function buildRanges(form: FormState, editing: boolean): { ranges: { start: Date; end: Date }[] } | { error: string } {
  if (form.allDay) {
    if (form.endDate < form.startDate) return { error: "La fecha final no puede ser anterior a la inicial" };
    const start = fromDateKey(form.startDate);
    const end = addDays(fromDateKey(form.endDate), 1);
    if (differenceInCalendarDays(end, start) > 370) return { error: "El bloqueo no puede superar un año" };
    return { ranges: [{ start, end }] };
  }

  if (form.repeat && !editing) {
    if (form.endTime <= form.startTime) return { error: "La hora final debe ser posterior a la inicial" };
    if (form.repeatUntil < form.startDate) return { error: "«Repetir hasta» no puede ser anterior a la fecha inicial" };
    const days = differenceInCalendarDays(fromDateKey(form.repeatUntil), fromDateKey(form.startDate)) + 1;
    if (days > MAX_REPEAT_DAYS) return { error: `Puedes repetir como máximo ${MAX_REPEAT_DAYS} días` };
    const ranges = Array.from({ length: days }, (_, i) => {
      const key = toDateKey(addDays(fromDateKey(form.startDate), i));
      return { start: combineDateTime(key, form.startTime), end: combineDateTime(key, form.endTime) };
    });
    return { ranges };
  }

  const start = combineDateTime(form.startDate, form.startTime);
  const end = combineDateTime(form.endDate, form.endTime);
  if (end <= start) return { error: "El final del bloqueo debe ser posterior al inicio" };
  if (differenceInCalendarDays(end, start) > 370) return { error: "El bloqueo no puede superar un año" };
  return { ranges: [{ start, end }] };
}

export function TimeOffModal({ open, onClose, onSaved, block, defaults, staff }: TimeOffModalProps) {
  const toast = useToast();
  const { terms, staff: me } = useApp();
  const isSpecialist = me.role === "specialist";
  const staffOptions = isSpecialist ? staff.filter((s) => s.id === me.id) : staff;
  const fallbackStaff = isSpecialist ? me.id : (defaults.staffId ?? staffOptions[0]?.id ?? "");

  const [form, setForm] = useState<FormState>(() => initialState(block, defaults, fallbackStaff));
  const [conflicts, setConflicts] = useState<Appointment[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initialState(block, defaults, fallbackStaff));
      setConflicts(null);
    }
    // Reinicia solo al abrir o al cambiar de bloqueo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, block?.id]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      // La fecha final acompaña a la inicial mientras no se haya elegido otra posterior
      if (key === "startDate" && (current.endDate < String(value) || current.endDate === current.startDate)) next.endDate = String(value);
      if (key === "startDate" && current.repeatUntil < String(value)) next.repeatUntil = String(value);
      return next;
    });
    setConflicts(null);
  }

  async function handleSave() {
    if (!form.staffId) return toast.error(`Selecciona un ${terms.professional.toLowerCase()}`);
    const built = buildRanges(form, Boolean(block));
    if ("error" in built) return toast.error(built.error);
    const ranges = built.ranges.map((r) => ({ start: r.start.toISOString(), end: r.end.toISOString() }));

    setSaving(true);
    try {
      // Primer intento: avisar si el bloqueo cae sobre citas ya agendadas
      if (conflicts === null) {
        const found = await findAppointmentsInRanges(form.staffId, ranges);
        if (found.length > 0) {
          setConflicts(found);
          return;
        }
      }
      const rows: StaffTimeOffInput[] = ranges.map((r) => ({
        staff_id: form.staffId,
        starts_at: r.start,
        ends_at: r.end,
        kind: form.kind,
        reason: nullIfEmpty(form.reason),
      }));
      if (block) await updateTimeOff(block.id, rows[0]);
      else await createTimeOff(rows);
      toast.success(block ? "Bloqueo actualizado" : rows.length > 1 ? `${rows.length} bloqueos creados` : "Horario bloqueado");
      onSaved();
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!block || !window.confirm("¿Eliminar este bloqueo? El horario quedará disponible para citas.")) return;
    setDeleting(true);
    try {
      await deleteTimeOff(block.id);
      toast.success("Bloqueo eliminado");
      onSaved();
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  }

  const canRepeat = !block && !form.allDay;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={block ? "Editar bloqueo" : "Bloquear horario"}
      description="El horario bloqueado no acepta citas nuevas."
      footer={
        <>
          {block ? (
            <Button variant="ghost" icon={Trash2} loading={deleting} onClick={() => void handleDelete()} className="mr-auto text-clay">
              Eliminar
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={CalendarOff} loading={saving} onClick={() => void handleSave()}>
            {conflicts && conflicts.length > 0 ? "Bloquear de todos modos" : block ? "Guardar cambios" : "Bloquear horario"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={terms.professional} required>
            <Select value={form.staffId} onChange={(e) => update("staffId", e.target.value)} disabled={isSpecialist}>
              <option value="">Selecciona</option>
              {staffOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Motivo">
            <Select value={form.kind} onChange={(e) => update("kind", e.target.value as TimeOffKind)}>
              {(Object.keys(TIME_OFF_LABELS) as TimeOffKind[]).map((k) => (
                <option key={k} value={k}>
                  {TIME_OFF_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Checkbox checked={form.allDay} onChange={(v) => update("allDay", v)} label="Todo el día" />

        <div className="grid grid-cols-2 gap-4">
          <Field label={form.allDay ? "Desde el día" : "Fecha"}>
            <Input type="date" value={form.startDate} onChange={(e) => e.target.value && update("startDate", e.target.value)} />
          </Field>
          {form.allDay ? (
            <Field label="Hasta el día">
              <Input
                type="date"
                value={form.endDate}
                min={form.startDate}
                onChange={(e) => e.target.value && update("endDate", e.target.value)}
              />
            </Field>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Desde">
                <Input
                  type="time"
                  step={300}
                  value={form.startTime}
                  onChange={(e) => e.target.value && update("startTime", e.target.value)}
                />
              </Field>
              <Field label="Hasta">
                <Input type="time" step={300} value={form.endTime} onChange={(e) => e.target.value && update("endTime", e.target.value)} />
              </Field>
            </div>
          )}
        </div>

        {!form.allDay && !form.repeat ? (
          <Field label="Termina el día" hint="Cámbialo solo si el bloqueo pasa de un día a otro.">
            <Input
              type="date"
              value={form.endDate}
              min={form.startDate}
              onChange={(e) => e.target.value && update("endDate", e.target.value)}
            />
          </Field>
        ) : null}

        {canRepeat ? (
          <div className="space-y-2 rounded-xl bg-surface-2 p-3">
            <Checkbox checked={form.repeat} onChange={(v) => update("repeat", v)} label="Repetir todos los días a la misma hora" />
            {form.repeat ? (
              <Field label="Repetir hasta" hint={`Máximo ${MAX_REPEAT_DAYS} días. Útil para el refrigerio diario.`}>
                <Input
                  type="date"
                  value={form.repeatUntil}
                  min={form.startDate}
                  onChange={(e) => e.target.value && update("repeatUntil", e.target.value)}
                />
              </Field>
            ) : null}
          </div>
        ) : null}

        <Field label="Detalle (opcional)">
          <Textarea
            rows={2}
            maxLength={200}
            value={form.reason}
            onChange={(e) => update("reason", e.target.value)}
            placeholder="Ej.: cita médica, sale temprano"
          />
        </Field>

        {conflicts && conflicts.length > 0 ? (
          <Alert tone="clay" icon={AlertTriangle}>
            <p className="font-medium">
              Hay {conflicts.length} {conflicts.length === 1 ? "cita agendada" : "citas agendadas"} en ese horario. Seguirán en la agenda:
              reprográmalas o cancélalas.
            </p>
            <ul className="mt-1 space-y-0.5">
              {conflicts.slice(0, 6).map((c) => (
                <li key={c.id}>
                  {formatDate(c.starts_at, "EEE d MMM")} {formatTime(c.starts_at)} · {c.client?.full_name ?? c.walk_in_name} (
                  {c.service?.name})
                </li>
              ))}
              {conflicts.length > 6 ? <li>y {conflicts.length - 6} más…</li> : null}
            </ul>
          </Alert>
        ) : null}
      </div>
    </Modal>
  );
}
