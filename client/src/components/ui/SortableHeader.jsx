import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '../../lib/cn.js'

export function SortableHeader({ label, column, sortBy, sortOrder, onSort }) {
  const isActive = sortBy === column
  const nextOrder = isActive && sortOrder === 'asc' ? 'desc' : 'asc'

  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1 text-left hover:text-[#24463f]',
        isActive && 'text-[#24463f]',
      )}
      onClick={() => onSort(column, nextOrder)}
    >
      {label}
      {isActive && sortOrder === 'asc' ? <ArrowUp size={13} /> : null}
      {isActive && sortOrder === 'desc' ? <ArrowDown size={13} /> : null}
    </button>
  )
}
