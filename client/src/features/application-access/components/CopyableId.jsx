import { copyText } from "../utils/copyText.js";

// An id that copies itself when clicked. No separate button.
export function CopyableId({ value, className = "" }) {
  return (
    <button
      type="button"
      title="Click to copy"
      aria-label={`Copy ${value}`}
      onClick={() => copyText(value)}
      className={`max-w-full truncate rounded-md bg-(--mws-soft) px-2 py-0.5 text-left font-mono text-xs font-semibold text-(--mws-charcoal) transition hover:bg-(--mws-line) focus-visible:outline-2 focus-visible:outline-(--mws-burgundy) ${className}`}
    >
      {value}
    </button>
  );
}
