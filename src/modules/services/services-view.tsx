"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, FolderPlus, Layers, Pencil, Plus, Scissors, Tags, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Switch } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { EmptyState, PageHeader, Spinner, Tabs } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { SEGMENT_LABELS } from "@/lib/constants";
import { formatDuration } from "@/lib/dates";
import { isSegmentVisible, segmentsForMode } from "@/lib/terminology";
import { cn, getErrorMessage, toNumber } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import type { Segment, Service, ServiceCategory } from "@/types/domain";
import { deleteCategory, listCategories, listServices, saveCategory } from "./api";
import { ServiceFormModal } from "./components/service-form-modal";

type Tab = "services" | "categories";

export function ServicesView() {
  const toast = useToast();
  const { settings, money, isAdmin } = useApp();
  const mode = settings.operating_mode;
  const [tab, setTab] = useState<Tab>("services");
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showInactive, setShowInactive] = useState(false);
  const [serviceModal, setServiceModal] = useState<{ open: boolean; service: Service | null }>({ open: false, service: null });
  const [categoryModal, setCategoryModal] = useState<{ open: boolean; category: ServiceCategory | null }>({ open: false, category: null });

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([listServices(), listCategories()]);
      setServices(s.filter((x) => isSegmentVisible(x.segment, mode)));
      setCategories(c.filter((x) => isSegmentVisible(x.segment, mode)));
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [mode, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const filtered = services.filter((s) => (showInactive || s.is_active) && (categoryFilter === "all" || s.category_id === categoryFilter));
    const groups = categories
      .map((c) => ({ id: c.id, name: c.name, items: filtered.filter((s) => s.category_id === c.id) }))
      .filter((g) => g.items.length > 0);
    const orphan = filtered.filter((s) => !s.category_id || !categories.some((c) => c.id === s.category_id));
    if (orphan.length) groups.push({ id: "none", name: "Sin categoría", items: orphan });
    return groups;
  }, [services, categories, categoryFilter, showInactive]);

  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? "Servicio";

  function commissionLabel(s: Service): string {
    if (!s.commission_type) return "Heredada";
    return s.commission_type === "percentage" ? `${s.commission_value}%` : `${money(s.commission_value)} fijo`;
  }

  async function handleDeleteCategory(category: ServiceCategory) {
    if (!window.confirm(`¿Eliminar la categoría «${category.name}»? Sus servicios quedarán sin categoría.`)) return;
    try {
      await deleteCategory(category.id);
      toast.success("Categoría eliminada");
      void load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  return (
    <div>
      <PageHeader
        title="Servicios y combos"
        description={`${services.filter((s) => s.is_active).length} servicios activos`}
        actions={
          isAdmin ? (
            <>
              <Button variant="outline" icon={FolderPlus} onClick={() => setCategoryModal({ open: true, category: null })}>
                Categoría
              </Button>
              <Button icon={Plus} onClick={() => setServiceModal({ open: true, service: null })}>
                Nuevo servicio
              </Button>
            </>
          ) : null
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4"
        items={[
          { value: "services", label: "Catálogo", icon: Scissors },
          { value: "categories", label: "Categorías", icon: Tags, count: categories.length },
        ]}
      />

      {loading ? (
        <Spinner />
      ) : tab === "services" ? (
        <>
          <Card className="mb-4 flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            <div className="sm:w-64">
              <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Categoría">
                <option value="all">Todas las categorías</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="sm:ml-auto">
              <Switch checked={showInactive} onChange={setShowInactive} label="Mostrar inactivos" />
            </div>
          </Card>

          {grouped.length === 0 ? (
            <Card>
              <EmptyState icon={Scissors} title="Sin servicios" description="Crea tu catálogo con duraciones, tiempos de pose y comisiones." />
            </Card>
          ) : (
            <div className="space-y-6">
              {grouped.map((group) => (
                <Card key={group.id} className="overflow-hidden">
                  <CardHeader title={group.name} description={`${group.items.length} servicios`} />
                  <ul className="divide-y divide-line">
                    {group.items.map((s) => (
                      <li key={s.id} className={cn("flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center", !s.is_active && "opacity-60")}>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-ink">{s.name}</p>
                            {s.is_combo ? (
                              <Badge tone="ochre">
                                <Icon icon={Layers} className="h-3 w-3" /> Combo
                              </Badge>
                            ) : null}
                            {!s.is_active ? <Badge tone="outline">Inactivo</Badge> : null}
                            {mode === "hybrid" ? <Badge tone="neutral">{SEGMENT_LABELS[s.segment]}</Badge> : null}
                          </div>
                          {s.description ? <p className="mt-0.5 text-sm text-muted">{s.description}</p> : null}
                          {s.is_combo && s.combo_items.length ? (
                            <p className="mt-1 text-xs text-muted">
                              Incluye: {s.combo_items.map((c) => `${c.quantity > 1 ? `${c.quantity}× ` : ""}${serviceName(c.service_id)}`).join(" + ")}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                          <span className="flex items-center gap-1.5 text-muted">
                            <Icon icon={Clock} />
                            {formatDuration(s.duration_minutes)}
                            {s.processing_minutes > 0 ? ` + ${s.processing_minutes} pose` : ""}
                          </span>
                          <span className="text-muted">Comisión: {commissionLabel(s)}</span>
                          <span className="w-24 text-right font-semibold tabular-nums text-ink">{money(s.price)}</span>
                          {isAdmin ? (
                            <Button size="icon" variant="ghost" aria-label={`Editar ${s.name}`} onClick={() => setServiceModal({ open: true, service: s })}>
                              <Icon icon={Pencil} />
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <Card className="overflow-hidden">
          {categories.length === 0 ? (
            <EmptyState icon={Tags} title="Sin categorías" />
          ) : (
            <ul className="divide-y divide-line">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="w-8 text-sm tabular-nums text-muted">{c.sort_order}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{c.name}</p>
                    <p className="text-xs text-muted">
                      {SEGMENT_LABELS[c.segment]} · {services.filter((s) => s.category_id === c.id).length} servicios
                    </p>
                  </div>
                  {!c.is_active ? <Badge tone="outline">Inactiva</Badge> : null}
                  {isAdmin ? (
                    <>
                      <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setCategoryModal({ open: true, category: c })}>
                        <Icon icon={Pencil} />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="Eliminar" onClick={() => void handleDeleteCategory(c)}>
                        <Icon icon={Trash2} />
                      </Button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <ServiceFormModal
        open={serviceModal.open}
        service={serviceModal.service}
        services={services}
        categories={categories}
        onClose={() => setServiceModal({ open: false, service: null })}
        onSaved={() => void load()}
      />
      <CategoryModal
        open={categoryModal.open}
        category={categoryModal.category}
        nextOrder={categories.reduce((m, c) => Math.max(m, c.sort_order), 0) + 1}
        onClose={() => setCategoryModal({ open: false, category: null })}
        onSaved={() => void load()}
      />
    </div>
  );
}

function CategoryModal({
  open,
  category,
  nextOrder,
  onClose,
  onSaved,
}: {
  open: boolean;
  category: ServiceCategory | null;
  nextOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { settings } = useApp();
  const segments = segmentsForMode(settings.operating_mode);
  const [name, setName] = useState("");
  const [segment, setSegment] = useState<Segment>("both");
  const [order, setOrder] = useState(1);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? "");
    setSegment(category?.segment ?? (segments.length === 2 ? segments[0] : "both"));
    setOrder(category?.sort_order ?? nextOrder);
    setActive(category?.is_active ?? true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category?.id]);

  async function handleSave() {
    if (name.trim().length < 2) return toast.error("Ingresa un nombre");
    setSaving(true);
    try {
      await saveCategory({ name: name.trim(), segment, sort_order: order, is_active: active }, category?.id);
      toast.success("Categoría guardada");
      onSaved();
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={category ? "Editar categoría" : "Nueva categoría"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving} onClick={() => void handleSave()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Área">
            <Select value={segment} onChange={(e) => setSegment(e.target.value as Segment)}>
              {segments.map((s) => (
                <option key={s} value={s}>
                  {SEGMENT_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Orden">
            <Input type="number" min={0} value={order} onChange={(e) => setOrder(toNumber(e.target.value, 0))} />
          </Field>
        </div>
        <Switch checked={active} onChange={setActive} label="Activa" />
      </div>
    </Modal>
  );
}
