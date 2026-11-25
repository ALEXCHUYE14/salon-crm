import type {
  AppointmentSource,
  CashMovementCategory,
  CashMovementType,
  AppointmentStatus,
  ConfigurableRole,
  Gender,
  InventoryItemType,
  ModuleKey,
  MovementType,
  DepositStatus,
  PaymentMethodKey,
  RecordedPaymentMethod,
  Segment,
  Specialty,
  StaffRole,
  TechnicalRecordType,
  TimeOffKind,
  ToggleableModule,
} from "@/types/domain";

export type Tone = "neutral" | "sage" | "clay" | "ochre" | "ink" | "outline";

export const APPOINTMENT_STATUS: Record<AppointmentStatus, { label: string; tone: Tone }> = {
  scheduled: { label: "Programada", tone: "outline" },
  confirmed: { label: "Confirmada", tone: "sage" },
  waiting: { label: "En espera", tone: "ochre" },
  in_service: { label: "En atención", tone: "ink" },
  completed: { label: "Completada", tone: "neutral" },
  no_show: { label: "No asistió", tone: "clay" },
  cancelled: { label: "Cancelada", tone: "clay" },
};

export const APPOINTMENT_STATUS_ORDER: AppointmentStatus[] = [
  "scheduled",
  "confirmed",
  "waiting",
  "in_service",
  "completed",
  "no_show",
  "cancelled",
];

export const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = ["scheduled", "confirmed", "waiting", "in_service", "completed"];

export const TIME_OFF_LABELS: Record<TimeOffKind, string> = {
  vacation: "Vacaciones",
  sick: "Descanso médico",
  break: "Refrigerio",
  personal: "Asunto personal",
  training: "Capacitación",
  other: "Otro",
};

export const APPOINTMENT_SOURCES: Record<AppointmentSource, string> = {
  walk_in: "Presencial",
  phone: "Teléfono",
  whatsapp: "WhatsApp",
  online: "Web",
  app: "App",
};

export const PAYMENT_METHOD_LABELS: Record<RecordedPaymentMethod, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  wallet: "Billetera digital",
  deposit: "Adelanto aplicado",
};

/** Métodos con los que se puede pagar o dejar un adelanto. */
export const PAYABLE_METHODS: PaymentMethodKey[] = ["cash", "card", "transfer", "wallet"];

export const DEPOSIT_STATUS: Record<DepositStatus, { label: string; tone: Tone }> = {
  held: { label: "Disponible", tone: "sage" },
  applied: { label: "Aplicado", tone: "neutral" },
  refunded: { label: "Devuelto", tone: "outline" },
  forfeited: { label: "Retenido", tone: "ochre" },
};

export const CASH_MOVEMENT_LABELS: Record<CashMovementType, { label: string; direction: "in" | "out" }> = {
  expense: { label: "Gasto", direction: "out" },
  withdrawal: { label: "Retiro", direction: "out" },
  deposit: { label: "Ingreso", direction: "in" },
};

export const CASH_CATEGORY_LABELS: Record<CashMovementCategory, string> = {
  supplies: "Insumos y productos",
  services: "Servicios (luz, agua, internet)",
  rent: "Alquiler",
  salary_advance: "Adelanto al personal",
  commission_payout: "Pago de comisiones",
  cleaning: "Limpieza",
  food: "Alimentación",
  transport: "Movilidad",
  maintenance: "Mantenimiento",
  owner: "Propietario",
  change_fund: "Fondo para cambio",
  other: "Otro",
};

/** Categorías válidas por tipo (la BD normaliza cualquier otra a "other"). */
export const CASH_CATEGORIES_BY_TYPE: Record<CashMovementType, CashMovementCategory[]> = {
  expense: ["supplies", "services", "rent", "salary_advance", "commission_payout", "cleaning", "food", "transport", "maintenance", "other"],
  withdrawal: ["owner", "other"],
  deposit: ["change_fund", "owner", "other"],
};

export const ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Propietario",
  admin: "Administrador",
  receptionist: "Recepción",
  specialist: "Especialista",
};

export const CONFIGURABLE_ROLES: ConfigurableRole[] = ["admin", "receptionist", "specialist"];

export const SPECIALTY_LABELS: Record<Specialty, string> = {
  barber: "Barbería",
  stylist: "Estilismo",
  both: "Barbería y estilismo",
  none: "Sin atención directa",
};

export const SEGMENT_LABELS: Record<Segment, string> = {
  barbershop: "Barbería",
  beauty_salon: "Salón de belleza",
  both: "Ambos",
};

export const GENDER_LABELS: Record<Gender, string> = {
  female: "Femenino",
  male: "Masculino",
  other: "Otro",
  unspecified: "Sin especificar",
};

export const ITEM_TYPE_LABELS: Record<InventoryItemType, string> = {
  retail: "Reventa",
  supply: "Insumo técnico",
};

export const MOVEMENT_LABELS: Record<MovementType, { label: string; direction: "in" | "out" }> = {
  purchase: { label: "Compra / entrada", direction: "in" },
  sale: { label: "Venta", direction: "out" },
  usage: { label: "Uso interno", direction: "out" },
  adjustment_in: { label: "Ajuste positivo", direction: "in" },
  adjustment_out: { label: "Ajuste negativo / merma", direction: "out" },
  return: { label: "Devolución", direction: "in" },
};

export const RECORD_TYPE_LABELS: Record<TechnicalRecordType, string> = {
  barber: "Corte y barba",
  color: "Colorimetría",
  hair_diagnosis: "Diagnóstico capilar",
  nails: "Uñas",
  skin: "Piel",
  treatment: "Tratamiento",
};

export const MODULE_LABELS: Record<ModuleKey, string> = {
  dashboard: "Inicio",
  agenda: "Agenda",
  clients: "Clientes",
  services: "Servicios",
  team: "Equipo",
  pos: "Caja / POS",
  inventory: "Inventario",
  loyalty: "Fidelización",
  reports: "Reportes",
  settings: "Ajustes",
};

export const TOGGLEABLE_MODULES: ToggleableModule[] = [
  "agenda",
  "clients",
  "services",
  "team",
  "pos",
  "inventory",
  "loyalty",
  "reports",
];

export const ALL_MODULES: ModuleKey[] = ["dashboard", ...TOGGLEABLE_MODULES, "settings"];

export const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
export const WEEKDAYS_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export const STAFF_COLORS = ["#3F5E4D", "#6B7F5E", "#A85A3A", "#9A6B26", "#5C5852", "#4A6670", "#7A5C6E", "#1C1B19"];

export const TEMPLATE_VARIABLES = ["cliente", "negocio", "fecha", "hora", "servicio", "profesional", "dias"] as const;

export const PAGE_SIZE = 20;
