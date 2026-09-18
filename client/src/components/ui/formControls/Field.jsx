import { cn } from "../../../lib/cn.js";
import { countDigits } from "../../../lib/form.js";

export function Field({ label, children, hint, error, className, name }) {
  return (
    <div
      className={cn("block space-y-1.5", className)}
      data-field={name || undefined}
    >
      <span
        className={cn(
          "font-display text-sm font-semibold",
          error ? "text-[#a43c41]" : "text-(--mws-charcoal)",
        )}
      >
        {label}
      </span>
      {children}
      {error ? (
        <span className="block text-xs font-medium leading-5 text-[#a43c41]">
          {error}
        </span>
      ) : hint ? (
        <span className="block text-xs leading-5 text-(--mws-muted)">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function LengthHint({ value, max, label, prefix, count = countDigits }) {
  const length = count(value);
  const isComplete = length === max;

  return (
    <span className="flex flex-wrap items-center justify-between gap-2">
      <span>{prefix || `Optional, ${max} ${label} if filled`}</span>
      <span className={isComplete ? "text-[#476b43]" : "text-(--mws-muted)"}>
        {length}/{max} {label}
      </span>
    </span>
  );
}
