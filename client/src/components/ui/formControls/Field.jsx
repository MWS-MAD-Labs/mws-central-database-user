import { cn } from "../../../lib/cn.js";
import { countDigits } from "../../../lib/form.js";

// `counter` is the "3/25" at the right end of the label row: { value, max, count }. `count` is how a value is counted,
// digits by default.
export function Field({
  label,
  children,
  hint,
  counter,
  error,
  className,
  name,
  required = false,
}) {
  const length = counter ? (counter.count || countDigits)(counter.value) : 0;
  return (
    <div
      className={cn("block space-y-1.5", className)}
      data-field={name || undefined}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span
          className={cn(
            "font-display text-sm font-semibold",
            error ? "text-[#a43c41]" : "text-(--mws-charcoal)",
          )}
        >
          {label}
          {required ? (
            <span className="ml-0.5 text-[#a43c41]" aria-hidden="true">
              *
            </span>
          ) : null}
        </span>
        {counter ? (
          <span
            className={cn(
              "shrink-0 text-xs tabular-nums",
              length > counter.max
                ? "text-[#a43c41]"
                : length === counter.max
                  ? "text-[#476b43]"
                  : "text-(--mws-muted)",
            )}
          >
            {length}/{counter.max}
          </span>
        ) : null}
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
