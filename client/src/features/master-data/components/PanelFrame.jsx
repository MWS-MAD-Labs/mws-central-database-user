import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'

export function PanelFrame({
  title,
  description,
  icon: Icon,
  action,
  toolbar,
  isFetching,
  notice,
  children,
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--mws-line)] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
            <Icon size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-[var(--mws-charcoal)]">
                {title}
              </h2>
              <StatusBadge tone={isFetching ? 'amber' : 'green'}>
                {isFetching ? 'Syncing' : 'Live'}
              </StatusBadge>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--mws-muted)]">
              {description}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
          {action}
        </div>
      </div>
      {toolbar ? (
        <div className="flex min-w-0 flex-col gap-2 border-b border-[var(--mws-line)] p-4 lg:flex-row lg:items-center">
          {toolbar}
        </div>
      ) : null}
      {notice ? (
        <div className="border-b border-[var(--mws-line)] bg-[#fffaf0] px-4 py-3 text-sm text-[#8a6419]">
          {notice}
        </div>
      ) : null}
      <div className="w-full min-w-0 overflow-x-auto">{children}</div>
    </section>
  )
}
