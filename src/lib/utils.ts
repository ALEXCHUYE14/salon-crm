import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function formatMoney(amount: number | null | undefined, symbol: string, locale: string): string {
  const value = toNumber(amount);
  const formatted = value.toLocaleString(locale || "es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol} ${formatted}`;
}

export function formatNumber(value: number | null | undefined, locale: string, decimals = 0): string {
  return toNumber(value).toLocaleString(locale || "es-PE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Limpia caracteres que rompen los filtros `or()` de PostgREST. */
export function sanitizeSearch(term: string): string {
  return term.replace(/[%,()*\\:."']/g, " ").replace(/\s+/g, " ").trim();
}

/** UUID v4. Usa crypto.randomUUID si existe (solo en https/localhost) y si no, getRandomValues. */
export function uuidv4(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function nullIfEmpty(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function fillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? vars[key] : match));
}

export function buildWhatsAppUrl(phone: string | null, message: string, countryCode: string): string {
  const text = encodeURIComponent(message);
  if (!phone) return `https://wa.me/?text=${text}`;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (!digits.startsWith(countryCode) || digits.length <= 9) digits = `${countryCode}${digits}`;
  return `https://wa.me/${digits}?text=${text}`;
}

type CsvValue = string | number | boolean | null | undefined;

export function toCsv(rows: Array<Record<string, CsvValue>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: CsvValue): string => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    return /[";\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [headers.join(";"), ...rows.map((row) => headers.map((h) => escape(row[h])).join(";"))];
  return lines.join("\r\n");
}

/** Descarga CSV con BOM y separador `;` (compatible con Excel en español). */
export function downloadCsv(filename: string, rows: Array<Record<string, CsvValue>>): void {
  const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

interface PgLikeError {
  code?: string;
  message?: string;
  details?: string;
}

export function getErrorMessage(error: unknown): string {
  if (!error) return "Ocurrió un error inesperado";
  const err = error as PgLikeError;
  switch (err.code) {
    case "23P01":
      return "Ese horario se cruza con otra cita del mismo profesional.";
    case "23505":
      return "Ya existe un registro con esos datos (valor duplicado).";
    case "23503":
      return "El registro está relacionado con otros datos y no puede eliminarse.";
    case "23514":
      return "Alguno de los valores no cumple las reglas de validación.";
    case "42501":
      return err.message && !err.message.includes("row-level security")
        ? err.message
        : "No tienes permisos para realizar esta acción.";
    case "PGRST116":
      return "No se encontró el registro solicitado.";
    default:
      break;
  }
  if (err.message) return err.message;
  if (error instanceof Error) return error.message;
  return "Ocurrió un error inesperado";
}
