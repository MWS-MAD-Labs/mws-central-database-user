// A burgundy ring around a button that is waiting. The arc starts whole and shortens clockwise as the wait runs out,
// so the time left can be seen. `left` and `total` are in seconds; with nothing left the ring is not drawn.
export function CooldownRing({ left, total, children, className = "" }) {
  const waiting = left > 0 && total > 0;
  const arc = Math.min(100, Math.max(0, (left / total) * 100));
  return (
    <span className={`relative inline-flex ${className}`} data-cooldown={waiting ? left : undefined}>
      {children}
      {waiting ? (
        <svg aria-hidden="true" className="pointer-events-none absolute -inset-1 h-[calc(100%+8px)] w-[calc(100%+8px)] overflow-visible" focusable="false">
          <rect
            pathLength="100"
            fill="none"
            stroke="var(--mws-burgundy)"
            strokeOpacity="0.15"
            strokeWidth="2"
            style={{ x: 1, y: 1, width: "calc(100% - 2px)", height: "calc(100% - 2px)", rx: 9999 }}
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
            style={{ x: 1, y: 1, width: "calc(100% - 2px)", height: "calc(100% - 2px)", rx: 9999 }}
          />
        </svg>
      ) : null}
    </span>
  );
}
