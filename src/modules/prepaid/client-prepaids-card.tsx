"use client";

import { useEffect, useState } from "react";
import { Gift, Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { formatDate } from "@/lib/dates";
import { useApp } from "@/providers/app-provider";
import type { ClientPrepaid } from "@/types/domain";
import { isUsable, listClientPrepaids } from "./api";

/** Paquetes y gift cards del cliente (solo se muestra si tiene alguno). */
export function ClientPrepaidsCard({ clientId }: { clientId: string }) {
  const { money } = useApp();
  const [rows, setRows] = useState<ClientPrepaid[]>([]);

  useEffect(() => {
    let cancelled = false;
    listClientPrepaids(clientId)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (rows.length === 0) return null;

  return (
    <Card className="mb-6">
      <CardHeader title="Paquetes y gift cards" description="Se aplican al cobrar en caja." />
      <ul className="divide-y divide-line text-sm">
        {rows.map((p) => {
          const usable = isUsable(p);
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <Icon icon={p.kind === "package" ? Ticket : Gift} className="h-5 w-5 text-sage" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{p.name}</p>
                <p className="text-xs text-muted">
                  Código <span className="font-mono tracking-wider">{p.code}</span>
                  {p.expires_at ? ` · vence el ${formatDate(p.expires_at)}` : ""}
                </p>
              </div>
              <span className="font-semibold tabular-nums text-ink">
                {p.kind === "package" ? `Quedan ${p.sessions_total - p.sessions_used} de ${p.sessions_total} sesiones` : `Saldo ${money(p.balance)}`}
              </span>
              {!usable ? <Badge tone="clay">{p.expires_at && Date.parse(p.expires_at) < Date.now() ? "Vencido" : "Agotado"}</Badge> : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
