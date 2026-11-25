"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Phone, Plus, Save, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Switch, Textarea } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { getErrorMessage, nullIfEmpty } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import { listSuppliers, saveSupplier, type Supplier, type SupplierInput } from "./api";

const EMPTY: SupplierInput = { name: "", contact_name: null, phone: null, email: null, tax_id: null, notes: null, is_active: true };

export function SuppliersPanel() {
  const toast = useToast();
  const { isAdmin } = useApp();
  const [rows, setRows] = useState<Supplier[] | null>(null);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SupplierInput>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await listSuppliers());
    } catch (error) {
      toast.error(getErrorMessage(error));
      setRows([]);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function openForm(s: Supplier | null) {
    setEditing(s);
    setForm(s ? { ...s } : EMPTY);
    setOpen(true);
  }

  function update<K extends keyof SupplierInput>(key: K, value: SupplierInput[K]) {
    setForm((c) => ({ ...c, [key]: value }));
  }

  async function handleSave() {
    if (form.name.trim().length < 2) return toast.error("Escribe el nombre del proveedor");
    setSaving(true);
    try {
      await saveSupplier(
        {
          name: form.name.trim(),
          contact_name: nullIfEmpty(form.contact_name),
          phone: nullIfEmpty(form.phone),
          email: nullIfEmpty(form.email),
          tax_id: nullIfEmpty(form.tax_id),
          notes: nullIfEmpty(form.notes),
          is_active: form.is_active,
        },
        editing?.id,
      );
      toast.success("Proveedor guardado");
      setOpen(false);
      void load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Proveedores"
        action={
          isAdmin ? (
            <Button size="sm" icon={Plus} onClick={() => openForm(null)}>
              Nuevo proveedor
            </Button>
          ) : null
        }
      />
      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon={Truck} title="Sin proveedores registrados" description="Regístralos para armar órdenes de compra." />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-5 py-3">
              <Icon icon={Truck} className="h-5 w-5 text-sage" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium text-ink">
                  <span className="truncate">{s.name}</span>
                  {!s.is_active ? <Badge>Inactivo</Badge> : null}
                </p>
                <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted">
                  {s.contact_name ? <span>{s.contact_name}</span> : null}
                  {s.phone ? (
                    <a href={`tel:${s.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 hover:text-ink">
                      <Icon icon={Phone} className="h-3.5 w-3.5" />
                      {s.phone}
                    </a>
                  ) : null}
                  {s.tax_id ? <span>RUC {s.tax_id}</span> : null}
                </p>
              </div>
              {isAdmin ? (
                <Button size="icon" variant="ghost" aria-label={`Editar ${s.name}`} onClick={() => openForm(s)}>
                  <Icon icon={Pencil} />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar proveedor" : "Nuevo proveedor"}
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre o razón social" required className="sm:col-span-2">
            <Input value={form.name} maxLength={120} onChange={(e) => update("name", e.target.value)} />
          </Field>
          <Field label="Contacto">
            <Input value={form.contact_name ?? ""} maxLength={120} onChange={(e) => update("contact_name", e.target.value)} />
          </Field>
          <Field label="Teléfono">
            <Input type="tel" value={form.phone ?? ""} maxLength={40} onChange={(e) => update("phone", e.target.value)} />
          </Field>
          <Field label="Correo">
            <Input type="email" value={form.email ?? ""} maxLength={120} onChange={(e) => update("email", e.target.value)} />
          </Field>
          <Field label="RUC / NIT">
            <Input value={form.tax_id ?? ""} maxLength={30} onChange={(e) => update("tax_id", e.target.value)} />
          </Field>
          <Field label="Notas" className="sm:col-span-2">
            <Textarea rows={2} maxLength={500} value={form.notes ?? ""} onChange={(e) => update("notes", e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Switch checked={form.is_active} onChange={(v) => update("is_active", v)} label="Activo" />
          </div>
        </div>
      </Modal>
    </Card>
  );
}
