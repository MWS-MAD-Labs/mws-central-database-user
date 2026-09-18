import { usePagedSearchParams } from '../../../lib/usePagedSearchParams.js'

const FILTER_KEYS = ['current_grade_id', 'current_class_id', 'join_academic_year_id', 'is_deleted']

export function useStudentsSearchParams() {
  return usePagedSearchParams({ filterKeys: FILTER_KEYS })
}
