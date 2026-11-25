"use client";

import { MapPin } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";

/** Selector de sede de trabajo (solo aparece con dos o más sedes activas). */
export function BranchSwitcher({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { branches, branch, setBranchId } = useApp();
  if (branches.length < 2 || !branch) return null;
  return (
    <label className={cn("flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5", compact ? "h-9" : "h-10", className)}>
      <Icon icon={MapPin} className="text-sage" />
      <span className="sr-only">Sede</span>
      <select
        value={branch.id}
        onChange={(e) => setBranchId(e.target.value)}
        className="min-w-0 flex-1 truncate bg-transparent text-base font-medium sm:text-sm text-ink focus:outline-none"
        aria-label="Sede de trabajo"
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
