import { cn } from "../../../lib/cn.js";
import { inputClasses } from "./sharedStyles.js";

// Only digits are accepted, and no more of them than the largest allowed number has, so
// "202753445455445" cannot be typed into a year. A minus sign is accepted when `min` is below zero.
// `onChange` gets the cleaned string. The range itself is checked by the form that uses it.
export function NumberInput({ value, onChange, min = 0, max = 999999, invalid, className, ...props }) {
  const maxDigits = String(Math.max(Math.abs(min), Math.abs(max))).length;
  const allowNegative = min < 0;

  function clean(raw) {
    const negative = allowNegative && raw.trimStart().startsWith("-");
    const digits = raw.replace(/\D/g, "").slice(0, maxDigits);
    return negative ? `-${digits}` : digits;
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className={cn(inputClasses, invalid ? "border-[#c75f64]" : null, className)}
      value={value ?? ""}
      onChange={(event) => onChange(clean(event.target.value))}
      {...props}
    />
  );
}
