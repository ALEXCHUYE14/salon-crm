"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftRight,
  Banknote,
  Gift,
  Ticket,
  CreditCard,
  Lock,
  Minus,
  Package,
  Plus,
  Printer,
  Receipt as ReceiptIcon,
  Scissors,
  Search,
  Star,
  ShoppingBag,
  Trash2,
  Unlock,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Alert, EmptyState, PageHeader, Spinner, Tabs } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useCatalog } from "@/hooks/use-catalog";
import { formatDateTime, formatDuration } from "@/lib/dates";
import { buildWhatsAppUrl, cn, getErrorMessage, nullIfEmpty, round2, toNumber } from "@/lib/utils";
import { getAppointment, listAppointmentDeposits, listBookingAppointments } from "@/modules/agenda/api";
import { getClient } from "@/modules/clients/api";
import { findPrepaidByCode, isUsable, listClientPrepaids, listPlans } from "@/modules/prepaid/api";
import { createVisitSurvey, surveyUrl } from "@/modules/surveys/api";
import { ClientPicker } from "@/modules/clients/components/client-picker";
import { listInventory } from "@/modules/inventory/api";
import { useApp } from "@/providers/app-provider";
import type {
  AppointmentDeposit,
  CashRegister,
  ClientPrepaid,
  ClientRef,
  InventoryItem,
  PaymentMethodKey,
  PrepaidPlan,
  SalePayload,
} from "@/types/domain";
import { createSale, getOpenRegister, openRegister } from "./api";
import { Receipt, type ReceiptData } from "./components/receipt";
import { CashMovementsModal, CloseRegisterModal, TicketsModal } from "./components/register-modals";

interface CartLine {
  key: string;
  item_kind: "service" | "product" | "plan";
  service_id: string | null;
  inventory_item_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount: number;
  staff_id: string | null;
  maxQuantity: number | null;
  /** Cita agendada de la que proviene la línea (cobro de reservas). */
  appointmentId?: string;
  /** Paquete o gift card que se vende (ítem "plan"). */
  plan_id?: string | null;
  /** Paquete de sesiones con el que se paga este servicio. */
  prepaid_id?: string | null;
}

/** Descuento efectivo de la línea: una sesión de paquete deja el servicio en 0. */
function lineDiscount(l: CartLine): number {
  return l.prepaid_id ? round2(l.quantity * l.unit_price) : l.discount;
}

function lineAmount(l: CartLine): number {
  return round2(l.quantity * l.unit_price - lineDiscount(l));
}

interface PaymentLine {
  key: string;
  method: PaymentMethodKey;
  amount: string;
  reference: string;
}

const METHOD_ICONS: Record<PaymentMethodKey, typeof Banknote> = {
  cash: Banknote,
  card: CreditCard,
  transfer: Wallet,
  wallet: Wallet,
};

const newKey = () => Math.random().toString(36).slice(2, 10);

