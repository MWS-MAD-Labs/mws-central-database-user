import { X } from 'lucide-react'
import { Button } from './Button.jsx'

export function BulkActionBar({ selectedCount, children, onClear }) {
  if (!selectedCount) return null

  return (
    <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--mws-line)] bg-[#fffaf0] px-4 py-3 text-sm text-[#8a6419] lg:flex-row lg:items-center lg:justify-between">
      <p className="font-semibold">
        {selectedCount} selected
      </p>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        {children}
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          <X size={15} />
          Clear
        </Button>
      </div>
    </div>
  )
}
