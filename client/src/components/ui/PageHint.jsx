import { useState } from 'react'
import { Info, X } from 'lucide-react'
import { dismissHint, isHintDismissed } from '../../lib/pageHints.js'

// A small explainer for a page/panel that isn't self-evident from its
// own UI - not a substitute for inline field help, which stays where it
// already is. `id` must be unique across the app (used as the dismissal
// key) and stable across renders (don't derive it from anything that
// changes, e.g. a record id).
export function PageHint({ id, children }) {
  const [dismissed, setDismissed] = useState(() => isHintDismissed(id))
  const [open, setOpen] = useState(false)

  if (dismissed) return null

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {open ? (
        <div className="w-72 rounded-2xl border border-[var(--mws-line)] bg-white p-4 text-sm text-[var(--mws-charcoal)] shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <p className="leading-relaxed">{children}</p>
            <button
              type="button"
              onClick={() => {
                dismissHint(id)
                setDismissed(true)
              }}
              className="shrink-0 rounded-full p-1 text-[var(--mws-muted)] hover:bg-[var(--mws-soft)] hover:text-[var(--mws-charcoal)]"
              aria-label="Dismiss hint"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--mws-burgundy)] text-white shadow-md hover:bg-[var(--mws-burgundy-dark)]"
        aria-label="Page hint"
      >
        <Info size={13} />
      </button>
    </div>
  )
}
