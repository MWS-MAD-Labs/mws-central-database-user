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
              className="shrink-0 rounded-full p-1 text-(--mws-muted) hover:bg-(--mws-soft) hover:text-(--mws-charcoal)"
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
