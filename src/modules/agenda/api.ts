import { getSupabase, unwrap } from "@/lib/supabase/client";
import type {
  Appointment,
  AppointmentDeposit,
  AppointmentInput,
  AppointmentStatus,
  PaymentMethodKey,
  StaffTimeOff,
  StaffTimeOffInput,
} from "@/types/domain";

export const APPOINTMENT_COLUMNS =
  "id,booking_id,branch_id,client_id,walk_in_name,staff_id,service_id,starts_at,ends_at,duration_minutes,processing_minutes,status,price,source,notes," +
  "client:clients!appointments_client_fk(id,full_name,phone)," +
  "staff:staff_members!appointments_staff_fk(id,full_name,color)," +
  "service:services!appointments_service_fk(id,name)";

export async function listAppointments(fromIso: string, toIso: string, staffId?: string, branchId?: string | null): Promise<Appointment[]> {
  let query = getSupabase()
    .from("appointments")
    .select(APPOINTMENT_COLUMNS)
    .gte("starts_at", fromIso)
    .lt("starts_at", toIso)
    .order("starts_at")
    .limit(500);
  if (staffId) query = query.eq("staff_id", staffId);
  if (branchId) query = query.eq("branch_id", branchId);
  return unwrap<Appointment[]>(await query);
}

export async function getAppointment(id: string): Promise<Appointment> {
  return unwrap<Appointment>(await getSupabase().from("appointments").select(APPOINTMENT_COLUMNS).eq("id", id).single());
}

/** Citas del profesional que se cruzan con el rango [start, end). */
export async function findConflicts(staffId: string, startIso: string, endIso: string, excludeId?: string): Promise<Appointment[]> {
  let query = getSupabase()
    .from("appointments")
    .select(APPOINTMENT_COLUMNS)
    .eq("staff_id", staffId)
    .lt("starts_at", endIso)
    .gt("ends_at", startIso)
    .not("status", "in", "(cancelled,no_show)")
    .limit(5);
  if (excludeId) query = query.neq("id", excludeId);
  return unwrap<Appointment[]>(await query);
}

export async function saveAppointment(input: AppointmentInput, id?: string): Promise<Appointment> {
  const supabase = getSupabase();
  const result = id
    ? await supabase.from("appointments").update(input).eq("id", id).select(APPOINTMENT_COLUMNS).single()
    : await supabase.from("appointments").insert(input).select(APPOINTMENT_COLUMNS).single();
  return unwrap<Appointment>(result);
}

export async function updateAppointmentStatus(id: string | string[], status: AppointmentStatus, cancellationReason?: string): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === "cancelled") patch.cancellation_reason = cancellationReason ?? null;
  const ids = Array.isArray(id) ? id : [id];
  if (ids.length === 0) return;
  const { error } = await getSupabase().from("appointments").update(patch).in("id", ids);
  if (error) throw error;
}

/** Crea varias citas en un solo INSERT (atómico: si una falla, no se guarda ninguna). */
export async function createAppointments(inputs: AppointmentInput[]): Promise<void> {
  if (inputs.length === 0) return;
  const { error } = await getSupabase().from("appointments").insert(inputs);
  if (error) throw error;
}

/** Todas las citas de una reserva con varios servicios. */
export async function listBookingAppointments(bookingId: string): Promise<Appointment[]> {
  const result = await getSupabase().from("appointments").select(APPOINTMENT_COLUMNS).eq("booking_id", bookingId).order("starts_at").limit(20);
  return unwrap<Appointment[]>(result);
}

/**
 * Suscripción Realtime limitada por fecha (filtro en servidor) para reducir egress.
 * Devuelve la función para cancelar la suscripción.
 */
