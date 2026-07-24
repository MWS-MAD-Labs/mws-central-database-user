import { X } from 'lucide-react'
import { Button } from './Button.jsx'

export function CrudDialog({ title, description, children, footer, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 px-4 py-8">
      <div className="w-full max-w-2xl rounded-md border border-[#d8d6cf] bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#e7e4dc] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[#202326]">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm text-[#676c70]">{description}</p>
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
          <div className="flex justify-end gap-2 border-t border-[#e7e4dc] px-5 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}
