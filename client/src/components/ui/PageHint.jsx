import { useState } from 'react'
import { Info, X } from 'lucide-react'
import { dismissHint, isHintDismissed } from '../../lib/pageHints.js'

export function PageHint({ id, children }) {
  const [dismissed, setDismissed] = useState(() => isHintDismissed(id))
  const [open, setOpen] = useState(false)

  if (dismissed) return null

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {open ? (
        <div className="w-72 rounded-2xl border border-(--mws-line) bg-white p-4 text-sm text-(--mws-charcoal) shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <p className="leading-relaxed">{children}</p>
            <button
              type="button"
              onClick={() => {
                dismissHint(id)
                setDismissed(true)
              }}
              className="flex h-7 w-7 min-w-7 shrink-0 aspect-square items-center justify-center rounded-full border border-transparent text-(--mws-muted) transition hover:border-(--mws-line) hover:bg-(--mws-soft) hover:text-(--mws-charcoal) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--mws-burgundy)"
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
        className="flex h-7 w-7 items-center justify-center rounded-full bg-(--mws-burgundy) text-white shadow-md hover:bg-(--mws-burgundy-dark)"
        aria-label="Page hint"
      >
        <Info size={13} />
      </button>
    </div>
  )
}