export function CashView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { settings, staff: me, terms, money, branch } = useApp();
  const catalog = useCatalog();

  const [register, setRegister] = useState<CashRegister | null>(null);
  const [loadingRegister, setLoadingRegister] = useState(true);
  const [products, setProducts] = useState<InventoryItem[]>([]);

  const [catalogTab, setCatalogTab] = useState<"services" | "products" | "plans">("services");
  const [plans, setPlans] = useState<PrepaidPlan[]>([]);
  const [clientPrepaids, setClientPrepaids] = useState<ClientPrepaid[]>([]);
  const [gcCode, setGcCode] = useState("");
  const [giftCard, setGiftCard] = useState<ClientPrepaid | null>(null);
  const [gcAmount, setGcAmount] = useState("");
  const [gcChecking, setGcChecking] = useState(false);
  const [mobilePane, setMobilePane] = useState<"catalog" | "cart">("catalog");
  const [search, setSearch] = useState("");

  const [lines, setLines] = useState<CartLine[]>([]);
  const [client, setClient] = useState<ClientRef | null>(null);
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [appointmentIds, setAppointmentIds] = useState<string[]>([]);
  const [deposits, setDeposits] = useState<AppointmentDeposit[]>([]);
  const [pointsBalance, setPointsBalance] = useState<number | null>(null);
  const [redeemPoints, setRedeemPoints] = useState("");
  const [discountMode, setDiscountMode] = useState<"amount" | "percent">("amount");
  const [discountValue, setDiscountValue] = useState("");
  const [tip, setTip] = useState("");
  const [tipStaffId, setTipStaffId] = useState<string>("");
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [cashReceived, setCashReceived] = useState("");
  const [notes, setNotes] = useState("");
  const [charging, setCharging] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const [openingAmount, setOpeningAmount] = useState("");
  const [openingNotes, setOpeningNotes] = useState("");
  const [opening, setOpening] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [ticketsOpen, setTicketsOpen] = useState(false);
  const [movementsOpen, setMovementsOpen] = useState(false);

  const enabledMethods = settings.payment_methods.filter((m) => m.enabled);
  const staffName = (id: string | null) => catalog.staff.find((s) => s.id === id)?.full_name ?? null;

  const branchId = branch?.id ?? null;
  const loadRegister = useCallback(async () => {
    try {
      setRegister(await getOpenRegister(branchId));
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoadingRegister(false);
    }
  }, [toast, branchId]);

  const loadProducts = useCallback(async () => {
    try {
      const rows = await listInventory({ type: "retail" });
      setProducts(rows.filter((p) => p.price !== null));
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }, [toast]);

  useEffect(() => {
    void loadRegister();
    void loadProducts();
    // Si la migración de paquetes aún no se aplicó, la pestaña simplemente no aparece
    listPlans({ activeOnly: true })
      .then(setPlans)
      .catch(() => setPlans([]));
  }, [loadRegister, loadProducts]);

  // Cobro de una cita (?cita=<id>)
  useEffect(() => {
    const citaId = searchParams.get("cita");
    if (!citaId) return;
    let cancelled = false;
    (async () => {
      const appt = await getAppointment(citaId);
      // Reserva con varios servicios: se cobran juntas todas las citas pendientes de la visita
      const siblings = appt.booking_id ? await listBookingAppointments(appt.booking_id) : [];
      const pending = siblings.filter((a) => a.id === appt.id || !["completed", "cancelled", "no_show"].includes(a.status));
      const toCharge = pending.length > 0 ? pending : [appt];
      // Adelantos disponibles de esas citas (si la tabla aún no existe, se cobra sin adelantos)
      const held = await listAppointmentDeposits(toCharge.map((a) => a.id))
        .then((rows) => rows.filter((d) => d.status === "held"))
        .catch(() => [] as AppointmentDeposit[]);
      return { appt, toCharge, held };
    })()
      .then(({ appt, toCharge, held }) => {
        if (cancelled) return;
        setAppointmentId(appt.id);
        setAppointmentIds(toCharge.map((a) => a.id));
        setDeposits(held);
        if (appt.client) setClient(appt.client);
        setLines(
          toCharge.map((a) => ({
            key: newKey(),
            item_kind: "service" as const,
            service_id: a.service_id,
            inventory_item_id: null,
            description: a.service?.name ?? "Servicio",
            quantity: 1,
            unit_price: Number(a.price),
            discount: 0,
            staff_id: a.staff_id,
            maxQuantity: null,
            appointmentId: a.id,
          })),
        );
        setTipStaffId(appt.staff_id);
        setMobilePane("cart");
        router.replace(pathname);
      })
      .catch((error: unknown) => toast.error(getErrorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [searchParams, pathname, router, toast]);

  // Totales
  const subtotal = useMemo(() => round2(lines.reduce((sum, l) => sum + lineAmount(l), 0)), [lines]);
  const discountAmount = useMemo(() => {
    const v = Math.max(0, toNumber(discountValue));
    return round2(Math.min(subtotal, discountMode === "percent" ? (subtotal * Math.min(v, 100)) / 100 : v));
  }, [discountValue, discountMode, subtotal]);
  const tipAmount = round2(Math.max(0, toNumber(tip)));
  // Canje de puntos: como descuento, sin superar lo que queda por pagar
  const pointValue = settings.loyalty_point_value;
  const maxRedeemable =
    pointsBalance && pointValue > 0 ? Math.max(0, Math.min(pointsBalance, Math.floor((subtotal - discountAmount) / pointValue + 1e-9))) : 0;
  const redeem = Math.min(maxRedeemable, Math.max(0, Math.trunc(toNumber(redeemPoints))));
  const pointsValue = round2(redeem * pointValue);
  // Gift card: saldo aplicado como descuento, sin superar lo que queda por pagar
  const giftValue = giftCard
    ? round2(Math.max(0, Math.min(toNumber(gcAmount), giftCard.balance, subtotal - discountAmount - pointsValue)))
    : 0;
  const total = round2(subtotal - discountAmount - pointsValue - giftValue + tipAmount);
  // Citas que se completarán con este cobro y adelantos que les corresponden
  const chargedAppointmentIds = appointmentIds.filter((id) => id === appointmentId || lines.some((l) => l.appointmentId === id));
  const appliedDeposits = deposits.filter((d) => chargedAppointmentIds.includes(d.appointment_id));
  const depositTotal = round2(appliedDeposits.reduce((sum, d) => sum + d.amount, 0));
  /** Lo que falta pagar después de aplicar adelantos. */
  const due = round2(Math.max(0, total - depositTotal));
  const paid = round2(payments.reduce((sum, p) => sum + Math.max(0, toNumber(p.amount)), 0));
  const remaining = round2(due - paid);
  const cashAmount = round2(payments.filter((p) => p.method === "cash").reduce((s, p) => s + toNumber(p.amount), 0));
  const change = cashReceived === "" ? 0 : round2(Math.max(0, toNumber(cashReceived) - cashAmount));

  // Paquetes vigentes del cliente elegido; al cambiar de cliente se quitan las sesiones aplicadas
  const clientIdForPrepaids = client?.id ?? null;
  useEffect(() => {
    setLines((current) =>
      current.some((l) => l.prepaid_id) ? current.map((l) => (l.prepaid_id ? { ...l, prepaid_id: null, maxQuantity: null } : l)) : current,
    );
    if (!clientIdForPrepaids) {
      setClientPrepaids([]);
      return;
    }
    let cancelled = false;
    listClientPrepaids(clientIdForPrepaids)
      .then((rows) => {
        if (!cancelled) setClientPrepaids(rows.filter((p) => p.kind === "package" && isUsable(p)));
      })
      .catch(() => {
        if (!cancelled) setClientPrepaids([]);
      });
    return () => {
      cancelled = true;
    };
  }, [clientIdForPrepaids]);

  function togglePackage(line: CartLine) {
    if (line.prepaid_id) {
      updateLine(line.key, { prepaid_id: null, maxQuantity: null });
      return;
    }
    const pkg = clientPrepaids.find((p) => p.service_id === line.service_id);
    if (!pkg) return;
    const usedElsewhere = lines.filter((l) => l.prepaid_id === pkg.id && l.key !== line.key).reduce((s, l) => s + l.quantity, 0);
    const left = pkg.sessions_total - pkg.sessions_used - usedElsewhere;
    if (left < 1) return toast.error("Ya no quedan sesiones en el paquete");
    updateLine(line.key, { prepaid_id: pkg.id, maxQuantity: left, quantity: Math.min(line.quantity, left) });
  }

  async function applyGiftCard() {
    if (!gcCode.trim()) return;
    setGcChecking(true);
    try {
      const found = await findPrepaidByCode(gcCode);
      if (!found || found.kind !== "gift_card") return toast.error("No encontramos una gift card con ese código");
      if (!isUsable(found)) return toast.error(found.balance <= 0 ? "La gift card no tiene saldo" : "La gift card venció");
      setGiftCard(found);
      setGcAmount(String(round2(Math.min(found.balance, Math.max(0, subtotal - discountAmount - pointsValue)))));
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setGcChecking(false);
    }
  }

  function removeGiftCard() {
    setGiftCard(null);
    setGcAmount("");
    setGcCode("");
  }

  function addPlan(plan: PrepaidPlan) {
    setLines((current) => [
      ...current,
      {
        key: newKey(),
        item_kind: "plan",
        service_id: null,
        inventory_item_id: null,
        plan_id: plan.id,
        description: plan.name,
        quantity: 1,
        unit_price: Number(plan.price),
        discount: 0,
        staff_id: null,
        maxQuantity: 10,
      },
    ]);
  }

  // Saldo de puntos del cliente elegido
  const clientIdForPoints = settings.loyalty_points_enabled ? (client?.id ?? null) : null;
  useEffect(() => {
    setRedeemPoints("");
    if (!clientIdForPoints) {
      setPointsBalance(null);
      return;
    }
    let cancelled = false;
    getClient(clientIdForPoints)
      .then((c) => {
        if (!cancelled) setPointsBalance(Number(c.loyalty_points ?? 0));
      })
      .catch(() => {
        if (!cancelled) setPointsBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [clientIdForPoints]);

  // Con un solo método de pago, el monto sigue al total automáticamente
  useEffect(() => {
    setPayments((current) => {
      if (current.length === 0 && enabledMethods.length > 0) {
        return [{ key: newKey(), method: enabledMethods[0].key, amount: due > 0 ? due.toFixed(2) : "", reference: "" }];
      }
      if (current.length === 1) return [{ ...current[0], amount: due > 0 ? due.toFixed(2) : "" }];
      return current;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due]);

  function addService(serviceId: string) {
    const service = catalog.services.find((s) => s.id === serviceId);
    if (!service) return;
    const defaultStaff =
      lines.find((l) => l.item_kind === "service")?.staff_id ?? (me.is_bookable ? me.id : (catalog.bookableStaff[0]?.id ?? null));
    setLines((current) => [
      ...current,
      {
        key: newKey(),
        item_kind: "service",
        service_id: service.id,
        inventory_item_id: null,
        description: service.name,
        quantity: 1,
        unit_price: Number(service.price),
        discount: 0,
        staff_id: defaultStaff,
        maxQuantity: null,
      },
    ]);
    if (!tipStaffId && defaultStaff) setTipStaffId(defaultStaff);
  }

  function addProduct(product: InventoryItem) {
    setLines((current) => {
      const existing = current.find((l) => l.inventory_item_id === product.id);
      if (existing) {
        if (existing.quantity + 1 > product.stock) {
          toast.error(`Stock disponible: ${product.stock}`);
          return current;
        }
        return current.map((l) => (l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      if (product.stock < 1) {
        toast.error("Producto sin stock");
        return current;
      }
      return [
        ...current,
        {
          key: newKey(),
          item_kind: "product",
          service_id: null,
          inventory_item_id: product.id,
          description: product.name,
          quantity: 1,
          unit_price: Number(product.price ?? 0),
          discount: 0,
          staff_id: current.find((l) => l.item_kind === "service")?.staff_id ?? null,
          maxQuantity: product.stock,
        },
      ];
    });
  }

  function updateLine(key: string, patch: Partial<CartLine>) {
    setLines((current) =>
      current.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        if (next.maxQuantity !== null && next.quantity > next.maxQuantity) {
          toast.error(`Stock disponible: ${next.maxQuantity}`);
          next.quantity = next.maxQuantity;
        }
        next.quantity = Math.max(1, next.quantity);
        next.discount = Math.min(Math.max(0, next.discount), round2(next.quantity * next.unit_price));
        return next;
      }),
    );
  }

  function resetSale() {
    setLines([]);
    setClient(null);
    setAppointmentId(null);
    setAppointmentIds([]);
    setDeposits([]);
    setRedeemPoints("");
    setGiftCard(null);
    setGcAmount("");
    setGcCode("");
    setDiscountValue("");
    setTip("");
    setTipStaffId("");
    setPayments([]);
    setCashReceived("");
    setNotes("");
    setMobilePane("catalog");
  }

  async function handleOpenRegister() {
    setOpening(true);
    try {
      const reg = await openRegister(Math.max(0, toNumber(openingAmount)), me.id, nullIfEmpty(openingNotes), branchId);
      setRegister(reg);
      toast.success("Caja abierta");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setOpening(false);
    }
  }

  async function handleCharge() {
    if (lines.length === 0) return toast.error("Agrega al menos un servicio o producto");
    if (lines.some((l) => l.item_kind === "plan") && !client)
      return toast.error("Selecciona al cliente que recibe el paquete o la gift card");
    if (redeem > 0 && redeem < settings.loyalty_min_redeem)
      return toast.error(`El canje mínimo es de ${settings.loyalty_min_redeem} puntos`);
    if (depositTotal > total + 0.009)
      return toast.error(
        `El adelanto (${money(depositTotal)}) supera el total. Agrega los servicios de la cita o devuelve el adelanto desde la agenda.`,
      );
    if (Math.abs(remaining) > 0.009)
      return toast.error(remaining > 0 ? `Faltan ${money(remaining)} por asignar` : `Los pagos exceden el total en ${money(-remaining)}`);
    if (lines.some((l) => l.item_kind === "service" && !l.staff_id))
      return toast.error(`Asigna un ${terms.professional.toLowerCase()} a cada servicio`);
    if (cashReceived !== "" && toNumber(cashReceived) < cashAmount)
      return toast.error("El efectivo recibido es menor al monto en efectivo");

    const validPayments = payments.filter((p) => toNumber(p.amount) > 0);
    const payload: SalePayload = {
      client_id: client?.id ?? null,
      appointment_id: appointmentId,
      // Solo se completan las citas cuyo servicio sigue en el carrito (más la cita desde la que se abrió el cobro)
      appointment_ids: chargedAppointmentIds,
      deposit_ids: appliedDeposits.map((d) => d.id),
      points_redeemed: redeem,
      branch_id: branchId,
      gift_card_code: giftCard && giftValue > 0 ? giftCard.code : null,
      gift_card_amount: giftCard ? giftValue : 0,
      discount_amount: discountAmount,
      tip_amount: tipAmount,
      tip_staff_id: tipAmount > 0 ? nullIfEmpty(tipStaffId) : null,
      cash_received: cashAmount > 0 && cashReceived !== "" ? toNumber(cashReceived) : null,
      notes: nullIfEmpty(notes),
      items: lines.map((l) => ({
        item_kind: l.item_kind,
        service_id: l.service_id,
        inventory_item_id: l.inventory_item_id,
        plan_id: l.plan_id ?? null,
        prepaid_id: l.prepaid_id ?? null,
        staff_id: l.item_kind === "plan" ? null : l.staff_id,
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        discount: lineDiscount(l),
      })),
      payments: validPayments.map((p) => ({ method: p.method, amount: round2(toNumber(p.amount)), reference: nullIfEmpty(p.reference) })),
    };

    setCharging(true);
    try {
      const result = await createSale(payload);
      setReceipt({
        transactionId: result.id,
        clientPhone: client?.phone ?? null,
        ticketNumber: result.ticket_number,
        createdAt: new Date().toISOString(),
        clientName: client?.full_name ?? null,
        lines: lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          lineTotal: lineAmount(l),
          staffName: staffName(l.staff_id),
        })),
        subtotal,
        discount: round2(discountAmount + pointsValue + giftValue),
        tip: tipAmount,
        total,
        payments: [
          ...(depositTotal > 0 ? [{ method: "deposit" as const, amount: depositTotal }] : []),
          ...payload.payments.map((p) => ({ method: p.method, amount: p.amount })),
        ],
        cashReceived: payload.cash_received,
        change: Number(result.change ?? change),
        pointsRedeemed: redeem,
        pointsEarned: Number(result.points_earned ?? 0),
        pointsBalance: typeof result.points_balance === "number" ? result.points_balance : null,
        giftCardUsed: giftValue,
        giftCardBalance: typeof result.gift_card_balance === "number" ? Number(result.gift_card_balance) : null,
        prepaids: (result.prepaids ?? []).map((p) => ({ name: p.name, code: p.code, expiresAt: p.expires_at })),
      });
      resetSale();
      void loadProducts();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setCharging(false);
    }
  }

  const term = search.trim().toLowerCase();
  const filteredServices = catalog.services.filter((s) => !term || s.name.toLowerCase().includes(term));
  const filteredProducts = products.filter(
    (p) => !term || p.name.toLowerCase().includes(term) || (p.sku ?? "").toLowerCase().includes(term),
  );

  if (loadingRegister || catalog.loading) return <Spinner />;

  if (!register) {
    return (
      <div>
        <PageHeader title="Caja" description="Para registrar cobros primero abre la caja del día." />
        <Card className="mx-auto max-w-md">
          <CardHeader title="Apertura de caja" description="Registra el fondo inicial en efectivo" />
          <CardBody className="space-y-4">
            <Field label={`Fondo inicial (${settings.currency_symbol})`}>
              <Input
                type="number"
                min={0}
                step="0.1"
                inputMode="decimal"
                value={openingAmount}
                onChange={(e) => setOpeningAmount(e.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </Field>
            <Field label="Observaciones">
              <Textarea rows={2} value={openingNotes} onChange={(e) => setOpeningNotes(e.target.value)} />
            </Field>
            <Button className="w-full" size="lg" icon={Unlock} loading={opening} onClick={() => void handleOpenRegister()}>
              Abrir caja
            </Button>
          </CardBody>
        </Card>
        {receipt ? <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} /> : null}
      </div>
    );
  }

  const catalogPane = (
    <Card className="flex flex-col overflow-hidden">
      <div className="space-y-3 border-b border-line p-3">
        <Tabs
          value={catalogTab}
          onChange={setCatalogTab}
          items={[
            { value: "services", label: "Servicios", icon: Scissors, count: catalog.services.length },
            { value: "products", label: "Productos", icon: Package, count: products.length },
            ...(plans.length > 0 ? [{ value: "plans" as const, label: "Paquetes", icon: Ticket, count: plans.length }] : []),
          ]}
        />
        <div className="relative">
          <Icon icon={Search} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar en el catálogo" className="pl-9" />
        </div>
      </div>
      <div className="grid max-h-[65vh] grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
        {catalogTab === "plans"
          ? plans
              .filter((p) => !term || p.name.toLowerCase().includes(term))
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addPlan(p)}
                  className="flex min-h-[88px] flex-col justify-between rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:border-sage/40 hover:bg-sage-soft/40 active:bg-sage-soft"
                >
                  <span className="line-clamp-2 text-sm font-medium text-ink">{p.name}</span>
                  <span className="mt-2 flex items-end justify-between gap-2">
                    <span className="text-xs text-muted">
                      {p.kind === "package" ? `${p.sessions} sesiones` : `Saldo ${money(p.credit)}`}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-ink">{money(p.price)}</span>
                  </span>
                </button>
              ))
          : catalogTab === "services"
            ? filteredServices.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => addService(s.id)}
                  className="flex min-h-[88px] flex-col justify-between rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:border-sage/40 hover:bg-sage-soft/40 active:bg-sage-soft"
                >
                  <span className="line-clamp-2 text-sm font-medium text-ink">{s.name}</span>
                  <span className="mt-2 flex items-end justify-between gap-2">
                    <span className="text-xs text-muted">{formatDuration(s.duration_minutes + s.processing_minutes)}</span>
                    <span className="text-sm font-semibold tabular-nums text-ink">{money(s.price)}</span>
                  </span>
                </button>
              ))
            : filteredProducts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addProduct(p)}
                  disabled={p.stock < 1}
                  className="flex min-h-[88px] flex-col justify-between rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:border-sage/40 hover:bg-sage-soft/40 disabled:opacity-50"
                >
                  <span className="line-clamp-2 text-sm font-medium text-ink">{p.name}</span>
                  <span className="mt-2 flex items-end justify-between gap-2">
                    <span className={cn("text-xs", p.is_low_stock ? "text-ochre-dark" : "text-muted")}>Stock {p.stock}</span>
                    <span className="text-sm font-semibold tabular-nums text-ink">{money(p.price)}</span>
                  </span>
                </button>
              ))}
        {(catalogTab === "services" ? filteredServices : catalogTab === "products" ? filteredProducts : plans).length === 0 ? (
          <p className="col-span-full py-8 text-center text-sm text-muted">Sin resultados</p>
        ) : null}
      </div>
    </Card>
  );

  const cartPane = (
    <Card className="flex flex-col">
      <CardHeader
        title="Venta actual"
        description={
          appointmentIds.length > 1
            ? `Cobro de reserva con ${appointmentIds.length} servicios`
            : appointmentId
              ? "Cobro de cita agendada"
              : "Venta de mostrador"
        }
        action={
          lines.length > 0 ? (
            <Button size="sm" variant="ghost" icon={X} onClick={resetSale}>
              Vaciar
            </Button>
          ) : null
        }
      />
      <div className="space-y-4 p-4">
        <Field label="Cliente">
          <ClientPicker value={client} onChange={setClient} placeholder="Cliente (opcional)" />
        </Field>

        {pointsBalance !== null ? (
          <div className="rounded-xl border border-sage/30 bg-sage-soft/40 p-3 text-sm">
            <p className="text-sage-dark">
              <span className="font-semibold tabular-nums">{pointsBalance}</span> puntos disponibles ({money(pointsBalance * pointValue)})
            </p>
            {pointsBalance >= settings.loyalty_min_redeem && maxRedeemable > 0 ? (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={maxRedeemable}
                  step={1}
                  value={redeemPoints}
                  onChange={(e) => setRedeemPoints(e.target.value)}
                  placeholder="Puntos a canjear"
                  className="h-10 min-h-0 w-40"
                  aria-label="Puntos a canjear"
                />
                <Button size="sm" variant="outline" onClick={() => setRedeemPoints(String(maxRedeemable))}>
                  Usar {maxRedeemable}
                </Button>
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted">Canje desde {settings.loyalty_min_redeem} puntos.</p>
            )}
          </div>
        ) : null}

        {lines.length === 0 ? (
          <EmptyState icon={ShoppingBag} title="Carrito vacío" description="Toca un servicio o producto del catálogo." className="py-6" />
        ) : (
          <ul className="space-y-2">
            {lines.map((l) => (
              <li key={l.key} className="rounded-xl border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{l.description}</p>
                    <p className="text-xs text-muted">
                      {l.item_kind === "service" ? "Servicio" : l.item_kind === "product" ? "Producto" : "Paquete / gift card"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <p className="text-sm font-semibold tabular-nums">{money(lineAmount(l))}</p>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9"
                      aria-label="Quitar"
                      onClick={() => setLines((c) => c.filter((x) => x.key !== l.key))}
                    >
                      <Icon icon={Trash2} />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-2 sm:grid-cols-[auto_1fr_1fr]">
                  <div className="flex items-center rounded-lg border border-line">
                    <button
                      type="button"
                      className="flex h-10 w-10 items-center justify-center text-muted hover:text-ink"
                      onClick={() => updateLine(l.key, { quantity: l.quantity - 1 })}
                      aria-label="Menos"
                    >
                      <Icon icon={Minus} />
                    </button>
                    <span className="w-7 text-center text-sm tabular-nums">{l.quantity}</span>
                    <button
                      type="button"
                      className="flex h-10 w-10 items-center justify-center text-muted hover:text-ink"
                      onClick={() => updateLine(l.key, { quantity: l.quantity + 1 })}
                      aria-label="Más"
                    >
                      <Icon icon={Plus} />
                    </button>
                  </div>
                  {l.item_kind === "plan" ? (
                    <p className="text-xs text-muted">Se entrega al cliente seleccionado</p>
                  ) : (
                    <Select
                      value={l.staff_id ?? ""}
                      onChange={(e) => updateLine(l.key, { staff_id: e.target.value || null })}
                      aria-label={terms.professional}
                      className="h-10 min-h-0"
                    >
                      <option value="">{l.item_kind === "service" ? `Elegir ${terms.professional.toLowerCase()}` : "Sin vendedor"}</option>
                      {catalog.staff
                        .filter((s) => (l.item_kind === "service" ? s.is_bookable : true))
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.full_name}
                          </option>
                        ))}
                    </Select>
                  )}
                  <div className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-1">
                    <Input
                      type="number"
                      min={0}
                      step="0.5"
                      value={l.unit_price}
                      onChange={(e) => updateLine(l.key, { unit_price: Math.max(0, toNumber(e.target.value)) })}
                      aria-label="Precio unitario"
                      className="h-10 min-h-0"
                    />
                    <Input
                      type="number"
                      min={0}
                      step="0.5"
                      value={l.discount || ""}
                      placeholder="Dcto."
                      onChange={(e) => updateLine(l.key, { discount: toNumber(e.target.value) })}
                      aria-label="Descuento de línea"
                      className="h-10 min-h-0"
                      disabled={Boolean(l.prepaid_id)}
                    />
                  </div>
                </div>
                {l.item_kind === "service" && (l.prepaid_id || clientPrepaids.some((p) => p.service_id === l.service_id)) ? (
                  <button
                    type="button"
                    onClick={() => togglePackage(l)}
                    className={cn(
                      "mt-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium",
                      l.prepaid_id ? "bg-sage text-white" : "bg-sage-soft text-sage-dark hover:bg-sage-soft/70",
                    )}
                  >
                    <Icon icon={Ticket} className="h-3.5 w-3.5" />
                    {l.prepaid_id
                      ? "Pagado con paquete · quitar"
                      : (() => {
                          const p = clientPrepaids.find((x) => x.service_id === l.service_id);
                          return p ? `Usar paquete «${p.name}» · ${p.sessions_total - p.sessions_used} sesiones` : "Usar paquete";
                        })()}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {plans.some((p) => p.kind === "gift_card") || giftCard ? (
          <div className="rounded-xl border border-line p-3">
            {giftCard ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Icon icon={Gift} className="text-sage" />
                <span className="text-ink">
                  Gift card <span className="font-mono">{giftCard.code}</span> · saldo {money(giftCard.balance)}
                </span>
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  value={gcAmount}
                  onChange={(e) => setGcAmount(e.target.value)}
                  className="h-10 min-h-0 w-28"
                  aria-label="Monto a usar de la gift card"
                />
                <Button size="sm" variant="ghost" icon={X} onClick={removeGiftCard}>
                  Quitar
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  value={gcCode}
                  onChange={(e) => setGcCode(e.target.value.toUpperCase())}
                  placeholder="Código de gift card"
                  className="h-10 min-h-0 font-mono"
                  maxLength={20}
                  aria-label="Código de gift card"
                />
                <Button size="sm" variant="outline" icon={Gift} loading={gcChecking} onClick={() => void applyGiftCard()}>
                  Aplicar
                </Button>
              </div>
            )}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Descuento general">
            <div className="flex gap-1">
              <Input
                type="number"
                min={0}
                step="0.5"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder="0"
              />
              <Select
                value={discountMode}
                onChange={(e) => setDiscountMode(e.target.value as "amount" | "percent")}
                className="w-20"
                aria-label="Tipo de descuento"
              >
                <option value="amount">{settings.currency_symbol}</option>
                <option value="percent">%</option>
              </Select>
            </div>
          </Field>
          <Field label="Propina">
            <Input type="number" min={0} step="0.5" value={tip} onChange={(e) => setTip(e.target.value)} placeholder="0" />
          </Field>
          {tipAmount > 0 ? (
            <Field label="Propina para" className="col-span-2">
              <Select value={tipStaffId} onChange={(e) => setTipStaffId(e.target.value)}>
                <option value="">Fondo común</option>
                {catalog.bookableStaff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>

        <dl className="space-y-1 rounded-xl bg-surface-2 p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Subtotal</dt>
            <dd className="tabular-nums">{money(subtotal)}</dd>
          </div>
          {discountAmount > 0 ? (
            <div className="flex justify-between text-clay">
              <dt>Descuento</dt>
              <dd className="tabular-nums">- {money(discountAmount)}</dd>
            </div>
          ) : null}
          {giftValue > 0 ? (
            <div className="flex justify-between text-sage-dark">
              <dt>Gift card {giftCard?.code}</dt>
              <dd className="tabular-nums">- {money(giftValue)}</dd>
            </div>
          ) : null}
          {pointsValue > 0 ? (
            <div className="flex justify-between text-sage-dark">
              <dt>Canje de {redeem} puntos</dt>
              <dd className="tabular-nums">- {money(pointsValue)}</dd>
            </div>
          ) : null}
          {tipAmount > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted">Propina</dt>
              <dd className="tabular-nums">{money(tipAmount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-line pt-2 font-display text-xl font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{money(total)}</dd>
          </div>
          {depositTotal > 0 ? (
            <>
              <div className="flex justify-between pt-1 text-sage-dark">
                <dt>Adelanto ya pagado</dt>
                <dd className="tabular-nums">- {money(depositTotal)}</dd>
              </div>
              <div className="flex justify-between font-semibold">
                <dt>Por cobrar</dt>
                <dd className="tabular-nums">{money(due)}</dd>
              </div>
            </>
          ) : null}
        </dl>

        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">Pagos</p>
          {payments.map((p) => (
            <div key={p.key} className="flex flex-wrap items-center gap-2">
              <div className="min-w-[150px] flex-1">
                <Select
                  value={p.method}
                  onChange={(e) =>
                    setPayments((c) => c.map((x) => (x.key === p.key ? { ...x, method: e.target.value as PaymentMethodKey } : x)))
                  }
                  aria-label="Método de pago"
                >
                  {enabledMethods.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Input
                type="number"
                min={0}
                step="0.1"
                inputMode="decimal"
                value={p.amount}
                onChange={(e) => setPayments((c) => c.map((x) => (x.key === p.key ? { ...x, amount: e.target.value } : x)))}
                className="w-28"
                aria-label="Monto"
              />
              {p.method !== "cash" ? (
                <Input
                  value={p.reference}
                  onChange={(e) => setPayments((c) => c.map((x) => (x.key === p.key ? { ...x, reference: e.target.value } : x)))}
                  placeholder="Ref./operación"
                  className="w-32"
                  aria-label="Referencia"
                />
              ) : null}
              {payments.length > 1 ? (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Quitar pago"
                  onClick={() => setPayments((c) => c.filter((x) => x.key !== p.key))}
                >
                  <Icon icon={X} />
                </Button>
              ) : null}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {enabledMethods.length > 1 ? (
              <Button
                size="sm"
                variant="outline"
                icon={Plus}
                onClick={() =>
                  setPayments((c) => {
                    const used = new Set(c.map((x) => x.method));
                    const next = enabledMethods.find((m) => !used.has(m.key)) ?? enabledMethods[0];
                    return [...c, { key: newKey(), method: next.key, amount: remaining > 0 ? remaining.toFixed(2) : "", reference: "" }];
                  })
                }
              >
                Pago mixto
              </Button>
            ) : null}
            {Math.abs(remaining) > 0.009 ? (
              <span className={cn("self-center text-sm font-medium", remaining > 0 ? "text-clay" : "text-ochre-dark")}>
                {remaining > 0 ? `Falta ${money(remaining)}` : `Excede ${money(-remaining)}`}
              </span>
            ) : null}
          </div>
          {cashAmount > 0 ? (
            <div className="grid grid-cols-2 items-end gap-3">
              <Field label="Efectivo recibido">
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  inputMode="decimal"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                  placeholder={cashAmount.toFixed(2)}
                />
              </Field>
              <div className="pb-2 text-right">
                <p className="text-xs text-muted">Vuelto</p>
                <p className="font-display text-xl font-semibold tabular-nums text-sage">{money(change)}</p>
              </div>
            </div>
          ) : null}
        </div>

        <Field label="Notas del ticket">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
        </Field>

        <Button
          size="lg"
          className="w-full"
          icon={METHOD_ICONS[payments[0]?.method ?? "cash"]}
          loading={charging}
          disabled={lines.length === 0}
          onClick={() => void handleCharge()}
        >
          Cobrar {money(due)}
        </Button>
      </div>
    </Card>
  );

  return (
    <div>
      <PageHeader
        title="Caja"
        description={`Caja abierta desde ${formatDateTime(register.opened_at)}${register.opened_by_staff ? ` · ${register.opened_by_staff.full_name}` : ""}`}
        actions={
          <>
            <Button variant="outline" icon={ReceiptIcon} onClick={() => setTicketsOpen(true)}>
              Ventas
            </Button>
            <Button variant="outline" icon={ArrowLeftRight} onClick={() => setMovementsOpen(true)}>
              Gastos y retiros
            </Button>
            <Button variant="outline" icon={Lock} onClick={() => setCloseOpen(true)}>
              Cerrar caja
            </Button>
          </>
        }
      />

      {enabledMethods.length === 0 ? (
        <Alert tone="clay" icon={Wallet} className="mb-4">
          No hay métodos de pago activos. Actívalos en Ajustes → Finanzas.
        </Alert>
      ) : null}

      <div className="mb-3 md:hidden">
        <Tabs
          value={mobilePane}
          onChange={setMobilePane}
          items={[
            { value: "catalog", label: "Catálogo", icon: Scissors },
            { value: "cart", label: `Venta · ${money(total)}`, icon: ShoppingBag, count: lines.length },
          ]}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_400px] xl:grid-cols-[1fr_440px]">
        <div className={cn(mobilePane === "catalog" ? "block" : "hidden", "md:block")}>{catalogPane}</div>
        <div className={cn(mobilePane === "cart" ? "block" : "hidden", "md:block")}>{cartPane}</div>
      </div>

      <CloseRegisterModal
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        register={register}
        onClosed={() => {
          setRegister(null);
          resetSale();
        }}
      />
      <CashMovementsModal open={movementsOpen} onClose={() => setMovementsOpen(false)} register={register} />
      <TicketsModal
        open={ticketsOpen}
        onClose={() => setTicketsOpen(false)}
        registerId={register.id}
        onChanged={() => void loadProducts()}
      />
      {receipt ? <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} /> : null}
    </div>
  );
}

function ReceiptModal({ receipt, onClose }: { receipt: ReceiptData; onClose: () => void }) {
  const { money, settings } = useApp();
  const toast = useToast();
  const [sending, setSending] = useState(false);

  async function sendSurvey() {
    if (!receipt.transactionId) return;
    // La ventana se abre antes de esperar a la red para que el navegador no la bloquee
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setSending(true);
    try {
      const token = await createVisitSurvey(receipt.transactionId);
      const name = receipt.clientName ? receipt.clientName.split(" ")[0] : "";
      const message = `Hola${name ? ` ${name}` : ""}, gracias por visitarnos en ${settings.business_name}. ¿Nos ayudas calificando tu atención? Toma 10 segundos: ${surveyUrl(token)}`;
      const url = buildWhatsAppUrl(receipt.clientPhone ?? null, message, settings.default_country_code);
      if (popup) popup.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      popup?.close();
      toast.error(getErrorMessage(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Cobro registrado"
      description={receipt.change > 0 ? `Entregar vuelto: ${money(receipt.change)}` : `Ticket #${receipt.ticketNumber}`}
      footer={
        <>
          {receipt.transactionId ? (
            <Button variant="outline" icon={Star} loading={sending} onClick={() => void sendSurvey()} className="mr-auto">
              Encuesta
            </Button>
          ) : null}
          <Button variant="outline" icon={Printer} onClick={() => window.print()}>
            Imprimir
          </Button>
          <Button onClick={onClose}>Nueva venta</Button>
        </>
      }
    >
      <Receipt data={receipt} />
    </Modal>
  );
}
