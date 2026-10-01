import { useQuery } from '@tanstack/react-query'
import { changeRequestsApi } from '../api/changeRequestsApi.js'

// Who sees "My Requests": admins that can file requests (not Viewers, not approvers).
export function canSeeMyChangeRequests(user) {
  return (
    user?.type === 'admin' &&
    user?.role !== 'VIEWER' &&
    !user?.is_employee_identifier_change_approver
  )
}

// Decisions on my requests that I have not opened yet.
export function useMyChangeRequestCount(user) {
  const enabled = canSeeMyChangeRequests(user)
  const query = useQuery({
    queryKey: ['change-requests', 'mine', { count: true }],
    queryFn: () => changeRequestsApi.listMine({ page: 1, size: 1 }),
    enabled,
    refetchInterval: 60_000,
  })
  if (!enabled) return 0
  return query.data?.unseen_decided_count ?? 0
}
