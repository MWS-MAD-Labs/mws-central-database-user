import { LiveIndicator } from "../../../components/ui/LiveIndicator.jsx";
import { LockKeyhole } from "lucide-react";
import { formatNumber } from "../utils/dashboardFormatters";

export function MetricCard({ metric, isLoading, isSyncing }) {
  const Icon = metric.icon;

  return (
    <div className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
          <Icon size={19} />
        </div>
        {metric.restricted ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-(--mws-soft) px-2.5 py-1 text-xs font-semibold text-(--mws-muted)">
            <LockKeyhole size={12} />
            Restricted
          </span>
        ) : (
          <LiveIndicator isSyncing={isSyncing} />
        )}
      </div>
      <p className="font-display text-3xl font-extrabold text-(--mws-charcoal)">
        {metric.restricted
          ? "Restricted"
          : isLoading
            ? "-"
            : formatNumber(metric.value || 0)}
      </p>
      <p className="mt-1 text-sm text-(--mws-muted)">{metric.label}</p>
      <p className="mt-3 text-xs leading-5 text-(--mws-muted)">
        {metric.caption}
      </p>
    </div>
  );
}
