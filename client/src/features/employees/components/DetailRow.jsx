export function DetailRow({ label, value, compact = false, warning }) {
  return (
    <div className="grid min-w-0 gap-1 border-b border-[var(--mws-line)] py-3 last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)]">
      <dt className="text-sm font-medium text-[var(--mws-muted)]">{label}</dt>
      <dd>
        <span
          className={
            compact
              ? warning
                ? 'break-words text-sm text-[#a43c41]'
                : 'break-words text-sm text-[var(--mws-charcoal)]'
              : warning
                ? 'break-words text-sm font-medium text-[#a43c41]'
                : 'break-words text-sm font-medium text-[var(--mws-charcoal)]'
          }
        >
          {value || '-'}
        </span>
        {warning ? (
          <span className="mt-0.5 block text-xs font-medium text-[#a43c41]">
            {warning}
          </span>
        ) : null}
      </dd>
    </div>
  )
}


