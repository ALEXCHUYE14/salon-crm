import { getSupabase, unwrap } from "@/lib/supabase/client";

export interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  tax_id: string | null;
  notes: string | null;
  is_active: boolean;
}

export type SupplierInput = Omit<Supplier, "id">;

export type PurchaseStatus = "draft" | "ordered" | "received" | "cancelled";

export interface PurchaseOrderItem {
  id?: string;
  item_id: string;
  quantity: number;
  unit_cost: number;
  item?: { id: string; name: string; unit: string } | null;
}

export interface PurchaseOrder {
  id: string;
  order_number: number;
  supplier_id: string;
  status: PurchaseStatus;
  expected_on: string | null;
  notes: string | null;
  created_at: string;
  received_at: string | null;
  supplier: { id: string; name: string } | null;
  items: PurchaseOrderItem[];
}

export const PURCHASE_STATUS: Record<PurchaseStatus, { label: string; tone: "outline" | "ochre" | "sage" | "clay" }> = {
  draft: { label: "Borrador", tone: "outline" },
  ordered: { label: "Enviada", tone: "ochre" },
  received: { label: "Recibida", tone: "sage" },
  cancelled: { label: "Anulada", tone: "clay" },
};

const SUPPLIER_COLUMNS = "id,name,contact_name,phone,email,tax_id,notes,is_active";
const ORDER_COLUMNS =
  "id,order_number,supplier_id,status,expected_on,notes,created_at,received_at," +
  "supplier:suppliers!purchase_orders_supplier_fk(id,name)," +
  "items:purchase_order_items(id,item_id,quantity,unit_cost,item:inventory_items!purchase_order_items_item_fk(id,name,unit))";

export async function listSuppliers(): Promise<Supplier[]> {
  return unwrap<Supplier[]>(await getSupabase().from("suppliers").select(SUPPLIER_COLUMNS).order("name"));
}

export async function saveSupplier(input: SupplierInput, id?: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = id ? await supabase.from("suppliers").update(input).eq("id", id) : await supabase.from("suppliers").insert(input);
  if (error) throw error;
}

export async function listPurchaseOrders(limit = 50): Promise<PurchaseOrder[]> {
  const rows = unwrap<PurchaseOrder[]>(
    await getSupabase().from("purchase_orders").select(ORDER_COLUMNS).order("created_at", { ascending: false }).limit(limit),
  );
  return rows.map((o) => ({ ...o, items: (o.items ?? []).map((i) => ({ ...i, quantity: Number(i.quantity), unit_cost: Number(i.unit_cost) })) }));
}

export function orderTotal(items: PurchaseOrderItem[]): number {
  return Math.round(items.reduce((s, i) => s + i.quantity * i.unit_cost, 0) * 100) / 100;
}

/** Crea o actualiza la orden (con sus líneas) mientras esté abierta. */
export async function savePurchaseOrder(
  order: { supplier_id: string; status: "draft" | "ordered"; expected_on: string | null; notes: string | null },
  items: PurchaseOrderItem[],
  id?: string,
): Promise<string> {
  const supabase = getSupabase();
  let orderId = id;
  if (id) {
    const { error } = await supabase.from("purchase_orders").update(order).eq("id", id);
    if (error) throw error;
  } else {
    orderId = unwrap<{ id: string }>(await supabase.from("purchase_orders").insert(order).select("id").single()).id;
  }
  if (!orderId) throw new Error("No se pudo guardar la orden");
  const { error: deleteError } = await supabase.from("purchase_order_items").delete().eq("order_id", orderId);
  if (deleteError) throw deleteError;
  const rows = items.map((i) => ({ order_id: orderId, item_id: i.item_id, quantity: i.quantity, unit_cost: i.unit_cost }));
  if (rows.length > 0) {
    const { error } = await supabase.from("purchase_order_items").insert(rows);
    if (error) throw error;
  }
  return orderId;
}

export async function cancelPurchaseOrder(id: string): Promise<void> {
  const { error } = await getSupabase().from("purchase_orders").update({ status: "cancelled" }).eq("id", id);
  if (error) throw error;
}

export async function receivePurchaseOrder(id: string, payFromRegister: boolean): Promise<{ order_number: number; total: number }> {
  return unwrap(await getSupabase().rpc("receive_purchase_order", { p_order_id: id, p_pay_from_register: payFromRegister }));
}
