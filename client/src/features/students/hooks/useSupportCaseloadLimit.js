import { useQuery } from '@tanstack/react-query'
import { supportCaseloadApi } from '../api/supportCaseloadApi.js'

export const SUPPORT_CASELOAD_KEY = ['support-caseload-limit']
export const DEFAULT_SUPPORT_CASELOAD = 2

// The limit, or the default one while it loads, so the picker never waits for it.
export function useSupportCaseloadLimit() {
  const query = useQuery({
    queryKey: SUPPORT_CASELOAD_KEY,
    queryFn: supportCaseloadApi.get,
    staleTime: 5 * 60 * 1000,
  })
  const valid = typeof query.data?.max_students === 'number'
  return { limit: valid ? query.data.max_students : DEFAULT_SUPPORT_CASELOAD, isLoading: query.isLoading }
}
