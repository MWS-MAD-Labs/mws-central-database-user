import { PaginationBar } from './PaginationBar.jsx'
import { StatusBadge } from './StatusBadge.jsx'
import { TextInput } from './FormControls.jsx'

// Pick one item from a server-paged list. Rows are radios, no inner scroll.
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
  return (
    <div className="space-y-3">
      <TextInput
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={`Search ${itemLabel}s`}
      />
      <div className="overflow-hidden rounded-xl border border-(--mws-line)">
        <div className="divide-y divide-(--mws-line)" role="radiogroup" aria-label={itemLabel}>
          {isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-(--mws-muted)">
              Loading {itemLabel}s...
            </p>
          ) : options.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-(--mws-muted)">
              {emptyMessage || `No ${itemLabel}s found.`}
            </p>
          ) : (
            options.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-(--mws-soft)"
              >
                <input
                  type="radio"
                  name={`pick-${itemLabel}`}
                  checked={value === option.value}
                  onChange={() => onChange(option.value, option)}
                  className="mt-1 h-4 w-4 accent-(--mws-burgundy)"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-(--mws-charcoal)">
                    {option.label}
                  </span>
                  {option.description ? (
                    <span className="mt-0.5 block text-xs text-(--mws-muted)">
                      {option.description}
                    </span>
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
        />
      </div>
    </div>
  )
}
