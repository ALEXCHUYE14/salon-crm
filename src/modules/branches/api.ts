import { invalidateCatalog } from "@/lib/catalog-cache";
import { getSupabase, unwrap } from "@/lib/supabase/client";
import type { Branch } from "@/types/domain";

const BRANCH_COLUMNS = "id,name,address,phone,is_main,is_active";

export async function listBranches(): Promise<Branch[]> {
  return unwrap<Branch[]>(await getSupabase().from("branches").select(BRANCH_COLUMNS).order("is_main", { ascending: false }).order("name"));
}

export async function saveBranch(input: Omit<Branch, "id" | "is_main">, id?: string): Promise<void> {
  const supabase = getSupabase();
  try {
    const { error } = id ? await supabase.from("branches").update(input).eq("id", id) : await supabase.from("branches").insert(input);
    if (error) throw error;
  } finally {
    invalidateCatalog();
  }
}

/** Agrega el parámetro de sede solo si existe (compatible con bases sin la migración 015). */
export function withBranch<T extends Record<string, unknown>>(params: T, branchId: string | null | undefined): T & { p_branch_id?: string } {
  return branchId ? { ...params, p_branch_id: branchId } : params;
}
