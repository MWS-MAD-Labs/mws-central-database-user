import { Eye } from 'lucide-react'
import { Link } from 'react-router'
import { PaginationBar } from './PaginationBar.jsx'

// Shared multi-select checklist: search/filter live in the caller, this only
// renders the "select all N matching" header, the paged rows, and paging.
// Used by both the Class enrollment picker and the PC Activity Room student
// picker so the two flows look and behave identically.
export function ChecklistPicker({
  items,
  selectedIds,
  onToggle,
  onToggleAll,
  isLoading = false,
  loadingMessage = 'Loading...',
  emptyMessage = 'No matches.',
  page,
  onPageChange,
  pageSize = 10,
  onPageSizeChange,
  itemLabel = 'item',
  itemLabelPlural = `${itemLabel}s`,
}) {
  const totalPages = Math.max(Math.ceil(items.length / pageSize), 1)
  const clampedPage = Math.min(page, totalPages)
  const paged = items.slice(
    (clampedPage - 1) * pageSize,
    clampedPage * pageSize,
  )
  const allSelected =
    items.length > 0 && items.every((item) => selectedIds.includes(item.id))

  return (
    <div className="overflow-hidden rounded-xl border border-(--mws-line) bg-white">
      {items.length > 0 ? (
        <label className="flex cursor-pointer items-center gap-3 border-b border-(--mws-line) bg-(--mws-soft) px-3 py-2 text-sm font-semibold text-(--mws-charcoal)">
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-(--mws-burgundy)"
            checked={allSelected}
            onChange={(event) => onToggleAll(event.target.checked)}
          />
          Select all {items.length} matching {itemLabel}
          {items.length === 1 ? '' : 's'}
        </label>
      ) : null}
      {isLoading ? (
        <p className="p-3 text-sm font-semibold text-(--mws-muted)">{loadingMessage}</p>
      ) : items.length === 0 ? (
        <p className="p-3 text-sm leading-6 text-(--mws-muted)">{emptyMessage}</p>
      ) : (
        <div className="divide-y divide-(--mws-line)">
          {paged.map((item) => (
            <div
              key={item.id}
              className="flex min-w-0 items-center gap-3 px-3 py-2 hover:bg-(--mws-soft)"
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-(--mws-burgundy)"
                  checked={selectedIds.includes(item.id)}
                  onChange={() => onToggle(item.id)}
                />
                <div className="min-w-0">
                  <p
                    className={`truncate font-display text-sm font-bold ${item.labelClassName || 'text-(--mws-charcoal)'}`}
                  >
                    {item.label}
                  </p>
                  {item.sublabel ? (
                    <p className="truncate text-xs text-(--mws-muted)">{item.sublabel}</p>
                  ) : null}
                  {item.extra ? (
                    <p className="truncate text-xs text-(--mws-muted)">{item.extra}</p>
                  ) : null}
                </div>
              </label>
              {item.href ? (
                <Link
                  to={item.href}
                  target="_blank"
                  rel="noreferrer"
                  title="Open detail in a new tab"
                  className="shrink-0 rounded-lg p-1.5 text-(--mws-muted) hover:bg-white hover:text-(--mws-burgundy)"
                >
                  <Eye size={15} />
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {items.length > 0 ? (
        <PaginationBar
          paging={{
            current_page: clampedPage,
            total_page: totalPages,
            total_item: items.length,
            size: pageSize,
          }}
          itemLabel={itemLabelPlural}
          onPrevious={() => onPageChange(Math.max(clampedPage - 1, 1))}
          onNext={() => onPageChange(Math.min(clampedPage + 1, totalPages))}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}
    </div>
  )
}
