import { useQuery } from '@tanstack/react-query'
import { changeRequestsApi } from '../api/changeRequestsApi.js'
import { canSeeMyChangeRequests } from './useMyChangeRequestCount.js'

// The requester's latest request per field of one record, for the locked-field hint.
export function useMyRequestsForRecord(user, entityType, entityId, enabled = true) {
  const allowed = enabled && Boolean(entityId) && canSeeMyChangeRequests(user)
  const query = useQuery({
    queryKey: ['change-requests', 'mine', { entityType, entityId }],
    queryFn: () =>
      changeRequestsApi.listMine({ entity_type: entityType, entity_id: entityId, size: 20 }),
    enabled: allowed,
  })
  // Newest first from the server, so the first match per field is the latest.
  return (fieldName) =>
    allowed ? (query.data?.data || []).find((item) => item.field_name === fieldName) : undefined
}
