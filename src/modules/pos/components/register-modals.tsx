"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Ban, Lock, Plus, Receipt as ReceiptIcon, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { EmptyState, Spinner, Tabs } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { CASH_CATEGORIES_BY_TYPE, CASH_CATEGORY_LABELS, CASH_MOVEMENT_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/constants";
import { formatDateTime, formatTime } from "@/lib/dates";
import { cn, getErrorMessage, nullIfEmpty, round2, toNumber } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import type {
  CashMovement,
  CashMovementCategory,
  CashMovementType,
  CashRegister,
  RecordedPaymentMethod,
  RegisterSummary,
  TransactionRow,
} from "@/types/domain";
import {
  closeRegister,
  createCashMovement,
  deleteCashMovement,
  fetchRegisterSummary,
  listCashMovements,
  listRegisterTransactions,
  voidTransaction,
} from "../api";

export function CloseRegisterModal({
  open,
  onClose,
  register,
  onClosed,
}: {
  open: boolean;
  onClose: () => void;
  register: CashRegister;
  onClosed: (closed: CashRegister) => void;
}) {
  const toast = useToast();
  const { money } = useApp();
  const [summary, setSummary] = useState<RegisterSummary | null>(null);
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCounted("");
    setNotes("");
    setSummary(null);
    fetchRegisterSummary(register.id)
      .then(setSummary)
      .catch((error: unknown) => toast.error(getErrorMessage(error)));
  }, [open, register.id, toast]);

  const expected = toNumber(summary?.expected_cash);
  const diff = counted === "" ? null : round2(toNumber(counted) - expected);

  async function handleClose() {
    if (counted === "") return toast.error("Ingresa el efectivo contado");
    setSaving(true);
    try {
      const closed = await closeRegister(toNumber(counted), nullIfEmpty(notes), register.branch_id ?? null);
      toast.success("Caja cerrada correctamente");
      onClosed(closed);
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
      title="Cierre de caja y arqueo"
      description={`Abierta el ${formatDateTime(register.opened_at)}${register.opened_by_staff ? ` por ${register.opened_by_staff.full_name}` : ""}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" icon={Lock} loading={saving} onClick={() => void handleClose()} disabled={!summary}>
            Cerrar caja
          </Button>
        </>
      }
    >
      {!summary ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Ventas" value={String(summary.transactions)} />
            <Stat label="Anuladas" value={String(summary.voided)} />
            <Stat label="Total cobrado" value={money(summary.gross_total)} />
            <Stat label="Propinas" value={money(summary.tips)} />
          </dl>
          <div className="rounded-xl border border-line">
            <p className="border-b border-line px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted">Por método de pago</p>
            <ul className="divide-y divide-line text-sm">
              {(Object.keys(PAYMENT_METHOD_LABELS) as RecordedPaymentMethod[]).map((m) => (
                <li key={m} className="flex justify-between px-4 py-2">
                  <span className="text-muted">{PAYMENT_METHOD_LABELS[m]}</span>
                  <span className="tabular-nums">{money(summary.by_method[m] ?? 0)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl bg-surface-2 p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Fondo inicial</span>
              <span className="tabular-nums">{money(summary.opening_amount)}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted">+ Ventas en efectivo</span>
              <span className="tabular-nums">{money(summary.cash_sales)}</span>
            </div>
            {summary.advances_cash_in > 0 ? (
              <div className="mt-1 flex justify-between">
                <span className="text-muted">+ Adelantos recibidos en efectivo</span>
                <span className="tabular-nums">{money(summary.advances_cash_in)}</span>
              </div>
            ) : null}
            {summary.advances_cash_out > 0 ? (
              <div className="mt-1 flex justify-between text-clay-dark">
                <span>− Adelantos devueltos</span>
                <span className="tabular-nums">{money(summary.advances_cash_out)}</span>
              </div>
            ) : null}
            {summary.deposits > 0 ? (
              <div className="mt-1 flex justify-between">
                <span className="text-muted">+ Ingresos de efectivo</span>
                <span className="tabular-nums">{money(summary.deposits)}</span>
              </div>
            ) : null}
            {summary.expenses > 0 ? (
              <div className="mt-1 flex justify-between text-clay-dark">
                <span>− Gastos</span>
                <span className="tabular-nums">{money(summary.expenses)}</span>
              </div>
            ) : null}
            {summary.withdrawals > 0 ? (
              <div className="mt-1 flex justify-between text-clay-dark">
                <span>− Retiros</span>
                <span className="tabular-nums">{money(summary.withdrawals)}</span>
              </div>
            ) : null}
            <div className="mt-2 flex justify-between border-t border-line pt-2 font-semibold">
              <span>Efectivo esperado en caja</span>
              <span className="tabular-nums">{money(expected)}</span>
            </div>
          </div>
          <Field label="Efectivo contado" required>
            <Input type="number" min={0} step="0.1" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
          </Field>
          {diff !== null ? (
            <p className={cn("text-sm font-medium", diff === 0 ? "text-sage" : diff > 0 ? "text-ochre-dark" : "text-clay")}>
              {diff === 0 ? "Caja cuadrada" : diff > 0 ? `Sobrante de ${money(diff)}` : `Faltante de ${money(Math.abs(diff))}`}
            </p>
          ) : null}
          <Field label="Observaciones">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

export function TicketsModal({ open, onClose, registerId, onChanged }: { open: boolean; onClose: () => void; registerId: string; onChanged: () => void }) {
  const toast = useToast();
  const { money, isAdmin } = useApp();
  const [rows, setRows] = useState<TransactionRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listRegisterTransactions(registerId));
    } catch (error) {
      toast.error(getErrorMessage(error));
      setRows([]);
    }
  }, [registerId, toast]);

  useEffect(() => {
    if (open) {
      setRows(null);
      void load();
    }
  }, [open, load]);

  async function handleVoid(tx: TransactionRow) {
    const reason = window.prompt(`Motivo de anulación del ticket #${tx.ticket_number}`);
    if (!reason?.trim()) return;
    setBusy(tx.id);
    try {
      await voidTransaction(tx.id, reason.trim());
      toast.success(`Ticket #${tx.ticket_number} anulado`);
      void load();
      onChanged();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Ventas de esta caja">
      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon={ReceiptIcon} title="Aún no hay ventas en esta caja" />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((tx) => (
            <li key={tx.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">
                  #{tx.ticket_number} · {formatTime(tx.created_at)} {tx.client ? `· ${tx.client.full_name}` : ""}
                  {tx.status === "voided" ? (
                    <Badge tone="clay" className="ml-2">
                      Anulado
                    </Badge>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted">{tx.items.map((i) => i.description).join(", ")}</p>
                <p className="text-xs text-muted">{tx.payments.map((p) => `${PAYMENT_METHOD_LABELS[p.method]} ${money(p.amount)}`).join(" · ")}</p>
                {tx.void_reason ? <p className="text-xs text-clay">Motivo: {tx.void_reason}</p> : null}
              </div>
              <div className="flex items-center gap-3">
                <span className={cn("font-semibold tabular-nums", tx.status === "voided" && "text-muted line-through")}>{money(tx.total)}</span>
                {isAdmin && tx.status === "completed" ? (
                  <Button size="sm" variant="ghost" icon={Ban} loading={busy === tx.id} onClick={() => void handleVoid(tx)}>
                    Anular
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

const MOVEMENT_TABS: { value: CashMovementType; label: string }[] = [
  { value: "expense", label: "Gasto" },
  { value: "withdrawal", label: "Retiro" },
  { value: "deposit", label: "Ingreso" },
];

const MOVEMENT_PLACEHOLDERS: Record<CashMovementType, string> = {
  expense: "Ej.: compra de toallas, recibo de luz",
  withdrawal: "Ej.: retiro del propietario",
  deposit: "Ej.: sencillo para dar vuelto",
};

/** Gastos, retiros e ingresos de efectivo de la caja abierta. */
export function CashMovementsModal({ open, onClose, register }: { open: boolean; onClose: () => void; register: CashRegister }) {
  const toast = useToast();
  const { money, isAdmin, settings } = useApp();
  const [rows, setRows] = useState<CashMovement[] | null>(null);
  const [available, setAvailable] = useState<number | null>(null);
  const [type, setType] = useState<CashMovementType>("expense");
  const [category, setCategory] = useState<CashMovementCategory>("supplies");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [movements, summary] = await Promise.all([listCashMovements(register.id), fetchRegisterSummary(register.id)]);
      setRows(movements);
      setAvailable(summary.expected_cash);
    } catch (error) {
      toast.error(getErrorMessage(error));
      setRows([]);
    }
  }, [register.id, toast]);

  useEffect(() => {
    if (!open) return;
    setRows(null);
    setAvailable(null);
    setAmount("");
    setDescription("");
    void load();
  }, [open, load]);

  function changeType(next: CashMovementType) {
    setType(next);
    setCategory(CASH_CATEGORIES_BY_TYPE[next][0]);
  }

  async function handleSave() {
    const value = round2(toNumber(amount));
    if (value <= 0) return toast.error("Ingresa un monto mayor a cero");
    if (description.trim().length < 2) return toast.error("Describe el movimiento");
    if (CASH_MOVEMENT_LABELS[type].direction === "out" && available !== null && value > available) {
      return toast.error(`Solo hay ${money(available)} en efectivo en caja`);
    }
    setSaving(true);
    try {
      await createCashMovement({ cash_register_id: register.id, movement_type: type, category, amount: value, description: description.trim() });
      toast.success(`${CASH_MOVEMENT_LABELS[type].label} registrado`);
      setAmount("");
      setDescription("");
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(movement: CashMovement) {
    if (!window.confirm(`¿Eliminar «${movement.description}» por ${money(movement.amount)}?`)) return;
    setBusy(movement.id);
    try {
      await deleteCashMovement(movement.id);
      toast.success("Movimiento eliminado");
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Gastos y retiros"
      description={available === null ? "Movimientos de efectivo de esta caja" : `Efectivo disponible en caja: ${money(available)}`}
    >
      <div className="space-y-5">
        <div className="space-y-4 rounded-xl border border-line p-4">
          <Tabs value={type} onChange={changeType} items={MOVEMENT_TABS} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Monto (${settings.currency_symbol})`} required>
              <Input type="number" min={0} step="0.1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Categoría">
              <Select value={category} onChange={(e) => setCategory(e.target.value as CashMovementCategory)}>
                {CASH_CATEGORIES_BY_TYPE[type].map((c) => (
                  <option key={c} value={c}>
                    {CASH_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Descripción" required>
            <Input value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} placeholder={MOVEMENT_PLACEHOLDERS[type]} />
          </Field>
          <div className="flex justify-end">
            <Button icon={Plus} loading={saving} onClick={() => void handleSave()}>
              Registrar {CASH_MOVEMENT_LABELS[type].label.toLowerCase()}
            </Button>
          </div>
        </div>

        {rows === null ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ReceiptIcon}
            title="Sin movimientos en esta caja"
            description="Los gastos y retiros se descuentan del efectivo esperado al cerrar la caja."
            className="py-6"
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((m) => {
              const out = CASH_MOVEMENT_LABELS[m.movement_type].direction === "out";
              return (
                <li key={m.id} className="flex items-center gap-3 py-3">
                  <Icon icon={out ? ArrowUpCircle : ArrowDownCircle} className={cn("h-5 w-5", out ? "text-clay" : "text-sage")} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{m.description}</p>
                    <p className="truncate text-xs text-muted">
                      {CASH_MOVEMENT_LABELS[m.movement_type].label}
                      {m.category !== "other" ? `, ${CASH_CATEGORY_LABELS[m.category].toLowerCase()}` : ""} · {formatTime(m.created_at)}
                      {m.created_by_staff ? ` · ${m.created_by_staff.full_name}` : ""}
                    </p>
                  </div>
                  <span className={cn("font-semibold tabular-nums", out ? "text-clay-dark" : "text-sage-dark")}>
                    {out ? "−" : "+"} {money(m.amount)}
                  </span>
                  {isAdmin ? (
                    <Button size="icon" variant="ghost" aria-label="Eliminar movimiento" disabled={busy === m.id} onClick={() => void handleDelete(m)}>
                      <Icon icon={Trash2} />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
