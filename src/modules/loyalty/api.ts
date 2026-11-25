import { subDays } from "date-fns";
import { getSupabase, unwrap } from "@/lib/supabase/client";
import { APPOINTMENT_COLUMNS } from "@/modules/agenda/api";
import type { Appointment, Client } from "@/types/domain";

const LOYALTY_COLUMNS =
  "id,full_name,phone,email,birth_date,gender,segment,notes,tags,preferred_staff_id,marketing_opt_in,last_visit_at,visits_count,total_spent,loyalty_points,is_active,created_at";

export async function listInactiveClients(days: number, page: number, pageSize: number): Promise<{ rows: Client[]; count: number }> {
  const cutoff = subDays(new Date(), days).toISOString();
  const from = (page - 1) * pageSize;
  const { data, error, count } = await getSupabase()
    .from("clients")
    .select(LOYALTY_COLUMNS, { count: "exact" })
    .eq("is_active", true)
    .lt("last_visit_at", cutoff)
    .order("last_visit_at", { ascending: true })
    .range(from, from + pageSize - 1);
  if (error) throw error;
  return { rows: (data ?? []) as unknown as Client[], count: count ?? 0 };
}

export async function listBirthdays(month: number): Promise<Client[]> {
  const result = await getSupabase()
    .from("clients")
    .select(LOYALTY_COLUMNS)
    .eq("is_active", true)
    .eq("birth_month", month)
    .order("birth_date")
    .limit(200);
  const rows = unwrap<Client[]>(result);
  return rows.sort((a, b) => Number(a.birth_date?.slice(8, 10)) - Number(b.birth_date?.slice(8, 10)));
}

export async function listUpcomingAppointments(fromIso: string, toIso: string): Promise<Appointment[]> {
  const result = await getSupabase()
    .from("appointments")
    .select(APPOINTMENT_COLUMNS)
    .gte("starts_at", fromIso)
    .lt("starts_at", toIso)
    .in("status", ["scheduled", "confirmed"])
    .order("starts_at")
    .limit(200);
  return unwrap<Appointment[]>(result);
}
