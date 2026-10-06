import { ListChecks } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const GAP = 8;
const WIDTH = 320;
const MAX_HEIGHT = 288;

// A count that opens a readable list of chips, grouped under optional titles.
// The list is portaled so a table or card edge never clips it.
// `groups` is [{ title?, items: string[] }]. `compact` shows only the number.
export function ListPopover({
  label,
  count,
  groups,
  dialogLabel,
  compact = false,
  icon = true,
  mono = true,
  className = "",
}) {
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
    const inside = (target) => triggerRef.current?.contains(target) || panelRef.current?.contains(target);
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event) => {
      if (!inside(event.target)) setOpen(false);
    };
    // Scrolling the list itself must not close it, only the page behind.
    const onScroll = (event) => {
      if (!inside(event.target)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

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
        className={`inline-flex cursor-pointer items-center gap-1 font-semibold transition-colors hover:text-(--mws-burgundy) ${
          compact ? "text-sm text-(--mws-charcoal)" : "text-xs text-(--mws-muted)"
        }`}
      >
        {compact || !icon ? null : <ListChecks size={13} aria-hidden="true" />}
        {compact ? count : label}
      </button>
      {open && position
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={dialogLabel}
              style={{ left: position.left, top: position.top, bottom: position.bottom, width: WIDTH, maxHeight: MAX_HEIGHT }}
              className="fixed z-50 max-w-[calc(100vw-16px)] space-y-3 overflow-y-auto rounded-2xl border border-(--mws-line) bg-white p-4 text-left shadow-lg"
            >
              {groups.map((group) => (
                <div key={group.title ?? "all"}>
                  {group.title ? (
                    <p className="mb-1 text-xs font-bold uppercase tracking-wide text-(--mws-muted)">
                      {group.title} <span className="font-normal">{group.items.length}</span>
                    </p>
                  ) : null}
                  <ul className="flex flex-wrap gap-1.5">
                    {group.items.map((item) => (
                      <li
                        key={item}
                        className={`rounded bg-(--mws-soft) px-1.5 py-0.5 text-[11px] text-(--mws-charcoal) ${
                          mono ? "font-mono" : "font-medium"
                        }`}
                      >
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
