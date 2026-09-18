import { Eye, RefreshCw } from 'lucide-react'
import { Button } from '../../../../components/ui/Button.jsx'
import { StatusBadge } from '../../../../components/ui/StatusBadge.jsx'


export function PanelFrame({ title, icon: Icon, isFetching, onRefresh, action, children }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-(--mws-line) bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="flex min-w-0 flex-col gap-3 border-b border-(--mws-line) p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
            <Icon size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-(--mws-charcoal)">{title}</h2>
              <StatusBadge tone={isFetching ? 'amber' : 'green'}>
                {isFetching ? 'Syncing' : 'Live'}
              </StatusBadge>
              {onRefresh ? (
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={isFetching}
                  title="Refresh"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-(--mws-muted) hover:bg-(--mws-soft) hover:text-(--mws-charcoal) disabled:opacity-50"
                >
                  <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">{action}</div>
      </div>
      <div className="min-w-0 p-5">{children}</div>
    </section>
  )
}

export function SensitiveDataReveal({ icon, title, onReveal }) {
  return (
    <PanelFrame title={title} icon={icon} isFetching={false}>
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <Button type="button" variant="secondary" size="sm" onClick={onReveal}>
          <Eye size={15} />
          Show {title}
        </Button>
      </div>
    </PanelFrame>
  )
}

export function SummaryCard({ label, value, tone = 'neutral' }) {
  return (
    <div className="min-w-0 rounded-2xl border border-(--mws-line) bg-(--mws-soft) p-4">
      <p className="text-xs font-semibold text-(--mws-muted)">{label}</p>
      <StatusBadge tone={tone} className="mt-2">{value}</StatusBadge>
    </div>
  )
}

export function DialogFooter({ form, isSubmitting, onClose }) {
  return (
    <>
      <Button type="button" variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" form={form} disabled={isSubmitting}>
        Save
      </Button>
    </>
  )
}
