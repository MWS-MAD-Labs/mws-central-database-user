import { useEffect, useRef } from "react";

const nowMs = () => Date.now();

// The share of the whole wait that is left, 0 to 1.
function shareLeft(until, total) {
  if (!until || !total) return 0;
  return Math.min(1, Math.max(0, (Date.parse(until) - nowMs()) / (total * 1000)));
}

// A burgundy ring on the edge of a button that is waiting, no bigger than the button itself. The arc starts at the share
// of the wait that is left and runs clockwise down to nothing in exactly the time that is left, so it ends when the
// wait does. It is moved by the clock (the browser's animation), not by the page being drawn again each second, so it
// does not stall or jump. `radius` is half the height of the button (16 for the usual 32px one), so a pill stays a pill.
export function CooldownRing({ waiting, until, total, children, className = "", radius = 16 }) {
  const arc = useRef(null);
  const start = waiting ? shareLeft(until, total) : 0;

  useEffect(() => {
    const node = arc.current;
    if (!waiting || !node || typeof node.animate !== "function") return undefined;
    const left = Date.parse(until) - nowMs();
    if (left <= 0) return undefined;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const run = node.animate(
      [{ strokeDashoffset: 100 - shareLeft(until, total) * 100 }, { strokeDashoffset: 100 }],
      { duration: left, easing: "linear", fill: "forwards" },
    );
    return () => run.cancel();
  }, [waiting, until, total]);

  return (
    <span className={`relative inline-flex ${className}`} data-cooldown={waiting ? "on" : undefined}>
      {children}
      {waiting ? (
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" focusable="false">
          <rect
            pathLength="100"
            fill="none"
            stroke="var(--mws-burgundy)"
            strokeOpacity="0.15"
            strokeWidth="2"
            style={{ x: 1, y: 1, width: "calc(100% - 2px)", height: "calc(100% - 2px)", rx: radius - 1, ry: radius - 1 }}
          />
          <rect
            ref={arc}
            data-testid="cooldown-arc"
            pathLength="100"
            fill="none"
            stroke="var(--mws-burgundy)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="100"
            strokeDashoffset={100 - start * 100}
            style={{ x: 1, y: 1, width: "calc(100% - 2px)", height: "calc(100% - 2px)", rx: radius - 1, ry: radius - 1 }}
          />
        </svg>
      ) : null}
    </span>
  );
}
