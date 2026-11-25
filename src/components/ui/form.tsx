import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";

const controlBase =
  "w-full rounded-lg border border-line bg-surface px-3 text-base text-ink placeholder:text-muted/70 transition-colors " +
  "sm:text-sm focus:border-sage focus:outline-none focus:ring-2 focus:ring-sage/20 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(controlBase, "min-h-[44px]", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...props },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cn(controlBase, "py-2.5 leading-relaxed", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(controlBase, "min-h-[44px] appearance-none pr-9", className)} {...props}>
        {children}
      </select>
      <Icon icon={ChevronDown} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  );
});

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
        {required ? <span className="ml-0.5 text-clay">*</span> : null}
      </label>
      {children}
      {error ? <p className="text-xs text-clay">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  id?: string;
}

export function Switch({ checked, onChange, label, description, disabled, id }: SwitchProps) {
  return (
    <label
      htmlFor={id}
      className={cn("flex min-h-[44px] cursor-pointer items-center justify-between gap-4", disabled && "cursor-not-allowed opacity-60")}
    >
      {label ? (
        <span className="flex flex-col">
          <span className="text-sm font-medium text-ink">{label}</span>
          {description ? <span className="text-xs text-muted">{description}</span> : null}
        </span>
      ) : null}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/40",
          checked ? "bg-sage" : "bg-line",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 rounded-full bg-white shadow-card transition-transform",
            checked ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>
    </label>
  );
}

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, label, disabled }: CheckboxProps) {
  return (
    <label className={cn("flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-ink", disabled && "cursor-not-allowed opacity-60")}>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-line accent-[#3F5E4D]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
