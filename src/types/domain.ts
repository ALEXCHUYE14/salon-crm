// Tipos de dominio alineados con supabase/migrations/001_schema_and_rls.sql

export type OperatingMode = "barbershop" | "beauty_salon" | "hybrid";
export type Segment = "barbershop" | "beauty_salon" | "both";
export type StaffRole = "owner" | "admin" | "receptionist" | "specialist";
export type ConfigurableRole = Exclude<StaffRole, "owner">;
export type Specialty = "barber" | "stylist" | "both" | "none";
export type CommissionType = "percentage" | "fixed";
export type Gender = "female" | "male" | "other" | "unspecified";

export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "waiting"
  | "in_service"
  | "completed"
  | "no_show"
  | "cancelled";

export type AppointmentSource = "walk_in" | "phone" | "whatsapp" | "online" | "app";
export type PaymentMethodKey = "cash" | "card" | "transfer" | "wallet";
/** Métodos que aparecen en pagos registrados (incluye adelantos aplicados). */
export type RecordedPaymentMethod = PaymentMethodKey | "deposit";
export type InventoryItemType = "retail" | "supply";
export type MovementType = "purchase" | "sale" | "usage" | "adjustment_in" | "adjustment_out" | "return";
export type TechnicalRecordType = "barber" | "color" | "hair_diagnosis" | "nails" | "skin" | "treatment";

export type ModuleKey =
  | "dashboard"
  | "agenda"
  | "clients"
  | "services"
  | "team"
  | "pos"
  | "inventory"
  | "loyalty"
  | "reports"
  | "settings";

export type ToggleableModule = Exclude<ModuleKey, "dashboard" | "settings">;
export type EnabledModules = Record<ToggleableModule, boolean>;
export type RolePermissions = Record<ConfigurableRole, ModuleKey[]>;

export interface BusinessHour {
  day: number;
  open: boolean;
  start: string;
  end: string;
}

export interface PaymentMethodConfig {
  key: PaymentMethodKey;
  label: string;
  enabled: boolean;
}

export interface MessageTemplate {
  key: string;
  name: string;
  body: string;
}

export interface BusinessSettings {
  id: string;
  business_name: string;
  slogan: string | null;
  tax_id: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  logo_url: string | null;
  operating_mode: OperatingMode;
  enabled_modules: EnabledModules;
  business_hours: BusinessHour[];
  timezone: string;
  currency_code: string;
  currency_symbol: string;
  locale: string;
  default_country_code: string;
  default_commission_type: CommissionType;
  default_commission_value: number;
  product_commission_rate: number;
  payment_methods: PaymentMethodConfig[];
  message_templates: MessageTemplate[];
  role_permissions: RolePermissions;
  slot_interval_minutes: number;
  inactive_client_days: number;
  online_booking_enabled: boolean;
  online_booking_days_ahead: number;
  online_booking_min_notice_minutes: number;
  online_booking_note: string | null;
  loyalty_points_enabled: boolean;
  loyalty_points_per_currency: number;
  loyalty_point_value: number;
  loyalty_min_redeem: number;
}

export interface Branch {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  is_main: boolean;
  is_active: boolean;
}

export interface WorkScheduleDay {
  day: number;
  start: string;
  end: string;
}

export interface StaffMember {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: StaffRole;
  specialty: Specialty;
  station_label: string | null;
  color: string;
  is_bookable: boolean;
  commission_type: CommissionType | null;
  commission_value: number | null;
  product_commission_rate: number | null;
  work_schedule: WorkScheduleDay[];
  avatar_url: string | null;
  is_active: boolean;
  branch_id: string | null;
}

export type StaffInput = Omit<StaffMember, "id" | "user_id" | "avatar_url" | "branch_id"> & { branch_id?: string | null };

export interface Client {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  gender: Gender;
  segment: Segment;
  notes: string | null;
  tags: string[];
  preferred_staff_id: string | null;
  marketing_opt_in: boolean;
  last_visit_at: string | null;
  visits_count: number;
  total_spent: number;
  loyalty_points: number;
  is_active: boolean;
  created_at: string;
}

export type PhotoKind = "before" | "after" | "other";

export interface ClientPhoto {
  id: string;
  client_id: string;
  path: string;
  kind: PhotoKind;
  caption: string | null;
  taken_on: string;
  created_by: string | null;
  created_at: string;
}

export interface LoyaltyLedgerEntry {
  id: string;
  kind: "earn" | "redeem" | "reverse" | "adjust";
  points: number;
  balance_after: number;
  description: string | null;
  created_at: string;
}

export type ClientInput = Pick<
  Client,
  "full_name" | "phone" | "email" | "birth_date" | "gender" | "segment" | "notes" | "tags" | "preferred_staff_id" | "marketing_opt_in"
