import type { ReactNode } from "react";
import type { Tone } from "@/lib/constants";
import { cn } from "@/lib/utils";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  sage: "bg-sage-soft text-sage-dark",
  clay: "bg-clay-soft text-clay-dark",
  ochre: "bg-ochre-soft text-ochre-dark",
  ink: "bg-ink text-white",
  outline: "border border-line bg-surface text-muted",
};

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium", toneClasses[tone], className)}>
      {children}
    </span>
  );
}
