export function DetailRow({ label, value, compact = false }) {
  return (
    <div className="grid min-w-0 gap-1 border-b border-[var(--mws-line)] py-3 last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)]">
      <dt className="text-sm font-medium text-[var(--mws-muted)]">{label}</dt>
      <dd
        className={
          compact
            ? "break-words text-sm text-[var(--mws-charcoal)]"
            : "break-words text-sm font-medium text-[var(--mws-charcoal)]"
        }
      >
        {value || "-"}
      </dd>
    </div>
  );
}