export function subscribeToAppointments(fromIso: string, onChange: () => void, options: { timeOff?: boolean } = {}): () => void {
  const supabase = getSupabase();
  // Con la pestaña oculta no se recarga: se marca pendiente y se actualiza una vez al volver
  let pending = false;
  const notify = () => {
    if (typeof document !== "undefined" && document.hidden) {
      pending = true;
      return;
    }
    onChange();
  };
  const onVisible = () => {
    if (!document.hidden && pending) {
      pending = false;
      onChange();
    }
  };
  document.addEventListener("visibilitychange", onVisible);

  const channel = supabase
    .channel(`appointments-${fromIso}${options.timeOff ? "-agenda" : ""}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `starts_at=gte.${fromIso}` }, notify);
  // Bloqueos: solo en la agenda y solo los que terminan después del inicio del rango (menos mensajes de Realtime)
  if (options.timeOff) {
    channel.on("postgres_changes", { event: "*", schema: "public", table: "staff_time_off", filter: `ends_at=gte.${fromIso}` }, notify);
  }
  channel.subscribe();
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    void supabase.removeChannel(channel);
  };
}

/* ---------------------------------------------------------------------------
 * Bloqueos y ausencias del personal
 * ------------------------------------------------------------------------- */

const TIME_OFF_COLUMNS = "id,staff_id,starts_at,ends_at,kind,reason";

/** Bloqueos que se cruzan con [fromIso, toIso). */
export async function listTimeOff(fromIso: string, toIso: string, staffId?: string): Promise<StaffTimeOff[]> {
  let query = getSupabase()
    .from("staff_time_off")
    .select(TIME_OFF_COLUMNS)
    .lt("starts_at", toIso)
    .gt("ends_at", fromIso)
    .order("starts_at")
    .limit(500);
  if (staffId) query = query.eq("staff_id", staffId);
  return unwrap<StaffTimeOff[]>(await query);
}

export async function createTimeOff(inputs: StaffTimeOffInput[]): Promise<void> {
  if (inputs.length === 0) return;
  const { error } = await getSupabase().from("staff_time_off").insert(inputs);
  if (error) throw error;
}

export async function updateTimeOff(id: string, input: StaffTimeOffInput): Promise<void> {
  const { error } = await getSupabase().from("staff_time_off").update(input).eq("id", id);
  if (error) throw error;
}

export async function deleteTimeOff(id: string): Promise<void> {
  const { error } = await getSupabase().from("staff_time_off").delete().eq("id", id);
  if (error) throw error;
}

/** Citas activas de un profesional que se cruzan con alguno de los rangos dados. */
export async function findAppointmentsInRanges(staffId: string, ranges: { start: string; end: string }[]): Promise<Appointment[]> {
  if (ranges.length === 0) return [];
  // Comparación numérica: la BD devuelve "+00:00" y toISOString() "Z", no son comparables como texto
  const spans = ranges.map((r) => ({ start: Date.parse(r.start), end: Date.parse(r.end) }));
  const from = new Date(Math.min(...spans.map((r) => r.start))).toISOString();
  const to = new Date(Math.max(...spans.map((r) => r.end))).toISOString();
  const rows = unwrap<Appointment[]>(
    await getSupabase()
      .from("appointments")
      .select(APPOINTMENT_COLUMNS)
      .eq("staff_id", staffId)
      .lt("starts_at", to)
      .gt("ends_at", from)
      .not("status", "in", "(cancelled,no_show,completed)")
      .order("starts_at")
      .limit(200),
  );
  return rows.filter((a) => {
    const start = Date.parse(a.starts_at);
    const end = Date.parse(a.ends_at);
    return spans.some((r) => start < r.end && end > r.start);
  });
}

/* ---------------------------------------------------------------------------
 * Adelantos e inasistencias
 * ------------------------------------------------------------------------- */

const DEPOSIT_COLUMNS = "id,appointment_id,amount,method,reference,status,received_at,resolved_at,notes";

export async function listAppointmentDeposits(appointmentIds: string[]): Promise<AppointmentDeposit[]> {
  if (appointmentIds.length === 0) return [];
  const rows = unwrap<AppointmentDeposit[]>(
    await getSupabase().from("appointment_deposits").select(DEPOSIT_COLUMNS).in("appointment_id", appointmentIds).order("received_at"),
  );
  return rows.map((d) => ({ ...d, amount: Number(d.amount) }));
}

export async function recordDeposit(appointmentId: string, amount: number, method: PaymentMethodKey, reference: string | null): Promise<void> {
  const { error } = await getSupabase().rpc("record_deposit", {
    p_appointment_id: appointmentId,
    p_amount: amount,
    p_method: method,
    p_reference: reference,
  });
  if (error) throw error;
}

export async function resolveDeposit(depositId: string, action: "refund" | "forfeit", notes: string | null): Promise<void> {
  const { error } = await getSupabase().rpc("resolve_deposit", { p_deposit_id: depositId, p_action: action, p_notes: notes });
  if (error) throw error;
}

export async function fetchClientNoShows(clientId: string): Promise<number> {
  return Number(unwrap<number>(await getSupabase().rpc("client_no_show_count", { p_client_id: clientId })) ?? 0);
}
