import { formatNumber } from "../utils/dashboardFormatters";

export function GenderDonut({ title, rows }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  const male = rows.find((row) => row.label === "Male")?.value || 0;
  const female = rows.find((row) => row.label === "Female")?.value || 0;

  const malePercentage = total > 0 ? (male / total) * 100 : 0;
  const femalePercentage = total > 0 ? (female / total) * 100 : 0;

  return (
    <div className="min-w-0 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-4">
      <p className="mb-4 font-display text-sm font-bold text-[var(--mws-charcoal)]">
        {title}
      </p>

      <div className="flex items-center gap-6">
        <div
          className="relative flex h-32 w-32 shrink-0 items-center justify-center rounded-full"
          style={{
            background: `conic-gradient(
              var(--mws-burgundy) 0 ${malePercentage}%,
              #476b43 ${malePercentage}% 100%
            )`,
          }}
        >
          <div className="flex h-20 w-20 flex-col items-center justify-center rounded-full bg-[var(--mws-soft)]">
            <span className="font-display text-xl font-extrabold text-[var(--mws-charcoal)]">
              {formatNumber(total)}
            </span>
            <span className="text-[10px] font-semibold text-[var(--mws-muted)]">
              Total
            </span>
          </div>
        </div>

        <div className="grid min-w-0 gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--mws-burgundy)]" />
              <span className="text-xs font-semibold text-[var(--mws-muted)]">
                Male
              </span>
            </div>

            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-display text-lg font-extrabold text-[var(--mws-charcoal)]">
                {formatNumber(male)}
              </span>
              <span className="text-xs text-[var(--mws-muted)]">
                {malePercentage.toFixed(1)}%
              </span>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#476b43]" />
              <span className="text-xs font-semibold text-[var(--mws-muted)]">
                Female
              </span>
            </div>

            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-display text-lg font-extrabold text-[var(--mws-charcoal)]">
                {formatNumber(female)}
              </span>
              <span className="text-xs text-[var(--mws-muted)]">
                {femalePercentage.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}