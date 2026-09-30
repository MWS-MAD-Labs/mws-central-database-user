import { useState } from "react";

// Client-side paging for small admin lists: the whole list is already loaded.
export function usePagedList(items, initialSize = 10) {
  const [page, setPage] = useState(1);
  const [size, setSizeState] = useState(initialSize);

  const totalPage = Math.max(Math.ceil(items.length / size), 1);
  const currentPage = Math.min(page, totalPage);
  const pageItems = items.slice((currentPage - 1) * size, currentPage * size);

  return {
    pageItems,
    paging: {
      current_page: currentPage,
      total_page: totalPage,
      total_item: items.length,
      size,
    },
    onPrevious: () => setPage(Math.max(currentPage - 1, 1)),
    onNext: () => setPage(Math.min(currentPage + 1, totalPage)),
    onPageSizeChange: (nextSize) => {
      setSizeState(nextSize);
      setPage(1);
    },
  };
}
