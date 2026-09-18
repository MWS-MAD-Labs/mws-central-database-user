import { usePagedSearchParams } from '../../../lib/usePagedSearchParams.js'

const FILTER_KEYS = ['employment_type', 'unit_id', 'building_id', 'is_deleted']

const SORT_FIELDS = new Set([
  'created_at',
  'full_name',
  'nick_name',
  'email',
  'employee_id',
  'status',
  'join_date',
])

export function useEmployeesSearchParams() {
  return usePagedSearchParams({ filterKeys: FILTER_KEYS, sortFields: SORT_FIELDS })
}
