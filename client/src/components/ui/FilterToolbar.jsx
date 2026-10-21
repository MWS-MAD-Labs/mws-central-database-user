import { Children } from "react";

// Search, filters and the reset button of a list. With fewer than 4 filters everything sits on one row, so the right
// side is not left empty. From 4 filters on, the filters go on a second row under the search.
export const INLINE_FILTER_LIMIT = 4;

export function FilterToolbar({ search, status, reset, actions: extra, children }) {
  const filters = Children.toArray(children).filter(Boolean);
  const actions = status || reset || extra ? (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {status}
      {reset}
      {extra}
    </div>
  ) : null;

  if (filters.length > 0 && filters.length < INLINE_FILTER_LIMIT) {
    return (
      <div className="flex min-w-0 flex-wrap items-end gap-3" data-testid="filter-toolbar" data-layout="inline">
        <div className="min-w-60 flex-1 sm:max-w-lg">{search}</div>
        {filters}
        {actions ? <div className="ml-auto flex h-11 items-center">{actions}</div> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="filter-toolbar" data-layout="stacked">
      <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1 xl:max-w-lg">{search}</div>
        {actions}
      </div>
      {filters.length > 0 ? <div className="flex min-w-0 flex-wrap gap-3">{filters}</div> : null}
    </div>
  );
}
