"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  ClipboardList,
  Download,
  History,
  Package,
  PackagePlus,
  Pencil,
  Search,
  Save,
  Truck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { EmptyState, PageHeader, Spinner, StatCard, Tabs } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { ITEM_TYPE_LABELS, MOVEMENT_LABELS, SEGMENT_LABELS } from "@/lib/constants";
import { formatDateTime } from "@/lib/dates";
import { isSegmentVisible, segmentsForMode } from "@/lib/terminology";
import { cn, downloadCsv, formatNumber, getErrorMessage, nullIfEmpty, toNumber } from "@/lib/utils";
import { PurchasesPanel } from "@/modules/purchases/purchases-panel";
import { SuppliersPanel } from "@/modules/purchases/suppliers-panel";
import { useApp } from "@/providers/app-provider";
import type { InventoryItem, InventoryItemType, InventoryMovement, Segment } from "@/types/domain";
import { createMovement, listInventory, listMovements, saveInventoryItem, type MovementInput } from "./api";

type Tab = "items" | "movements" | "purchases" | "suppliers";

export function InventoryView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { settings, money, isAdmin, can, staff } = useApp();
  const [tab, setTab] = useState<Tab>("items");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [type, setType] = useState<InventoryItemType | "all">("all");
  const [lowOnly, setLowOnly] = useState(searchParams.get("bajo") === "1");
  const [itemModal, setItemModal] = useState<{ open: boolean; item: InventoryItem | null }>({ open: false, item: null });
  const [movementItem, setMovementItem] = useState<InventoryItem | null>(null);

  const canMove = can("pos") || isAdmin;

  useEffect(() => {
    if (searchParams.get("bajo") === "1") router.replace(pathname);
  }, [searchParams, router, pathname]);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(search), 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listInventory({ search: debounced, type, lowOnly });
      setItems(rows.filter((r) => isSegmentVisible(r.segment, settings.operating_mode)));
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [debounced, type, lowOnly, settings.operating_mode, toast]);

  const loadMovements = useCallback(async () => {
    try {
      setMovements(await listMovements({ limit: 80 }));
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }, [toast]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (tab === "movements") void loadMovements();
  }, [tab, loadMovements]);

  const lowCount = items.filter((i) => i.is_low_stock).length;
  const stockValue = items.reduce((sum, i) => sum + Number(i.stock) * Number(i.cost), 0);

  return (
    <div>
      <PageHeader
        title="Inventario"
        description="Productos de reventa e insumos técnicos"
        actions={
          <>
            <Button
              variant="outline"
              icon={Download}
              disabled={items.length === 0}
              onClick={() =>
                downloadCsv(
                  "inventario",
                  items.map((i) => ({
                    SKU: i.sku,
                    Producto: i.name,
                    Tipo: ITEM_TYPE_LABELS[i.item_type],
                    Marca: i.brand,
                    Stock: i.stock,
                    Minimo: i.min_stock,
                    Unidad: i.unit,
                    Costo: Number(i.cost).toFixed(2),
                    Precio: i.price !== null ? Number(i.price).toFixed(2) : "",
                    Proveedor: i.supplier,
                  })),
                )
              }
            >
              CSV
            </Button>
            {isAdmin ? (
              <Button icon={PackagePlus} onClick={() => setItemModal({ open: true, item: null })}>
                Nuevo producto
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Productos activos" value={String(items.length)} icon={Package} />
        <StatCard label="En stock mínimo" value={String(lowCount)} icon={AlertTriangle} tone={lowCount > 0 ? "ochre" : "neutral"} />
        <StatCard label="Valor a costo" value={money(stockValue)} icon={Package} tone="sage" />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4"
        items={[
          { value: "items", label: "Productos", icon: Package },
          { value: "movements", label: "Movimientos", icon: History },
          ...(isAdmin || staff.role === "receptionist"
            ? [
                { value: "purchases" as Tab, label: "Compras", icon: ClipboardList },
                { value: "suppliers" as Tab, label: "Proveedores", icon: Truck },
              ]
            : []),
        ]}
      />

      {tab === "purchases" ? <PurchasesPanel onStockChanged={() => void loadItems()} /> : null}
      {tab === "suppliers" ? <SuppliersPanel /> : null}

      {tab === "items" ? (
        <>
          <Card className="mb-4 flex flex-col gap-3 p-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Icon icon={Search} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, SKU o marca" className="pl-9" />
            </div>
            <div className="md:w-48">
              <Select value={type} onChange={(e) => setType(e.target.value as InventoryItemType | "all")} aria-label="Tipo">
                <option value="all">Todos los tipos</option>
                <option value="retail">{ITEM_TYPE_LABELS.retail}</option>
                <option value="supply">{ITEM_TYPE_LABELS.supply}</option>
              </Select>
            </div>
            <Switch checked={lowOnly} onChange={setLowOnly} label="Solo stock bajo" />
          </Card>

          <Card className="overflow-hidden">
            {loading ? (
              <Spinner />
            ) : items.length === 0 ? (
              <EmptyState icon={Package} title="Sin productos" description="Registra productos de reventa e insumos con su stock mínimo." />
            ) : (
              <ul className="divide-y divide-line">
                {items.map((item) => (
                  <li key={item.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-ink">{item.name}</p>
                        <Badge tone={item.item_type === "retail" ? "sage" : "neutral"}>{ITEM_TYPE_LABELS[item.item_type]}</Badge>
                        {item.is_low_stock ? (
                          <Badge tone="ochre">
                            <Icon icon={AlertTriangle} className="h-3 w-3" /> Stock bajo
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs text-muted">
                        {[item.sku, item.brand, item.supplier].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                      <div className="text-right">
                        <p className={cn("font-semibold tabular-nums", item.is_low_stock ? "text-ochre-dark" : "text-ink")}>
                          {formatNumber(item.stock, settings.locale, Number.isInteger(Number(item.stock)) ? 0 : 2)} {item.unit}
                        </p>
                        <p className="text-xs text-muted">mín. {formatNumber(item.min_stock, settings.locale)}</p>
                      </div>
                      <div className="w-24 text-right">
                        <p className="tabular-nums text-ink">{item.price !== null ? money(item.price) : "—"}</p>
                        <p className="text-xs text-muted">costo {money(item.cost)}</p>
                      </div>
                      <div className="flex gap-1">
                        {canMove ? (
                          <Button size="sm" variant="outline" onClick={() => setMovementItem(item)}>
                            Movimiento
                          </Button>
                        ) : null}
                        {isAdmin ? (
                          <Button size="icon" variant="ghost" aria-label={`Editar ${item.name}`} onClick={() => setItemModal({ open: true, item })}>
                            <Icon icon={Pencil} />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : tab === "movements" ? (
        <Card className="overflow-hidden">
          {movements.length === 0 ? (
            <EmptyState icon={History} title="Sin movimientos registrados" />
          ) : (
            <ul className="divide-y divide-line">
              {movements.map((m) => {
                const meta = MOVEMENT_LABELS[m.movement_type];
                const incoming = meta.direction === "in";
                return (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", incoming ? "bg-sage-soft text-sage" : "bg-clay-soft text-clay")}>
                      <Icon icon={incoming ? ArrowDownLeft : ArrowUpRight} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{m.item?.name}</p>
                      <p className="truncate text-xs text-muted">
                        {meta.label} · {formatDateTime(m.created_at)}
                        {m.reference ? ` · ${m.reference}` : ""}
                        {m.notes ? ` · ${m.notes}` : ""}
                      </p>
                    </div>
                    <span className={cn("font-semibold tabular-nums", incoming ? "text-sage" : "text-clay")}>
                      {incoming ? "+" : "−"}
                      {formatNumber(m.quantity, settings.locale, Number.isInteger(Number(m.quantity)) ? 0 : 2)} {m.item?.unit}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : null}

      <ItemModal open={itemModal.open} item={itemModal.item} onClose={() => setItemModal({ open: false, item: null })} onSaved={() => void loadItems()} />
      <MovementModal
        item={movementItem}
        onClose={() => setMovementItem(null)}
        onSaved={() => {
          void loadItems();
          if (tab === "movements") void loadMovements();
        }}
      />
    </div>
  );
}

function ItemModal({ open, item, onClose, onSaved }: { open: boolean; item: InventoryItem | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { settings } = useApp();
  const segments = segmentsForMode(settings.operating_mode);
  const [form, setForm] = useState({
    sku: "",
    name: "",
    item_type: "retail" as InventoryItemType,
    segment: "both" as Segment,
    brand: "",
    unit: "unidad",
    min_stock: 0,
    cost: 0,
    price: "",
    supplier: "",
    is_active: true,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      sku: item?.sku ?? "",
      name: item?.name ?? "",
      item_type: item?.item_type ?? "retail",
      segment: item?.segment ?? (segments.length === 2 ? segments[0] : "both"),
      brand: item?.brand ?? "",
      unit: item?.unit ?? "unidad",
      min_stock: Number(item?.min_stock ?? 0),
      cost: Number(item?.cost ?? 0),
      price: item?.price !== null && item?.price !== undefined ? String(item.price) : "",
      supplier: item?.supplier ?? "",
      is_active: item?.is_active ?? true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);

  async function handleSave() {
    if (form.name.trim().length < 2) return toast.error("Ingresa el nombre del producto");
    if (form.item_type === "retail" && form.price === "") return toast.error("Los productos de reventa requieren precio de venta");
    setSaving(true);
    try {
      await saveInventoryItem(
        {
          sku: nullIfEmpty(form.sku)?.toUpperCase() ?? null,
          name: form.name.trim(),
          item_type: form.item_type,
          segment: form.segment,
          brand: nullIfEmpty(form.brand),
          unit: form.unit.trim() || "unidad",
          min_stock: Math.max(0, form.min_stock),
          cost: Math.max(0, form.cost),
          price: form.price === "" ? null : Math.max(0, toNumber(form.price)),
          supplier: nullIfEmpty(form.supplier),
          is_active: form.is_active,
        },
        item?.id,
      );
      toast.success(item ? "Producto actualizado" : "Producto registrado. Registra una entrada para cargar su stock.");
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
      size="lg"
      title={item ? "Editar producto" : "Nuevo producto"}
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
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Tipo">
          <Select value={form.item_type} onChange={(e) => setForm({ ...form, item_type: e.target.value as InventoryItemType })}>
            <option value="retail">{ITEM_TYPE_LABELS.retail}</option>
            <option value="supply">{ITEM_TYPE_LABELS.supply}</option>
          </Select>
        </Field>
        <Field label="Área">
          <Select value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value as Segment })}>
            {Array.from(new Set<Segment>([...segments, form.segment])).map((s) => (
              <option key={s} value={s}>
                {SEGMENT_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="SKU / código">
          <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
        </Field>
        <Field label="Marca">
          <Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
        </Field>
        <Field label="Unidad de medida" hint="unidad, tubo, litro, frasco…">
          <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        </Field>
        <Field label="Stock mínimo">
          <Input type="number" min={0} step="0.5" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: toNumber(e.target.value) })} />
        </Field>
        <Field label={`Costo (${settings.currency_symbol})`}>
          <Input type="number" min={0} step="0.1" value={form.cost} onChange={(e) => setForm({ ...form, cost: toNumber(e.target.value) })} />
        </Field>
        <Field label={`Precio de venta (${settings.currency_symbol})`} hint={form.item_type === "supply" ? "Opcional para insumos" : undefined}>
          <Input type="number" min={0} step="0.1" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        </Field>
        <Field label="Proveedor" className="sm:col-span-2">
          <Input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Switch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Activo" />
        </div>
      </div>
    </Modal>
  );
}

const MANUAL_MOVEMENTS: MovementInput["movement_type"][] = ["purchase", "usage", "adjustment_in", "adjustment_out"];

function MovementModal({ item, onClose, onSaved }: { item: InventoryItem | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { settings } = useApp();
  const [type, setType] = useState<MovementInput["movement_type"]>("purchase");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    setType("purchase");
    setQuantity("");
    setUnitCost(String(item.cost ?? ""));
    setReference("");
    setNotes("");
  }, [item]);

  if (!item) return null;
  const incoming = MOVEMENT_LABELS[type].direction === "in";
  const qty = toNumber(quantity);
  const resulting = Number(item.stock) + (incoming ? qty : -qty);

  async function handleSave() {
    if (!item) return;
    if (qty <= 0) return toast.error("Ingresa una cantidad mayor a cero");
    if (resulting < 0) return toast.error("El stock no puede quedar negativo");
    setSaving(true);
    try {
      await createMovement({
        item_id: item.id,
        movement_type: type,
        quantity: qty,
        unit_cost: type === "purchase" && unitCost !== "" ? toNumber(unitCost) : null,
        reference: nullIfEmpty(reference),
        notes: nullIfEmpty(notes),
      });
      toast.success("Movimiento registrado");
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
      open
      onClose={onClose}
      size="sm"
      title="Registrar movimiento"
      description={`${item.name} · stock actual ${item.stock} ${item.unit}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving} onClick={() => void handleSave()}>
            Registrar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tipo de movimiento">
          <Select value={type} onChange={(e) => setType(e.target.value as MovementInput["movement_type"])}>
            {MANUAL_MOVEMENTS.map((m) => (
              <option key={m} value={m}>
                {MOVEMENT_LABELS[m].label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Cantidad (${item.unit})`} required>
            <Input type="number" min={0} step="0.5" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
          </Field>
          {type === "purchase" ? (
            <Field label={`Costo unit. (${settings.currency_symbol})`}>
              <Input type="number" min={0} step="0.1" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            </Field>
          ) : null}
        </div>
        <Field label="Referencia" hint="N.° de factura, guía, servicio…">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Notas">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {qty > 0 ? (
          <p className={cn("text-sm", resulting < Number(item.min_stock) ? "text-ochre-dark" : "text-muted")}>
            Stock resultante: <strong className="tabular-nums">{resulting}</strong> {item.unit}
            {resulting < Number(item.min_stock) ? " (por debajo del mínimo)" : ""}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
