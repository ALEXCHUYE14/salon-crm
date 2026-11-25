"use client";

import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Minus, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { SEGMENT_LABELS } from "@/lib/constants";
import { formatDuration } from "@/lib/dates";
import { segmentsForMode } from "@/lib/terminology";
import { getErrorMessage, nullIfEmpty, round2, toNumber } from "@/lib/utils";
import { listInventory } from "@/modules/inventory/api";
import { useApp } from "@/providers/app-provider";
import type { ComboItem, CommissionType, InventoryItem, Segment, Service, ServiceCategory, ServiceSupply } from "@/types/domain";
import { listServiceSupplies, saveService, saveServiceSupplies } from "../api";

type CommissionMode = "inherit" | CommissionType;

interface FormState {
  name: string;
  description: string;
  category_id: string;
  segment: Segment;
  duration_minutes: number;
  processing_minutes: number;
  price: number;
  commission_mode: CommissionMode;
  commission_value: number;
  is_combo: boolean;
  is_active: boolean;
  online_bookable: boolean;
  sort_order: number;
  combo_items: ComboItem[];
}

interface ServiceFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  service: Service | null;
  services: Service[];
  categories: ServiceCategory[];
}

function toForm(service: Service | null, defaultSegment: Segment, nextOrder: number): FormState {
  return {
    name: service?.name ?? "",
    description: service?.description ?? "",
    category_id: service?.category_id ?? "",
    segment: service?.segment ?? defaultSegment,
    duration_minutes: service?.duration_minutes ?? 30,
    processing_minutes: service?.processing_minutes ?? 0,
    price: service ? Number(service.price) : 0,
    commission_mode: service?.commission_type ?? "inherit",
    commission_value: service?.commission_value !== null && service?.commission_value !== undefined ? Number(service.commission_value) : 0,
    is_combo: service?.is_combo ?? false,
    is_active: service?.is_active ?? true,
    online_bookable: service?.online_bookable ?? true,
    sort_order: service?.sort_order ?? nextOrder,
    combo_items: service?.combo_items ?? [],
  };
}

