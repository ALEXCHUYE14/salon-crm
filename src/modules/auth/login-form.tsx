"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Eye, EyeOff, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast";
import { getSupabase } from "@/lib/supabase/client";
import { cn, getErrorMessage } from "@/lib/utils";

type Mode = "signin" | "signup";

const AUTH_MESSAGES: Record<string, string> = {
  "Invalid login credentials": "El correo o la contraseña no coinciden. Revísalos e inténtalo de nuevo.",
  "Email not confirmed": "Tu correo aún no está confirmado. Abre el enlace que te enviamos y vuelve a ingresar.",
  "User already registered": "Ese correo ya tiene una cuenta. Ingresa con tu contraseña.",
};

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setError(null);
  }

  function trackCapsLock(event: KeyboardEvent<HTMLInputElement>) {
    if (typeof event.getModifierState === "function") setCapsLock(event.getModifierState("CapsLock"));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabase();
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        const next = params.get("next");
        router.replace(next && next.startsWith("/") ? next : "/dashboard");
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        });
        if (error) throw error;
        if (data.session) {
          router.replace("/dashboard");
          router.refresh();
        } else {
          toast.success("Cuenta creada. Confirma tu correo con el enlace que te enviamos y luego ingresa.");
          setMode("signin");
          setPassword("");
        }
      }
    } catch (err) {
      const message = getErrorMessage(err);
      setError(AUTH_MESSAGES[message] ?? message);
    } finally {
      setLoading(false);
    }
  }

  const isSignin = mode === "signin";

  return (
    <div className="grid min-h-screen grid-cols-1 bg-canvas lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <PhotoPanel />

      <main className="flex min-h-screen min-w-0 flex-col px-5 py-8 sm:px-10 lg:px-14">
        <header className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sage text-white">
            <Icon icon={Scissors} className="h-[18px] w-[18px]" />
          </span>
          <span className="font-display text-[17px] font-semibold text-ink">Gestión de Barbería y Salón</span>
        </header>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[380px]">
            <div
              className="mb-8 grid grid-cols-2 rounded-full border border-line bg-surface-2 p-1 text-sm"
              role="group"
              aria-label="Tipo de acceso"
            >
              {(
                [
                  ["signin", "Ingresar"],
                  ["signup", "Activar acceso"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => switchMode(value)}
                  className={cn(
                    "min-h-[40px] rounded-full font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/40",
                    mode === value ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <h1 className="font-display text-[28px] font-semibold leading-tight text-ink">
              {isSignin ? "Ingresa a tu cuenta" : "Activa tu acceso al equipo"}
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              {isSignin
                ? "Usa el correo que la administración registró en tu ficha del equipo."
                : "Usa el mismo correo de tu ficha del equipo. Tu cuenta quedará vinculada a tu rol automáticamente."}
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              {error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-clay/25 bg-clay-soft px-3.5 py-3 text-sm text-clay-dark"
                >
                  <Icon icon={AlertCircle} className="mt-0.5" />
                  <span>{error}</span>
                </div>
              ) : null}

              {!isSignin ? (
                <Field label="Nombre completo" htmlFor="full_name" required>
                  <Input
                    id="full_name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    autoComplete="name"
                    placeholder="Como figura en tu ficha"
                  />
                </Field>
              ) : null}

              <Field label="Correo electrónico" htmlFor="email" required>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="nombre@correo.com"
                />
              </Field>

              <Field
                label="Contraseña"
                htmlFor="password"
                required
                hint={capsLock ? "Bloq Mayús está activado." : !isSignin ? "Mínimo 6 caracteres." : undefined}
              >
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    minLength={6}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={trackCapsLock}
                    onKeyUp={trackCapsLock}
                    onBlur={() => setCapsLock(false)}
                    required
                    autoComplete={isSignin ? "current-password" : "new-password"}
                    className="pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    aria-controls="password"
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/40"
                  >
                    <Icon icon={showPassword ? EyeOff : Eye} className="h-[18px] w-[18px]" />
                  </button>
                </div>
              </Field>

              <Button type="submit" className="w-full" size="lg" loading={loading}>
                {loading ? (isSignin ? "Ingresando…" : "Activando…") : isSignin ? "Ingresar" : "Activar acceso"}
              </Button>
            </form>

            <p className="mt-6 text-sm leading-relaxed text-muted">
              {isSignin ? (
<>¿Olvidaste tu contraseña? Pide a la administración que te la restablezca.</>
              ) : (
                <>Si tu correo no está en el equipo, la administración debe agregarlo antes en Equipo.</>
              )}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Panel visual: fotografía del oficio + la cita "en vivo" que muestra la foto
 * ------------------------------------------------------------------------- */

function PhotoPanel() {
  return (
    <aside aria-hidden="true" className="relative hidden overflow-hidden bg-[#1E2C24] lg:block">
      <Image
        src="/login/barberia.jpg"
        alt=""
        fill
        priority
        sizes="(min-width: 1024px) 55vw, 1px"
        className="object-cover object-[45%_38%]"
      />

      {/* Velos: verde del sistema desde abajo para el texto, viñeta suave arriba */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#16211B] via-[#16211B]/55 via-45% to-transparent" />
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#16211B]/50 to-transparent" />

      {/* La cita que está ocurriendo en la foto */}
      <div className="login-slot absolute right-10 top-10 w-[272px] rounded-2xl border border-white/15 bg-[#16211B]/55 p-4 text-[#F2EFE8] shadow-pop backdrop-blur-md xl:right-14 xl:top-14">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[12px] font-medium text-[#B9D3C2]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#8FC1A0] opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#8FC1A0]" />
            </span>
            En servicio
          </span>
          <span className="text-[12px] tabular-nums text-[#F2EFE8]/60">Silla 1</span>
        </div>
        <p className="mt-3 font-display text-[20px] leading-tight">Perfilado de barba</p>
        <p className="mt-1 text-[13px] text-[#F2EFE8]/65">Con Carlos, cliente frecuente</p>
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/15">
          <div className="h-full w-[62%] rounded-full bg-[#8FC1A0]" />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-[#F2EFE8]/50">
          <span>10:00</span>
          <span>Termina 10:20</span>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 px-12 pb-14 xl:px-16">
        <p className="max-w-[520px] font-display text-[42px] leading-[1.08] text-[#F7F5F0] xl:text-[50px]">
          Cada silla, cada tinte y cada cobro del día, en una sola vista.
        </p>
        <p className="mt-5 max-w-[420px] text-[15px] leading-relaxed text-[#F2EFE8]/75">
          Agenda con tiempos de pose, caja con pagos mixtos, comisiones e inventario para barbería y salón.
        </p>
      </div>
    </aside>
  );
}
