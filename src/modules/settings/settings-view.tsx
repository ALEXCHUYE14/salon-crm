"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Building2,
  Clock,
  Coins,
  Copy,
  ExternalLink,
  Gift,
  Globe,
  History,
  ImageUp,
  LayoutGrid,
  MapPin,
  MessageSquareText,
  Plus,
  Save,
  Scissors,
  ShieldCheck,
  Sparkles,
  Store,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { PageHeader, Tabs } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import {
  ALL_MODULES,
  CONFIGURABLE_ROLES,
  MODULE_LABELS,
  PAYMENT_METHOD_LABELS,
  ROLE_LABELS,
  TEMPLATE_VARIABLES,
  TOGGLEABLE_MODULES,
  WEEKDAYS,
} from "@/lib/constants";
import { getTerminology } from "@/lib/terminology";
import { cn, getErrorMessage, nullIfEmpty, toNumber } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import type { BusinessSettings, CommissionType, ModuleKey, OperatingMode } from "@/types/domain";
import { deleteLogoByUrl, updateSettings, uploadLogo, type SettingsPatch } from "./api";
import { BranchesSection } from "@/modules/branches/branches-section";
import { AuditPanel } from "./audit-panel";

type Section = "business" | "branches" | "operation" | "hours" | "online" | "points" | "finance" | "messages" | "permissions" | "audit";

const CURRENCIES = [
  { code: "PEN", symbol: "S/", locale: "es-PE", label: "Sol peruano (PEN)" },
  { code: "USD", symbol: "$", locale: "es-US", label: "Dólar estadounidense (USD)" },
  { code: "COP", symbol: "$", locale: "es-CO", label: "Peso colombiano (COP)" },
  { code: "MXN", symbol: "$", locale: "es-MX", label: "Peso mexicano (MXN)" },
  { code: "CLP", symbol: "$", locale: "es-CL", label: "Peso chileno (CLP)" },
  { code: "ARS", symbol: "$", locale: "es-AR", label: "Peso argentino (ARS)" },
  { code: "BOB", symbol: "Bs", locale: "es-BO", label: "Boliviano (BOB)" },
  { code: "EUR", symbol: "€", locale: "es-ES", label: "Euro (EUR)" },
];

const TIMEZONES = [
  "America/Lima",
  "America/Bogota",
  "America/Guayaquil",
  "America/Mexico_City",
  "America/Santiago",
  "America/La_Paz",
  "America/Argentina/Buenos_Aires",
  "America/Caracas",
  "America/New_York",
  "Europe/Madrid",
];

const MODES: { value: OperatingMode; label: string; description: string; icon: LucideIcon }[] = [
  { value: "barbershop", label: "Barbería", description: "Barberos, sillas, cortes, fades y barba.", icon: Scissors },
  { value: "beauty_salon", label: "Salón de belleza", description: "Estilistas, tocadores, color, uñas y tratamientos.", icon: Sparkles },
  { value: "hybrid", label: "Mixto", description: "Ambos rubros en un mismo local.", icon: Store },
];

