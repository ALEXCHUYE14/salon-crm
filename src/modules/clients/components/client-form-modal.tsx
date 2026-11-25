"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { GENDER_LABELS, SEGMENT_LABELS } from "@/lib/constants";
import { segmentsForMode } from "@/lib/terminology";
import { getErrorMessage, nullIfEmpty } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import type { Client, ClientInput, Gender, Segment, StaffMember } from "@/types/domain";
import { saveClient } from "../api";

interface ClientFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (client: Client) => void;
  client: Client | null;
  staff: StaffMember[];
}

interface FormState {
  full_name: string;
  phone: string;
  email: string;
  birth_date: string;
  gender: Gender;
  segment: Segment;
  notes: string;
  tags: string;
  preferred_staff_id: string;
  marketing_opt_in: boolean;
}

function toForm(client: Client | null, defaultSegment: Segment): FormState {
  return {
    full_name: client?.full_name ?? "",
    phone: client?.phone ?? "",
    email: client?.email ?? "",
    birth_date: client?.birth_date ?? "",
    gender: client?.gender ?? "unspecified",
    segment: client?.segment ?? defaultSegment,
    notes: client?.notes ?? "",
    tags: (client?.tags ?? []).join(", "),
    preferred_staff_id: client?.preferred_staff_id ?? "",
    marketing_opt_in: client?.marketing_opt_in ?? true,
  };
}

export function ClientFormModal({ open, onClose, onSaved, client, staff }: ClientFormModalProps) {
  const toast = useToast();
  const { settings, terms } = useApp();
  const mode = settings.operating_mode;
  const defaultSegment: Segment = mode === "barbershop" ? "barbershop" : mode === "beauty_salon" ? "beauty_salon" : "both";
  const [form, setForm] = useState<FormState>(() => toForm(client, defaultSegment));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(toForm(client, defaultSegment));
  }, [open, client, defaultSegment]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSave() {
    if (form.full_name.trim().length < 2) return toast.error("Ingresa el nombre del cliente");
    setSaving(true);
    try {
      const payload: ClientInput = {
        full_name: form.full_name.trim(),
        phone: nullIfEmpty(form.phone),
        email: nullIfEmpty(form.email)?.toLowerCase() ?? null,
        birth_date: nullIfEmpty(form.birth_date),
        gender: form.gender,
        segment: form.segment,
        notes: nullIfEmpty(form.notes),
        tags: form.tags
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
        preferred_staff_id: nullIfEmpty(form.preferred_staff_id),
        marketing_opt_in: form.marketing_opt_in,
      };
      const saved = await saveClient(payload, client?.id);
      toast.success(client ? "Cliente actualizado" : "Cliente registrado");
      onSaved(saved);
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const segmentOptions = Array.from(new Set<Segment>([...segmentsForMode(mode), form.segment]));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={client ? "Editar cliente" : "Nuevo cliente"}
      size="lg"
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
          <Input value={form.full_name} onChange={(e) => update("full_name", e.target.value)} autoFocus />
        </Field>
        <Field label="Teléfono / WhatsApp">
          <Input value={form.phone} onChange={(e) => update("phone", e.target.value)} inputMode="tel" />
        </Field>
        <Field label="Correo">
          <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} />
        </Field>
        <Field label="Fecha de nacimiento">
          <Input type="date" value={form.birth_date} onChange={(e) => update("birth_date", e.target.value)} />
        </Field>
        <Field label="Género">
          <Select value={form.gender} onChange={(e) => update("gender", e.target.value as Gender)}>
            {(Object.keys(GENDER_LABELS) as Gender[]).map((g) => (
              <option key={g} value={g}>
                {GENDER_LABELS[g]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Área de atención">
          <Select value={form.segment} onChange={(e) => update("segment", e.target.value as Segment)}>
            {segmentOptions.map((s) => (
              <option key={s} value={s}>
                {SEGMENT_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`${terms.professional} preferido`}>
          <Select value={form.preferred_staff_id} onChange={(e) => update("preferred_staff_id", e.target.value)}>
            <option value="">Sin preferencia</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Etiquetas" hint="Separadas por coma: vip, color, frecuente" className="sm:col-span-2">
          <Input value={form.tags} onChange={(e) => update("tags", e.target.value)} />
        </Field>
        <Field label="Notas internas" className="sm:col-span-2">
          <Textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Alergias, preferencias, observaciones…" />
        </Field>
        <div className="sm:col-span-2">
          <Switch
            checked={form.marketing_opt_in}
            onChange={(v) => update("marketing_opt_in", v)}
            label="Acepta mensajes de fidelización"
            description="Recordatorios, promociones y saludos de cumpleaños por WhatsApp."
          />
        </div>
      </div>
    </Modal>
  );
}
