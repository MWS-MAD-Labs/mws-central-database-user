import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'

const DEFAULT_PAGE = 1

export function usePagedSearchParams({
  defaultSize = 10,
  defaultSortBy = 'created_at',
  defaultSortOrder = 'desc',
  statusDefault = 'ACTIVE',
  filterKeys = [],
  sortFields,
} = {}) {
  const [searchParams, setSearchParams] = useSearchParams()

  const params = useMemo(() => {
    const sortByRaw = searchParams.get('sort_by')
    const result = {
      page: getPositiveNumber(searchParams.get('page'), DEFAULT_PAGE),
      size: getPositiveNumber(searchParams.get('size'), defaultSize),
      search: searchParams.get('search') || '',
      status: searchParams.get('status') || statusDefault,
      sort_by: sortFields
        ? (sortFields.has(sortByRaw) ? sortByRaw : defaultSortBy)
        : (sortByRaw || defaultSortBy),
      sort_order: searchParams.get('sort_order') || defaultSortOrder,
    }
    for (const key of filterKeys) {
      result[key] = searchParams.get(key) || ''
    }
    return result
  }, [
    searchParams,
    defaultSize,
    defaultSortBy,
    defaultSortOrder,
    statusDefault,
    filterKeys,
    sortFields,
  ])

  const updateParams = useCallback(
    (nextPatch) => {
      const next = new URLSearchParams(searchParams)

      Object.entries(nextPatch).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          next.delete(key)
        } else {
          next.set(key, String(value))
        }
      })

      setSearchParams(next)
    },
    [searchParams, setSearchParams],
  )

  const resetPageAndUpdate = useCallback(
    (nextPatch) => {
      updateParams({ ...nextPatch, page: DEFAULT_PAGE })
    },
    [updateParams],
  )

  return { params, updateParams, resetPageAndUpdate }
}

function getPositiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}
