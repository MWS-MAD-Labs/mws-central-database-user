import { useState } from "react";

// Selection of a filter list where "All" means every item, now and later.
// `selected` is null for "All", otherwise the chosen ids.
export function useMultiSelect(initialIds = []) {
  const [selected, setSelected] = useState(initialIds.length > 0 ? initialIds : null);
  return { selected, setSelected };
}

// The ids to send to the server: [] means "all".
export function selectionIds(selection) {
  return selection.selected ?? [];
}
