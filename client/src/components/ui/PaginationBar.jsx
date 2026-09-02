import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Button } from './Button.jsx'
import { SearchableSelect } from './FormControls.jsx'

const PAGE_SIZE_OPTIONS = [10, 30, 50, 100].map((size) => ({
  value: String(size),
  label: String(size),
}))

// Same threshold as ImportPreviewPager's own jump input - Prev/Next alone
// stops being a fast way to reach a far-off page once there are enough of
// them (e.g. 30 pages of 10 rows each out of 299 bulk-photo files).
const JUMP_THRESHOLD_PAGES = 7

// onPageChange is optional - only callers with enough pages to need it pass
// it (see the threshold above), everyone else gets the same Prev/Next bar
// as before with no layout change.
function GoToPageJump({ totalPage, isLoading, onPageChange }) {
  const [value, setValue] = useState('')

  function handleSubmit(event) {
    event.preventDefault()
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= totalPage) {
      onPageChange(parsed)
    }
    setValue('')
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-1.5 text-sm font-semibold text-[var(--mws-muted)]"
    >
      Go to
      <input
        type="number"
        min={1}
        max={totalPage}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={isLoading}
        placeholder="Page"
        className="h-8 w-16 rounded-md border border-[var(--mws-line)] px-2 text-sm"
      />
      <Button type="submit" variant="secondary" size="sm" disabled={isLoading}>
        Go
      </Button>
    </form>
  )
}

export function PaginationBar({
  paging,
  itemLabel,
  isLoading,
  onPrevious,
  onNext,
  onPageSizeChange,
  onPageChange,
}) {
  const totalPage = Math.max(paging?.total_page || 1, 1)
  const currentPage = paging?.current_page || 1
  const totalItem = paging?.total_item || 0
  const pageSize = paging?.size || 10

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--mws-line)] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-[var(--mws-muted)]">
        Page {currentPage} of {totalPage} / {totalItem} {itemLabel}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {onPageSizeChange ? (
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--mws-muted)]">
            Rows
            <SearchableSelect
              value={String(pageSize)}
              onChange={(value) => onPageSizeChange(Number(value))}
              options={PAGE_SIZE_OPTIONS}
              disabled={isLoading}
              className="w-20"
              buttonClassName="h-8 w-20 rounded-full px-3"
              openUpward
            />
          </div>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={currentPage <= 1 || isLoading}
          onClick={onPrevious}
        >
          <ChevronLeft size={15} />
          Prev
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={currentPage >= totalPage || isLoading}
          onClick={onNext}
        >
          Next
          <ChevronRight size={15} />
        </Button>
        {onPageChange && totalPage > JUMP_THRESHOLD_PAGES ? (
          <GoToPageJump
            totalPage={totalPage}
            isLoading={isLoading}
            onPageChange={onPageChange}
          />
        ) : null}
      </div>
    </div>
  )
}
