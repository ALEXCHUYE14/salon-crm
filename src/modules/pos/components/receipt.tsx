"use client";

import { formatDateTime } from "@/lib/dates";
import { PAYMENT_METHOD_LABELS } from "@/lib/constants";
import { useApp } from "@/providers/app-provider";
import type { RecordedPaymentMethod } from "@/types/domain";

export interface ReceiptData {
  transactionId?: string;
  clientPhone?: string | null;
  ticketNumber: number;
  createdAt: string;
  clientName: string | null;
  lines: { description: string; quantity: number; lineTotal: number; staffName: string | null }[];
  subtotal: number;
  discount: number;
  tip: number;
  total: number;
  payments: { method: RecordedPaymentMethod; amount: number }[];
  cashReceived: number | null;
  change: number;
  pointsRedeemed?: number;
  pointsEarned?: number;
  pointsBalance?: number | null;
  giftCardUsed?: number;
  giftCardBalance?: number | null;
  prepaids?: { name: string; code: string; expiresAt: string | null }[];
}

/** Ticket imprimible en formato 80 mm (ver @media print en globals.css). */
export function Receipt({ data }: { data: ReceiptData }) {
  const { settings, money } = useApp();
  return (
    <div className="print-area mx-auto w-full max-w-xs rounded-xl border border-dashed border-line bg-surface p-4 font-mono text-xs text-ink">
      <div className="text-center">
        <p className="text-sm font-bold">{settings.business_name}</p>
        {settings.tax_id ? <p>RUC/NIT: {settings.tax_id}</p> : null}
        {settings.address ? <p>{settings.address}</p> : null}
        {settings.phone ? <p>Tel. {settings.phone}</p> : null}
      </div>
      <div className="my-2 border-t border-dashed border-line" />
      <p>Ticket #{data.ticketNumber}</p>
      <p>{formatDateTime(data.createdAt)}</p>
      {data.clientName ? <p>Cliente: {data.clientName}</p> : null}
      <div className="my-2 border-t border-dashed border-line" />
      <ul className="space-y-1">
        {data.lines.map((line, i) => (
          <li key={`${line.description}-${i}`}>
            <div className="flex justify-between gap-2">
              <span>
                {line.quantity > 1 ? `${line.quantity}× ` : ""}
                {line.description}
              </span>
              <span className="tabular-nums">{money(line.lineTotal)}</span>
            </div>
            {line.staffName ? <p className="text-[10px] text-muted">Atendió: {line.staffName}</p> : null}
          </li>
        ))}
      </ul>
      <div className="my-2 border-t border-dashed border-line" />
      <Row label="Subtotal" value={money(data.subtotal)} />
      {data.discount > 0 ? <Row label="Descuento" value={`- ${money(data.discount)}`} /> : null}
      {data.tip > 0 ? <Row label="Propina" value={money(data.tip)} /> : null}
      <Row label="TOTAL" value={money(data.total)} bold />
      <div className="my-2 border-t border-dashed border-line" />
      {data.payments.map((p) => (
        <Row key={p.method} label={PAYMENT_METHOD_LABELS[p.method]} value={money(p.amount)} />
      ))}
      {data.cashReceived !== null ? <Row label="Efectivo recibido" value={money(data.cashReceived)} /> : null}
      {data.change > 0 ? <Row label="Vuelto" value={money(data.change)} bold /> : null}
      {data.giftCardUsed ? (
        <>
          <div className="my-2 border-t border-dashed border-line" />
          <Row label="Pagado con gift card" value={money(data.giftCardUsed)} />
          {typeof data.giftCardBalance === "number" ? <Row label="Saldo de la gift card" value={money(data.giftCardBalance)} /> : null}
        </>
      ) : null}
      {data.prepaids && data.prepaids.length > 0 ? (
        <>
          <div className="my-2 border-t border-dashed border-line" />
          {data.prepaids.map((p) => (
            <div key={p.code} className="py-0.5">
              <p className="font-bold">{p.name}</p>
              <p>Código: {p.code}</p>
              {p.expiresAt ? <p>Vence: {formatDateTime(p.expiresAt).slice(0, 10)}</p> : null}
            </div>
          ))}
        </>
      ) : null}
      {data.pointsRedeemed || data.pointsEarned ? (
        <>
          <div className="my-2 border-t border-dashed border-line" />
          {data.pointsRedeemed ? <Row label="Puntos canjeados" value={String(data.pointsRedeemed)} /> : null}
          {data.pointsEarned ? <Row label="Puntos ganados" value={`+${data.pointsEarned}`} /> : null}
          {typeof data.pointsBalance === "number" ? <Row label="Saldo de puntos" value={String(data.pointsBalance)} /> : null}
        </>
      ) : null}
      <div className="my-2 border-t border-dashed border-line" />
      <p className="text-center">{settings.slogan ?? "Gracias por su visita"}</p>
      <p className="mt-1 text-center text-[10px] text-muted">Comprobante interno de venta</p>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-bold" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
