import { PaginationBar } from "../../../../components/ui/PaginationBar.jsx";
import { TextInput } from "../../../../components/ui/FormControls.jsx";

export function PaginatedCandidatePicker({
  items,
  selected,
  paging,
  search,
  filters,
  isLoading,
  emptyMessage,
  itemLabel,
  onSearchChange,
  onToggle,
  onTogglePage,
  onPageChange,
  onPageSizeChange,
}) {
  const selectable = items.filter((item) => !item.disabled);
  const pageIds = selectable.map((item) => item.id);
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  return (
    <div className="space-y-3">
      <TextInput
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={`Search ${itemLabel}s`}
      />
      {filters}
      <div className="overflow-hidden rounded-xl border border-(--mws-line)">
        <label className="flex items-center gap-3 bg-(--mws-soft) px-4 py-3 text-sm font-semibold text-(--mws-charcoal)">
          <input
            type="checkbox"
            checked={allPageSelected}
            disabled={isLoading || selectable.length === 0}
            onChange={(event) => onTogglePage(event.target.checked, selectable)}
            className="h-4 w-4 accent-(--mws-burgundy)"
          />
          Select all on this page
        </label>
        <div className="max-h-80 divide-y divide-(--mws-line) overflow-y-auto">
          {isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-(--mws-muted)">
              Loading {itemLabel}s...
            </p>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-(--mws-muted)">
              {emptyMessage}
            </p>
          ) : (
            items.map((item) => (
              <label
                key={item.id}
                className={`flex items-start gap-3 px-4 py-3 ${
                  item.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-(--mws-soft)"
                }`}
              >
                <input
                  type="checkbox"
                  aria-label={item.label}
                  checked={selected.has(item.id)}
                  disabled={item.disabled}
                  onChange={(event) =>
                    onToggle(item, event.target.checked)
                  }
                  className="mt-1 h-4 w-4 accent-(--mws-burgundy)"
                />
                <span className="min-w-0">
                  <span className="block font-semibold text-(--mws-charcoal)">
                    {item.label}
                  </span>
                  {item.sublabel ? (
                    <span className="mt-0.5 block text-xs text-(--mws-muted)">
                      {item.sublabel}
                    </span>
                  ) : null}
                  {item.extra ? (
                    <span className="mt-1 block text-xs text-(--mws-burgundy)">
                      {item.extra}
                    </span>
                  ) : null}
                </span>
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
      <p className="text-xs font-semibold text-(--mws-muted)">
        {selected.size} {itemLabel}{selected.size === 1 ? "" : "s"} selected
        across all pages.
      </p>
    </div>
  );
}
