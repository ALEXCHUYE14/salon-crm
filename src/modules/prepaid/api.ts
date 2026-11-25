import { getSupabase, unwrap } from "@/lib/supabase/client";
import type { ClientPrepaid, PrepaidPlan, PrepaidPlanInput } from "@/types/domain";

const PLAN_COLUMNS = "id,name,kind,service_id,sessions,credit,price,validity_days,is_active";
const PREPAID_COLUMNS =
  "id,code,client_id,kind,name,service_id,sessions_total,sessions_used,initial_credit,balance,expires_at,status,created_at," +
  "client:clients!client_prepaids_client_fk(id,full_name,phone)";

function normalizePlan(p: PrepaidPlan): PrepaidPlan {
  return { ...p, price: Number(p.price), credit: p.credit === null ? null : Number(p.credit) };
}

function normalizePrepaid(p: ClientPrepaid): ClientPrepaid {
  return { ...p, initial_credit: Number(p.initial_credit), balance: Number(p.balance) };
}

export async function listPlans(options: { activeOnly?: boolean } = {}): Promise<PrepaidPlan[]> {
  let query = getSupabase().from("prepaid_plans").select(PLAN_COLUMNS).order("kind").order("name");
  if (options.activeOnly) query = query.eq("is_active", true);
  return unwrap<PrepaidPlan[]>(await query).map(normalizePlan);
}

export async function savePlan(input: PrepaidPlanInput, id?: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = id ? await supabase.from("prepaid_plans").update(input).eq("id", id) : await supabase.from("prepaid_plans").insert(input);
  if (error) throw error;
}

/** Paquetes y gift cards vigentes de un cliente. */
export async function listClientPrepaids(clientId: string): Promise<ClientPrepaid[]> {
  const rows = unwrap<ClientPrepaid[]>(
    await getSupabase()
      .from("client_prepaids")
      .select(PREPAID_COLUMNS)
      .eq("client_id", clientId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(50),
  );
  return rows.map(normalizePrepaid);
}

export async function findPrepaidByCode(code: string): Promise<ClientPrepaid | null> {
  const clean = code.trim().toUpperCase().replace(/[^0-9A-F]/g, "");
  if (clean.length < 6) return null;
  const row = unwrap<ClientPrepaid | null>(await getSupabase().from("client_prepaids").select(PREPAID_COLUMNS).eq("code", clean).maybeSingle());
  return row ? normalizePrepaid(row) : null;
}

/** Vigente = activo, no vencido y con saldo o sesiones disponibles. */
export function isUsable(p: ClientPrepaid): boolean {
  if (p.status !== "active") return false;
  if (p.expires_at && Date.parse(p.expires_at) < Date.now()) return false;
  return p.kind === "package" ? p.sessions_used < p.sessions_total : p.balance > 0;
}
