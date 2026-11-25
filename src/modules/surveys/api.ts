import { getSupabase, unwrap } from "@/lib/supabase/client";

export interface PublicSurvey {
  found: boolean;
  business_name?: string;
  logo_url?: string | null;
  client_name?: string | null;
  staff_name?: string | null;
  services?: string[];
  answered?: boolean;
  expired?: boolean;
}

export interface SurveySummaryRow {
  staff_id: string | null;
  full_name: string;
  responses: number;
  average: number;
  promoters: number;
  detractors: number;
}

export interface SurveyComment {
  id: string;
  rating: number;
  comment: string | null;
  answered_at: string;
  staff: { id: string; full_name: string } | null;
}

/** Crea (o reutiliza) el enlace de encuesta de un ticket y devuelve el token. */
export async function createVisitSurvey(transactionId: string): Promise<string> {
  return unwrap<string>(await getSupabase().rpc("create_visit_survey", { p_transaction_id: transactionId }));
}

export function surveyUrl(token: string): string {
  return `${window.location.origin}/encuesta/${token}`;
}

export async function fetchPublicSurvey(token: string): Promise<PublicSurvey> {
  return unwrap<PublicSurvey>(await getSupabase().rpc("public_get_survey", { p_token: token }));
}

export async function submitSurvey(token: string, rating: number, comment: string | null): Promise<void> {
  const { error } = await getSupabase().rpc("public_submit_survey", { p_token: token, p_rating: rating, p_comment: comment });
  if (error) throw error;
}

export async function fetchSurveySummary(from: string, to: string): Promise<SurveySummaryRow[]> {
  const rows = unwrap<SurveySummaryRow[]>(await getSupabase().rpc("report_survey_summary", { p_from: from, p_to: to }));
  return rows.map((r) => ({
    ...r,
    responses: Number(r.responses),
    average: Number(r.average),
    promoters: Number(r.promoters),
    detractors: Number(r.detractors),
  }));
}

export async function listSurveyComments(fromIso: string, toIso: string, limit = 8): Promise<SurveyComment[]> {
  return unwrap<SurveyComment[]>(
    await getSupabase()
      .from("visit_surveys")
      .select("id,rating,comment,answered_at,staff:staff_members!visit_surveys_staff_fk(id,full_name)")
      .not("comment", "is", null)
      .gte("answered_at", fromIso)
      .lt("answered_at", toIso)
      .order("answered_at", { ascending: false })
      .limit(limit),
  );
}
