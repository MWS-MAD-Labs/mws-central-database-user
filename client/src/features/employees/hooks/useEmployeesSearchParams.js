import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'

const DEFAULT_PAGE = 1
const DEFAULT_SIZE = 10
const DEFAULT_SORT_BY = 'created_at'
const DEFAULT_SORT_ORDER = 'desc'

export function useEmployeesSearchParams() {
  const [searchParams, setSearchParams] = useSearchParams()

  const params = useMemo(() => {
    return {
      page: getPositiveNumber(searchParams.get('page'), DEFAULT_PAGE),
      size: getPositiveNumber(searchParams.get('size'), DEFAULT_SIZE),
      search: searchParams.get('search') || '',
      status: searchParams.get('status') || '',
      is_deleted: searchParams.get('is_deleted') || '',
      sort_by: searchParams.get('sort_by') || DEFAULT_SORT_BY,
      sort_order: searchParams.get('sort_order') || DEFAULT_SORT_ORDER,
    }
  }, [searchParams])

  const updateParams = useCallback((nextPatch) => {
    const next = new URLSearchParams(searchParams)

    Object.entries(nextPatch).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        next.delete(key)
      } else {
        next.set(key, String(value))
      }
    })

    setSearchParams(next)
  }, [searchParams, setSearchParams])

  const resetPageAndUpdate = useCallback((nextPatch) => {
    updateParams({ ...nextPatch, page: DEFAULT_PAGE })
  }, [updateParams])

  return {
    params,
    updateParams,
    resetPageAndUpdate,
  }
}

function getPositiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}
