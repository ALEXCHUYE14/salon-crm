import { getSupabase, unwrap } from "@/lib/supabase/client";
import { sanitizeSearch } from "@/lib/utils";
import type { InventoryItem, InventoryItemInput, InventoryItemType, InventoryMovement, MovementType } from "@/types/domain";

export const INVENTORY_COLUMNS = "id,sku,name,item_type,segment,brand,unit,stock,min_stock,is_low_stock,cost,price,supplier,is_active";

export interface InventoryFilters {
  search?: string;
  type?: InventoryItemType | "all";
  lowOnly?: boolean;
  activeOnly?: boolean;
}

export async function listInventory(filters: InventoryFilters = {}): Promise<InventoryItem[]> {
  let query = getSupabase().from("inventory_items").select(INVENTORY_COLUMNS).order("name").limit(500);
  if (filters.activeOnly !== false) query = query.eq("is_active", true);
  if (filters.type && filters.type !== "all") query = query.eq("item_type", filters.type);
  if (filters.lowOnly) query = query.eq("is_low_stock", true);
  const term = sanitizeSearch(filters.search ?? "");
  if (term) query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,brand.ilike.%${term}%`);
  return unwrap<InventoryItem[]>(await query);
}

export async function saveInventoryItem(input: InventoryItemInput, id?: string): Promise<InventoryItem> {
  const supabase = getSupabase();
  const result = id
    ? await supabase.from("inventory_items").update(input).eq("id", id).select(INVENTORY_COLUMNS).single()
    : await supabase.from("inventory_items").insert(input).select(INVENTORY_COLUMNS).single();
  return unwrap<InventoryItem>(result);
}

export interface MovementInput {
  item_id: string;
  movement_type: Exclude<MovementType, "sale" | "return">;
  quantity: number;
  unit_cost: number | null;
  reference: string | null;
  notes: string | null;
}

export async function createMovement(input: MovementInput): Promise<void> {
  const { error } = await getSupabase().from("inventory_movements").insert(input);
  if (error) throw error;
}

export async function listMovements(options: { itemId?: string; limit?: number } = {}): Promise<InventoryMovement[]> {
  let query = getSupabase()
    .from("inventory_movements")
    .select("id,item_id,movement_type,quantity,unit_cost,reference,notes,created_at,item:inventory_items!inventory_movements_item_fk(id,name,unit)")
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);
  if (options.itemId) query = query.eq("item_id", options.itemId);
  return unwrap<InventoryMovement[]>(await query);
}
