import { useRef } from "react";
import { cn } from "../../lib/cn.js";

// Tabs as plain words on a thin line, the active one underlined. Left and right arrows move between them.
export function Tabs({ tabs, active, onChange, label }) {
  const refs = useRef([]);

  function move(event, index) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    refs.current[next]?.focus();
    onChange(tabs[next].id);
  }

  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-x-6 border-b border-(--mws-line)">
      {tabs.map((tab, index) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => move(event, index)}
            className={cn(
              "-mb-px cursor-pointer border-b-2 px-0.5 pb-2.5 pt-1 text-sm! font-semibold! transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--mws-burgundy)",
              selected ? "border-(--mws-burgundy) text-(--mws-burgundy)" : "border-transparent text-(--mws-muted) hover:text-(--mws-charcoal)",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
