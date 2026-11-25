"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { EmptyState, Spinner, Tabs } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/dates";
import { getErrorMessage, nullIfEmpty } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import type { ClientPhoto, PhotoKind } from "@/types/domain";
import { deleteClientPhoto, listClientPhotos, signPhotoUrls, uploadClientPhoto } from "../api";

const KIND_LABELS: Record<PhotoKind, string> = { before: "Antes", after: "Después", other: "Otra" };
const MAX_INPUT_BYTES = 15 * 1024 * 1024;

/** Antes y después del cliente (bucket privado, URLs firmadas temporales). */
export function PhotosPanel({ clientId }: { clientId: string }) {
  const toast = useToast();
  const { staff: me, isAdmin } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<ClientPhoto[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | PhotoKind>("all");
  const [kind, setKind] = useState<PhotoKind>("before");
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState<ClientPhoto | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await listClientPhotos(clientId);
      setPhotos(rows);
      setUrls(rows.length ? await signPhotoUrls(rows.map((p) => p.path)) : {});
    } catch (error) {
      toast.error(getErrorMessage(error));
      setPhotos([]);
    }
  }, [clientId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files).slice(0, 10);
    const invalid = list.find((f) => !f.type.startsWith("image/") || f.size > MAX_INPUT_BYTES);
    if (invalid) {
      toast.error(`«${invalid.name}» no es una imagen válida o pesa más de 15 MB`);
      return;
    }
    setUploading(true);
    let ok = 0;
    try {
      for (const file of list) {
        await uploadClientPhoto(clientId, file, kind, nullIfEmpty(caption));
        ok += 1;
      }
      toast.success(ok === 1 ? "Foto guardada" : `${ok} fotos guardadas`);
      setCaption("");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
      void load();
    }
  }

  async function handleDelete(photo: ClientPhoto) {
    if (!window.confirm("¿Eliminar esta foto? No se puede recuperar.")) return;
    try {
      await deleteClientPhoto(photo);
      setViewing(null);
      toast.success("Foto eliminada");
      void load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  const visible = (photos ?? []).filter((p) => filter === "all" || p.kind === filter);
  const canDelete = (p: ClientPhoto) => isAdmin || p.created_by === me.id;

  return (
    <Card>
      <CardHeader title="Antes y después" description="Solo el personal puede verlas. Se comprimen automáticamente al subirlas." />
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
        <div className="sm:w-36">
          <Select value={kind} onChange={(e) => setKind(e.target.value as PhotoKind)} aria-label="Tipo de foto">
            <option value="before">Antes</option>
            <option value="after">Después</option>
            <option value="other">Otra</option>
          </Select>
        </div>
        <Input value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} placeholder="Nota (opcional), ej.: balayage tono 7.3" aria-label="Nota de la foto" />
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => void handleFiles(e.target.files)} aria-label="Elegir fotos" />
        <Button icon={ImagePlus} loading={uploading} onClick={() => fileRef.current?.click()} className="shrink-0">
          Subir fotos
        </Button>
      </div>

      {photos === null ? (
        <Spinner />
      ) : photos.length === 0 ? (
        <EmptyState icon={Camera} title="Sin fotos todavía" description="Sube el antes y el después para mostrar el resultado y repetir el trabajo." />
      ) : (
        <div className="p-4">
          <Tabs
            value={filter}
            onChange={setFilter}
            className="mb-4"
            items={[
              { value: "all", label: "Todas", count: photos.length },
              { value: "before", label: "Antes", count: photos.filter((p) => p.kind === "before").length },
              { value: "after", label: "Después", count: photos.filter((p) => p.kind === "after").length },
            ]}
          />
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {visible.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setViewing(p)}
                  className="group relative block aspect-square w-full overflow-hidden rounded-xl border border-line bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/40"
                >
                  {urls[p.path] ? (
                    <img src={urls[p.path]} alt={p.caption ?? `Foto ${KIND_LABELS[p.kind].toLowerCase()}`} className="h-full w-full object-cover" loading="lazy" />
                  ) : null}
                  <span className="absolute left-2 top-2">
                    <Badge tone={p.kind === "before" ? "ochre" : p.kind === "after" ? "sage" : "neutral"}>{KIND_LABELS[p.kind]}</Badge>
                  </span>
                </button>
                <p className="mt-1 truncate text-xs text-muted">
                  {formatDate(p.taken_on + "T00:00:00")}
                  {p.caption ? ` · ${p.caption}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        size="xl"
        title={viewing ? `${KIND_LABELS[viewing.kind]} · ${formatDate(viewing.taken_on + "T00:00:00")}` : ""}
        description={viewing?.caption ?? undefined}
        footer={
          viewing && canDelete(viewing) ? (
            <Button variant="ghost" icon={Trash2} className="text-clay" onClick={() => void handleDelete(viewing)}>
              Eliminar
            </Button>
          ) : undefined
        }
      >
        {viewing && urls[viewing.path] ? <img src={urls[viewing.path]} alt="" className="mx-auto max-h-[70vh] w-auto rounded-lg" /> : null}
      </Modal>
    </Card>
  );
}