>;

export interface ClientRef {
  id: string;
  full_name: string;
  phone: string | null;
}

export interface TechnicalRecord {
  id: string;
  client_id: string;
  staff_id: string | null;
  appointment_id: string | null;
  record_type: TechnicalRecordType;
  service_date: string;
  cut_style: string | null;
  fade_type: string | null;
  clipper_guards: string | null;
  beard_style: string | null;
  finish: string | null;
  color_formula: string | null;
  developer_volume: number | null;
  processing_minutes: number | null;
  hair_diagnosis: string | null;
  nails_diagnosis: string | null;
  skin_diagnosis: string | null;
  products_used: string | null;
  result_notes: string | null;
  created_at: string;
  staff: { id: string; full_name: string } | null;
}

export type TechnicalRecordInput = Omit<TechnicalRecord, "id" | "created_at" | "staff">;

export interface ServiceCategory {
  id: string;
  name: string;
  segment: Segment;
  sort_order: number;
  is_active: boolean;
}

export interface ComboItem {
  service_id: string;
  quantity: number;
}

export interface Service {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  segment: Segment;
  duration_minutes: number;
  processing_minutes: number;
  price: number;
  commission_type: CommissionType | null;
  commission_value: number | null;
  is_combo: boolean;
  is_active: boolean;
  online_bookable: boolean;
  sort_order: number;
  combo_items: ComboItem[];
}

export type ServiceInput = Omit<Service, "id" | "combo_items">;

/** Insumo que consume un servicio (receta). */
export interface ServiceSupply {
  item_id: string;
  quantity: number;
}

export interface Appointment {
  id: string;
  booking_id: string | null;
  branch_id?: string | null;
  client_id: string | null;
  walk_in_name: string | null;
  staff_id: string;
  service_id: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  processing_minutes: number;
  status: AppointmentStatus;
  price: number;
  source: AppointmentSource;
  notes: string | null;
  client: ClientRef | null;
  staff: { id: string; full_name: string; color: string } | null;
  service: { id: string; name: string } | null;
}

export interface AppointmentInput {
  booking_id?: string | null;
  client_id: string | null;
  walk_in_name: string | null;
  staff_id: string;
  service_id: string;
  starts_at: string;
  duration_minutes: number;
  processing_minutes: number;
  price: number;
  status: AppointmentStatus;
  source: AppointmentSource;
  notes: string | null;
}

export type TimeOffKind = "vacation" | "sick" | "break" | "personal" | "training" | "other";

export interface StaffTimeOff {
  id: string;
  staff_id: string;
  starts_at: string;
  ends_at: string;
  kind: TimeOffKind;
  reason: string | null;
}

export type StaffTimeOffInput = Omit<StaffTimeOff, "id">;

export type DepositStatus = "held" | "applied" | "refunded" | "forfeited";

export interface AppointmentDeposit {
  id: string;
  appointment_id: string;
  amount: number;
  method: PaymentMethodKey;
  reference: string | null;
  status: DepositStatus;
  received_at: string;
  resolved_at: string | null;
  notes: string | null;
}

export interface InventoryItem {
  id: string;
  sku: string | null;
  name: string;
  item_type: InventoryItemType;
  segment: Segment;
  brand: string | null;
  unit: string;
  stock: number;
  min_stock: number;
  is_low_stock: boolean;
  cost: number;
  price: number | null;
  supplier: string | null;
  is_active: boolean;
}

export type InventoryItemInput = Omit<InventoryItem, "id" | "stock" | "is_low_stock">;

export interface InventoryMovement {
  id: string;
  item_id: string;
  movement_type: MovementType;
  quantity: number;
  unit_cost: number | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
  item: { id: string; name: string; unit: string } | null;
}

export interface CashRegister {
  id: string;
  branch_id?: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_amount: number;
  expected_cash: number | null;
  counted_cash: number | null;
  difference: number | null;
  status: "open" | "closed";
  notes: string | null;
  opened_by_staff: { id: string; full_name: string } | null;
}

export interface RegisterSummary {
  register_id: string;
  opening_amount: number;
  transactions: number;
  voided: number;
  gross_total: number;
  tips: number;
  discounts: number;
  by_method: Partial<Record<RecordedPaymentMethod, number>>;
  cash_sales: number;
  advances_received: number;
  advances_cash_in: number;
  advances_cash_out: number;
  expenses: number;
  withdrawals: number;
  deposits: number;
  expected_cash: number;
}

export type CashMovementType = "expense" | "withdrawal" | "deposit";
export type CashMovementCategory =
  | "supplies"
  | "services"
  | "rent"
  | "salary_advance"
  | "commission_payout"
  | "cleaning"
  | "food"
  | "transport"
  | "maintenance"
  | "owner"
  | "change_fund"
  | "other";

