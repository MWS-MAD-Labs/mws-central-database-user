import { ChevronDown } from "lucide-react";
import { ActionsMenu } from "../../../components/ui/ActionsMenu.jsx";
import { groupScopes } from "../utils/scopes.js";

// One compact pill per scope group; the list opens on click, like the
// permission groups on the Admin Users page.
export function ScopeGroupPills({ scopes, emptyLabel = "No scopes" }) {
  if (!scopes?.length) {
    return <span className="text-xs text-(--mws-muted)">{emptyLabel}</span>;
  }

  return (
    <div className="flex max-w-md flex-wrap gap-1.5">
      {groupScopes(scopes).map(({ group, items }) => {
        const hasSensitive = items.some((item) => item.sensitive);
        return (
          <ActionsMenu
            key={group}
            label={`${group} scopes`}
            renderTrigger={({ onClick, isOpen }) => (
              <button
                type="button"
                onClick={onClick}
                aria-label={`${group} scopes`}
                className="inline-flex items-center gap-1.5 rounded-full border border-(--mws-line) bg-white px-2.5 py-1 text-xs font-semibold text-(--mws-charcoal) transition hover:border-(--mws-burgundy)"
              >
                {hasSensitive ? (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#a43c41]"
                    title="Includes sensitive data"
                  />
                ) : null}
                {group}
                <span className="rounded-full bg-(--mws-soft) px-1.5 text-[11px] text-(--mws-muted)">
                  {items.length}
                </span>
                <ChevronDown
                  size={12}
                  className={`shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
            )}
          >
            {() => (
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.name} className="rounded-xl px-3 py-2" title={item.name}>
                    <p className="text-sm font-medium text-(--mws-charcoal)">
                      {item.title}
                      {item.sensitive ? (
                        <span className="ml-1.5 text-xs font-semibold text-[#a43c41]">
                          Sensitive
                        </span>
                      ) : null}
                    </p>
                    {item.description ? (
                      <p className="text-xs text-(--mws-muted)">{item.description}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </ActionsMenu>
        );
      })}
    </div>
  );
}

// Static grouped list for places where a pill menu would hide the preview.
export function ScopeGroupList({ scopes, emptyLabel }) {
  if (!scopes?.length) {
    return <p className="text-sm text-(--mws-muted)">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-3">
      {groupScopes(scopes).map(({ group, items }) => (
        <div key={group}>
          <p className="mb-1 font-display text-xs font-bold text-(--mws-muted)">{group}</p>
          <ul className="space-y-0.5 text-sm text-(--mws-charcoal)">
            {items.map((item) => (
              <li key={item.name} title={item.name}>
                {item.title}
                {item.sensitive ? (
                  <span className="ml-1.5 text-xs font-semibold text-[#a43c41]">Sensitive</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
