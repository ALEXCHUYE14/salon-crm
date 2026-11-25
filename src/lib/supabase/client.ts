import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

function readEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local");
  }
  return { url, anonKey };
}

/** Cliente de navegador (singleton). Llamar solo dentro de efectos o handlers. */
export function getSupabase(): SupabaseClient {
  if (!browserClient) {
    const { url, anonKey } = readEnv();
    browserClient = createBrowserClient(url, anonKey);
  }
  return browserClient;
}

/** Lanza el error de Supabase si existe y devuelve los datos tipados. */
export function unwrap<T>(result: { data: unknown; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data as T;
}