export function ServiceFormModal({ open, onClose, onSaved, service, services, categories }: ServiceFormModalProps) {
  const toast = useToast();
  const { settings, money } = useApp();
  const mode = settings.operating_mode;
  const defaultSegment: Segment = mode === "barbershop" ? "barbershop" : mode === "beauty_salon" ? "beauty_salon" : "both";
  const nextOrder = services.reduce((max, s) => Math.max(max, s.sort_order), 0) + 1;
  const [form, setForm] = useState<FormState>(() => toForm(service, defaultSegment, nextOrder));
  const [saving, setSaving] = useState(false);
  const [stockItems, setStockItems] = useState<InventoryItem[]>([]);
  const [recipe, setRecipe] = useState<ServiceSupply[]>([]);
  /** null = cargando; false = la receta no está disponible (tabla aún no migrada o sin permiso). */
  const [recipeReady, setRecipeReady] = useState<boolean | null>(null);

  useEffect(() => {
    if (open) setForm(toForm(service, defaultSegment, nextOrder));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, service?.id]);

  // Receta de insumos del servicio
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRecipe([]);
    setRecipeReady(null);
    Promise.all([listInventory({ type: "all" }), service ? listServiceSupplies(service.id) : Promise.resolve([] as ServiceSupply[])])
      .then(([items, rows]) => {
        if (cancelled) return;
        setStockItems(items);
        setRecipe(rows);
        setRecipeReady(true);
      })
      .catch(() => {
        if (!cancelled) setRecipeReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, service]);

  const comboCandidates = services.filter((s) => !s.is_combo && s.id !== service?.id && s.is_active);
  const comboSuggestion = useMemo(() => {
    const items = form.combo_items.map((ci) => ({ ci, svc: services.find((s) => s.id === ci.service_id) }));
    return {
      price: round2(items.reduce((sum, { ci, svc }) => sum + Number(svc?.price ?? 0) * ci.quantity, 0)),
      duration: items.reduce((sum, { ci, svc }) => sum + (svc?.duration_minutes ?? 0) * ci.quantity, 0),
      processing: items.reduce((sum, { ci, svc }) => sum + (svc?.processing_minutes ?? 0) * ci.quantity, 0),
    };
  }, [form.combo_items, services]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setComboQty(serviceId: string, quantity: number) {
    setForm((current) => {
      const rest = current.combo_items.filter((c) => c.service_id !== serviceId);
      return { ...current, combo_items: quantity > 0 ? [...rest, { service_id: serviceId, quantity: Math.min(quantity, 10) }] : rest };
    });
  }

  async function handleSave() {
    if (form.name.trim().length < 2) return toast.error("Ingresa el nombre del servicio");
    if (form.duration_minutes < 5) return toast.error("La duración mínima es de 5 minutos");
    if (form.commission_mode === "percentage" && form.commission_value > 100) return toast.error("El porcentaje no puede superar 100");
    if (form.is_combo && form.combo_items.length < 2) return toast.error("Un combo debe incluir al menos dos servicios");
    if (recipe.some((r) => !r.item_id || !(r.quantity > 0))) return toast.error("Completa el insumo y la cantidad de cada línea de la receta");
    if (new Set(recipe.map((r) => r.item_id)).size !== recipe.length) return toast.error("Un insumo está repetido en la receta");
    setSaving(true);
    try {
      const savedId = await saveService(
        {
          name: form.name.trim(),
          description: nullIfEmpty(form.description),
          category_id: nullIfEmpty(form.category_id),
          segment: form.segment,
          duration_minutes: form.duration_minutes,
          processing_minutes: form.processing_minutes,
          price: form.price,
          commission_type: form.commission_mode === "inherit" ? null : form.commission_mode,
          commission_value: form.commission_mode === "inherit" ? null : form.commission_value,
          is_combo: form.is_combo,
          is_active: form.is_active,
          online_bookable: form.online_bookable,
          sort_order: form.sort_order,
        },
        form.is_combo ? form.combo_items : [],
        service?.id,
      );
      if (recipeReady) await saveServiceSupplies(savedId, recipe);
      toast.success(service ? "Servicio actualizado" : "Servicio creado");
      onSaved();
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const segmentOptions = Array.from(new Set<Segment>([...segmentsForMode(mode), form.segment]));
  const inheritLabel =
    settings.default_commission_type === "percentage"
      ? `${settings.default_commission_value}% (o el del especialista)`
      : `${money(settings.default_commission_value)} fijo (o el del especialista)`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={service ? "Editar servicio" : "Nuevo servicio"}
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
        <Field label="Nombre" required className="sm:col-span-2">
          <Input value={form.name} onChange={(e) => update("name", e.target.value)} />
        </Field>
        <Field label="Categoría">
          <Select value={form.category_id} onChange={(e) => update("category_id", e.target.value)}>
            <option value="">Sin categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Área">
          <Select value={form.segment} onChange={(e) => update("segment", e.target.value as Segment)}>
            {segmentOptions.map((s) => (
              <option key={s} value={s}>
                {SEGMENT_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-3 gap-3 sm:col-span-2">
          <Field label="Duración (min)">
            <Input type="number" min={5} step={5} value={form.duration_minutes} onChange={(e) => update("duration_minutes", toNumber(e.target.value, 5))} />
          </Field>
          <Field label="Pose (min)">
            <Input type="number" min={0} step={5} value={form.processing_minutes} onChange={(e) => update("processing_minutes", toNumber(e.target.value, 0))} />
          </Field>
          <Field label={`Precio (${settings.currency_symbol})`}>
            <Input type="number" min={0} step="0.5" value={form.price} onChange={(e) => update("price", toNumber(e.target.value, 0))} />
          </Field>
        </div>
        <Field label="Comisión" hint={form.commission_mode === "inherit" ? `Hereda: ${inheritLabel}` : undefined}>
          <Select value={form.commission_mode} onChange={(e) => update("commission_mode", e.target.value as CommissionMode)}>
            <option value="inherit">Heredada</option>
            <option value="percentage">Porcentaje personalizado</option>
            <option value="fixed">Monto fijo personalizado</option>
          </Select>
        </Field>
        <Field label={form.commission_mode === "fixed" ? `Monto (${settings.currency_symbol})` : "Porcentaje (%)"}>
          <Input
            type="number"
            min={0}
            max={form.commission_mode === "percentage" ? 100 : undefined}
            step="0.5"
            value={form.commission_value}
            disabled={form.commission_mode === "inherit"}
            onChange={(e) => update("commission_value", toNumber(e.target.value, 0))}
          />
        </Field>
        <Field label="Descripción" className="sm:col-span-2">
          <Textarea rows={2} value={form.description} onChange={(e) => update("description", e.target.value)} />
        </Field>
        <div className="space-y-1 sm:col-span-2">
          <Switch checked={form.is_active} onChange={(v) => update("is_active", v)} label="Activo" description="Disponible en agenda y caja." />
          <Switch checked={form.is_combo} onChange={(v) => update("is_combo", v)} label="Es un combo" description="Agrupa varios servicios con un precio especial." />
          <Switch
            checked={form.online_bookable}
            onChange={(v) => update("online_bookable", v)}
            label="Reservable online"
            description="Aparece en la página pública de reservas."
          />
        </div>

        {form.is_combo ? (
          <div className="rounded-xl border border-line bg-surface-2/50 p-3 sm:col-span-2">
            <p className="mb-2 text-sm font-medium text-ink">Servicios incluidos</p>
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {comboCandidates.map((s) => {
                const qty = form.combo_items.find((c) => c.service_id === s.id)?.quantity ?? 0;
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      {s.name} <span className="text-muted">· {money(s.price)}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setComboQty(s.id, qty - 1)} disabled={qty === 0} aria-label="Quitar">
                        <Icon icon={Minus} />
                      </Button>
                      <span className="w-5 text-center tabular-nums">{qty}</span>
                      <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setComboQty(s.id, qty + 1)} aria-label="Agregar">
                        <Icon icon={Plus} />
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
            {form.combo_items.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted">
                  Suma individual: {money(comboSuggestion.price)} · {formatDuration(comboSuggestion.duration + comboSuggestion.processing)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setForm((c) => ({ ...c, duration_minutes: comboSuggestion.duration || c.duration_minutes, processing_minutes: comboSuggestion.processing }))
                  }
                >
                  Usar duración sugerida
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {recipeReady ? (
          <div className="rounded-xl border border-line p-3 sm:col-span-2">
            <div className="mb-2 flex items-start gap-2">
              <Icon icon={FlaskConical} className="mt-0.5 text-sage" />
              <div>
                <p className="text-sm font-medium text-ink">Insumos que consume</p>
                <p className="text-xs text-muted">
                  Se descuentan del inventario cada vez que se cobra el servicio.
                  {form.is_combo ? " Si el combo no tiene receta propia, se usa la de sus servicios." : ""}
                </p>
              </div>
            </div>
            {recipe.length > 0 ? (
              <ul className="space-y-2">
                {recipe.map((line, index) => {
                  const item = stockItems.find((i) => i.id === line.item_id);
                  return (
                    <li key={index} className="grid grid-cols-[1fr_110px_auto] items-center gap-2">
                      <Select
                        value={line.item_id}
                        aria-label={`Insumo ${index + 1}`}
                        onChange={(e) => setRecipe((current) => current.map((r, i) => (i === index ? { ...r, item_id: e.target.value } : r)))}
                      >
                        <option value="">Elige un insumo</option>
                        {stockItems
                          .filter((i) => i.id === line.item_id || !recipe.some((r) => r.item_id === i.id))
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name} ({i.unit})
                            </option>
                          ))}
                      </Select>
                      <div className="relative">
                        <Input
                          type="number"
                          min={0.01}
                          step="0.01"
                          value={line.quantity || ""}
                          aria-label={`Cantidad del insumo ${index + 1}`}
                          onChange={(e) =>
                            setRecipe((current) => current.map((r, i) => (i === index ? { ...r, quantity: round2(Math.max(0, toNumber(e.target.value))) } : r)))
                          }
                          className="pr-14"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 max-w-[48px] -translate-y-1/2 truncate text-xs text-muted">
                          {item?.unit ?? ""}
                        </span>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-10 w-10"
                        aria-label={`Quitar insumo ${index + 1}`}
                        onClick={() => setRecipe((current) => current.filter((_, i) => i !== index))}
                      >
                        <Icon icon={Trash2} />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              icon={Plus}
              className="mt-2"
              disabled={recipe.length >= stockItems.length}
              onClick={() => setRecipe((current) => [...current, { item_id: "", quantity: 1 }])}
            >
              Agregar insumo
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
