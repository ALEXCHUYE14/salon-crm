import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Páginas públicas sin sesión: no se consulta Auth (reserva online y encuestas). */
const ANONYMOUS_PATHS = ["/reservar", "/encuesta"];
const LOGIN_PATH = "/login";

function matches(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** ¿Hay cookie de sesión de Supabase? (puede venir partida en .0, .1…) */
function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));
}

/**
 * Navegación interna del App Router (RSC o precarga de enlaces). Las pantallas son
 * componentes de cliente que validan la sesión y leen datos protegidos por RLS, así
 * que aquí basta con verificar que exista la cookie: evita una llamada a Auth por clic.
 */
function isClientNavigation(request: NextRequest): boolean {
  return (
    request.headers.get("rsc") === "1" || request.headers.has("next-router-prefetch") || request.headers.has("next-router-state-tree")
  );
}

function redirectTo(request: NextRequest, pathname: string, next?: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  if (next) url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (ANONYMOUS_PATHS.some((p) => matches(pathname, p))) {
    return NextResponse.next({ request });
  }

  const isLogin = matches(pathname, LOGIN_PATH);
  if (!isLogin && isClientNavigation(request)) {
    return hasAuthCookie(request) ? NextResponse.next({ request }) : redirectTo(request, LOGIN_PATH, pathname);
  }

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

  // Sin cookie no hay sesión que verificar: se ahorra la llamada a Auth
  if (!hasAuthCookie(request)) {
    return isLogin ? response : redirectTo(request, LOGIN_PATH, pathname);
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getClaims valida la firma del JWT (localmente con claves asimétricas) y refresca la sesión si expiró
  const { data, error } = await supabase.auth.getClaims();
  const signedIn = !error && Boolean(data?.claims?.sub);

  if (!signedIn && !isLogin) return redirectTo(request, LOGIN_PATH, pathname);
  if (signedIn && isLogin) return redirectTo(request, "/dashboard");

  return response;
}
