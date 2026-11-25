import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-[1.75rem]">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-muted">
        <Icon icon={icon} className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className, label = "Cargando" }: { className?: string; label?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-10 text-sm text-muted", className)} role="status">
      <Icon icon={Loader2} className="h-5 w-5 animate-spin" />
      <span>{label}…</span>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: "sage" | "clay" | "ochre" | "neutral";
}

const statTone = {
  sage: "bg-sage-soft text-sage",
  clay: "bg-clay-soft text-clay",
  ochre: "bg-ochre-soft text-ochre",
  neutral: "bg-surface-2 text-muted",
};

export function StatCard({ label, value, hint, icon, tone = "neutral" }: StatCardProps) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted">{label}</p>
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", statTone[tone])}>
          <Icon icon={icon} />
        </span>
      </div>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

interface TabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  items: { value: T; label: string; icon?: LucideIcon; count?: number }[];
  className?: string;
}

export function Tabs<T extends string>({ value, onChange, items, className }: TabsProps<T>) {
  return (
    <div className={cn("-mx-1 overflow-x-auto px-1", className)}>
      <div className="inline-flex min-w-full gap-1 rounded-xl border border-line bg-surface-2 p-1 sm:min-w-0" role="tablist">
        {items.map((item) => {
          const active = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(item.value)}
              className={cn(
                "inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors sm:flex-none",
                active ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
              )}
            >
              {item.icon ? <Icon icon={item.icon} /> : null}
              {item.label}
              {typeof item.count === "number" ? (
                <span className={cn("rounded px-1.5 text-xs", active ? "bg-sage-soft text-sage-dark" : "bg-line/70")}>{item.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
      <span>
        {from}–{to} de {total}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-surface hover:bg-surface-2 disabled:opacity-40"
          aria-label="Página anterior"
        >
          <Icon icon={ChevronLeft} />
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-surface hover:bg-surface-2 disabled:opacity-40"
          aria-label="Página siguiente"
        >
          <Icon icon={ChevronRight} />
        </button>
      </div>
    </div>
  );
}

export function Avatar({ name, color, size = "md" }: { name: string; color?: string; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-14 w-14 text-lg" };
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white", sizes[size])}
      style={{ backgroundColor: color ?? "#5C5852" }}
      aria-hidden="true"
    >
      {letters}
    </span>
  );
}

export function Alert({
  tone = "ochre",
  icon,
  children,
  className,
}: {
  tone?: "ochre" | "clay" | "sage";
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    ochre: "border-ochre/30 bg-ochre-soft text-ochre-dark",
    clay: "border-clay/30 bg-clay-soft text-clay-dark",
    sage: "border-sage/30 bg-sage-soft text-sage-dark",
  };
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm", tones[tone], className)}>
      <Icon icon={icon} className="mt-0.5" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
