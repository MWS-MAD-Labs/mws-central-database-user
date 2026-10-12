import { Link } from "react-router";
import { cn } from "../../../../lib/cn.js";

// The parts of the guide. It stays in view while the part is read, and on a narrow screen it becomes a row of tabs.
export function GuideNav({ parts, current, hrefFor }) {
  return (
    <nav
      aria-label="Parts of the guide"
      className="sticky top-14 z-10 -mx-4 overflow-x-auto bg-[#fffafa]/95 px-4 py-2 backdrop-blur sm:mx-0 sm:px-0 lg:top-24 lg:self-start lg:bg-transparent lg:py-0"
    >
      <ol className="flex gap-1 lg:flex-col">
        {parts.map((part, index) => {
          const active = part.id === current;
          return (
            <li key={part.id} className="shrink-0">
              <Link
                to={hrefFor(part.id)}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-(--mws-burgundy) text-white" : "text-(--mws-muted) hover:bg-(--mws-soft) hover:text-(--mws-charcoal)",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                    active ? "bg-white/20" : "bg-(--mws-soft)",
                  )}
                >
                  {index + 1}
                </span>
                <span className="whitespace-nowrap">{part.label}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
