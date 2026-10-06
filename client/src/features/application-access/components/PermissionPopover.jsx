import { ListChecks } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { groupPermissions } from "../utils/groupSummary.js";

// "15 permissions" that opens a readable list, grouped by area.
export function PermissionPopover({ permissions, className = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === "keydown" ? event.key === "Escape" : !ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const label = `${permissions.length} permission${permissions.length === 1 ? "" : "s"}`;
  if (permissions.length === 0) return <span className={`text-xs text-(--mws-muted) ${className}`}>{label}</span>;

  return (
    <span ref={ref} className={`relative inline-block ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-(--mws-muted) transition-colors hover:text-(--mws-burgundy)"
      >
        <ListChecks size={13} aria-hidden="true" />
        {label}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Permissions"
          className="absolute left-0 top-full z-30 mt-2 w-80 max-w-[85vw] max-h-72 space-y-3 overflow-y-auto rounded-2xl border border-(--mws-line) bg-white p-4 shadow-lg"
        >
          {groupPermissions(permissions).map((group) => (
            <div key={group.area}>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-(--mws-muted)">{group.area} <span className="font-normal">{group.items.length}</span></p>
              <ul className="flex flex-wrap gap-1.5">
                {group.items.map((item) => (
                  <li key={item} className="rounded bg-(--mws-soft) px-1.5 py-0.5 font-mono text-[11px] text-(--mws-charcoal)">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </span>
  );
}
