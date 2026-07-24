import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './Button.jsx'

export function PaginationBar({
  paging,
  itemLabel,
  isLoading,
  onPrevious,
  onNext,
}) {
  const totalPage = Math.max(paging?.total_page || 1, 1)
  const currentPage = paging?.current_page || 1
  const totalItem = paging?.total_item || 0

  return (
    <div className="flex flex-col gap-3 border-t border-[#e7e4dc] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-[#676c70]">
        Page {currentPage} of {totalPage} / {totalItem} {itemLabel}
      </p>
      <div className="flex items-center gap-2">
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
