"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { RECORD_TYPE_LABELS } from "@/lib/constants";
import { toDateKey } from "@/lib/dates";
import { recordTypesForMode } from "@/lib/terminology";
import { getErrorMessage, nullIfEmpty } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import type { StaffMember, TechnicalRecord, TechnicalRecordInput, TechnicalRecordType } from "@/types/domain";
import { saveTechnicalRecord } from "../api";

interface TechnicalRecordModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  clientId: string;
  record: TechnicalRecord | null;
  staff: StaffMember[];
}

type TextFields =
  | "cut_style"
  | "fade_type"
  | "clipper_guards"
  | "beard_style"
  | "finish"
  | "color_formula"
  | "hair_diagnosis"
  | "nails_diagnosis"
  | "skin_diagnosis"
  | "products_used"
  | "result_notes";

interface FormState extends Record<TextFields, string> {
  record_type: TechnicalRecordType;
  service_date: string;
  staff_id: string;
  developer_volume: string;
  processing_minutes: string;
}

const TEXT_FIELDS: TextFields[] = [
  "cut_style",
  "fade_type",
  "clipper_guards",
  "beard_style",
  "finish",
  "color_formula",
  "hair_diagnosis",
  "nails_diagnosis",
  "skin_diagnosis",
  "products_used",
  "result_notes",
];

function toForm(record: TechnicalRecord | null, defaultType: TechnicalRecordType, defaultStaff: string): FormState {
  const base = Object.fromEntries(TEXT_FIELDS.map((f) => [f, record?.[f] ?? ""])) as Record<TextFields, string>;
  return {
    ...base,
    record_type: record?.record_type ?? defaultType,
    service_date: record?.service_date ?? toDateKey(new Date()),
    staff_id: record?.staff_id ?? defaultStaff,
    developer_volume: record?.developer_volume ? String(record.developer_volume) : "",
    processing_minutes: record?.processing_minutes !== null && record?.processing_minutes !== undefined ? String(record.processing_minutes) : "",
  };
}

export function TechnicalRecordModal({ open, onClose, onSaved, clientId, record, staff }: TechnicalRecordModalProps) {
  const toast = useToast();
  const { settings, staff: me, terms } = useApp();
  const types = recordTypesForMode(settings.operating_mode);
  const defaultStaff = me.is_bookable ? me.id : "";
  const [form, setForm] = useState<FormState>(() => toForm(record, types[0], defaultStaff));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(toForm(record, types[0], defaultStaff));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record?.id]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const textValues = Object.fromEntries(TEXT_FIELDS.map((f) => [f, nullIfEmpty(form[f])])) as Record<TextFields, string | null>;
      const payload: TechnicalRecordInput = {
        ...textValues,
        client_id: clientId,
        appointment_id: record?.appointment_id ?? null,
        staff_id: nullIfEmpty(form.staff_id),
        record_type: form.record_type,
        service_date: form.service_date,
        developer_volume: form.developer_volume ? Number(form.developer_volume) : null,
        processing_minutes: form.processing_minutes ? Number(form.processing_minutes) : null,
      };
      await saveTechnicalRecord(payload, record?.id);
      toast.success("Ficha técnica guardada");
      onSaved();
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const t = form.record_type;
  const typeOptions = types.includes(t) ? types : [...types, t];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={record ? "Editar ficha técnica" : "Nueva ficha técnica"}
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
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Tipo de registro">
          <Select value={t} onChange={(e) => update("record_type", e.target.value as TechnicalRecordType)}>
            {typeOptions.map((type) => (
              <option key={type} value={type}>
                {RECORD_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fecha">
          <Input type="date" value={form.service_date} onChange={(e) => update("service_date", e.target.value)} />
        </Field>
        <Field label={terms.professional}>
          <Select value={form.staff_id} onChange={(e) => update("staff_id", e.target.value)}>
            <option value="">Sin asignar</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </Select>
        </Field>

        {t === "barber" ? (
          <>
            <Field label="Tipo de corte" className="sm:col-span-2">
              <Input value={form.cut_style} onChange={(e) => update("cut_style", e.target.value)} placeholder="Crop texturizado, clásico, mullet…" />
            </Field>
            <Field label="Fade / degradado">
              <Input value={form.fade_type} onChange={(e) => update("fade_type", e.target.value)} placeholder="Low, mid, high, taper" />
            </Field>
            <Field label="Peines / guardas" className="sm:col-span-2">
              <Input value={form.clipper_guards} onChange={(e) => update("clipper_guards", e.target.value)} placeholder="Laterales 1 → 0.5, nuca 0, arriba tijera" />
            </Field>
            <Field label="Acabado">
              <Input value={form.finish} onChange={(e) => update("finish", e.target.value)} placeholder="Mate, brillo, natural" />
            </Field>
            <Field label="Estilo de barba" className="sm:col-span-3">
              <Input value={form.beard_style} onChange={(e) => update("beard_style", e.target.value)} placeholder="Perfilada, candado, degradada…" />
            </Field>
          </>
        ) : null}

        {t === "color" ? (
          <>
            <Field label="Fórmula de colorimetría / tinte" className="sm:col-span-3">
              <Textarea
                value={form.color_formula}
                onChange={(e) => update("color_formula", e.target.value)}
                placeholder="Ej.: 6.0 (30 g) + 7.3 (30 g) + oxidante 1:1,5"
              />
            </Field>
            <Field label="Volumen de peróxido">
              <Select value={form.developer_volume} onChange={(e) => update("developer_volume", e.target.value)}>
                <option value="">—</option>
                {[10, 20, 30, 40].map((v) => (
                  <option key={v} value={v}>
                    {v} vol.
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tiempo de pose (min)">
              <Input type="number" min={0} value={form.processing_minutes} onChange={(e) => update("processing_minutes", e.target.value)} />
            </Field>
          </>
        ) : null}

        {t === "color" || t === "hair_diagnosis" || t === "treatment" ? (
          <Field label="Diagnóstico capilar" className="sm:col-span-3">
            <Textarea
              value={form.hair_diagnosis}
              onChange={(e) => update("hair_diagnosis", e.target.value)}
              placeholder="Grosor, porosidad, % de canas, estado de puntas…"
            />
          </Field>
        ) : null}

        {t === "treatment" ? (
          <Field label="Tiempo de pose (min)">
            <Input type="number" min={0} value={form.processing_minutes} onChange={(e) => update("processing_minutes", e.target.value)} />
          </Field>
        ) : null}

        {t === "nails" ? (
          <Field label="Diagnóstico de uñas" className="sm:col-span-3">
            <Textarea value={form.nails_diagnosis} onChange={(e) => update("nails_diagnosis", e.target.value)} placeholder="Grosor, cutícula, sensibilidad…" />
          </Field>
        ) : null}

        {t === "skin" ? (
          <Field label="Diagnóstico de piel" className="sm:col-span-3">
            <Textarea value={form.skin_diagnosis} onChange={(e) => update("skin_diagnosis", e.target.value)} placeholder="Tipo de piel, sensibilidad, observaciones…" />
          </Field>
        ) : null}

        <Field label="Productos aplicados" className="sm:col-span-3">
          <Input value={form.products_used} onChange={(e) => update("products_used", e.target.value)} />
        </Field>
        <Field label="Resultado / observaciones" className="sm:col-span-3">
          <Textarea value={form.result_notes} onChange={(e) => update("result_notes", e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
