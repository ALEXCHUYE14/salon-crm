"use client";

import { useState } from "react";
import { MapPin, Pencil, Plus, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Switch } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { getErrorMessage, nullIfEmpty } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import type { Branch } from "@/types/domain";
import { saveBranch } from "./api";

/** Alta y edición de sedes (Ajustes → Sedes). */
export function BranchesSection() {
  const toast = useToast();
  const { allBranches, reloadBranches } = useApp();
  const [editing, setEditing] = useState<Branch | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", phone: "", is_active: true });
  const [saving, setSaving] = useState(false);

  function openForm(branch: Branch | null) {
    setEditing(branch);
    setForm({ name: branch?.name ?? "", address: branch?.address ?? "", phone: branch?.phone ?? "", is_active: branch?.is_active ?? true });
    setOpen(true);
  }

  async function handleSave() {
    if (form.name.trim().length < 2) return toast.error("Escribe el nombre de la sede");
    setSaving(true);
    try {
      await saveBranch(
        { name: form.name.trim(), address: nullIfEmpty(form.address), phone: nullIfEmpty(form.phone), is_active: editing?.is_main ? true : form.is_active },
        editing?.id,
      );
      toast.success("Sede guardada");
      setOpen(false);
      await reloadBranches();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Sedes"
        description="Cada sede tiene su equipo, agenda, caja y reportes. El inventario es compartido."
        action={
          <Button size="sm" icon={Plus} onClick={() => openForm(null)}>
            Nueva sede
          </Button>
        }
      />
      <ul className="divide-y divide-line">
        {allBranches.map((b) => (
          <li key={b.id} className="flex items-center gap-3 px-5 py-3">
            <Icon icon={MapPin} className="h-5 w-5 text-sage" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-medium text-ink">
                <span className="truncate">{b.name}</span>
                {b.is_main ? <Badge tone="sage">Principal</Badge> : null}
                {!b.is_active ? <Badge>Inactiva</Badge> : null}
              </p>
              {b.address || b.phone ? <p className="truncate text-sm text-muted">{[b.address, b.phone].filter(Boolean).join(" · ")}</p> : null}
            </div>
            <Button size="icon" variant="ghost" aria-label={`Editar ${b.name}`} onClick={() => openForm(b)}>
              <Icon icon={Pencil} />
            </Button>
          </li>
        ))}
      </ul>
      {allBranches.length <= 1 ? (
        <p className="border-t border-line px-5 py-3 text-sm text-muted">
          Con una sola sede el sistema funciona igual que siempre. Al crear la segunda aparece el selector de sede en el menú.
        </p>
      ) : null}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar sede" : "Nueva sede"}
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
          <Field label="Nombre" required>
            <Input value={form.name} maxLength={80} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ej.: Sede Norte" />
          </Field>
          <Field label="Dirección">
            <Input value={form.address} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </Field>
          <Field label="Teléfono">
            <Input type="tel" value={form.phone} maxLength={40} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </Field>
          {!editing?.is_main ? (
            <Switch checked={form.is_active} onChange={(v) => setForm((f) => ({ ...f, is_active: v }))} label="Activa" />
          ) : (
            <p className="text-xs text-muted">La sede principal siempre está activa.</p>
          )}
        </div>
      </Modal>
    </Card>
  );
}
