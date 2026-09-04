import { cn } from "../../../lib/cn.js";
import { workspaceTabs } from "../utils/workspaceTabs.js";

export function WorkspaceTabs({ activeTab, onChange }) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-[var(--mws-line)] bg-[var(--mws-soft)] px-2">
      {workspaceTabs.map((tab) => {
        const isActive = tab.id === activeTab;

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-4 py-2.5 font-display text-sm font-semibold transition-colors",
              isActive
                ? "border-[var(--mws-burgundy)] bg-white text-[var(--mws-burgundy)]"
                : "border-transparent text-[var(--mws-muted)] hover:text-[var(--mws-charcoal)]",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
