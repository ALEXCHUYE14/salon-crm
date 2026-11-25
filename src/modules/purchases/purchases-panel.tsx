"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, ClipboardList, PackageCheck, Plus, Save, Send, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/dates";
import { getErrorMessage, nullIfEmpty, round2, toNumber } from "@/lib/utils";
import { listInventory } from "@/modules/inventory/api";
import { useApp } from "@/providers/app-provider";
import type { InventoryItem } from "@/types/domain";
import {
  PURCHASE_STATUS,
  cancelPurchaseOrder,
  listPurchaseOrders,
  listSuppliers,
  orderTotal,
  receivePurchaseOrder,
  savePurchaseOrder,
  type PurchaseOrder,
  type PurchaseOrderItem,
  type Supplier,
} from "./api";

/** Órdenes de compra a proveedores. `onStockChanged` recarga el inventario al recibir. */
export function PurchasesPanel({ onStockChanged }: { onStockChanged: () => void }) {
  const toast = useToast();
  const { money, isAdmin } = useApp();
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, s, i] = await Promise.all([listPurchaseOrders(), listSuppliers(), listInventory({ type: "all" })]);
      setOrders(o);
      setSuppliers(s);
      setItems(i);
    } catch (error) {
      toast.error(getErrorMessage(error));
      setOrders([]);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function openOrder(order: PurchaseOrder | null) {
    if (!order && suppliers.filter((s) => s.is_active).length === 0) {
      toast.error("Primero registra un proveedor en la pestaña «Proveedores»");
      return;
    }
    setEditing(order);
    setOpen(true);
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Órdenes de compra"
        description="Al recibir la mercadería se suma el stock y se actualiza el costo de cada producto."
        action={
          isAdmin ? (
            <Button size="sm" icon={Plus} onClick={() => openOrder(null)}>
              Nueva orden
            </Button>
          ) : null
        }
      />
      {orders === null ? (
        <Spinner />
      ) : orders.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Sin órdenes de compra" />
      ) : (
        <ul className="divide-y divide-line">
          {orders.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => openOrder(o)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-surface-2/60">
                <span className="w-14 shrink-0 font-mono text-sm text-muted">#{o.order_number}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{o.supplier?.name}</p>
                  <p className="truncate text-xs text-muted">
                    {o.items.length} {o.items.length === 1 ? "producto" : "productos"} · {formatDate(o.created_at)}
                    {o.received_at ? ` · recibida el ${formatDate(o.received_at)}` : o.expected_on ? ` · llega el ${formatDate(o.expected_on + "T00:00:00")}` : ""}
                  </p>
                </div>
                <Badge tone={PURCHASE_STATUS[o.status].tone}>{PURCHASE_STATUS[o.status].label}</Badge>
                <span className="w-24 text-right font-semibold tabular-nums text-ink">{money(orderTotal(o.items))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <OrderModal
          order={editing}
          suppliers={suppliers}
          items={items}
          readOnly={!isAdmin}
          onClose={() => setOpen(false)}
          onSaved={(received) => {
            setOpen(false);
            void load();
            if (received) onStockChanged();
          }}
        />
      ) : null}
    </Card>
  );
}

function OrderModal({
  order,
  suppliers,
  items,
  readOnly,
  onClose,
  onSaved,
}: {
  order: PurchaseOrder | null;
  suppliers: Supplier[];
  items: InventoryItem[];
  readOnly: boolean;
  onClose: () => void;
  onSaved: (received: boolean) => void;
}) {
  const toast = useToast();
  const { money } = useApp();
  const closed = order ? ["received", "cancelled"].includes(order.status) : false;
  const locked = readOnly || closed;
  const [supplierId, setSupplierId] = useState(order?.supplier_id ?? suppliers.find((s) => s.is_active)?.id ?? "");
  const [expected, setExpected] = useState(order?.expected_on ?? "");
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [lines, setLines] = useState<PurchaseOrderItem[]>(order?.items.map((i) => ({ item_id: i.item_id, quantity: i.quantity, unit_cost: i.unit_cost })) ?? []);
  const [payCash, setPayCash] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const total = orderTotal(lines);

  function setLine(index: number, patch: Partial<PurchaseOrderItem>) {
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function validate(): string | null {
    if (!supplierId) return "Elige el proveedor";
    if (lines.length === 0) return "Agrega al menos un producto";
    if (lines.some((l) => !l.item_id || !(l.quantity > 0) || l.unit_cost < 0)) return "Completa producto, cantidad y costo en cada línea";
    if (new Set(lines.map((l) => l.item_id)).size !== lines.length) return "Hay un producto repetido";
    return null;
  }

  async function save(status: "draft" | "ordered", thenReceive = false) {
    const problem = validate();
    if (problem) return toast.error(problem);
    setBusy(thenReceive ? "receive" : status);
    try {
      const id = await savePurchaseOrder(
        { supplier_id: supplierId, status, expected_on: expected || null, notes: nullIfEmpty(notes) },
        lines.map((l) => ({ ...l, quantity: round2(l.quantity), unit_cost: round2(l.unit_cost) })),
        order?.id,
      );
      if (thenReceive) {
        const res = await receivePurchaseOrder(id, payCash);
        toast.success(`Orden #${res.order_number} recibida: stock actualizado`);
        onSaved(true);
      } else {
        toast.success(status === "ordered" ? "Orden enviada" : "Borrador guardado");
        onSaved(false);
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!order || !window.confirm(`¿Anular la orden #${order.order_number}? No afecta el stock.`)) return;
    setBusy("cancel");
    try {
      await cancelPurchaseOrder(order.id);
      toast.success("Orden anulada");
      onSaved(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={order ? `Orden de compra #${order.order_number}` : "Nueva orden de compra"}
      description={order ? PURCHASE_STATUS[order.status].label : undefined}
      footer={
        locked ? (
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        ) : (
          <>
            {order ? (
              <Button variant="ghost" icon={Ban} className="mr-auto text-clay" loading={busy === "cancel"} onClick={() => void cancel()}>
                Anular
              </Button>
            ) : null}
            <Button variant="outline" icon={Save} loading={busy === "draft"} onClick={() => void save("draft")}>
              Borrador
            </Button>
            <Button variant="outline" icon={Send} loading={busy === "ordered"} onClick={() => void save("ordered")}>
              Marcar enviada
            </Button>
            <Button icon={PackageCheck} loading={busy === "receive"} onClick={() => void save("ordered", true)}>
              Recibir mercadería
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Proveedor" required>
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={locked}>
              <option value="">Elige un proveedor</option>
              {suppliers
                .filter((s) => s.is_active || s.id === supplierId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Fecha estimada de llegada">
            <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} disabled={locked} />
          </Field>
        </div>

        <div className="rounded-xl border border-line">
          <div className="grid grid-cols-[1fr_90px_110px_36px] gap-2 border-b border-line px-3 py-2 text-xs font-medium text-muted">
            <span>Producto</span>
            <span>Cantidad</span>
            <span>Costo unit.</span>
            <span />
          </div>
          <ul className="space-y-2 p-3">
            {lines.map((l, index) => {
              const item = items.find((i) => i.id === l.item_id);
              return (
                <li key={index} className="grid grid-cols-[1fr_90px_110px_36px] items-center gap-2">
                  <Select
                    value={l.item_id}
                    disabled={locked}
                    aria-label={`Producto ${index + 1}`}
                    onChange={(e) => {
                      const chosen = items.find((i) => i.id === e.target.value);
                      setLine(index, { item_id: e.target.value, unit_cost: chosen ? Number(chosen.cost) : l.unit_cost });
                    }}
                    className="h-10 min-h-0"
                  >
                    <option value="">Elige</option>
                    {items
                      .filter((i) => i.id === l.item_id || !lines.some((x) => x.item_id === i.id))
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} · stock {i.stock} {i.unit}
                        </option>
                      ))}
                  </Select>
                  <Input
                    type="number"
                    min={0.01}
                    step="1"
                    value={l.quantity || ""}
                    disabled={locked}
                    aria-label={`Cantidad ${index + 1}${item ? ` (${item.unit})` : ""}`}
                    onChange={(e) => setLine(index, { quantity: Math.max(0, toNumber(e.target.value)) })}
                    className="h-10 min-h-0"
                  />
                  <Input
                    type="number"
                    min={0}
                    step="0.1"
                    value={l.unit_cost}
                    disabled={locked}
                    aria-label={`Costo unitario ${index + 1}`}
                    onChange={(e) => setLine(index, { unit_cost: Math.max(0, toNumber(e.target.value)) })}
                    className="h-10 min-h-0"
                  />
                  {!locked ? (
                    <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={`Quitar línea ${index + 1}`} onClick={() => setLines((c) => c.filter((_, i) => i !== index))}>
                      <Icon icon={Trash2} />
                    </Button>
                  ) : (
                    <span />
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between border-t border-line px-3 py-2">
            {!locked ? (
              <Button size="sm" variant="outline" icon={Plus} onClick={() => setLines((c) => [...c, { item_id: "", quantity: 1, unit_cost: 0 }])}>
                Agregar producto
              </Button>
            ) : (
              <span />
            )}
            <span className="font-semibold tabular-nums text-ink">Total {money(total)}</span>
          </div>
        </div>

        <Field label="Notas">
          <Textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={locked} />
        </Field>

        {!locked ? (
          <Checkbox checked={payCash} onChange={setPayCash} label="Al recibir, pagar en efectivo desde la caja abierta (se registra como gasto)" />
        ) : null}
      </div>
    </Modal>
  );
}
