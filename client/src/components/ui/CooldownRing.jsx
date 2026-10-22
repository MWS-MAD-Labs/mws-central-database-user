// A burgundy ring on the edge of a button that is waiting, no bigger than the button itself. The arc starts whole and shortens clockwise as the wait runs out,
// so the time left can be seen. `left` and `total` are in seconds; with nothing left the ring is not drawn.
// `radius` is half the height of the button (16 for the usual 32px one), so a pill stays a pill and not an oval.
export function CooldownRing({ left, total, children, className = "", radius = 16 }) {
  const waiting = left > 0 && total > 0;
  const arc = Math.min(100, Math.max(0, (left / total) * 100));
  return (
    <span className={`relative inline-flex ${className}`} data-cooldown={waiting ? left : undefined}>
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
            data-testid="cooldown-arc"
            pathLength="100"
            fill="none"
            stroke="var(--mws-burgundy)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="100"
            strokeDashoffset={100 - arc}
            className="transition-[stroke-dashoffset] duration-1000 ease-linear motion-reduce:transition-none"
            style={{ x: 1, y: 1, width: "calc(100% - 2px)", height: "calc(100% - 2px)", rx: radius - 1, ry: radius - 1 }}
          />
        </svg>
      ) : null}
    </span>
  );
}
