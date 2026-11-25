"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Switch } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { ROLE_LABELS, SPECIALTY_LABELS, STAFF_COLORS, WEEKDAYS } from "@/lib/constants";
import { cn, getErrorMessage, nullIfEmpty, toNumber } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import type { CommissionType, Specialty, StaffMember, StaffRole, WorkScheduleDay } from "@/types/domain";
import { saveStaff } from "../api";

type CommissionMode = "inherit" | CommissionType;

interface FormState {
  full_name: string;
  email: string;
  phone: string;
  role: StaffRole;
  specialty: Specialty;
  station_label: string;
  color: string;
  is_bookable: boolean;
  is_active: boolean;
  commission_mode: CommissionMode;
  commission_value: number;
  product_rate: string;
  schedule: Record<number, { enabled: boolean; start: string; end: string }>;
}

function toForm(member: StaffMember | null): FormState {
  const schedule: FormState["schedule"] = {};
  for (let day = 0; day < 7; day += 1) {
    const found = member?.work_schedule.find((w) => w.day === day);
    schedule[day] = found
      ? { enabled: true, start: found.start, end: found.end }
      : { enabled: !member && day !== 0, start: "09:00", end: "19:00" };
  }
  return {
    full_name: member?.full_name ?? "",
    email: member?.email ?? "",
    phone: member?.phone ?? "",
    role: member?.role ?? "specialist",
    specialty: member?.specialty ?? "both",
    station_label: member?.station_label ?? "",
    color: member?.color ?? STAFF_COLORS[0],
    is_bookable: member?.is_bookable ?? true,
    is_active: member?.is_active ?? true,
    commission_mode: member?.commission_type ?? "inherit",
    commission_value: member?.commission_value !== null && member?.commission_value !== undefined ? Number(member.commission_value) : 0,
    product_rate: member?.product_commission_rate !== null && member?.product_commission_rate !== undefined ? String(member.product_commission_rate) : "",
    schedule,
  };
}

interface StaffFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  member: StaffMember | null;
}

