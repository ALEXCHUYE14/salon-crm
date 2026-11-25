import { invalidateCatalog } from "@/lib/catalog-cache";
import { getSupabase, unwrap } from "@/lib/supabase/client";
import type { ComboItem, Service, ServiceCategory, ServiceInput, ServiceSupply } from "@/types/domain";

const CATEGORY_COLUMNS = "id,name,segment,sort_order,is_active";
const SERVICE_COLUMNS =
  "id,category_id,name,description,segment,duration_minutes,processing_minutes,price,commission_type,commission_value,is_combo,is_active,online_bookable,sort_order," +
  "combo_items:service_combo_items!service_combo_items_combo_fk(service_id,quantity)";

export async function listCategories(): Promise<ServiceCategory[]> {
  return unwrap<ServiceCategory[]>(await getSupabase().from("service_categories").select(CATEGORY_COLUMNS).order("sort_order").order("name"));
}

export async function saveCategory(input: Omit<ServiceCategory, "id">, id?: string): Promise<void> {
  const supabase = getSupabase();
  try {
    const { error } = id
      ? await supabase.from("service_categories").update(input).eq("id", id)
      : await supabase.from("service_categories").insert(input);
    if (error) throw error;
  } finally {
    invalidateCatalog();
  }
}

export async function deleteCategory(id: string): Promise<void> {
  try {
    const { error } = await getSupabase().from("service_categories").delete().eq("id", id);
    if (error) throw error;
  } finally {
    invalidateCatalog();
  }
}

export async function listServices(options: { activeOnly?: boolean } = {}): Promise<Service[]> {
  let query = getSupabase().from("services").select(SERVICE_COLUMNS).order("sort_order").order("name");
  if (options.activeOnly) query = query.eq("is_active", true);
  const rows = unwrap<Service[]>(await query);
  return rows.map((s) => ({ ...s, combo_items: s.combo_items ?? [] }));
}

/** Guarda el servicio y devuelve su id. */
export async function saveService(input: ServiceInput, comboItems: ComboItem[], id?: string): Promise<string> {
  try {
    return await writeService(input, comboItems, id);
  } finally {
    invalidateCatalog();
  }
}

async function writeService(input: ServiceInput, comboItems: ComboItem[], id?: string): Promise<string> {
  const supabase = getSupabase();
  let serviceId = id;
  if (id) {
    const { error } = await supabase.from("services").update(input).eq("id", id);
    if (error) throw error;
  } else {
    const result = await supabase.from("services").insert(input).select("id").single();
    serviceId = unwrap<{ id: string }>(result).id;
  }
  if (!serviceId) throw new Error("No se pudo guardar el servicio");

  const { error: deleteError } = await supabase.from("service_combo_items").delete().eq("combo_id", serviceId);
  if (deleteError) throw deleteError;

  if (input.is_combo && comboItems.length > 0) {
    const { error: insertError } = await supabase
      .from("service_combo_items")
      .insert(comboItems.map((item) => ({ combo_id: serviceId, service_id: item.service_id, quantity: item.quantity })));
    if (insertError) throw insertError;
  }
  return serviceId;
}

export async function listServiceSupplies(serviceId: string): Promise<ServiceSupply[]> {
  const rows = unwrap<ServiceSupply[]>(await getSupabase().from("service_supplies").select("item_id,quantity").eq("service_id", serviceId));
  return rows.map((r) => ({ item_id: r.item_id, quantity: Number(r.quantity) }));
}

/** Reemplaza la receta completa del servicio. */
export async function saveServiceSupplies(serviceId: string, supplies: ServiceSupply[]): Promise<void> {
  const supabase = getSupabase();
  const { error: deleteError } = await supabase.from("service_supplies").delete().eq("service_id", serviceId);
  if (deleteError) throw deleteError;
  const rows = supplies.filter((s) => s.item_id && s.quantity > 0);
  if (rows.length === 0) return;
  const { error } = await supabase.from("service_supplies").insert(rows.map((s) => ({ service_id: serviceId, item_id: s.item_id, quantity: s.quantity })));
  if (error) throw error;
}
