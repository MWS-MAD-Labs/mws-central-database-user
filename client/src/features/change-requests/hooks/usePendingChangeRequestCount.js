import { useQuery } from '@tanstack/react-query'
import { changeRequestsApi } from '../api/changeRequestsApi.js'

// Pending requests this admin can act on: decide (approvers) or cancel (requesters).
export function usePendingChangeRequestCount(user) {
  const enabled = user?.type === 'admin' && user?.role !== 'VIEWER'
  const query = useQuery({
    queryKey: ['change-requests', { status: 'PENDING' }],
    queryFn: () => changeRequestsApi.list({ status: 'PENDING' }),
    enabled,
    refetchInterval: 60_000,
  })
  if (!enabled) return 0
  return (query.data?.data || []).filter((item) =>
    query.data?.can_approve ? item.can_decide : item.can_cancel,
  ).length
}
