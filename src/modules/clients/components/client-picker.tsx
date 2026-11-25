"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, Plus, Search, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast";
import { getErrorMessage, nullIfEmpty } from "@/lib/utils";
import { saveClient, searchClients } from "@/modules/clients/api";
import type { ClientRef } from "@/types/domain";

interface ClientPickerProps {
  value: ClientRef | null;
  onChange: (client: ClientRef | null) => void;
  placeholder?: string;
}

/** Buscador de clientes con alta rápida (nombre + teléfono). */
export function ClientPicker({ value, onChange, placeholder = "Buscar por nombre o teléfono" }: ClientPickerProps) {
  const toast = useToast();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<ClientRef[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const rows = await searchClients(term);
        if (!cancelled) setResults(rows);
      } catch (error) {
        if (!cancelled) toast.error(getErrorMessage(error));
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [term, toast]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function handleQuickCreate() {
    if (term.trim().length < 2) return;
    setSaving(true);
    try {
      const client = await saveClient({
        full_name: term.trim(),
        phone: nullIfEmpty(newPhone),
        email: null,
        birth_date: null,
        gender: "unspecified",
        segment: "both",
        notes: null,
        tags: [],
        preferred_staff_id: null,
        marketing_opt_in: true,
      });
      onChange({ id: client.id, full_name: client.full_name, phone: client.phone });
      toast.success("Cliente registrado");
      setTerm("");
      setNewPhone("");
      setCreating(false);
      setOpen(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  if (value) {
    return (
      <div className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-sage/30 bg-sage-soft/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon icon={UserRound} className="text-sage" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{value.full_name}</p>
            {value.phone ? <p className="text-xs text-muted">{value.phone}</p> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-ink"
          aria-label="Quitar cliente"
        >
          <Icon icon={X} />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Icon icon={Search} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <Input
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
            setCreating(false);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="pl-9"
          aria-label="Buscar cliente"
        />
      </div>
      {open && term.trim().length >= 2 ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
          <ul className="max-h-60 overflow-y-auto">
            {results.map((client) => (
              <li key={client.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(client);
                    setTerm("");
                    setOpen(false);
                  }}
                  className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
                >
                  <span className="font-medium text-ink">{client.full_name}</span>
                  {client.phone ? (
                    <span className="flex items-center gap-1 text-xs text-muted">
                      <Icon icon={Phone} className="h-3.5 w-3.5" />
                      {client.phone}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-line p-2">
            {creating ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Teléfono (opcional)" inputMode="tel" />
                <Button onClick={() => void handleQuickCreate()} loading={saving} icon={Plus}>
                  Guardar
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex min-h-[40px] w-full items-center gap-2 rounded-lg px-2 text-sm font-medium text-sage hover:bg-sage-soft"
              >
                <Icon icon={Plus} />
                Registrar «{term.trim()}» como cliente nuevo
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
