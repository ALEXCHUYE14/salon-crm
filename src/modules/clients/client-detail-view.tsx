"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowLeft,
  CalendarDays,
  Camera,
  ClipboardList,
  Mail,
  MessageCircle,
  Palette,
  Pencil,
  Phone,
  Plus,
  Receipt,
  Scissors,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Avatar, EmptyState, Spinner, StatCard, Tabs } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { useCatalog } from "@/hooks/use-catalog";
import { APPOINTMENT_STATUS, PAYMENT_METHOD_LABELS, RECORD_TYPE_LABELS, SEGMENT_LABELS } from "@/lib/constants";
import { daysSince, formatDate, formatDateTime } from "@/lib/dates";
import { buildWhatsAppUrl, cn, fillTemplate, getErrorMessage } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import type { Appointment, Client, TechnicalRecord, TransactionRow } from "@/types/domain";
import {
  archiveClient,
  deleteTechnicalRecord,
  getClient,
  listClientAppointments,
  listClientTransactions,
  listTechnicalRecords,
} from "./api";
import { ClientFormModal } from "./components/client-form-modal";
import { ClientPrepaidsCard } from "@/modules/prepaid/client-prepaids-card";
import { LoyaltyCard } from "./components/loyalty-card";
import { PhotosPanel } from "./components/photos-panel";
import { TechnicalRecordModal } from "./components/technical-record-modal";

type Tab = "records" | "photos" | "appointments" | "purchases";

