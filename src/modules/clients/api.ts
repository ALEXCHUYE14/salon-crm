import { getSupabase, unwrap } from "@/lib/supabase/client";
import { sanitizeSearch, uuidv4 } from "@/lib/utils";
import type {
  Appointment,
  Client,
  ClientInput,
  ClientPhoto,
  ClientRef,
  PhotoKind,
  LoyaltyLedgerEntry,
  Segment,
  TechnicalRecord,
  TechnicalRecordInput,
  TransactionRow,
} from "@/types/domain";

export const CLIENT_COLUMNS =
  "id,full_name,phone,email,birth_date,gender,segment,notes,tags,preferred_staff_id,marketing_opt_in,last_visit_at,visits_count,total_spent,loyalty_points,is_active,created_at";

const RECORD_COLUMNS =
  "id,client_id,staff_id,appointment_id,record_type,service_date,cut_style,fade_type,clipper_guards,beard_style,finish," +
  "color_formula,developer_volume,processing_minutes,hair_diagnosis,nails_diagnosis,skin_diagnosis,products_used,result_notes,created_at," +
  "staff:staff_members!technical_records_staff_fk(id,full_name)";

export interface ClientListParams {
  search?: string;
  segment?: Segment | "all";
  page: number;
  pageSize: number;
}