export interface CashMovement {
  id: string;
  cash_register_id: string;
  movement_type: CashMovementType;
  category: CashMovementCategory;
  amount: number;
  description: string;
  created_at: string;
  created_by_staff: { id: string; full_name: string } | null;
}

export interface CashMovementInput {
  cash_register_id: string;
  movement_type: CashMovementType;
  category: CashMovementCategory;
  amount: number;
  description: string;
}

export interface CashMovementReportRow {
  movement_type: CashMovementType;
  category: CashMovementCategory;
  amount: number;
  movements: number;
}

export interface TransactionItemRow {
  id: string;
  item_kind: "service" | "product";
  description: string;
  quantity: number;
  unit_price: number;
  discount: number;
  line_total: number;
  staff_id: string | null;
}

export interface TransactionRow {
  id: string;
  ticket_number: number;
  subtotal: number;
  discount_amount: number;
  tip_amount: number;
  total: number;
  cash_received: number | null;
  change_given: number;
  status: "completed" | "voided";
  void_reason: string | null;
  created_at: string;
  client: ClientRef | null;
  items: TransactionItemRow[];
  payments: { method: RecordedPaymentMethod; amount: number }[];
}

export interface SaleLineInput {
  item_kind: "service" | "product" | "plan";
  service_id: string | null;
  inventory_item_id: string | null;
  plan_id?: string | null;
  /** Sesión de paquete con la que se paga este servicio. */
  prepaid_id?: string | null;
  staff_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount: number;
}

export interface SalePayload {
  client_id: string | null;
  appointment_id: string | null;
  appointment_ids: string[];
  deposit_ids: string[];
  points_redeemed: number;
  branch_id?: string | null;
  gift_card_code: string | null;
  gift_card_amount: number;
  discount_amount: number;
  tip_amount: number;
  tip_staff_id: string | null;
  cash_received: number | null;
  notes: string | null;
  items: SaleLineInput[];
  payments: { method: PaymentMethodKey; amount: number; reference: string | null }[];
}

export interface SaleResult {
  id: string;
  ticket_number: number;
  total: number;
  change: number;
  points_earned?: number;
  points_redeemed?: number;
  points_balance?: number | null;
  gift_card_amount?: number;
  gift_card_balance?: number | null;
  prepaids?: { name: string; code: string; kind: PrepaidKind; expires_at: string | null; sessions: number; credit: number }[];
}

export type PrepaidKind = "package" | "gift_card";

export interface PrepaidPlan {
  id: string;
  name: string;
  kind: PrepaidKind;
  service_id: string | null;
  sessions: number | null;
  credit: number | null;
  price: number;
  validity_days: number | null;
  is_active: boolean;
}

export type PrepaidPlanInput = Omit<PrepaidPlan, "id">;

export interface ClientPrepaid {
  id: string;
  code: string;
  client_id: string;
  kind: PrepaidKind;
  name: string;
  service_id: string | null;
  sessions_total: number;
  sessions_used: number;
  initial_credit: number;
  balance: number;
  expires_at: string | null;
  status: "active" | "cancelled";
  created_at: string;
  client: ClientRef | null;
}

export interface CommissionSummaryRow {
  staff_id: string;
  full_name: string;
  role: StaffRole;
  items_count: number;
  base_amount: number;
  commission_total: number;
  commission_pending: number;
  tips_total: number;
  tips_pending: number;
}

export interface CommissionPayout {
  id: string;
  staff_id: string;
  period_start: string;
  period_end: string;
  commission_amount: number;
  tips_amount: number;
  total_amount: number;
  items_count: number;
  notes: string | null;
  paid_at: string;
  staff: { id: string; full_name: string } | null;
}

export interface DashboardData {
  date: string;
  revenue: number;
  tips: number;
  transactions: number;
  commissions: number;
  appointments: Partial<Record<AppointmentStatus, number>>;
  low_stock_count: number;
  low_stock: { id: string; name: string; stock: number; min_stock: number; unit: string; item_type: InventoryItemType }[];
}

export interface RevenueByDayRow {
  day: string;
  revenue: number;
  tips: number;
  tx_count: number;
}

export interface StaffPerformanceRow {
  staff_id: string;
  full_name: string;
  services_count: number;
  services_revenue: number;
  products_revenue: number;
  commission: number;
  tips: number;
}

export interface TopServiceRow {
  service_id: string | null;
  service_name: string;
  quantity: number;
  revenue: number;
}

export interface PaymentMethodRow {
  method: RecordedPaymentMethod;
  amount: number;
  payments: number;
}
