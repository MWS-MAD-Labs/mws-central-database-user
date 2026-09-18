import { usePagedSearchParams } from '../../../lib/usePagedSearchParams.js'

const FILTER_KEYS = ['building_id', 'is_deleted']

const SORT_FIELDS = new Set([
  'created_at',
  'full_name',
  'nick_name',
  'email',
  'status',
  'join_date',
  'end_date',
])

export function useInternsSearchParams() {
  return usePagedSearchParams({ filterKeys: FILTER_KEYS, sortFields: SORT_FIELDS })
}
