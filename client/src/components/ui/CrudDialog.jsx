import { X } from 'lucide-react'
import { Button } from './Button.jsx'

export function CrudDialog({ title, description, children, footer, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#24171899] px-4 py-8">
      <div className="w-full max-w-2xl rounded-3xl border border-[var(--mws-line)] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--mws-line)] px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-bold text-[var(--mws-charcoal)]">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm leading-6 text-[var(--mws-muted)]">{description}</p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={18} />
          </Button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-[var(--mws-line)] px-5 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}
