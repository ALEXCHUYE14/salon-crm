"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { addDays, startOfDay } from "date-fns";
import { BellRing, Cake, MessageCircle, Send, Ticket, UserMinus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { EmptyState, PageHeader, Pagination, Spinner, Tabs } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { PAGE_SIZE, TEMPLATE_VARIABLES } from "@/lib/constants";
import { daysSince, formatDate, formatTime } from "@/lib/dates";
import { buildWhatsAppUrl, fillTemplate, firstName, getErrorMessage, toNumber } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import type { Appointment, Client } from "@/types/domain";
import { PlansPanel } from "@/modules/prepaid/plans-panel";
import { listBirthdays, listInactiveClients, listUpcomingAppointments } from "./api";

type Tab = "inactive" | "birthdays" | "reminders" | "plans";

interface ComposeTarget {
  name: string;
  phone: string | null;
  defaultTemplate: string;
  vars: Record<string, string>;
}

export function LoyaltyView() {
  const toast = useToast();
  const { settings, money } = useApp();
  const [tab, setTab] = useState<Tab>("inactive");
  const [days, setDays] = useState(settings.inactive_client_days);
  const [page, setPage] = useState(1);
  const [inactive, setInactive] = useState<{ rows: Client[]; count: number }>({ rows: [], count: 0 });
  const [birthdays, setBirthdays] = useState<Client[]>([]);
  const [reminders, setReminders] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [compose, setCompose] = useState<ComposeTarget | null>(null);

  const month = new Date().getMonth() + 1;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "inactive") setInactive(await listInactiveClients(Math.max(7, days), page, PAGE_SIZE));
      if (tab === "birthdays") setBirthdays(await listBirthdays(month));
      if (tab === "reminders") {
        const tomorrow = addDays(startOfDay(new Date()), 1);
        setReminders(await listUpcomingAppointments(tomorrow.toISOString(), addDays(tomorrow, 1).toISOString()));
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [tab, days, page, month, toast]);

  useEffect(() => {
    const handle = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(handle);
  }, [load]);

  const baseVars = { negocio: settings.business_name, fecha: "", hora: "", servicio: "", profesional: "", dias: "" };

  return (
    <div>
      <PageHeader title="Fidelización y recordatorios" description="Reactiva clientes y confirma citas con mensajes de WhatsApp personalizados." />

      <Tabs
        value={tab}
        onChange={(v) => {
          setTab(v);
          setPage(1);
        }}
        className="mb-4"
        items={[
          { value: "inactive", label: "Inactivos", icon: UserMinus },
          { value: "birthdays", label: "Cumpleaños del mes", icon: Cake },
          { value: "reminders", label: "Citas de mañana", icon: BellRing },
          { value: "plans", label: "Paquetes y gift cards", icon: Ticket },
        ]}
      />

      {tab === "plans" ? <PlansPanel /> : null}

      {tab === "inactive" ? (
        <Card className="mb-4 flex flex-wrap items-end gap-3 p-3">
          <Field label="Sin visitas hace más de (días)">
            <Input
              type="number"
              min={7}
              max={730}
              value={days}
              onChange={(e) => {
                setDays(toNumber(e.target.value, settings.inactive_client_days));
                setPage(1);
              }}
              className="w-32"
            />
          </Field>
          <p className="pb-3 text-sm text-muted">{inactive.count} clientes para reactivar</p>
        </Card>
      ) : null}

      <Card className={tab === "plans" ? "hidden" : "overflow-hidden"}>
        {loading ? (
          <Spinner />
        ) : tab === "inactive" ? (
          inactive.rows.length === 0 ? (
            <EmptyState icon={UserMinus} title="Sin clientes inactivos" description="Todos tus clientes visitaron el negocio en el periodo indicado." />
          ) : (
            <>
              <ul className="divide-y divide-line">
                {inactive.rows.map((c) => {
                  const since = daysSince(c.last_visit_at) ?? 0;
                  return (
                    <ClientRow
                      key={c.id}
                      client={c}
                      detail={`Última visita ${c.last_visit_at ? formatDate(c.last_visit_at) : "—"} · hace ${since} días · ${c.visits_count} visitas · ${money(c.total_spent)}`}
                      onMessage={() =>
                        setCompose({
                          name: c.full_name,
                          phone: c.phone,
                          defaultTemplate: "reactivation",
                          vars: { ...baseVars, cliente: firstName(c.full_name), dias: String(since) },
                        })
                      }
                    />
                  );
                })}
              </ul>
              <Pagination page={page} pageSize={PAGE_SIZE} total={inactive.count} onPageChange={setPage} />
            </>
          )
        ) : tab === "birthdays" ? (
          birthdays.length === 0 ? (
            <EmptyState icon={Cake} title="Sin cumpleaños este mes" />
          ) : (
            <ul className="divide-y divide-line">
              {birthdays.map((c) => (
                <ClientRow
                  key={c.id}
                  client={c}
                  detail={c.birth_date ? `Cumple el ${formatDate(c.birth_date, "d 'de' MMMM")}` : ""}
                  onMessage={() =>
                    setCompose({ name: c.full_name, phone: c.phone, defaultTemplate: "birthday", vars: { ...baseVars, cliente: firstName(c.full_name) } })
                  }
                />
              ))}
            </ul>
          )
        ) : reminders.length === 0 ? (
          <EmptyState icon={BellRing} title="Sin citas para mañana" />
        ) : (
          <>
            <CardHeader title="Recordatorios" description={`${reminders.length} citas programadas o confirmadas para mañana`} />
            <ul className="divide-y divide-line">
              {reminders.map((a) => (
                <li key={a.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{a.client?.full_name ?? a.walk_in_name}</p>
                    <p className="text-xs text-muted">
                      {formatTime(a.starts_at)} · {a.service?.name} · {a.staff?.full_name} {a.client?.phone ? `· ${a.client.phone}` : "· sin teléfono"}
                    </p>
                  </div>
                  <Badge tone={a.status === "confirmed" ? "sage" : "outline"}>{a.status === "confirmed" ? "Confirmada" : "Por confirmar"}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={MessageCircle}
                    disabled={!a.client?.phone}
                    onClick={() =>
                      setCompose({
                        name: a.client?.full_name ?? a.walk_in_name ?? "",
                        phone: a.client?.phone ?? null,
                        defaultTemplate: "reminder",
                        vars: {
                          ...baseVars,
                          cliente: firstName(a.client?.full_name ?? a.walk_in_name ?? ""),
                          fecha: formatDate(a.starts_at, "EEEE d 'de' MMMM"),
                          hora: formatTime(a.starts_at),
                          servicio: a.service?.name ?? "",
                          profesional: a.staff?.full_name ?? "",
                        },
                      })
                    }
                  >
                    Recordar
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <ComposeModal target={compose} onClose={() => setCompose(null)} />
    </div>
  );
}

function ClientRow({ client, detail, onMessage }: { client: Client; detail: string; onMessage: () => void }) {
  return (
    <li className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <Link href={`/clientes/${client.id}`} className="font-medium text-ink hover:underline">
          {client.full_name}
        </Link>
        <p className="text-xs text-muted">
          {client.phone ?? "Sin teléfono"} · {detail}
        </p>
      </div>
      {!client.marketing_opt_in ? <Badge tone="clay">No acepta promociones</Badge> : null}
      <Button size="sm" variant="outline" icon={MessageCircle} onClick={onMessage} disabled={!client.phone || !client.marketing_opt_in}>
        WhatsApp
      </Button>
    </li>
  );
}

function ComposeModal({ target, onClose }: { target: ComposeTarget | null; onClose: () => void }) {
  const { settings } = useApp();
  const templates = settings.message_templates;
  const [templateKey, setTemplateKey] = useState("");
  const [text, setText] = useState("");

  const selected = useMemo(() => templates.find((t) => t.key === templateKey) ?? templates[0], [templates, templateKey]);

  useEffect(() => {
    if (!target) return;
    const initial = templates.find((t) => t.key === target.defaultTemplate) ?? templates[0];
    setTemplateKey(initial?.key ?? "");
    setText(fillTemplate(initial?.body ?? "", target.vars));
  }, [target, templates]);

  if (!target) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Mensaje para ${target.name}`}
      description={target.phone ?? "Sin teléfono registrado"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            icon={Send}
            disabled={!text.trim()}
            onClick={() => {
              window.open(buildWhatsAppUrl(target.phone, text, settings.default_country_code), "_blank", "noopener,noreferrer");
              onClose();
            }}
          >
            Abrir WhatsApp
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Plantilla">
          <Select
            value={selected?.key ?? ""}
            onChange={(e) => {
              setTemplateKey(e.target.value);
              const t = templates.find((x) => x.key === e.target.value);
              setText(fillTemplate(t?.body ?? "", target.vars));
            }}
          >
            {templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mensaje" hint={`Variables disponibles: ${TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(" ")}`}>
          <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <p className="flex items-center gap-2 text-xs text-muted">
          <Icon icon={MessageCircle} /> Se abrirá WhatsApp con el mensaje listo; el envío lo confirmas tú desde la aplicación.
        </p>
      </div>
    </Modal>
  );
}
