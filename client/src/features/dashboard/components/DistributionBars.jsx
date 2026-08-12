import { formatNumber } from "../utils/dashboardFormatters";
import { cn } from "../../../lib/cn";

export function DistributionBars({ title, rows }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="min-w-0 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-4">
      <p className="mb-3 font-display text-sm font-bold text-[var(--mws-charcoal)]">
        {title}
      </p>
      <div className="grid gap-3">
        {rows.length > 0 ? (
          rows.map((row, index) => {
            const percentage = total > 0 ? (row.value / total) * 100 : 0;
            return (
              <div key={row.label} className="min-w-0">
                <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                  <span className="truncate font-semibold text-[var(--mws-muted)]">
                    {row.label}
                  </span>
                  <span className="shrink-0 font-bold text-[var(--mws-charcoal)]">
                    {formatNumber(row.value)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      index % 3 === 0 && "bg-[var(--mws-burgundy)]",
                      index % 3 === 1 && "bg-[#476b43]",
                      index % 3 === 2 && "bg-[#d3a22b]",
                    )}
                    style={{
                      width: `${Math.max(percentage, row.value ? 4 : 0)}%`,
                    }}
                  />
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-sm text-[var(--mws-muted)]">No data yet.</p>
        )}
      </div>
    </div>
  );
}