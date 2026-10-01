import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { PaginationBar } from './PaginationBar.jsx'
import { StatusBadge } from './StatusBadge.jsx'
import { TextInput } from './FormControls.jsx'

const ROW_HEIGHT_PX = 40
const MAX_ROWS_FOR_MIN_HEIGHT = 10

// Pick one item from a server-paged list. Rows are single-line radios with no
// inner scroll; the list keeps its height while the next page loads so a
// dialog around it does not jump.
export function PaginatedSingleSelect({
  options,
  value,
  paging,
  search,
  isLoading,
  itemLabel,
  emptyMessage,
  onChange,
  onSearchChange,
  onPageChange,
  onPageSizeChange,
}) {
  // Search waits for a short pause in typing instead of querying per key.
  const [draft, setDraft] = useState(search ?? '')
  const onSearchChangeRef = useRef(onSearchChange)
  useEffect(() => {
    onSearchChangeRef.current = onSearchChange
  })
  useEffect(() => {
    if (draft === (search ?? '')) return undefined
    const timer = setTimeout(() => onSearchChangeRef.current(draft), 300)
    return () => clearTimeout(timer)
  }, [draft, search])

  const minHeight =
    Math.min(paging?.size || 10, MAX_ROWS_FOR_MIN_HEIGHT) * ROW_HEIGHT_PX

  return (
    <div className="space-y-2">
      <div className="relative">
        <TextInput
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={`Search ${itemLabel}s`}
          className="pr-9"
        />
        {draft ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setDraft('')
              onSearchChange('')
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-(--mws-muted) hover:text-(--mws-charcoal)"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-xl border border-(--mws-line)">
        <div
          className="divide-y divide-(--mws-line)"
          role="radiogroup"
          aria-label={itemLabel}
          style={{ minHeight }}
        >
          {options.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-(--mws-muted)">
              {isLoading ? `Loading ${itemLabel}s...` : emptyMessage || `No ${itemLabel}s found.`}
            </p>
          ) : (
            options.map((option) => (
              <label
                key={option.value}
                title={option.description}
                className="flex h-10 cursor-pointer items-center gap-3 px-3 hover:bg-(--mws-soft)"
              >
                <input
                  type="radio"
                  name={`pick-${itemLabel}`}
                  checked={value === option.value}
                  onChange={() => onChange(option.value, option)}
                  className="h-4 w-4 shrink-0 accent-(--mws-burgundy)"
                />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold text-(--mws-charcoal)">{option.label}</span>
                  {option.description ? (
                    <span className="ml-2 text-xs text-(--mws-muted)">{option.description}</span>
                  ) : null}
                </span>
                {option.badge ? (
                  <StatusBadge tone={option.tone}>{option.badge}</StatusBadge>
                ) : null}
              </label>
            ))
          )}
        </div>
        <PaginationBar
          paging={paging}
          itemLabel={`${itemLabel}s`}
          isLoading={isLoading}
          onPrevious={() => onPageChange(paging.current_page - 1)}
          onNext={() => onPageChange(paging.current_page + 1)}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          showPageJump={false}
        />
      </div>
    </div>
  )
}
