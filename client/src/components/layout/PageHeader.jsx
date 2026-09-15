import { RefreshCw } from 'lucide-react'

// onRefresh/isFetching are optional - a page force-refetches its own
// queries (a change made elsewhere, e.g. a different page/tab entirely,
// doesn't otherwise reach this page's cache until it's manually refetched
// or the browser is reloaded).
export function PageHeader({ title, description, actions, onRefresh, isFetching }) {
  return (
    <div className="mb-6 flex min-w-0 flex-col gap-4 border-b border-[var(--mws-line)] pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="break-words font-display text-2xl font-bold text-[var(--mws-burgundy)] md:text-3xl">
            {title}
          </h1>
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isFetching}
              title="Refresh"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--mws-muted)] hover:bg-[var(--mws-soft)] hover:text-[var(--mws-charcoal)] disabled:opacity-50"
            >
              <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
            </button>
          ) : null}
        </div>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--mws-muted)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  )
}
