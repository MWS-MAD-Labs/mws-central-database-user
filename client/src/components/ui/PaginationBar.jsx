import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './Button.jsx'
import { SearchableSelect } from './FormControls.jsx'

const PAGE_SIZE_OPTIONS = [10, 30, 50, 100].map((size) => ({
  value: String(size),
  label: String(size),
}))

export function PaginationBar({
  paging,
  itemLabel,
  isLoading,
  onPrevious,
  onNext,
  onPageSizeChange,
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
      </div>
    </div>
  )
}
