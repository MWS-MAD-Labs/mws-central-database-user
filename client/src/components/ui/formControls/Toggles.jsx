import { Check } from "lucide-react";
import { cn } from "../../../lib/cn.js";

export function ToggleChip({ checked, onChange, children, className, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "border-(--mws-burgundy) bg-(--mws-burgundy) text-white"
          : "border-(--mws-line) bg-white text-(--mws-muted) hover:border-(--mws-burgundy) hover:text-(--mws-charcoal)",
        className,
      )}
    >
      {checked ? <Check size={13} /> : null}
      {children}
    </button>
  );
}

export function CheckboxField({ label, description, className, ...props }) {
  return (
    <label
      className={cn(
        "flex min-h-11 gap-3 rounded-xl border border-(--mws-line) bg-white px-3 py-2.5 text-sm text-(--mws-charcoal) transition hover:border-(--mws-burgundy)",
        description ? "items-start" : "items-center",
        className,
      )}
    >
      <input
        type="checkbox"
        className={cn(
          "h-4 w-4 accent-(--mws-burgundy)",
          description ? "mt-1" : null,
        )}
        {...props}
      />
      <span>
        <span className="block font-medium">{label}</span>
        {description ? (
          <span className="block text-xs text-(--mws-muted)">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