export function SettingsView() {
  const toast = useToast();
  const { settings, setSettings, isAdmin } = useApp();
  const [section, setSection] = useState<Section>("business");
  const [draft, setDraft] = useState<BusinessSettings>(settings);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(settings), [settings]);

  function patch<K extends keyof BusinessSettings>(key: K, value: BusinessSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save(fields: (keyof SettingsPatch)[]) {
    const payload: SettingsPatch = {};
    for (const field of fields) Object.assign(payload, { [field]: draft[field] });
    setSaving(true);
    try {
      const previousLogo = settings.logo_url;
      const updated = await updateSettings(settings.id, payload);
      setSettings(updated);
      // El logo reemplazado ya no se usa: se libera su espacio en Storage
      if (fields.includes("logo_url") && previousLogo && previousLogo !== updated.logo_url) void deleteLogoByUrl(previousLogo);
      toast.success("Ajustes guardados");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const saveButton = (fields: (keyof SettingsPatch)[]) => (
    <Button icon={Save} loading={saving} onClick={() => void save(fields)}>
      Guardar cambios
    </Button>
  );

  return (
    <div>
      <PageHeader title="Ajustes del sistema" description="Configura la identidad, operación, finanzas, mensajes y permisos del negocio." />
      <Tabs
        value={section}
        onChange={setSection}
        className="mb-6"
        items={[
          { value: "business", label: "Negocio", icon: Building2 },
          ...(isAdmin ? [{ value: "branches" as Section, label: "Sedes", icon: MapPin }] : []),
          { value: "operation", label: "Operación", icon: LayoutGrid },
          { value: "hours", label: "Horarios", icon: Clock },
          { value: "online", label: "Reserva online", icon: Globe },
          { value: "points", label: "Puntos", icon: Gift },
          { value: "finance", label: "Finanzas", icon: Coins },
          { value: "messages", label: "Mensajes", icon: MessageSquareText },
          { value: "permissions", label: "Permisos", icon: ShieldCheck },
          ...(isAdmin ? [{ value: "audit" as Section, label: "Auditoría", icon: History }] : []),
        ]}
      />

      {section === "business" ? <BusinessSection draft={draft} patch={patch} footer={saveButton(["business_name", "slogan", "tax_id", "phone", "email", "address", "logo_url"])} /> : null}
      {section === "operation" ? (
        <OperationSection draft={draft} patch={patch} footer={saveButton(["operating_mode", "enabled_modules", "slot_interval_minutes", "inactive_client_days"])} />
      ) : null}
      {section === "hours" ? <HoursSection draft={draft} patch={patch} footer={saveButton(["business_hours", "timezone"])} /> : null}
      {section === "points" ? (
        <PointsSection
          draft={draft}
          patch={patch}
          footer={saveButton(["loyalty_points_enabled", "loyalty_points_per_currency", "loyalty_point_value", "loyalty_min_redeem"])}
        />
      ) : null}
      {section === "online" ? (
        <OnlineBookingSection
          draft={draft}
          patch={patch}
          footer={saveButton(["online_booking_enabled", "online_booking_days_ahead", "online_booking_min_notice_minutes", "online_booking_note"])}
        />
      ) : null}
      {section === "finance" ? (
        <FinanceSection
          draft={draft}
          patch={patch}
          footer={saveButton([
            "currency_code",
            "currency_symbol",
            "locale",
            "default_country_code",
            "default_commission_type",
            "default_commission_value",
            "product_commission_rate",
            "payment_methods",
          ])}
        />
      ) : null}
      {section === "messages" ? <MessagesSection draft={draft} patch={patch} footer={saveButton(["message_templates"])} /> : null}
      {section === "audit" && isAdmin ? <AuditPanel /> : null}
      {section === "branches" && isAdmin ? <BranchesSection /> : null}
      {section === "permissions" ? <PermissionsSection draft={draft} patch={patch} footer={saveButton(["role_permissions"])} /> : null}
    </div>
  );
}

interface SectionProps {
  draft: BusinessSettings;
  patch: <K extends keyof BusinessSettings>(key: K, value: BusinessSettings[K]) => void;
  footer: ReactNode;
}

function SectionCard({ title, description, children, footer }: { title: string; description?: string; children: ReactNode; footer: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>{children}</CardBody>
      <div className="flex justify-end border-t border-line px-5 py-3">{footer}</div>
    </Card>
  );
}

function BusinessSection({ draft, patch, footer }: SectionProps) {
  const toast = useToast();
  const savedLogo = useApp().settings.logo_url;
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadLogo(file);
      // Si había otro logo subido sin guardar, se descarta para no dejar archivos huérfanos
      if (draft.logo_url && draft.logo_url !== savedLogo) void deleteLogoByUrl(draft.logo_url);
      patch("logo_url", url);
      toast.success("Logo cargado. Guarda los cambios para aplicarlo.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <SectionCard title="Identidad del negocio" description="Datos que aparecen en tickets, mensajes y en la interfaz." footer={footer}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex items-center gap-4 sm:col-span-2">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-2">
            {draft.logo_url ? <img src={draft.logo_url} alt="Logo" className="h-full w-full object-cover" /> : <Icon icon={ImageUp} className="h-6 w-6 text-muted" />}
          </div>
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
            <Button variant="outline" icon={ImageUp} loading={uploading} onClick={() => fileRef.current?.click()}>
              Subir logo
            </Button>
            {draft.logo_url ? (
              <Button variant="ghost" onClick={() => patch("logo_url", null)}>
                Quitar
              </Button>
            ) : null}
          </div>
        </div>
        <Field label="Nombre comercial" required>
          <Input value={draft.business_name} onChange={(e) => patch("business_name", e.target.value)} />
        </Field>
        <Field label="Eslogan">
          <Input value={draft.slogan ?? ""} onChange={(e) => patch("slogan", nullIfEmpty(e.target.value))} />
        </Field>
        <Field label="Identificación fiscal" hint="RUC, NIT, RFC…">
          <Input value={draft.tax_id ?? ""} onChange={(e) => patch("tax_id", nullIfEmpty(e.target.value))} />
        </Field>
        <Field label="Teléfono">
          <Input value={draft.phone ?? ""} onChange={(e) => patch("phone", nullIfEmpty(e.target.value))} inputMode="tel" />
        </Field>
        <Field label="Correo">
          <Input type="email" value={draft.email ?? ""} onChange={(e) => patch("email", nullIfEmpty(e.target.value))} />
        </Field>
        <Field label="Dirección">
          <Input value={draft.address ?? ""} onChange={(e) => patch("address", nullIfEmpty(e.target.value))} />
        </Field>
      </div>
    </SectionCard>
  );
}

function OperationSection({ draft, patch, footer }: SectionProps) {
  const terms = getTerminology(draft.operating_mode);
  return (
    <SectionCard title="Modo operativo y módulos" description="Ajusta la terminología y los módulos visibles según tu tipo de negocio." footer={footer}>
      <div className="grid gap-3 md:grid-cols-3">
        {MODES.map((m) => {
          const active = draft.operating_mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => patch("operating_mode", m.value)}
              className={cn(
                "flex min-h-[112px] flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors",
                active ? "border-sage bg-sage-soft/60" : "border-line bg-surface hover:bg-surface-2",
              )}
            >
              <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", active ? "bg-sage text-white" : "bg-surface-2 text-muted")}>
                <Icon icon={m.icon} />
              </span>
              <span className="font-medium text-ink">{m.label}</span>
              <span className="text-xs text-muted">{m.description}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-sm text-muted">
        Terminología: <strong className="text-ink">{terms.professional}</strong> / <strong className="text-ink">{terms.station}</strong>. Los servicios, categorías
        y fichas técnicas se filtran según el modo.
      </p>

      <div className="mt-6 grid gap-x-8 md:grid-cols-2">
        {TOGGLEABLE_MODULES.map((key) => (
          <Switch
            key={key}
            checked={Boolean(draft.enabled_modules[key])}
            onChange={(v) => patch("enabled_modules", { ...draft.enabled_modules, [key]: v })}
            label={MODULE_LABELS[key]}
          />
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label="Intervalo de la agenda" hint="Saltos de hora al agendar">
          <Select value={draft.slot_interval_minutes} onChange={(e) => patch("slot_interval_minutes", Number(e.target.value))}>
            {[5, 10, 15, 20, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m} minutos
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cliente inactivo después de (días)">
          <Input type="number" min={7} max={730} value={draft.inactive_client_days} onChange={(e) => patch("inactive_client_days", toNumber(e.target.value, 45))} />
        </Field>
      </div>
    </SectionCard>
  );
}

const NOTICE_OPTIONS = [
  { value: 0, label: "Sin anticipación mínima" },
  { value: 30, label: "30 minutos" },
  { value: 60, label: "1 hora" },
  { value: 120, label: "2 horas" },
  { value: 240, label: "4 horas" },
  { value: 720, label: "12 horas" },
  { value: 1440, label: "1 día" },
  { value: 2880, label: "2 días" },
];

function OnlineBookingSection({ draft, patch, footer }: SectionProps) {
  const toast = useToast();
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const link = `${origin}/reservar`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Enlace copiado");
    } catch {
      toast.error("No se pudo copiar. Selecciona el enlace y cópialo manualmente.");
    }
  }

  return (
    <SectionCard
      title="Reserva online"
      description="Una página pública donde tus clientes eligen servicio, profesional y horario libre."
      footer={footer}
    >
      <div className="space-y-5">
        <Switch
          checked={draft.online_booking_enabled}
          onChange={(v) => patch("online_booking_enabled", v)}
          label="Aceptar reservas por internet"
          description="Las reservas entran a la agenda como «Programada» con origen Web."
        />

        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <p className="text-sm font-medium text-ink">Enlace para compartir</p>
          <p className="mt-1 text-xs text-muted">Ponlo en tu biografía de Instagram, en Google Maps o en tu estado de WhatsApp.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Enlace de reservas" />
            <div className="flex gap-2">
              <Button variant="outline" icon={Copy} onClick={() => void copyLink()}>
                Copiar
              </Button>
              <a href="/reservar" target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "outline" })}>
                <Icon icon={ExternalLink} />
                Ver página
              </a>
            </div>
          </div>
          {!draft.online_booking_enabled ? <p className="mt-2 text-xs text-clay-dark">La página mostrará «Reservas no disponibles» hasta que actives la opción.</p> : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Se puede reservar hasta" hint="Días hacia adelante (1 a 120).">
            <Input
              type="number"
              min={1}
              max={120}
              value={draft.online_booking_days_ahead}
              onChange={(e) => patch("online_booking_days_ahead", Math.min(120, Math.max(1, toNumber(e.target.value, 30))))}
            />
          </Field>
          <Field label="Anticipación mínima" hint="Evita reservas de último minuto.">
            <Select value={draft.online_booking_min_notice_minutes} onChange={(e) => patch("online_booking_min_notice_minutes", Number(e.target.value))}>
              {NOTICE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Mensaje para el cliente (opcional)" hint="Se muestra al confirmar. Máximo 300 caracteres.">
          <Textarea
            rows={2}
            maxLength={300}
            value={draft.online_booking_note ?? ""}
            onChange={(e) => patch("online_booking_note", nullIfEmpty(e.target.value))}
            placeholder="Ej.: llega 5 minutos antes. Si no puedes asistir, avísanos por WhatsApp."
          />
        </Field>

        <p className="text-xs text-muted">
          Solo se ofrecen horarios libres según el horario del negocio, los turnos y bloqueos de cada profesional y las citas ya agendadas. Elige qué
          servicios se pueden reservar en Servicios → «Reservable online».
        </p>
      </div>
    </SectionCard>
  );
}

function PointsSection({ draft, patch, footer }: SectionProps) {
  const symbol = draft.currency_symbol;
  const example = 100;
  const earned = Math.floor(example * draft.loyalty_points_per_currency);
  return (
    <SectionCard title="Programa de puntos" description="Tus clientes acumulan puntos al pagar y los canjean como descuento en caja." footer={footer}>
      <div className="space-y-5">
        <Switch
          checked={draft.loyalty_points_enabled}
          onChange={(v) => patch("loyalty_points_enabled", v)}
          label="Activar programa de puntos"
          description="Solo acumulan los clientes registrados (no los de paso). Las propinas no suman puntos."
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={`Puntos por cada ${symbol} 1`}>
            <Input
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={draft.loyalty_points_per_currency}
              onChange={(e) => patch("loyalty_points_per_currency", Math.min(100, Math.max(0, toNumber(e.target.value, 1))))}
            />
          </Field>
          <Field label={`Valor de 1 punto (${symbol})`}>
            <Input
              type="number"
              min={0.0001}
              step="0.01"
              value={draft.loyalty_point_value}
              onChange={(e) => patch("loyalty_point_value", Math.max(0.0001, toNumber(e.target.value, 0.05)))}
            />
          </Field>
          <Field label="Canje mínimo (puntos)">
            <Input
              type="number"
              min={1}
              step={1}
              value={draft.loyalty_min_redeem}
              onChange={(e) => patch("loyalty_min_redeem", Math.max(1, Math.trunc(toNumber(e.target.value, 100))))}
            />
          </Field>
        </div>
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">
          Ejemplo: un cliente que paga {symbol} {example} gana {earned} puntos, que valen {symbol} {(earned * draft.loyalty_point_value).toFixed(2)} en su
          próxima visita ({((draft.loyalty_points_per_currency * draft.loyalty_point_value) * 100).toFixed(1)}% de retorno).
        </p>
      </div>
    </SectionCard>
  );
}

function HoursSection({ draft, patch, footer }: SectionProps) {
  const hours = [1, 2, 3, 4, 5, 6, 0].map((day) => draft.business_hours.find((h) => h.day === day) ?? { day, open: false, start: "09:00", end: "18:00" });

  function updateDay(day: number, change: Partial<(typeof hours)[number]>) {
    const next = hours.map((h) => (h.day === day ? { ...h, ...change } : h));
    patch("business_hours", next);
  }

  return (
    <SectionCard title="Horario de atención" description="Se usa para la grilla de la agenda y para avisar citas fuera de horario." footer={footer}>
      <div className="divide-y divide-line">
        {hours.map((h) => (
          <div key={h.day} className="flex flex-wrap items-center gap-3 py-2">
            <div className="w-40">
              <Switch checked={h.open} onChange={(v) => updateDay(h.day, { open: v })} label={WEEKDAYS[h.day]} />
            </div>
            <Input type="time" value={h.start} disabled={!h.open} onChange={(e) => updateDay(h.day, { start: e.target.value })} className="w-32" aria-label={`Apertura ${WEEKDAYS[h.day]}`} />
            <span className="text-muted">a</span>
            <Input type="time" value={h.end} disabled={!h.open} onChange={(e) => updateDay(h.day, { end: e.target.value })} className="w-32" aria-label={`Cierre ${WEEKDAYS[h.day]}`} />
            {!h.open ? <span className="text-sm text-muted">Cerrado</span> : null}
          </div>
        ))}
      </div>
      <div className="mt-6 max-w-sm">
        <Field label="Zona horaria" hint="Define el cierre de día en reportes y comisiones.">
          <Select value={draft.timezone} onChange={(e) => patch("timezone", e.target.value)}>
            {Array.from(new Set([draft.timezone, ...TIMEZONES])).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </SectionCard>
  );
}

function FinanceSection({ draft, patch, footer }: SectionProps) {
  return (
    <SectionCard title="Moneda, comisiones y métodos de pago" footer={footer}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Moneda">
          <Select
            value={draft.currency_code}
            onChange={(e) => {
              const c = CURRENCIES.find((x) => x.code === e.target.value);
              if (!c) return;
              patch("currency_code", c.code);
              patch("currency_symbol", c.symbol);
              patch("locale", c.locale);
            }}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Símbolo">
          <Input value={draft.currency_symbol} maxLength={5} onChange={(e) => patch("currency_symbol", e.target.value)} />
        </Field>
        <Field label="Código de país (WhatsApp)" hint="Sin +, ej.: 51">
          <Input value={draft.default_country_code} maxLength={4} inputMode="numeric" onChange={(e) => patch("default_country_code", e.target.value.replace(/\D/g, ""))} />
        </Field>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Field label="Comisión por defecto en servicios">
          <Select value={draft.default_commission_type} onChange={(e) => patch("default_commission_type", e.target.value as CommissionType)}>
            <option value="percentage">Porcentaje</option>
            <option value="fixed">Monto fijo por servicio</option>
          </Select>
        </Field>
        <Field label={draft.default_commission_type === "percentage" ? "Valor (%)" : `Monto (${draft.currency_symbol})`}>
          <Input
            type="number"
            min={0}
            max={draft.default_commission_type === "percentage" ? 100 : undefined}
            step="0.5"
            value={draft.default_commission_value}
            onChange={(e) => patch("default_commission_value", toNumber(e.target.value))}
          />
        </Field>
        <Field label="Comisión por venta de productos (%)">
          <Input type="number" min={0} max={100} step="0.5" value={draft.product_commission_rate} onChange={(e) => patch("product_commission_rate", toNumber(e.target.value))} />
        </Field>
      </div>

      <div className="mt-6">
        <p className="mb-2 text-sm font-medium text-ink">Métodos de pago</p>
        <div className="divide-y divide-line rounded-xl border border-line">
          {draft.payment_methods.map((m, index) => (
            <div key={m.key} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <div className="w-44">
                <Switch
                  checked={m.enabled}
                  onChange={(v) => patch("payment_methods", draft.payment_methods.map((x, i) => (i === index ? { ...x, enabled: v } : x)))}
                  label={PAYMENT_METHOD_LABELS[m.key]}
                />
              </div>
              <Input
                value={m.label}
                onChange={(e) => patch("payment_methods", draft.payment_methods.map((x, i) => (i === index ? { ...x, label: e.target.value } : x)))}
                className="max-w-xs"
                aria-label={`Etiqueta para ${PAYMENT_METHOD_LABELS[m.key]}`}
                placeholder="Etiqueta visible (ej.: Yape / Plin)"
              />
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}

function MessagesSection({ draft, patch, footer }: SectionProps) {
  const templates = draft.message_templates;

  function update(index: number, change: Partial<(typeof templates)[number]>) {
    patch("message_templates", templates.map((t, i) => (i === index ? { ...t, ...change } : t)));
  }

  return (
    <SectionCard
      title="Plantillas de mensajes"
      description={`Variables dinámicas: ${TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(" ")}`}
      footer={
        <div className="flex w-full flex-wrap justify-between gap-2">
          <Button
            variant="outline"
            icon={Plus}
            onClick={() => patch("message_templates", [...templates, { key: `custom_${Date.now()}`, name: "Nueva plantilla", body: "Hola {cliente}, " }])}
          >
            Agregar plantilla
          </Button>
          {footer}
        </div>
      }
    >
      <div className="space-y-4">
        {templates.map((t, index) => (
          <div key={t.key} className="rounded-xl border border-line p-3">
            <div className="flex items-end gap-2">
              <Field label="Nombre" className="flex-1">
                <Input value={t.name} onChange={(e) => update(index, { name: e.target.value })} />
              </Field>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Eliminar plantilla"
                disabled={templates.length <= 1}
                onClick={() => patch("message_templates", templates.filter((_, i) => i !== index))}
              >
                <Icon icon={Trash2} />
              </Button>
            </div>
            <Field label="Mensaje" className="mt-3">
              <Textarea rows={3} value={t.body} onChange={(e) => update(index, { body: e.target.value })} />
            </Field>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function PermissionsSection({ draft, patch, footer }: SectionProps) {
  function toggle(role: (typeof CONFIGURABLE_ROLES)[number], module: ModuleKey, value: boolean) {
    const current = draft.role_permissions[role] ?? [];
    const next = value ? Array.from(new Set([...current, module])) : current.filter((m) => m !== module);
    patch("role_permissions", { ...draft.role_permissions, [role]: next });
  }

  return (
    <SectionCard
      title="Permisos por rol"
      description="Controla qué módulos ve cada rol. El propietario siempre tiene acceso total; la base de datos aplica además reglas RLS por rol."
      footer={footer}
    >
      {/* Lista por módulo (móvil) */}
      <ul className="divide-y divide-line md:hidden">
        {ALL_MODULES.map((module) => (
          <li key={module} className="py-3">
            <p className="text-sm font-medium text-ink">{MODULE_LABELS[module]}</p>
            <div className="mt-1 flex flex-wrap gap-x-4">
              {CONFIGURABLE_ROLES.map((role) => (
                <label key={role} className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[#3F5E4D]"
                    checked={(draft.role_permissions[role] ?? []).includes(module)}
                    onChange={(e) => toggle(role, module, e.target.checked)}
                  />
                  {ROLE_LABELS[role]}
                </label>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted md:hidden">{ROLE_LABELS.owner}: acceso total a todos los módulos.</p>
      {/* Tabla (tableta/PC) */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-2 pr-4 font-medium">Módulo</th>
              <th className="px-3 py-2 text-center font-medium">{ROLE_LABELS.owner}</th>
              {CONFIGURABLE_ROLES.map((r) => (
                <th key={r} className="px-3 py-2 text-center font-medium">
                  {ROLE_LABELS[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ALL_MODULES.map((module) => (
              <tr key={module}>
                <td className="py-2 pr-4 text-ink">{MODULE_LABELS[module]}</td>
                <td className="px-3 py-2 text-center">
                  <input type="checkbox" checked disabled className="h-4 w-4 accent-[#3F5E4D]" aria-label={`${MODULE_LABELS[module]} propietario`} />
                </td>
                {CONFIGURABLE_ROLES.map((role) => (
                  <td key={role} className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-[#3F5E4D]"
                      checked={(draft.role_permissions[role] ?? []).includes(module)}
                      onChange={(e) => toggle(role, module, e.target.checked)}
                      aria-label={`${MODULE_LABELS[module]} ${ROLE_LABELS[role]}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
