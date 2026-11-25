"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { addDays } from "date-fns";
import { AlertCircle, CalendarCheck2, CalendarX2, Check, Clock, MapPin, Phone, Scissors, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/misc";
import { formatDate, formatDuration, fromDateKey, toDateKey } from "@/lib/dates";
import { cn, formatMoney, getErrorMessage, nullIfEmpty } from "@/lib/utils";
import {
  createPublicBooking,
  fetchBookingInfo,
  fetchSlots,
  staffCanServe,
  type BookingResult,
  type PublicBookingInfo,
  type PublicService,
  type PublicSlot,
  type PublicStaff,
} from "./api";

type Step = "service" | "staff" | "time" | "details";

const ANY_STAFF = "any";

function dayParts(slot: string): "morning" | "afternoon" | "evening" {
  const hour = Number(slot.slice(0, 2));
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

const PART_LABELS = { morning: "Mañana", afternoon: "Tarde", evening: "Noche" } as const;

export function PublicBooking() {
  const [info, setInfo] = useState<PublicBookingInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("service");
  const [branchChoice, setBranchChoice] = useState<string>("");
  const [category, setCategory] = useState<string>("all");
  const [service, setService] = useState<PublicService | null>(null);
  const [staffChoice, setStaffChoice] = useState<string>(ANY_STAFF);
  const [dateKey, setDateKey] = useState<string>("");
  const [slots, setSlots] = useState<PublicSlot[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [time, setTime] = useState<string>("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<BookingResult | null>(null);

  const stepRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setInfo(await fetchBookingInfo());
    } catch (error) {
      setLoadError(getErrorMessage(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const money = useCallback(
    (amount: number) => formatMoney(amount, info?.currency_symbol ?? "S/", info?.locale ?? "es-PE"),
    [info?.currency_symbol, info?.locale],
  );

  const services = useMemo(() => info?.services ?? [], [info]);
  const categories = useMemo(
    () => (info?.categories ?? []).filter((c) => services.some((s) => s.category_id === c.id)),
    [info, services],
  );
  const visibleServices = category === "all" ? services : services.filter((s) => s.category_id === category);
  const branches = useMemo(() => info?.branches ?? [], [info]);
  const multiBranch = branches.length > 1;
  const inBranch = useCallback(
    (m: PublicStaff) => !multiBranch || !branchChoice || !m.branch_id || m.branch_id === branchChoice,
    [multiBranch, branchChoice],
  );
  const eligibleStaff = useMemo<PublicStaff[]>(
    () => (service ? (info?.staff ?? []).filter((m) => staffCanServe(m.specialty, service.segment) && inBranch(m)) : []),
    [info, service, inBranch],
  );
  const chosenStaff = eligibleStaff.find((m) => m.id === staffChoice) ?? null;

  const days = useMemo(() => {
    if (!info?.today) return [];
    const base = fromDateKey(info.today);
    const total = Math.min(info.days_ahead ?? 30, 120) + 1;
    return Array.from({ length: total }, (_, i) => {
      const date = addDays(base, i);
      const hours = info.business_hours?.find((h) => h.day === date.getDay());
      return { key: toDateKey(date), date, open: Boolean(hours?.open) };
    });
  }, [info]);

  // Horarios del día elegido
  useEffect(() => {
    if (!service || !dateKey) return;
    let cancelled = false;
    setSlots(null);
    setSlotsError(null);
    fetchSlots(service.id, dateKey, staffChoice === ANY_STAFF ? null : staffChoice, multiBranch ? branchChoice || null : null)
      .then((rows) => {
        if (!cancelled) setSlots(rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSlots([]);
          setSlotsError(getErrorMessage(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [service, dateKey, staffChoice, multiBranch, branchChoice]);

  function goTo(next: Step) {
    setStep(next);
    setSubmitError(null);
    window.requestAnimationFrame(() => stepRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function chooseService(s: PublicService) {
    setService(s);
    setTime("");
    const eligible = (info?.staff ?? []).filter((m) => staffCanServe(m.specialty, s.segment) && inBranch(m));
    if (!eligible.some((m) => m.id === staffChoice)) setStaffChoice(ANY_STAFF);
    goTo(eligible.length > 1 ? "staff" : "time");
    if (!dateKey) setDateKey(days.find((d) => d.open)?.key ?? days[0]?.key ?? "");
  }

  function chooseStaff(id: string) {
    setStaffChoice(id);
    setTime("");
    goTo("time");
  }

  function chooseTime(slot: string) {
    setTime(slot);
    goTo("details");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!service || !dateKey || !time || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const booking = await createPublicBooking({
        branch_id: multiBranch ? branchChoice || null : null,
        service_id: service.id,
        staff_id: staffChoice === ANY_STAFF ? null : staffChoice,
        date: dateKey,
        time,
        name: name.trim(),
        phone: phone.trim(),
        email: nullIfEmpty(email),
        notes: nullIfEmpty(notes),
      });
      setResult(booking);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      const message = getErrorMessage(error);
      setSubmitError(message);
      // Si el horario se ocupó mientras completaba sus datos, se recargan los horarios
      if (/horario/i.test(message)) {
        setTime("");
        setSlots(null);
        fetchSlots(service.id, dateKey, staffChoice === ANY_STAFF ? null : staffChoice, multiBranch ? branchChoice || null : null)
          .then(setSlots)
          .catch(() => setSlots([]));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function restart() {
    setResult(null);
    setService(null);
    setTime("");
    setNotes("");
    setStep("service");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ----------------------------------------------------------------- */

  if (loadError) {
    return (
      <Shell>
        <Notice icon={AlertCircle} title="No pudimos cargar las reservas" text={loadError}>
          <Button variant="outline" onClick={() => void load()}>
            Reintentar
          </Button>
        </Notice>
      </Shell>
    );
  }
  if (!info) {
    return (
      <Shell>
        <Spinner label="Cargando horarios" />
      </Shell>
    );
  }
  if (!info.enabled || services.length === 0) {
    return (
      <Shell info={info}>
        <Notice
          icon={CalendarX2}
          title="Reservas online no disponibles"
          text={info.phone ? `Escríbenos o llámanos al ${info.phone} para agendar tu cita.` : "Comunícate con el negocio para agendar tu cita."}
        />
      </Shell>
    );
  }

  if (result) {
    return (
      <Shell info={info}>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sage text-white">
            <Icon icon={Check} className="h-6 w-6" />
          </div>
          <h1 className="mt-4 font-display text-2xl font-semibold text-ink">Tu cita quedó reservada</h1>
          <p className="mt-1 text-sm text-muted">Guarda este resumen. Si necesitas cambiarla, comunícate con nosotros.</p>
          <dl className="mt-5 divide-y divide-line rounded-xl border border-line text-sm">
            <SummaryRow label="Servicio" value={result.service} />
            <SummaryRow label="Profesional" value={result.staff} />
            <SummaryRow label="Fecha" value={capitalize(formatDate(`${result.date}T00:00:00`, "EEEE d 'de' MMMM"))} />
            <SummaryRow label="Hora" value={`${result.time} · ${formatDuration(result.duration_minutes)}`} />
            <SummaryRow label="Precio referencial" value={money(Number(result.price))} />
            <SummaryRow label="Código" value={result.reference} mono />
          </dl>
          {info.note ? <p className="mt-4 rounded-xl bg-sage-soft px-4 py-3 text-sm text-sage-dark">{info.note}</p> : null}
          <Button variant="outline" className="mt-5 w-full" onClick={restart}>
            Reservar otra cita
          </Button>
        </div>
      </Shell>
    );
  }

  const stepsDone = {
    service: Boolean(service),
    staff: Boolean(service) && step !== "service" && step !== "staff",
    time: Boolean(time),
  };

  if (multiBranch && !branchChoice) {
    return (
      <Shell info={info}>
        <section className="rounded-2xl border border-sage/40 bg-surface p-4 shadow-card">
          <h1 className="text-[15px] font-semibold text-ink">¿En qué sede quieres atenderte?</h1>
          <ul className="mt-3 space-y-2">
            {branches.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setBranchChoice(b.id)}
                  className="flex w-full items-start gap-3 rounded-xl border border-line bg-surface p-3.5 text-left hover:border-sage/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/40"
                >
                  <Icon icon={MapPin} className="mt-0.5 h-5 w-5 text-sage" />
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{b.name}</span>
                    {b.address ? <span className="block text-sm text-muted">{b.address}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </Shell>
    );
  }

  return (
    <Shell info={info}>
      {multiBranch ? (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-surface-2 px-4 py-2.5 text-sm">
          <span className="flex items-center gap-2 text-ink">
            <Icon icon={MapPin} className="text-sage" />
            {branches.find((b) => b.id === branchChoice)?.name}
          </span>
          <button
            type="button"
            className="font-medium text-sage hover:underline"
            onClick={() => {
              setBranchChoice("");
              setService(null);
              setStaffChoice(ANY_STAFF);
              setTime("");
              setStep("service");
            }}
          >
            Cambiar sede
          </button>
        </div>
      ) : null}
      <div ref={stepRef} className="scroll-mt-4 space-y-3">
        {/* 1. Servicio */}
        <StepCard
          number={1}
          title="Servicio"
          active={step === "service"}
          done={stepsDone.service && step !== "service"}
          summary={service ? `${service.name} · ${formatDuration(service.duration_minutes)} · ${money(service.price)}` : undefined}
          onEdit={() => goTo("service")}
        >
          {categories.length > 1 ? (
            <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Categorías">
              <Chip active={category === "all"} onClick={() => setCategory("all")}>
                Todos
              </Chip>
              {categories.map((c) => (
                <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
                  {c.name}
                </Chip>
              ))}
            </div>
          ) : null}
          <ul className="space-y-2">
            {visibleServices.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => chooseService(s)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border bg-surface p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/40",
                    service?.id === s.id ? "border-sage bg-sage-soft/40" : "border-line hover:border-sage/40",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{s.name}</p>
                    {s.description ? <p className="mt-0.5 line-clamp-2 text-sm text-muted">{s.description}</p> : null}
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                      <Icon icon={Clock} className="h-3.5 w-3.5" />
                      {formatDuration(s.duration_minutes)}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums text-ink">{money(s.price)}</span>
                </button>
              </li>
            ))}
          </ul>
        </StepCard>

        {/* 2. Profesional */}
        {service && eligibleStaff.length > 1 ? (
          <StepCard
            number={2}
            title="Profesional"
            active={step === "staff"}
            done={stepsDone.staff}
            summary={chosenStaff ? chosenStaff.name : "Sin preferencia"}
            onEdit={() => goTo("staff")}
          >
            <ul className="grid gap-2 sm:grid-cols-2">
              <li>
                <StaffOption selected={staffChoice === ANY_STAFF} onClick={() => chooseStaff(ANY_STAFF)} name="Sin preferencia" hint="El primero disponible" />
              </li>
              {eligibleStaff.map((m) => (
                <li key={m.id}>
                  <StaffOption selected={staffChoice === m.id} onClick={() => chooseStaff(m.id)} name={m.name} color={m.color} />
                </li>
              ))}
            </ul>
          </StepCard>
        ) : null}

        {/* 3. Fecha y hora */}
        {service ? (
          <StepCard
            number={eligibleStaff.length > 1 ? 3 : 2}
            title="Fecha y hora"
            active={step === "time"}
            done={stepsDone.time && step === "details"}
            summary={time ? `${capitalize(formatDate(`${dateKey}T00:00:00`, "EEEE d 'de' MMMM"))} · ${time}` : undefined}
            onEdit={() => goTo("time")}
          >
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="group" aria-label="Días disponibles">
              {days.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  disabled={!d.open}
                  aria-pressed={dateKey === d.key}
                  onClick={() => {
                    setDateKey(d.key);
                    setTime("");
                  }}
                  className={cn(
                    "flex w-[60px] shrink-0 flex-col items-center rounded-xl border py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/40",
                    dateKey === d.key ? "border-sage bg-sage text-white" : "border-line bg-surface text-ink hover:border-sage/40",
                    !d.open && "cursor-not-allowed border-dashed bg-transparent text-muted/50 hover:border-line",
                  )}
                >
                  <span className="text-[11px] capitalize">{formatDate(d.date, "EEE")}</span>
                  <span className="text-lg font-semibold tabular-nums leading-tight">{d.date.getDate()}</span>
                  <span className="text-[10px] capitalize opacity-80">{formatDate(d.date, "MMM")}</span>
                </button>
              ))}
            </div>

            <div className="mt-3 min-h-[120px]">
              {slots === null ? (
                <Spinner label="Buscando horarios libres" className="py-6" />
              ) : slots.length === 0 ? (
                <div className="rounded-xl bg-surface-2 px-4 py-6 text-center text-sm text-muted">
                  {slotsError ?? "No quedan horarios libres este día. Prueba con otra fecha."}
                </div>
              ) : (
                <div className="space-y-4">
                  {(["morning", "afternoon", "evening"] as const).map((part) => {
                    const items = slots.filter((s) => dayParts(s.slot_time) === part);
                    if (items.length === 0) return null;
                    return (
                      <div key={part}>
                        <p className="mb-2 text-sm font-medium text-muted">{PART_LABELS[part]}</p>
                        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                          {items.map((s) => (
                            <button
                              key={s.slot_time}
                              type="button"
                              onClick={() => chooseTime(s.slot_time)}
                              aria-pressed={time === s.slot_time}
                              className={cn(
                                "min-h-[44px] rounded-lg border text-sm font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/40",
                                time === s.slot_time ? "border-sage bg-sage text-white" : "border-line bg-surface text-ink hover:border-sage/50",
                              )}
                            >
                              {s.slot_time}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </StepCard>
        ) : null}

        {/* 4. Datos */}
        {service && time ? (
          <StepCard number={eligibleStaff.length > 1 ? 4 : 3} title="Tus datos" active={step === "details"} done={false} onEdit={() => goTo("details")}>
            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label="Nombre y apellido" htmlFor="bk-name" required>
                <Input id="bk-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} autoComplete="name" />
              </Field>
              <Field label="Celular" htmlFor="bk-phone" required hint="Te contactaremos solo por tu cita.">
                <Input
                  id="bk-phone"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  minLength={6}
                  maxLength={20}
                  autoComplete="tel"
                />
              </Field>
              <Field label="Correo (opcional)" htmlFor="bk-email">
                <Input id="bk-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} autoComplete="email" />
              </Field>
              <Field label="Comentario (opcional)" htmlFor="bk-notes">
                <Textarea id="bk-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="Ej.: es mi primera vez" />
              </Field>

              <div className="rounded-xl bg-surface-2 p-4 text-sm">
                <p className="font-medium text-ink">{service.name}</p>
                <p className="mt-0.5 text-muted">
                  {capitalize(formatDate(`${dateKey}T00:00:00`, "EEEE d 'de' MMMM"))} a las {time} · {chosenStaff ? chosenStaff.name : "Sin preferencia"}
                </p>
                <p className="mt-2 flex justify-between border-t border-line pt-2">
                  <span className="text-muted">Precio referencial</span>
                  <span className="font-semibold tabular-nums text-ink">{money(service.price)}</span>
                </p>
              </div>

              {submitError ? (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-clay/25 bg-clay-soft px-3.5 py-3 text-sm text-clay-dark">
                  <Icon icon={AlertCircle} className="mt-0.5" />
                  <span>{submitError}</span>
                </div>
              ) : null}

              <Button type="submit" size="lg" className="w-full" icon={CalendarCheck2} loading={submitting}>
                {submitting ? "Reservando…" : "Confirmar reserva"}
              </Button>
            </form>
          </StepCard>
        ) : null}
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------- */

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function Shell({ info, children }: { info?: PublicBookingInfo; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-4">
          {info?.logo_url ? (
            <img src={info.logo_url} alt="" className="h-11 w-11 shrink-0 rounded-full border border-line object-cover" />
          ) : (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sage text-white">
              <Icon icon={Scissors} className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold text-ink">{info?.business_name ?? "Reserva tu cita"}</p>
            {info?.slogan ? <p className="truncate text-sm text-muted">{info.slogan}</p> : null}
          </div>
        </div>
        {info?.address || info?.phone ? (
          <div className="mx-auto flex max-w-xl flex-wrap gap-x-4 gap-y-1 px-4 pb-3 text-xs text-muted">
            {info.address ? (
              <span className="flex items-center gap-1">
                <Icon icon={MapPin} className="h-3.5 w-3.5" />
                {info.address}
              </span>
            ) : null}
            {info.phone ? (
              <a href={`tel:${info.phone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-1 hover:text-ink">
                <Icon icon={Phone} className="h-3.5 w-3.5" />
                {info.phone}
              </a>
            ) : null}
          </div>
        ) : null}
      </header>
      <main className="mx-auto max-w-xl px-4 py-5 pb-16">{children}</main>
    </div>
  );
}

function StepCard({
  number,
  title,
  active,
  done,
  summary,
  onEdit,
  children,
}: {
  number: number;
  title: string;
  active: boolean;
  done: boolean;
  summary?: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-2xl border bg-surface shadow-card", active ? "border-sage/40" : "border-line")} aria-current={active ? "step" : undefined}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
            done ? "bg-sage text-white" : active ? "bg-ink text-white" : "bg-surface-2 text-muted",
          )}
        >
          {done ? <Icon icon={Check} className="h-4 w-4" /> : number}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {!active && summary ? <p className="truncate text-sm text-muted">{summary}</p> : null}
        </div>
        {!active && done ? (
          <button type="button" onClick={onEdit} className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-sage hover:bg-sage-soft">
            Cambiar
          </button>
        ) : null}
      </div>
      {active ? <div className="border-t border-line px-4 py-4">{children}</div> : null}
    </section>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-[36px] shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors",
        active ? "border-ink bg-ink text-white" : "border-line bg-surface text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function StaffOption({ selected, onClick, name, hint, color }: { selected: boolean; onClick: () => void; name: string; hint?: string; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/40",
        selected ? "border-sage bg-sage-soft/40" : "border-line bg-surface hover:border-sage/40",
      )}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
        style={{ backgroundColor: color ?? "#5C5852" }}
        aria-hidden="true"
      >
        {color ? name.charAt(0).toUpperCase() : <UserRound className="h-5 w-5" strokeWidth={1.75} />}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">{name}</span>
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
    </button>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("text-right font-medium text-ink", mono && "font-mono tracking-wider")}>{value}</dd>
    </div>
  );
}

function Notice({ icon, title, text, children }: { icon: typeof Check; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6 text-center shadow-card">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-muted">
        <Icon icon={icon} className="h-5 w-5" />
      </div>
      <h1 className="font-display text-xl font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-sm text-muted">{text}</p>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
