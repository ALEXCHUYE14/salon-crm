import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from "date-fns";
import { es } from "date-fns/locale";

/** Fecha local → "yyyy-MM-dd" (para inputs y RPC). */
export function toDateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** "yyyy-MM-dd" → Date local a medianoche. */
export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function combineDateTime(dateKey: string, time: string): Date {
  const base = fromDateKey(dateKey);
  const [h, min] = time.split(":").map(Number);
  base.setHours(h ?? 0, min ?? 0, 0, 0);
  return base;
}

export function dayBounds(date: Date): { start: string; end: string } {
  const start = startOfDay(date);
  return { start: start.toISOString(), end: addDays(start, 1).toISOString() };
}

export function weekBounds(date: Date): { start: Date; end: Date; days: Date[] } {
  const start = startOfWeek(date, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return { start, end: addDays(start, 7), days };
}

export function formatTime(iso: string): string {
  return format(parseISO(iso), "HH:mm");
}

export function formatDate(iso: string | Date, pattern = "dd/MM/yyyy"): string {
  const date = typeof iso === "string" ? parseISO(iso) : iso;
  return format(date, pattern, { locale: es });
}

export function formatLongDate(date: Date): string {
  const text = format(date, "EEEE d 'de' MMMM", { locale: es });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatDateTime(iso: string): string {
  return format(parseISO(iso), "dd/MM/yyyy HH:mm", { locale: es });
}

export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return differenceInCalendarDays(new Date(), parseISO(iso));
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function minutesOfDay(iso: string): number {
  const d = parseISO(iso);
  return d.getHours() * 60 + d.getMinutes();
}

export function buildTimeSlots(startMinutes: number, endMinutes: number, interval: number): string[] {
  const slots: string[] = [];
  for (let m = startMinutes; m < endMinutes; m += interval) slots.push(minutesToTime(m));
  return slots;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export type RangePreset = "today" | "7d" | "30d" | "month" | "prev_month";

export function rangeFromPreset(preset: RangePreset): { from: string; to: string } {
  const today = new Date();
  switch (preset) {
    case "today":
      return { from: toDateKey(today), to: toDateKey(today) };
    case "7d":
      return { from: toDateKey(subDays(today, 6)), to: toDateKey(today) };
    case "30d":
      return { from: toDateKey(subDays(today, 29)), to: toDateKey(today) };
    case "month":
      return { from: toDateKey(startOfMonth(today)), to: toDateKey(today) };
    case "prev_month": {
      const prev = subMonths(today, 1);
      return { from: toDateKey(startOfMonth(prev)), to: toDateKey(endOfMonth(prev)) };
    }
  }
}
