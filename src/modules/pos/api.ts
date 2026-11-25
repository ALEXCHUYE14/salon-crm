import { getSupabase, unwrap } from "@/lib/supabase/client";
import { withBranch } from "@/modules/branches/api";
import type {
  CashMovement,
  CashMovementInput,
  CashRegister,
  RegisterSummary,
  SalePayload,
  SaleResult,
  TransactionRow,
} from "@/types/domain";

const REGISTER_COLUMNS =
  "id,branch_id,opened_at,closed_at,opening_amount,expected_cash,counted_cash,difference,status,notes," +
  "opened_by_staff:staff_members!cash_registers_opened_by_fk(id,full_name)";

const TRANSACTION_COLUMNS =
  "id,ticket_number,subtotal,discount_amount,tip_amount,total,cash_received,change_given,status,void_reason,created_at," +
  "client:clients!transactions_client_fk(id,full_name,phone)," +
  "items:transaction_items(id,item_kind,description,quantity,unit_price,discount,line_total,staff_id)," +
  "payments:transaction_payments(method,amount)";

export async function getOpenRegister(branchId?: string | null): Promise<CashRegister | null> {
  let query = getSupabase().from("cash_registers").select(REGISTER_COLUMNS).eq("status", "open");
  if (branchId) query = query.eq("branch_id", branchId);
  const rows = unwrap<CashRegister[]>(await query.limit(1));
  return rows[0] ?? null;
}

export async function openRegister(openingAmount: number, openedBy: string, notes: string | null, branchId?: string | null): Promise<CashRegister> {
  const result = await getSupabase()
    .from("cash_registers")
    .insert({ opening_amount: openingAmount, opened_by: openedBy, notes, status: "open", ...(branchId ? { branch_id: branchId } : {}) })
    .select(REGISTER_COLUMNS)
    .single();
  return unwrap<CashRegister>(result);
}

export async function fetchRegisterSummary(registerId: string): Promise<RegisterSummary> {
  const data = unwrap<RegisterSummary>(await getSupabase().rpc("register_summary", { p_register_id: registerId }));
  return {
    ...data,
    advances_received: Number(data.advances_received ?? 0),
    advances_cash_in: Number(data.advances_cash_in ?? 0),
    advances_cash_out: Number(data.advances_cash_out ?? 0),
    opening_amount: Number(data.opening_amount),
    gross_total: Number(data.gross_total),
    tips: Number(data.tips),
    discounts: Number(data.discounts),
    cash_sales: Number(data.cash_sales ?? 0),
    expenses: Number(data.expenses ?? 0),
    withdrawals: Number(data.withdrawals ?? 0),
    deposits: Number(data.deposits ?? 0),
    expected_cash: Number(data.expected_cash),
  };
}

const MOVEMENT_COLUMNS =
  "id,cash_register_id,movement_type,category,amount,description,created_at," +
  "created_by_staff:staff_members!cash_movements_created_by_fk(id,full_name)";

export async function listCashMovements(registerId: string): Promise<CashMovement[]> {
  const result = await getSupabase()
    .from("cash_movements")
    .select(MOVEMENT_COLUMNS)
    .eq("cash_register_id", registerId)
    .order("created_at", { ascending: false })
    .limit(200);
  return unwrap<CashMovement[]>(result).map((m) => ({ ...m, amount: Number(m.amount) }));
}

export async function createCashMovement(input: CashMovementInput): Promise<void> {
  const { error } = await getSupabase().from("cash_movements").insert(input);
  if (error) throw error;
}

export async function deleteCashMovement(id: string): Promise<void> {
  const { error } = await getSupabase().from("cash_movements").delete().eq("id", id);
  if (error) throw error;
}

export async function closeRegister(countedCash: number, notes: string | null, branchId?: string | null): Promise<CashRegister> {
  return unwrap<CashRegister>(await getSupabase().rpc("close_cash_register", withBranch({ p_counted_cash: countedCash, p_notes: notes }, branchId)));
}

export async function listRecentRegisters(limit = 10): Promise<CashRegister[]> {
  const result = await getSupabase()
    .from("cash_registers")
    .select(REGISTER_COLUMNS)
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(limit);
  return unwrap<CashRegister[]>(result);
}

export async function createSale(payload: SalePayload): Promise<SaleResult> {
  return unwrap<SaleResult>(await getSupabase().rpc("create_sale", { p_payload: payload }));
}

export async function listRegisterTransactions(registerId: string, limit = 50): Promise<TransactionRow[]> {
  const result = await getSupabase()
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("cash_register_id", registerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return unwrap<TransactionRow[]>(result);
}

export async function voidTransaction(id: string, reason: string): Promise<void> {
  const { error } = await getSupabase().rpc("void_transaction", { p_transaction_id: id, p_reason: reason });
  if (error) throw error;
}
