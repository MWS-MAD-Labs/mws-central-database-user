import { useCallback, useMemo, useState } from 'react'
import { showErrorToast } from './toast.js'

export function useBulkSelection({
  listFn,
  queryParams,
  visibleIds,
  hasActiveFilters,
  paging,
  pageSize,
  entityLabel,
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set())

  const selectedCount = selectedIds.size

  const allVisibleSelected = useMemo(
    () => visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id)),
    [visibleIds, selectedIds],
  )

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const toggleSelected = useCallback((id) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const toggleAllVisible = useCallback(async () => {
    if (visibleIds.length === 0) return

    if (allVisibleSelected) {
      setSelectedIds(new Set())
      return
    }

    if (!hasActiveFilters) {
      setSelectedIds(new Set(visibleIds))
      return
    }

    const limit = Math.min(paging.total_item || pageSize, 100)
    const response = await listFn({ ...queryParams, page: 1, size: limit })
    setSelectedIds(new Set((response.data || []).map((item) => item.id)))
    if ((paging.total_item || 0) > 100) {
      showErrorToast(
        `Bulk action can select up to 100 filtered ${entityLabel} at once.`,
      )
    }
  }, [
    allVisibleSelected,
    hasActiveFilters,
    paging.total_item,
    pageSize,
    queryParams,
    visibleIds,
    listFn,
    entityLabel,
  ])

  return {
    selectedIds,
    selectedCount,
    allVisibleSelected,
    clearSelection,
    toggleSelected,
    toggleAllVisible,
  }
}
