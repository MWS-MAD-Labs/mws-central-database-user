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
  dense = false,
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
        <label className={`flex items-center gap-3 bg-(--mws-soft) px-4 text-sm font-semibold text-(--mws-charcoal) ${dense ? "py-2" : "py-3"}`}>
          <input
            type="checkbox"
            checked={allPageSelected}
            disabled={isLoading || selectable.length === 0}
            onChange={(event) => onTogglePage(event.target.checked, selectable)}
            className="h-4 w-4 accent-(--mws-burgundy)"
          />
          Select all on this page
        </label>
        <div className={`divide-y divide-(--mws-line) overflow-y-auto ${dense ? "max-h-[28rem]" : "max-h-80"}`}>
          {isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-(--mws-muted)">
              Loading {itemLabel}s...
            </p>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-(--mws-muted)">
              {emptyMessage}
            </p>
          ) : (
            items.map((item) =>
              dense ? (
                <label
                  key={item.id}
                  className={`flex items-center gap-3 px-4 py-2 text-sm ${
                    item.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-(--mws-soft)"
                  }`}
                >
                  <input
                    type="checkbox"
                    aria-label={item.label}
                    checked={selected.has(item.id)}
                    disabled={item.disabled}
                    onChange={(event) => onToggle(item, event.target.checked)}
                    className="h-4 w-4 shrink-0 accent-(--mws-burgundy)"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-semibold text-(--mws-charcoal)">{item.label}</span>
                    {item.sublabel ? (
                      <span className="ml-2 text-xs text-(--mws-muted)">{item.sublabel}</span>
                    ) : null}
                  </span>
                  {item.extra ? (
                    <span className="shrink-0 rounded-full bg-(--mws-soft) px-2 py-0.5 text-xs text-(--mws-burgundy)">
                      {item.extra}
                    </span>
                  ) : null}
                </label>
              ) : (
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
              ),
            )
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
