import { useQuery } from '@tanstack/react-query'
import { childrenAllowanceApi } from '../api/childrenAllowanceApi.js'
import { DEFAULT_ALLOWANCE_RULE } from '../utils/childrenRules.js'

export const CHILDREN_ALLOWANCE_KEY = ['children-allowance']

// The allowance rule, or the default one while it loads, so the form never waits for it.
export function useChildrenAllowance() {
  const query = useQuery({
    queryKey: CHILDREN_ALLOWANCE_KEY,
    queryFn: childrenAllowanceApi.get,
    staleTime: 5 * 60 * 1000,
  })
  // Anything that is not a whole rule (still loading, failed, odd answer) is the default rule.
  const valid = typeof query.data?.age_limit === 'number'
  return { rule: valid ? query.data : DEFAULT_ALLOWANCE_RULE, isLoading: query.isLoading }
}
