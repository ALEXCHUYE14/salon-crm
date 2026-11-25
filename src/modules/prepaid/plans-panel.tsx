"use client";

import { useCallback, useEffect, useState } from "react";
import { Gift, Pencil, Plus, Save, Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Switch } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useCatalog } from "@/hooks/use-catalog";
import { getErrorMessage, round2, toNumber } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import type { PrepaidKind, PrepaidPlan } from "@/types/domain";
import { listPlans, savePlan } from "./api";

interface FormState {
  name: string;
  kind: PrepaidKind;
  service_id: string;
  sessions: number;
  credit: number;
  price: number;
  validity_days: string;
  is_active: boolean;
}

function toForm(plan: PrepaidPlan | null): FormState {
  return {
    name: plan?.name ?? "",
    kind: plan?.kind ?? "package",
    service_id: plan?.service_id ?? "",
    sessions: plan?.sessions ?? 4,
    credit: plan?.credit ?? 100,
    price: plan?.price ?? 0,
    validity_days: plan?.validity_days ? String(plan.validity_days) : "",
    is_active: plan?.is_active ?? true,
  };
}

/** Catálogo de paquetes y gift cards que se venden en caja. */
export function PlansPanel() {
  const toast = useToast();
  const { money, isAdmin } = useApp();
  const catalog = useCatalog();
  const [plans, setPlans] = useState<PrepaidPlan[] | null>(null);
  const [editing, setEditing] = useState<PrepaidPlan | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(toForm(null));
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setPlans(await listPlans());
    } catch (error) {
      toast.error(getErrorMessage(error));
      setPlans([]);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function openForm(plan: PrepaidPlan | null) {
    setEditing(plan);
    setForm(toForm(plan));
    setOpen(true);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const service = catalog.services.find((s) => s.id === form.service_id);
  const regular = service ? round2(Number(service.price) * form.sessions) : 0;

  async function handleSave() {
    if (form.name.trim().length < 2) return toast.error("Escribe el nombre");
    if (form.kind === "package" && !form.service_id) return toast.error("Elige el servicio del paquete");
    if (form.kind === "package" && (form.sessions < 1 || form.sessions > 100)) return toast.error("Las sesiones deben estar entre 1 y 100");
    if (form.kind === "gift_card" && form.credit <= 0) return toast.error("Indica el saldo de la gift card");
    const validity = form.validity_days.trim() === "" ? null : Math.trunc(toNumber(form.validity_days));
    if (validity !== null && (validity < 1 || validity > 1095)) return toast.error("La vigencia debe estar entre 1 y 1095 días");
    setSaving(true);
    try {
      await savePlan(
        {
          name: form.name.trim(),
          kind: form.kind,
          service_id: form.kind === "package" ? form.service_id : null,
          sessions: form.kind === "package" ? form.sessions : null,
          credit: form.kind === "gift_card" ? round2(form.credit) : null,
          price: round2(form.price),
          validity_days: validity,
          is_active: form.is_active,
        },
        editing?.id,
      );
      toast.success(editing ? "Guardado" : "Creado");
      setOpen(false);
      void load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Paquetes y gift cards"
        description="Se venden en Caja → pestaña «Paquetes». El cliente recibe un código para usarlos."
        action={
          isAdmin ? (
            <Button size="sm" icon={Plus} onClick={() => openForm(null)}>
              Nuevo
            </Button>
          ) : null
        }
      />
      {plans === null ? (
        <Spinner />
      ) : plans.length === 0 ? (
        <EmptyState icon={Ticket} title="Aún no hay paquetes ni gift cards" description="Ejemplo: «4 cortes al mes» por S/ 80, o una gift card de S/ 100." />
      ) : (
        <ul className="divide-y divide-line">
          {plans.map((p) => {
            const svc = catalog.services.find((s) => s.id === p.service_id);
            return (
              <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                <Icon icon={p.kind === "package" ? Ticket : Gift} className="h-5 w-5 text-sage" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium text-ink">
                    <span className="truncate">{p.name}</span>
                    {!p.is_active ? <Badge>Inactivo</Badge> : null}
                  </p>
                  <p className="truncate text-sm text-muted">
                    {p.kind === "package" ? `${p.sessions} × ${svc?.name ?? "servicio"}` : `Saldo de ${money(p.credit)}`}
                    {p.validity_days ? ` · vence a los ${p.validity_days} días` : " · sin vencimiento"}
                  </p>
                </div>
                <span className="font-semibold tabular-nums text-ink">{money(p.price)}</span>
                {isAdmin ? (
                  <Button size="icon" variant="ghost" aria-label={`Editar ${p.name}`} onClick={() => openForm(p)}>
                    <Icon icon={Pencil} />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar" : "Nuevo paquete o gift card"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button icon={Save} loading={saving} onClick={() => void handleSave()}>
              Guardar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Tipo">
            <Select value={form.kind} onChange={(e) => update("kind", e.target.value as PrepaidKind)} disabled={Boolean(editing)}>
              <option value="package">Paquete de sesiones</option>
              <option value="gift_card">Gift card (saldo)</option>
            </Select>
          </Field>
          <Field label="Nombre" required>
            <Input
              value={form.name}
              maxLength={120}
              onChange={(e) => update("name", e.target.value)}
              placeholder={form.kind === "package" ? "Ej.: 4 cortes al mes" : "Ej.: Gift card S/ 100"}
            />
          </Field>
          {form.kind === "package" ? (
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <Field label="Servicio" required>
                <Select value={form.service_id} onChange={(e) => update("service_id", e.target.value)}>
                  <option value="">Elige un servicio</option>
                  {catalog.services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {money(s.price)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Sesiones">
                <Input type="number" min={1} max={100} value={form.sessions} onChange={(e) => update("sessions", Math.trunc(toNumber(e.target.value, 1)))} />
              </Field>
            </div>
          ) : (
            <Field label="Saldo que recibe el cliente">
              <Input type="number" min={1} step="1" value={form.credit} onChange={(e) => update("credit", toNumber(e.target.value, 0))} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Precio de venta" hint={form.kind === "package" && regular > 0 ? `Por separado: ${money(regular)}` : undefined}>
              <Input type="number" min={0} step="0.5" value={form.price} onChange={(e) => update("price", toNumber(e.target.value, 0))} />
            </Field>
            <Field label="Vigencia (días)" hint="Vacío = no vence.">
              <Input type="number" min={1} max={1095} value={form.validity_days} onChange={(e) => update("validity_days", e.target.value)} placeholder="Ej.: 30" />
            </Field>
          </div>
          <Switch checked={form.is_active} onChange={(v) => update("is_active", v)} label="Disponible para la venta" />
        </div>
      </Modal>
    </Card>
  );
}
