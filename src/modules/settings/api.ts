import { getSupabase, unwrap } from "@/lib/supabase/client";
import type { BusinessSettings } from "@/types/domain";

export const SETTINGS_COLUMNS =
  "id,business_name,slogan,tax_id,phone,email,address,logo_url,operating_mode,enabled_modules,business_hours,timezone," +
  "currency_code,currency_symbol,locale,default_country_code,default_commission_type,default_commission_value," +
  "product_commission_rate,payment_methods,message_templates,role_permissions,slot_interval_minutes,inactive_client_days," +
  "online_booking_enabled,online_booking_days_ahead,online_booking_min_notice_minutes,online_booking_note," +
  "loyalty_points_enabled,loyalty_points_per_currency,loyalty_point_value,loyalty_min_redeem";

export async function fetchSettings(): Promise<BusinessSettings> {
  const result = await getSupabase().from("business_settings").select(SETTINGS_COLUMNS).limit(1).single();
  return unwrap<BusinessSettings>(result);
}

export type SettingsPatch = Partial<Omit<BusinessSettings, "id">>;

export async function updateSettings(id: string, patch: SettingsPatch): Promise<BusinessSettings> {
  const result = await getSupabase().from("business_settings").update(patch).eq("id", id).select(SETTINGS_COLUMNS).single();
  return unwrap<BusinessSettings>(result);
}

const LOGO_BUCKET = "business-assets";
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Reduce el logo a 512 px como máximo (WebP conserva la transparencia). */
async function resizeLogo(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  if (!blob) throw new Error("No se pudo procesar la imagen");
  return blob;
}

export async function uploadLogo(file: File): Promise<string> {
  // SVG no se admite: puede contener scripts
  if (!LOGO_TYPES.includes(file.type)) throw new Error("El logo debe ser PNG, JPG o WEBP");
  if (file.size > 5 * 1024 * 1024) throw new Error("El logo no puede superar 5 MB");
  const blob = await resizeLogo(file);
  const path = `logo/logo-${Date.now()}.webp`;
  const supabase = getSupabase();
  const { error } = await supabase.storage.from(LOGO_BUCKET).upload(path, blob, {
    cacheControl: "31536000",
    upsert: false,
    contentType: "image/webp",
  });
  if (error) throw error;
  return supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Borra del Storage un logo subido por el sistema (ignora URLs externas). Mejor esfuerzo. */
export async function deleteLogoByUrl(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const marker = `/storage/v1/object/public/${LOGO_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index < 0) return;
  const path = decodeURIComponent(url.slice(index + marker.length).split("?")[0]);
  if (!/^logo\/logo-\d+\.(webp|png|jpe?g|svg)$/i.test(path)) return;
  try {
    await getSupabase().storage.from(LOGO_BUCKET).remove([path]);
  } catch {
    // No bloquea al usuario si no se pudo limpiar
  }
}
