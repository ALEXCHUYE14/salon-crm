import { invalidateCatalog } from "@/lib/catalog-cache";
import { getSupabase, unwrap } from "@/lib/supabase/client";
import type { CommissionPayout, CommissionSummaryRow, StaffInput, StaffMember } from "@/types/domain";

export const STAFF_COLUMNS =
  "id,user_id,full_name,email,phone,role,specialty,station_label,color,is_bookable,commission_type,commission_value," +
  "product_commission_rate,work_schedule,avatar_url,is_active,branch_id";

export async function fetchCurrentStaff(): Promise<{ staff: StaffMember | null; email: string | null }> {
  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { staff: null, email: null };
  const result = await supabase.from("staff_members").select(STAFF_COLUMNS).eq("user_id", user.id).eq("is_active", true).maybeSingle();
  return { staff: unwrap<StaffMember | null>(result), email: user.email ?? null };
}

export async function listStaff(options: { activeOnly?: boolean; bookableOnly?: boolean } = {}): Promise<StaffMember[]> {
  let query = getSupabase().from("staff_members").select(STAFF_COLUMNS).order("full_name");
  if (options.activeOnly) query = query.eq("is_active", true);
  if (options.bookableOnly) query = query.eq("is_bookable", true);
  return unwrap<StaffMember[]>(await query);
}

export async function saveStaff(input: StaffInput, id?: string): Promise<StaffMember> {
  const supabase = getSupabase();
  const payload = { ...input, email: input.email ? input.email.trim().toLowerCase() : null };
  try {
    const result = id
      ? await supabase.from("staff_members").update(payload).eq("id", id).select(STAFF_COLUMNS).single()
      : await supabase.from("staff_members").insert(payload).select(STAFF_COLUMNS).single();
    return unwrap<StaffMember>(result);
  } finally {
    invalidateCatalog();
  }
}

export async function fetchCommissionSummary(from: string, to: string): Promise<CommissionSummaryRow[]> {
  const result = await getSupabase().rpc("commission_summary", { p_from: from, p_to: to });
  return unwrap<CommissionSummaryRow[]>(result).map((r) => ({
    ...r,
    items_count: Number(r.items_count),
    base_amount: Number(r.base_amount),
    commission_total: Number(r.commission_total),
    commission_pending: Number(r.commission_pending),
    tips_total: Number(r.tips_total),
    tips_pending: Number(r.tips_pending),
  }));
}

export async function settleCommissions(staffId: string, from: string, to: string, notes: string | null): Promise<string> {
  const result = await getSupabase().rpc("settle_commissions", {
    p_staff_id: staffId,
    p_from: from,
    p_to: to,
    p_notes: notes,
  });
  return unwrap<string>(result);
}

export async function listPayouts(limit = 30): Promise<CommissionPayout[]> {
  const result = await getSupabase()
    .from("commission_payouts")
    .select(
      "id,staff_id,period_start,period_end,commission_amount,tips_amount,total_amount,items_count,notes,paid_at," +
        "staff:staff_members!commission_payouts_staff_fk(id,full_name)",
    )
    .order("paid_at", { ascending: false })
    .limit(limit);
  return unwrap<CommissionPayout[]>(result);
}