export function ClientDetailView({ clientId }: { clientId: string }) {
  const router = useRouter();
  const toast = useToast();
  const { settings, money, can, isAdmin, staff: me } = useApp();
  const { staff } = useCatalog();
  const [client, setClient] = useState<Client | null>(null);
  const [records, setRecords] = useState<TechnicalRecord[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [tab, setTab] = useState<Tab>("records");
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<TechnicalRecord | null>(null);

  const canSeePurchases = can("pos") || isAdmin;

  const load = useCallback(async () => {
    try {
      const [c, r, a, t] = await Promise.all([
        getClient(clientId),
        listTechnicalRecords(clientId),
        listClientAppointments(clientId),
        canSeePurchases ? listClientTransactions(clientId) : Promise.resolve([]),
      ]);
      setClient(c);
      setRecords(r);
      setAppointments(a);
      setTransactions(t);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [clientId, canSeePurchases, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Spinner />;
  if (!client) {
    return (
      <Card>
        <EmptyState icon={ClipboardList} title="Cliente no encontrado" action={<Link href="/clientes" className={buttonClasses({ variant: "outline" })}>Volver</Link>} />
      </Card>
    );
  }

  const since = daysSince(client.last_visit_at);

  function sendWhatsApp() {
    if (!client) return;
    const template = settings.message_templates.find((t) => t.key === "thanks") ?? settings.message_templates[0];
    const text = fillTemplate(template?.body ?? "Hola {cliente}", {
      cliente: client.full_name.split(" ")[0],
      negocio: settings.business_name,
      dias: String(since ?? ""),
      fecha: "",
      hora: "",
      servicio: "",
      profesional: me.full_name,
    });
    window.open(buildWhatsAppUrl(client.phone, text, settings.default_country_code), "_blank", "noopener,noreferrer");
  }

  async function handleArchive() {
    if (!client || !window.confirm(`¿Archivar a ${client.full_name}? Dejará de aparecer en búsquedas.`)) return;
    try {
      await archiveClient(client.id);
      toast.success("Cliente archivado");
      router.push("/clientes");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  async function handleDeleteRecord(record: TechnicalRecord) {
    if (!window.confirm("¿Eliminar este registro de la ficha técnica?")) return;
    try {
      await deleteTechnicalRecord(record.id);
      toast.success("Registro eliminado");
      void load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  return (
    <div>
      <Link href="/clientes" className="mb-4 inline-flex min-h-[44px] items-center gap-2 text-sm text-muted hover:text-ink">
        <Icon icon={ArrowLeft} /> Clientes
      </Link>

      <Card className="mb-6">
        <CardBody className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <Avatar name={client.full_name} size="lg" color="#3F5E4D" />
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-semibold text-ink">{client.full_name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                {client.phone ? (
                  <span className="flex items-center gap-1.5">
                    <Icon icon={Phone} /> {client.phone}
                  </span>
                ) : null}
                {client.email ? (
                  <span className="flex items-center gap-1.5">
                    <Icon icon={Mail} /> {client.email}
                  </span>
                ) : null}
                <span>{SEGMENT_LABELS[client.segment]}</span>
                {client.birth_date ? <span>Cumpleaños: {formatDate(client.birth_date, "d 'de' MMMM")}</span> : null}
              </div>
              {client.tags.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {client.tags.map((tag) => (
                    <Badge key={tag} tone="sage">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" icon={MessageCircle} onClick={sendWhatsApp}>
              WhatsApp
            </Button>
            <Button variant="outline" icon={Pencil} onClick={() => setEditOpen(true)}>
              Editar
            </Button>
            {isAdmin ? (
              <Button variant="ghost" icon={Archive} onClick={() => void handleArchive()}>
                Archivar
              </Button>
            ) : null}
          </div>
        </CardBody>
        {client.notes ? <div className="border-t border-line bg-ochre-soft/50 px-5 py-3 text-sm text-ochre-dark">{client.notes}</div> : null}
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Visitas" value={String(client.visits_count)} icon={CalendarDays} tone="sage" />
        <StatCard label="Consumo total" value={money(client.total_spent)} icon={Receipt} />
        <StatCard
          label="Ticket promedio"
          value={money(client.visits_count > 0 ? Number(client.total_spent) / client.visits_count : 0)}
          icon={Receipt}
        />
        <StatCard
          label="Última visita"
          value={client.last_visit_at ? formatDate(client.last_visit_at) : "—"}
          hint={since !== null ? `Hace ${since} días` : "Sin visitas registradas"}
          icon={CalendarDays}
          tone={since !== null && since > settings.inactive_client_days ? "clay" : "neutral"}
        />
      </div>

      <ClientPrepaidsCard clientId={client.id} />
      {settings.loyalty_points_enabled ? <LoyaltyCard clientId={client.id} balance={client.loyalty_points ?? 0} onChanged={() => void load()} /> : null}

      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4"
        items={[
          { value: "records", label: "Ficha técnica", icon: ClipboardList, count: records.length },
          { value: "photos", label: "Fotos", icon: Camera },
          { value: "appointments", label: "Citas", icon: CalendarDays, count: appointments.length },
          ...(canSeePurchases ? [{ value: "purchases" as Tab, label: "Compras", icon: Receipt, count: transactions.length }] : []),
        ]}
      />

      {tab === "photos" ? <PhotosPanel clientId={client.id} /> : null}

      {tab === "records" ? (
        <Card>
          <CardHeader
            title="Historial técnico"
            description="Fórmulas, guardas, diagnósticos y productos aplicados"
            action={
              <Button
                size="sm"
                icon={Plus}
                onClick={() => {
                  setEditingRecord(null);
                  setRecordOpen(true);
                }}
              >
                Nuevo registro
              </Button>
            }
          />
          {records.length === 0 ? (
            <EmptyState icon={ClipboardList} title="Sin registros técnicos" description="Guarda aquí el detalle de cada trabajo para repetirlo con precisión." />
          ) : (
            <ul className="divide-y divide-line">
              {records.map((r) => (
                <li key={r.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", r.record_type === "barber" ? "bg-sage-soft text-sage" : "bg-clay-soft text-clay")}>
                        <Icon icon={r.record_type === "barber" ? Scissors : Palette} />
                      </span>
                      <div>
                        <p className="text-sm font-medium text-ink">{RECORD_TYPE_LABELS[r.record_type]}</p>
                        <p className="text-xs text-muted">
                          {formatDate(r.service_date)} {r.staff ? `· ${r.staff.full_name}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Editar registro"
                        onClick={() => {
                          setEditingRecord(r);
                          setRecordOpen(true);
                        }}
                      >
                        <Icon icon={Pencil} />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="Eliminar registro" onClick={() => void handleDeleteRecord(r)}>
                        <Icon icon={Trash2} />
                      </Button>
                    </div>
                  </div>
                  <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    <RecordItem label="Corte" value={r.cut_style} />
                    <RecordItem label="Fade" value={r.fade_type} />
                    <RecordItem label="Guardas" value={r.clipper_guards} />
                    <RecordItem label="Barba" value={r.beard_style} />
                    <RecordItem label="Acabado" value={r.finish} />
                    <RecordItem label="Fórmula" value={r.color_formula} wide />
                    <RecordItem label="Peróxido" value={r.developer_volume ? `${r.developer_volume} vol.` : null} />
                    <RecordItem label="Pose" value={r.processing_minutes ? `${r.processing_minutes} min` : null} />
                    <RecordItem label="Diagnóstico capilar" value={r.hair_diagnosis} wide />
                    <RecordItem label="Uñas" value={r.nails_diagnosis} wide />
                    <RecordItem label="Piel" value={r.skin_diagnosis} wide />
                    <RecordItem label="Productos" value={r.products_used} wide />
                    <RecordItem label="Resultado" value={r.result_notes} wide />
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === "appointments" ? (
        <Card>
          {appointments.length === 0 ? (
            <EmptyState icon={CalendarDays} title="Sin citas registradas" />
          ) : (
            <ul className="divide-y divide-line">
              {appointments.map((a) => (
                <li key={a.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                  <span className="w-32 shrink-0 tabular-nums text-muted">{formatDateTime(a.starts_at)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{a.service?.name}</p>
                    <p className="truncate text-xs text-muted">{a.staff?.full_name}</p>
                  </div>
                  <span className="hidden tabular-nums text-ink sm:inline">{money(a.price)}</span>
                  <Badge tone={APPOINTMENT_STATUS[a.status].tone}>{APPOINTMENT_STATUS[a.status].label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === "purchases" ? (
        <Card>
          {transactions.length === 0 ? (
            <EmptyState icon={Receipt} title="Sin compras registradas" />
          ) : (
            <ul className="divide-y divide-line">
              {transactions.map((t) => (
                <li key={t.id} className="px-5 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-ink">
                        Ticket #{t.ticket_number}{" "}
                        {t.status === "voided" ? (
                          <Badge tone="clay" className="ml-1">
                            Anulado
                          </Badge>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted">
                        {formatDateTime(t.created_at)} · {t.payments.map((p) => PAYMENT_METHOD_LABELS[p.method]).join(" + ")}
                      </p>
                    </div>
                    <span className={cn("font-semibold tabular-nums", t.status === "voided" ? "text-muted line-through" : "text-ink")}>{money(t.total)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{t.items.map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.description}`).join(", ")}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <ClientFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        client={client}
        staff={staff.filter((s) => s.is_bookable)}
        onSaved={(c) => setClient(c)}
      />
      <TechnicalRecordModal
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        onSaved={() => void load()}
        clientId={client.id}
        record={editingRecord}
        staff={staff.filter((s) => s.is_bookable)}
      />
    </div>
  );
}

function RecordItem({ label, value, wide }: { label: string; value: string | null; wide?: boolean }) {
  if (!value) return null;
  return (
    <div className={cn(wide && "sm:col-span-2 lg:col-span-3")}>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-ink">{value}</dd>
    </div>
  );
}
