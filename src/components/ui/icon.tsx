import type { LucideIcon, LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

export const ICON_STROKE = 1.75;

interface IconProps extends Omit<LucideProps, "ref"> {
  icon: LucideIcon;
}

/** Envoltorio de lucide-react con el trazo estándar del sistema. */
export function Icon({ icon: Component, className, ...props }: IconProps) {
  return <Component strokeWidth={ICON_STROKE} className={cn("h-4 w-4 shrink-0", className)} aria-hidden="true" {...props} />;
}
