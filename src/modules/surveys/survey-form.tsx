"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, Check, Scissors, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/misc";
import { cn, getErrorMessage, nullIfEmpty } from "@/lib/utils";
import { fetchPublicSurvey, submitSurvey, type PublicSurvey } from "./api";

const LABELS = ["", "Muy mala", "Mala", "Regular", "Buena", "Excelente"];

export function SurveyForm({ token }: { token: string }) {
  const [survey, setSurvey] = useState<PublicSurvey | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetchPublicSurvey(token)
      .then(setSurvey)
      .catch(() => setSurvey({ found: false }));
  }, [token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rating < 1 || sending) return;
    setSending(true);
    setError(null);
    try {
      await submitSurvey(token, rating, nullIfEmpty(comment));
      setDone(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-start justify-center bg-canvas px-4 py-10 sm:items-center">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-card">
        {survey === null ? (
          <Spinner />
        ) : !survey.found || survey.expired ? (
          <Message icon={AlertCircle} title="Enlace no disponible" text="Este enlace de encuesta no existe o ya venció." />
        ) : done || survey.answered ? (
          <Message
            icon={Check}
            title="¡Gracias por tu opinión!"
            text={`Tu respuesta nos ayuda a mejorar en ${survey.business_name ?? "el negocio"}.`}
            positive
          />
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="flex items-center gap-3">
              {survey.logo_url ? (
                <img src={survey.logo_url} alt="" className="h-11 w-11 rounded-full border border-line object-cover" />
              ) : (
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sage text-white">
                  <Icon icon={Scissors} className="h-5 w-5" />
                </span>
              )}
              <p className="font-display text-lg font-semibold text-ink">{survey.business_name}</p>
            </div>

            <h1 className="mt-6 font-display text-2xl font-semibold leading-tight text-ink">
              {survey.client_name ? `${survey.client_name}, ¿cómo` : "¿Cómo"} te atendimos?
            </h1>
            <p className="mt-1 text-sm text-muted">
              {[survey.services?.join(", "), survey.staff_name ? `con ${survey.staff_name}` : null].filter(Boolean).join(" ")}
            </p>

            <div className="mt-6 flex justify-between gap-1" role="radiogroup" aria-label="Calificación">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} de 5: ${LABELS[n]}`}
                  onClick={() => setRating(n)}
                  className="flex flex-1 flex-col items-center gap-1 rounded-xl py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/40"
                >
                  <Star
                    className={cn("h-10 w-10 transition-colors", n <= rating ? "fill-ochre text-ochre" : "text-line")}
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
            <p className="mt-1 h-5 text-center text-sm font-medium text-ochre-dark">{LABELS[rating]}</p>

            <Field label="¿Algo que quieras contarnos? (opcional)" htmlFor="survey-comment" className="mt-4">
              <Textarea id="survey-comment" rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>

            {error ? (
              <p role="alert" className="mt-3 text-sm text-clay-dark">
                {error}
              </p>
            ) : null}

            <Button type="submit" size="lg" className="mt-5 w-full" disabled={rating < 1} loading={sending}>
              Enviar calificación
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

function Message({ icon, title, text, positive }: { icon: typeof Check; title: string; text: string; positive?: boolean }) {
  return (
    <div className="py-4 text-center">
      <div className={cn("mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full", positive ? "bg-sage text-white" : "bg-surface-2 text-muted")}>
        <Icon icon={icon} className="h-6 w-6" />
      </div>
      <h1 className="font-display text-xl font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-sm text-muted">{text}</p>
    </div>
  );
}
