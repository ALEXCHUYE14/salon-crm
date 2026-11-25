import { getSupabase, unwrap } from "@/lib/supabase/client";
import { withBranch } from "@/modules/branches/api";
import type { CashMovementReportRow, DashboardData, PaymentMethodRow, RevenueByDayRow, StaffPerformanceRow, TopServiceRow } from "@/types/domain";

export async function fetchDashboard(dateKey?: string, branchId?: string | null): Promise<DashboardData> {
  const data = unwrap<DashboardData>(await getSupabase().rpc("dashboard_today", withBranch({ p_date: dateKey ?? null }, branchId)));
  return {
    ...data,
    revenue: Number(data.revenue),
    tips: Number(data.tips),
    transactions: Number(data.transactions),
    commissions: Number(data.commissions),
    low_stock_count: Number(data.low_stock_count),
  };
}

export async function fetchRevenueByDay(from: string, to: string, branchId?: string | null): Promise<RevenueByDayRow[]> {
  const rows = unwrap<RevenueByDayRow[]>(await getSupabase().rpc("report_revenue_by_day", withBranch({ p_from: from, p_to: to }, branchId)));
  return rows.map((r) => ({ ...r, revenue: Number(r.revenue), tips: Number(r.tips), tx_count: Number(r.tx_count) }));
}

export async function fetchStaffPerformance(from: string, to: string, branchId?: string | null): Promise<StaffPerformanceRow[]> {
  const rows = unwrap<StaffPerformanceRow[]>(await getSupabase().rpc("report_staff_performance", withBranch({ p_from: from, p_to: to }, branchId)));
  return rows.map((r) => ({
    ...r,
    services_count: Number(r.services_count),
    services_revenue: Number(r.services_revenue),
    products_revenue: Number(r.products_revenue),
    commission: Number(r.commission),
    tips: Number(r.tips),
  }));
}

export async function fetchTopServices(from: string, to: string, limit = 10, branchId?: string | null): Promise<TopServiceRow[]> {
  const rows = unwrap<TopServiceRow[]>(
    await getSupabase().rpc("report_top_services", withBranch({ p_from: from, p_to: to, p_limit: limit }, branchId)),
  );
  return rows.map((r) => ({ ...r, quantity: Number(r.quantity), revenue: Number(r.revenue) }));
}

export async function fetchPaymentMethods(from: string, to: string, branchId?: string | null): Promise<PaymentMethodRow[]> {
  const rows = unwrap<PaymentMethodRow[]>(await getSupabase().rpc("report_payment_methods", withBranch({ p_from: from, p_to: to }, branchId)));
  return rows.map((r) => ({ ...r, amount: Number(r.amount), payments: Number(r.payments) }));
}

export async function fetchCashMovementReport(from: string, to: string, branchId?: string | null): Promise<CashMovementReportRow[]> {
  const rows = unwrap<CashMovementReportRow[]>(await getSupabase().rpc("report_cash_movements", withBranch({ p_from: from, p_to: to }, branchId)));
  return rows.map((r) => ({ ...r, amount: Number(r.amount), movements: Number(r.movements) }));
}
