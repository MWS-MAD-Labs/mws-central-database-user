import { useEffect, useRef, useState } from 'react'
import { Eye, X } from 'lucide-react'
import { Link } from 'react-router'
import { PaginationBar } from './PaginationBar.jsx'
import { StatusBadge } from './StatusBadge.jsx'
import { TextInput } from './FormControls.jsx'

const ROW_HEIGHT_PX = 52
const MAX_ROWS_FOR_MIN_HEIGHT = 10

// Pick one item from a server-paged list, laid out like the students in Enroll Student (a checkbox per row, but only
// one can be on: checking another moves the pick, unchecking clears it): a search box, a box with one
// row per item (name, a muted line under it, an optional badge and an eye that opens the item in a new tab when it has
// an `href`) and the page bar inside the box. No inner scroll; the list keeps its height while the next page loads so
// a dialog around it does not jump.
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
      <div className="overflow-hidden rounded-xl border border-(--mws-line) bg-white">
        <div
          className="divide-y divide-(--mws-line)"
          role="group"
          aria-label={itemLabel}
          style={{ minHeight }}
        >
          {options.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-(--mws-muted)">
              {isLoading ? `Loading ${itemLabel}s...` : emptyMessage || `No ${itemLabel}s found.`}
            </p>
          ) : (
            options.map((option) => (
              <div
                key={option.value}
                className="flex min-w-0 items-center gap-3 px-3 py-2 hover:bg-(--mws-soft)"
                style={{ minHeight: ROW_HEIGHT_PX }}
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={value === option.value}
                    onChange={(event) => (event.target.checked ? onChange(option.value, option) : onChange('', null))}
                    className="h-4 w-4 shrink-0 accent-(--mws-burgundy)"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-display text-sm font-bold text-(--mws-charcoal)">{option.label}</span>
                    {option.description ? (
                      <span className="block truncate text-xs text-(--mws-muted)">{option.description}</span>
                    ) : null}
                  </span>
                </label>
                {option.badge ? <StatusBadge tone={option.tone}>{option.badge}</StatusBadge> : null}
                {option.href ? (
                  <Link
                    to={option.href}
                    target="_blank"
                    rel="noreferrer"
                    title={`Open ${option.label} in a new tab`}
                    aria-label={`Open ${option.label} in a new tab`}
                    className="shrink-0 rounded-lg p-1.5 text-(--mws-muted) hover:bg-white hover:text-(--mws-burgundy)"
                  >
                    <Eye size={15} />
                  </Link>
                ) : null}
              </div>
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
