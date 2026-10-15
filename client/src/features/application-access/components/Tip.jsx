import { Info } from "lucide-react";

// A small info icon that explains itself on hover or focus.
export function Tip({ text, label = "More info" }) {
  return (
    <span
      tabIndex={0}
      role="img"
      aria-label={`${label}: ${text}`}
      title={text}
      className="inline-flex h-4 w-4 cursor-help items-center justify-center leading-none text-(--mws-muted) transition-colors hover:text-(--mws-burgundy) focus-visible:text-(--mws-burgundy) focus-visible:outline-none"
    >
      <Info size={15} aria-hidden="true" className="-translate-y-px" />
    </span>
  );
}
