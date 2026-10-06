import { ListChecks } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { groupPermissions } from "../utils/groupSummary.js";

const GAP = 8;
const WIDTH = 320;
const MAX_HEIGHT = 288;

// "15 permissions" that opens a readable list, grouped by area. The list is
// portaled so a table or card edge never clips it. `compact` shows only the count.
export function PermissionPopover({ permissions, compact = false, className = "" }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const upward = below < MAX_HEIGHT + GAP && rect.top > below;
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8)),
      top: upward ? undefined : rect.bottom + GAP,
      bottom: upward ? window.innerHeight - rect.top + GAP : undefined,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === "keydown") {
        if (event.key === "Escape") setOpen(false);
        return;
      }
      if (event.type === "mousedown") {
        const inside = triggerRef.current?.contains(event.target) || panelRef.current?.contains(event.target);
        if (!inside) setOpen(false);
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const count = permissions.length;
  const label = `${count} permission${count === 1 ? "" : "s"}`;
  if (count === 0) {
    return <span className={`text-xs text-(--mws-muted) ${className}`}>{compact ? "0" : label}</span>;
  }

  return (
    <span className={`inline-block ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={compact ? label : undefined}
        aria-expanded={open}
        title={compact ? label : undefined}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex cursor-pointer items-center gap-1 text-xs font-semibold transition-colors hover:text-(--mws-burgundy) ${
          compact ? "text-sm text-(--mws-charcoal)" : "text-(--mws-muted)"
        }`}
      >
        {compact ? null : <ListChecks size={13} aria-hidden="true" />}
        {compact ? count : label}
      </button>
      {open && position
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label="Permissions"
              style={{ left: position.left, top: position.top, bottom: position.bottom, width: WIDTH, maxHeight: MAX_HEIGHT }}
              className="fixed z-50 max-w-[calc(100vw-16px)] space-y-3 overflow-y-auto rounded-2xl border border-(--mws-line) bg-white p-4 text-left shadow-lg"
            >
              {groupPermissions(permissions).map((group) => (
                <div key={group.area}>
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-(--mws-muted)">
                    {group.area} <span className="font-normal">{group.items.length}</span>
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {group.items.map((item) => (
                      <li key={item} className="rounded bg-(--mws-soft) px-1.5 py-0.5 font-mono text-[11px] text-(--mws-charcoal)">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
