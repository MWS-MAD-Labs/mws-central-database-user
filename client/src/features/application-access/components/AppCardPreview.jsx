import { DEFAULT_ICON, HUB_ICONS } from "../utils/hubIcons.js";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";

const CATEGORY_LABELS = {
  reporting: "Reporting",
  students: "Students",
  workplace: "Workplace",
  operations: "Operations",
  utilities: "Utilities",
};

// A small stand-in for the card the Hub will show, so the form has something to look at.
export function AppCardPreview({ values }) {
  const Icon = HUB_ICONS[values.icon?.trim()] || HUB_ICONS[DEFAULT_ICON];
  const name = values.name?.trim();
  const description = values.description?.trim();
  const launch = values.launch_url?.trim();

  return (
    <div className="space-y-3 rounded-2xl border border-(--mws-line) bg-white p-5">
      <p className="font-display text-xs font-bold uppercase tracking-wide text-(--mws-muted)">Preview</p>
      <div className="min-w-0 overflow-hidden rounded-xl border border-(--mws-line) bg-(--mws-soft) p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-(--mws-burgundy) shadow-sm">
            <Icon size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p
              title={name || undefined}
              className={`truncate font-display text-sm font-bold ${name ? "text-(--mws-charcoal)" : "text-(--mws-muted)"}`}
            >
              {name || "Application name"}
            </p>
            <p title={description || undefined} className="mt-0.5 line-clamp-2 break-all text-xs leading-5 text-(--mws-muted)">
              {description || "A short line about what people use it for."}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge tone="neutral">{CATEGORY_LABELS[values.category] || "Utilities"}</StatusBadge>
          <span className="min-w-0 truncate text-xs text-(--mws-muted)">{launch ? `Opens ${launch}` : "No launch address yet"}</span>
        </div>
      </div>
    </div>
  );
}
