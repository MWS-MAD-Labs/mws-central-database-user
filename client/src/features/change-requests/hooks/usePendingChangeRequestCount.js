import { useQuery } from '@tanstack/react-query'
import { changeRequestsApi } from '../api/changeRequestsApi.js'

// Pending requests an approver can decide. Others do not see the queue.
export function usePendingChangeRequestCount(user) {
  const enabled =
    user?.type === 'admin' && Boolean(user?.is_employee_identifier_change_approver)
  const query = useQuery({
    queryKey: ['change-requests', { status: 'PENDING' }],
    queryFn: () => changeRequestsApi.list({ status: 'PENDING' }),
    enabled,
    refetchInterval: 60_000,
  })
  if (!enabled) return 0
  return (query.data?.data || []).filter((item) => item.can_decide).length
}
