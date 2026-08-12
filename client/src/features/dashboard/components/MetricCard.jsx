import { StatusBadge } from "../../../components/ui/StatusBadge";
import {formatNumber} from "../utils/dashboardFormatters"

export function MetricCard({ metric, isLoading, isSyncing }) {
  const Icon = metric.icon;

  return (
    <div className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
          <Icon size={19} />
        </div>
        <StatusBadge tone={isSyncing ? "amber" : metric.tone}>
          {isSyncing ? "Syncing" : "Live"}
        </StatusBadge>
      </div>
      <p className="font-display text-3xl font-extrabold text-[var(--mws-charcoal)]">
        {isLoading ? "-" : formatNumber(metric.value || 0)}
      </p>
      <p className="mt-1 text-sm text-[var(--mws-muted)]">{metric.label}</p>
      <p className="mt-3 text-xs leading-5 text-[var(--mws-muted)]">
        {metric.caption}
      </p>
    </div>
  );
}