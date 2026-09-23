import { LockKeyhole } from "lucide-react";

export function RestrictedDashboardPanel({ title, message, className = "" }) {
  return (
    <div
      className={`flex min-h-52 min-w-0 flex-col items-center justify-center rounded-xl border border-dashed border-(--mws-line) bg-(--mws-soft) p-5 text-center ${className}`}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-(--mws-muted)">
        <LockKeyhole size={18} />
      </div>
      <p className="mt-3 font-display text-sm font-bold text-(--mws-charcoal)">
        {title}
      </p>
      <span className="mt-2 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-(--mws-muted)">
        Restricted
      </span>
      <p className="mt-3 max-w-xs text-xs leading-5 text-(--mws-muted)">
        {message}
      </p>
    </div>
  );
}
