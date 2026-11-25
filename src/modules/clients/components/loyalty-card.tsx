"use client";

import { useCallback, useEffect, useState } from "react";
import { Gift, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/dates";
import { cn, formatNumber, getErrorMessage, toNumber } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import type { LoyaltyLedgerEntry } from "@/types/domain";
import { adjustLoyaltyPoints, listLoyaltyLedger } from "../api";

const KIND_LABELS: Record<LoyaltyLedgerEntry["kind"], string> = {
  earn: "Ganados",
  redeem: "Canjeados",
  reverse: "Reversión",
  adjust: "Ajuste",
};

/** Saldo e historial de puntos del cliente. */
export function LoyaltyCard({ clientId, balance, onChanged }: { clientId: string; balance: number; onChanged: () => void }) {
  const toast = useToast();
  const { settings, money, isAdmin } = useApp();
  const [rows, setRows] = useState<LoyaltyLedgerEntry[] | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await listLoyaltyLedger(clientId));
    } catch {
      setRows([]);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdjust() {
    const value = Math.trunc(toNumber(points));
    if (value === 0) return toast.error("Indica cuántos puntos sumar (positivo) o restar (negativo)");
    if (!reason.trim()) return toast.error("Indica el motivo del ajuste");
    setSaving(true);
    try {
      await adjustLoyaltyPoints(clientId, value, reason.trim());
      toast.success("Puntos ajustados");
      setAdjustOpen(false);
      setPoints("");
      setReason("");
      onChanged();
      void load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader
        title={`${formatNumber(balance, settings.locale)} puntos`}
        description={`Equivalen a ${money(balance * settings.loyalty_point_value)} en caja · canje mínimo ${formatNumber(settings.loyalty_min_redeem, settings.locale)} puntos`}
        action={
          isAdmin ? (
            <Button size="sm" variant="outline" icon={SlidersHorizontal} onClick={() => setAdjustOpen(true)}>
              Ajustar
            </Button>
          ) : null
        }
      />
      {rows && rows.length > 0 ? (
        <ul className="divide-y divide-line text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-5 py-2.5">
              <Gift className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.75} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-ink">{r.description ?? KIND_LABELS[r.kind]}</p>
                <p className="text-xs text-muted">{formatDateTime(r.created_at)}</p>
              </div>
              <span className={cn("font-semibold tabular-nums", r.points > 0 ? "text-sage-dark" : "text-clay-dark")}>
                {r.points > 0 ? "+" : "−"}
                {formatNumber(Math.abs(r.points), settings.locale)}
              </span>
            </li>
          ))}
        </ul>
      ) : rows ? (
        <p className="px-5 py-4 text-sm text-muted">Aún no tiene movimientos de puntos.</p>
      ) : null}

      <Modal
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        size="sm"
        title="Ajustar puntos"
        description={`Saldo actual: ${formatNumber(balance, settings.locale)} puntos`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdjustOpen(false)}>
              Cancelar
            </Button>
            <Button loading={saving} onClick={() => void handleAdjust()}>
              Guardar ajuste
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Puntos" hint="Usa un número negativo para restar.">
            <Input type="number" step={1} value={points} onChange={(e) => setPoints(e.target.value)} placeholder="Ej.: 100 o -50" />
          </Field>
          <Field label="Motivo" required>
            <Input value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: regalo de cumpleaños" />
          </Field>
        </div>
      </Modal>
    </Card>
  );
}