export function StaffFormModal({ open, onClose, onSaved, member }: StaffFormModalProps) {
  const toast = useToast();
  const { settings, terms, staff: me, money, branches, branch } = useApp();
  const [branchId, setBranchId] = useState<string>("");
  useEffect(() => {
    if (open) setBranchId(member?.branch_id ?? branch?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, member?.id]);
  const [form, setForm] = useState<FormState>(() => toForm(member));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(toForm(member));
  }, [open, member]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateDay(day: number, patch: Partial<FormState["schedule"][number]>) {
    setForm((current) => ({ ...current, schedule: { ...current.schedule, [day]: { ...current.schedule[day], ...patch } } }));
  }

  async function handleSave() {
    if (form.full_name.trim().length < 2) return toast.error("Ingresa el nombre");
    if (form.commission_mode === "percentage" && form.commission_value > 100) return toast.error("El porcentaje no puede superar 100");
    const schedule: WorkScheduleDay[] = Object.entries(form.schedule)
      .filter(([, d]) => d.enabled)
      .map(([day, d]) => ({ day: Number(day), start: d.start, end: d.end }));
    if (schedule.some((d) => d.end <= d.start)) return toast.error("Revisa los horarios: la salida debe ser posterior a la entrada");

    setSaving(true);
    try {
      await saveStaff(
        {
          full_name: form.full_name.trim(),
          email: nullIfEmpty(form.email),
          phone: nullIfEmpty(form.phone),
          role: form.role,
          specialty: form.specialty,
          station_label: nullIfEmpty(form.station_label),
          color: form.color,
          is_bookable: form.is_bookable,
          is_active: form.is_active,
          commission_type: form.commission_mode === "inherit" ? null : form.commission_mode,
          commission_value: form.commission_mode === "inherit" ? null : form.commission_value,
          product_commission_rate: form.product_rate === "" ? null : Math.min(100, toNumber(form.product_rate, 0)),
          work_schedule: schedule,
          ...(branchId ? { branch_id: branchId } : {}),
        },
        member?.id,
      );
      toast.success(member ? "Ficha actualizada" : `${terms.professional} registrado`);
      onSaved();
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const roleOptions: StaffRole[] = me.role === "owner" ? ["owner", "admin", "receptionist", "specialist"] : ["admin", "receptionist", "specialist"];
  const isSelf = member?.id === me.id;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={member ? `Editar ${member.full_name}` : `Nuevo miembro del equipo`}
      description="El acceso al sistema se vincula automáticamente cuando la persona se registra con este correo."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} loading={saving} onClick={() => void handleSave()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre completo" required className="sm:col-span-2">
          <Input value={form.full_name} onChange={(e) => update("full_name", e.target.value)} />
        </Field>
        <Field label="Correo (acceso)">
          <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} disabled={Boolean(member?.user_id)} />
        </Field>
        <Field label="Teléfono">
          <Input value={form.phone} onChange={(e) => update("phone", e.target.value)} inputMode="tel" />
        </Field>
        <Field label="Rol">
          <Select value={form.role} onChange={(e) => update("role", e.target.value as StaffRole)} disabled={isSelf || (member?.role === "owner" && me.role !== "owner")}>
            {(roleOptions.includes(form.role) ? roleOptions : [form.role, ...roleOptions]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Especialidad">
          <Select value={form.specialty} onChange={(e) => update("specialty", e.target.value as Specialty)}>
            {(Object.keys(SPECIALTY_LABELS) as Specialty[]).map((s) => (
              <option key={s} value={s}>
                {SPECIALTY_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        {branches.length > 1 ? (
          <Field label="Sede">
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Sede">
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label={terms.station} hint={`Ej.: ${terms.station} 1`}>
          <Input value={form.station_label} onChange={(e) => update("station_label", e.target.value)} />
        </Field>
        <Field label="Color en agenda">
          <div className="flex min-h-[44px] flex-wrap items-center gap-2">
            {STAFF_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => update("color", c)}
                className={cn("h-8 w-8 rounded-full border-2 transition-transform", form.color === c ? "scale-110 border-ink" : "border-transparent")}
                style={{ backgroundColor: c }}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
        </Field>

        <div className="rounded-xl border border-line p-3 sm:col-span-2">
          <p className="mb-2 text-sm font-medium text-ink">Comisiones</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label="Servicios"
              hint={
                form.commission_mode === "inherit"
                  ? `Negocio: ${settings.default_commission_type === "percentage" ? `${settings.default_commission_value}%` : money(settings.default_commission_value)}`
                  : undefined
              }
            >
              <Select value={form.commission_mode} onChange={(e) => update("commission_mode", e.target.value as CommissionMode)}>
                <option value="inherit">Heredada del negocio</option>
                <option value="percentage">Porcentaje</option>
                <option value="fixed">Monto fijo por servicio</option>
              </Select>
            </Field>
            <Field label={form.commission_mode === "fixed" ? `Monto (${settings.currency_symbol})` : "Valor (%)"}>
              <Input
                type="number"
                min={0}
                step="0.5"
                value={form.commission_value}
                disabled={form.commission_mode === "inherit"}
                onChange={(e) => update("commission_value", toNumber(e.target.value, 0))}
              />
            </Field>
            <Field label="Venta de productos (%)" hint={`Vacío = ${settings.product_commission_rate}% del negocio`}>
              <Input type="number" min={0} max={100} step="0.5" value={form.product_rate} onChange={(e) => update("product_rate", e.target.value)} />
            </Field>
          </div>
          <p className="mt-2 text-xs text-muted">Prioridad: comisión del servicio → comisión del especialista → regla general del negocio.</p>
        </div>

        <div className="rounded-xl border border-line p-3 sm:col-span-2">
          <p className="mb-1 text-sm font-medium text-ink">Horario de trabajo</p>
          <div className="divide-y divide-line">
            {Array.from({ length: 7 }, (_, i) => (i + 1) % 7).map((day) => {
              const d = form.schedule[day];
              return (
                <div key={day} className="flex flex-wrap items-center gap-3 py-1">
                  <div className="w-36">
                    <Checkbox checked={d.enabled} onChange={(v) => updateDay(day, { enabled: v })} label={WEEKDAYS[day]} />
                  </div>
                  <Input type="time" value={d.start} disabled={!d.enabled} onChange={(e) => updateDay(day, { start: e.target.value })} className="w-32" aria-label={`Entrada ${WEEKDAYS[day]}`} />
                  <span className="text-muted">a</span>
                  <Input type="time" value={d.end} disabled={!d.enabled} onChange={(e) => updateDay(day, { end: e.target.value })} className="w-32" aria-label={`Salida ${WEEKDAYS[day]}`} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-1 sm:col-span-2">
          <Switch checked={form.is_bookable} onChange={(v) => update("is_bookable", v)} label="Recibe citas" description="Aparece como columna en la agenda y en la caja." />
          <Switch checked={form.is_active} onChange={(v) => update("is_active", v)} label="Activo" description="Si se desactiva, pierde el acceso al sistema." disabled={isSelf} />
        </div>
      </div>
    </Modal>
  );
}