export async function listClients({ search, segment, page, pageSize }: ClientListParams): Promise<{ rows: Client[]; count: number }> {
  const from = (page - 1) * pageSize;
  let query = getSupabase()
    .from("clients")
    .select(CLIENT_COLUMNS, { count: "exact" })
    .eq("is_active", true)
    .order("full_name")
    .range(from, from + pageSize - 1);

  const term = sanitizeSearch(search ?? "");
  if (term) query = query.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`);
  if (segment && segment !== "all") query = query.in("segment", [segment, "both"]);

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as Client[], count: count ?? 0 };
}

export async function searchClients(term: string, limit = 8): Promise<ClientRef[]> {
  const clean = sanitizeSearch(term);
  if (clean.length < 2) return [];
  const result = await getSupabase()
    .from("clients")
    .select("id,full_name,phone")
    .eq("is_active", true)
    .or(`full_name.ilike.%${clean}%,phone.ilike.%${clean}%`)
    .order("full_name")
    .limit(limit);
  return unwrap<ClientRef[]>(result);
}

export async function getClient(id: string): Promise<Client> {
  return unwrap<Client>(await getSupabase().from("clients").select(CLIENT_COLUMNS).eq("id", id).single());
}

export async function saveClient(input: ClientInput, id?: string): Promise<Client> {
  const supabase = getSupabase();
  const result = id
    ? await supabase.from("clients").update(input).eq("id", id).select(CLIENT_COLUMNS).single()
    : await supabase.from("clients").insert(input).select(CLIENT_COLUMNS).single();
  return unwrap<Client>(result);
}

export async function archiveClient(id: string): Promise<void> {
  const { error } = await getSupabase().from("clients").update({ is_active: false }).eq("id", id);
  if (error) throw error;
}

export async function listTechnicalRecords(clientId: string): Promise<TechnicalRecord[]> {
  const result = await getSupabase()
    .from("client_technical_records")
    .select(RECORD_COLUMNS)
    .eq("client_id", clientId)
    .order("service_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);
  return unwrap<TechnicalRecord[]>(result);
}

export async function saveTechnicalRecord(input: TechnicalRecordInput, id?: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = id
    ? await supabase.from("client_technical_records").update(input).eq("id", id)
    : await supabase.from("client_technical_records").insert(input);
  if (error) throw error;
}

export async function deleteTechnicalRecord(id: string): Promise<void> {
  const { error } = await getSupabase().from("client_technical_records").delete().eq("id", id);
  if (error) throw error;
}

export async function listClientAppointments(clientId: string, limit = 20): Promise<Appointment[]> {
  const result = await getSupabase()
    .from("appointments")
    .select(
      "id,booking_id,branch_id,client_id,walk_in_name,staff_id,service_id,starts_at,ends_at,duration_minutes,processing_minutes,status,price,source,notes," +
        "client:clients!appointments_client_fk(id,full_name,phone)," +
        "staff:staff_members!appointments_staff_fk(id,full_name,color)," +
        "service:services!appointments_service_fk(id,name)",
    )
    .eq("client_id", clientId)
    .order("starts_at", { ascending: false })
    .limit(limit);
  return unwrap<Appointment[]>(result);
}

export async function listClientTransactions(clientId: string, limit = 20): Promise<TransactionRow[]> {
  const result = await getSupabase()
    .from("transactions")
    .select(
      "id,ticket_number,subtotal,discount_amount,tip_amount,total,cash_received,change_given,status,void_reason,created_at," +
        "client:clients!transactions_client_fk(id,full_name,phone)," +
        "items:transaction_items(id,item_kind,description,quantity,unit_price,discount,line_total,staff_id)," +
        "payments:transaction_payments(method,amount)",
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return unwrap<TransactionRow[]>(result);
}

export async function listLoyaltyLedger(clientId: string, limit = 15): Promise<LoyaltyLedgerEntry[]> {
  const result = await getSupabase()
    .from("loyalty_ledger")
    .select("id,kind,points,balance_after,description,created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return unwrap<LoyaltyLedgerEntry[]>(result);
}

export async function adjustLoyaltyPoints(clientId: string, points: number, reason: string): Promise<number> {
  return Number(unwrap<number>(await getSupabase().rpc("adjust_loyalty_points", { p_client_id: clientId, p_points: points, p_reason: reason })));
}

/* ---------------------------------------------------------------------------
 * Fotos de antes y después (bucket privado "client-photos")
 * ------------------------------------------------------------------------- */

const PHOTO_BUCKET = "client-photos";

export async function listClientPhotos(clientId: string): Promise<ClientPhoto[]> {
  return unwrap<ClientPhoto[]>(
    await getSupabase()
      .from("client_photos")
      .select("id,client_id,path,kind,caption,taken_on,created_by,created_at")
      .eq("client_id", clientId)
      .order("taken_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(120),
  );
}

/**
 * URLs firmadas (1 hora) indexadas por ruta. Se reutilizan durante 50 minutos: misma URL =
 * el navegador usa su caché y no vuelve a descargar la imagen (menos egress de Storage).
 */
const SIGNED_TTL_S = 3600;
const SIGNED_REUSE_MS = 50 * 60_000;
const signedCache = new Map<string, { url: string; at: number }>();

export async function signPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const map: Record<string, string> = {};
  const missing: string[] = [];
  for (const path of paths) {
    const hit = signedCache.get(path);
    if (hit && now - hit.at < SIGNED_REUSE_MS) map[path] = hit.url;
    else missing.push(path);
  }
  if (missing.length > 0) {
    const { data, error } = await getSupabase().storage.from(PHOTO_BUCKET).createSignedUrls(missing, SIGNED_TTL_S);
    if (error) throw error;
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) {
        map[item.path] = item.signedUrl;
        signedCache.set(item.path, { url: item.signedUrl, at: now });
      }
    }
  }
  return map;
}

/** Reduce la imagen a 1600 px como máximo y la convierte a JPEG (≈200–600 KB). */
async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("No se pudo comprimir la imagen");
  if (blob.size > 5 * 1024 * 1024) throw new Error("La imagen sigue pesando más de 5 MB después de comprimirla");
  return blob;
}

export async function uploadClientPhoto(clientId: string, file: File, kind: PhotoKind, caption: string | null): Promise<void> {
  const supabase = getSupabase();
  const blob = await compressImage(file);
  const path = `${clientId}/${uuidv4()}.jpg`;
  const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" });
  if (uploadError) throw uploadError;
  const { error } = await supabase.from("client_photos").insert({ client_id: clientId, path, kind, caption });
  if (error) {
    // Si el registro falla, no se deja el archivo huérfano
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    throw error;
  }
}

export async function deleteClientPhoto(photo: ClientPhoto): Promise<void> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("client_photos").delete().eq("id", photo.id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("No tienes permiso para eliminar esta foto");
  signedCache.delete(photo.path);
  await supabase.storage.from(PHOTO_BUCKET).remove([photo.path]);
}
