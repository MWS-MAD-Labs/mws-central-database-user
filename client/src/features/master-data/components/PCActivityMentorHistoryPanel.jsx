import { RotateCcw } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../../components/ui/Button.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { useConfirm } from '../../../components/ui/useConfirm.js'
import { formatDate } from '../../../lib/format.js'
import { showErrorToast, showSuccessToast } from '../../../lib/toast.js'
import { pcActivityDefaultMentorsApi } from '../api/masterDataApi.js'

// "One mentor for all units" saves as one set() call per unit (no bulk
// endpoint - see PCActivityMentorsDialog), so it writes one history row
// per unit too. Left as-is, that's the same change shown N times over.
// Groups rows into a single "All Units" entry when a batch of same-
// mentor, same-end-date rows landed within a few seconds of each other
// and covers every unit - a real per-unit split (different mentors, or
// changes made independently at different times) still shows one row
// per unit.
const SAME_BATCH_WINDOW_MS = 30_000

function groupHistoryRows(rows) {
  const totalUnits = new Set(rows.map((row) => row.unit_id)).size
  const sorted = [...rows].sort(
    (a, b) => new Date(a.start_date) - new Date(b.start_date),
  )

  const clusters = []
  for (const entry of sorted) {
    const cluster = clusters[clusters.length - 1]
    const lastEntry = cluster?.entries[cluster.entries.length - 1]
    const sameBatch =
      cluster &&
      cluster.mentor_id === entry.mentor_id &&
      cluster.end_date === entry.end_date &&
      Math.abs(new Date(entry.start_date) - new Date(lastEntry.start_date)) <=
        SAME_BATCH_WINDOW_MS
    if (sameBatch) {
      cluster.entries.push(entry)
    } else {
      clusters.push({
        mentor_id: entry.mentor_id,
        end_date: entry.end_date,
        entries: [entry],
      })
    }
  }

  const groups = []
  for (const cluster of clusters) {
    if (totalUnits > 1 && cluster.entries.length === totalUnits) {
      const first = cluster.entries[0]
      groups.push({
        key: cluster.entries.map((entry) => entry.id).join('-'),
        unitLabel: 'All Units',
        mentor_name: first.mentor_name,
        start_date: first.start_date,
        end_date: first.end_date,
        can_rollback: cluster.entries.every((entry) => entry.can_rollback),
        historyIds: cluster.entries.map((entry) => entry.id),
      })
    } else {
      for (const entry of cluster.entries) {
        groups.push({
          key: entry.id,
          unitLabel: entry.unit_name,
          mentor_name: entry.mentor_name,
          start_date: entry.start_date,
          end_date: entry.end_date,
          can_rollback: entry.can_rollback,
          historyIds: [entry.id],
        })
      }
    }
  }

  return groups.sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
}

// Nested under PCActivityMentorsDialog - one activity's mentor history
// across all its units. Mirrors EmployeeMutationHistoryPanel.jsx's
// shape/behavior exactly (Roll back undoes the most recent set()/clear()
// for a unit, restoring the previous mentor).
export function PCActivityMentorHistoryPanel({ activityId, canWrite }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const queryKey = ['pc-activity-mentor-history', activityId]

  const historyQuery = useQuery({
    queryKey,
    queryFn: () => pcActivityDefaultMentorsApi.getMentorHistory(activityId),
  })

  const rollbackMutation = useMutation({
    mutationFn: (historyIds) =>
      Promise.all(
        historyIds.map((historyId) =>
          pcActivityDefaultMentorsApi.rollbackMentor(activityId, historyId),
        ),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      queryClient.invalidateQueries({ queryKey: ['pc-activity-default-mentors'] })
      showSuccessToast('Change rolled back.')
    },
    onError: (error) => showErrorToast(error, 'Could not roll back this change.'),
  })

  async function handleRollback(group) {
    const confirmed = await confirm({
      title: 'Roll back change',
      description:
        group.unitLabel === 'All Units'
          ? 'Undo this change and restore the previous mentor for every unit?'
          : `Undo this change and restore ${group.unitLabel}'s mentor to its previous value?`,
      confirmLabel: 'Roll back',
      tone: 'danger',
    })
    if (confirmed) {
      rollbackMutation.mutate(group.historyIds)
    }
  }

  const rows = historyQuery.data || []
  const groups = groupHistoryRows(rows)

  return (
    <div className="mt-5 border-t border-[var(--mws-line)] pt-4">
      <p className="mb-2 font-display text-sm font-semibold text-[var(--mws-charcoal)]">
        Mentor History
      </p>
      <div className="w-full min-w-0 overflow-x-auto rounded-xl border border-[var(--mws-line)]">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
            <tr>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2">Mentor</th>
              <th className="px-3 py-2">Start</th>
              <th className="px-3 py-2">End</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {historyQuery.isLoading ? (
              <tr>
                <td className="px-3 py-6 text-center text-[var(--mws-muted)]" colSpan={5}>
                  Loading...
                </td>
              </tr>
            ) : groups.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-[var(--mws-muted)]" colSpan={5}>
                  No mentor changes recorded yet.
                </td>
              </tr>
            ) : (
              groups.map((group) => (
                <tr
                  key={group.key}
                  className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]"
                >
                  <td className="px-3 py-2">{group.unitLabel}</td>
                  <td className="px-3 py-2">
                    <StatusBadge tone={group.end_date ? 'neutral' : 'green'}>
                      {group.mentor_name || 'No mentor'}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-2">{formatDate(group.start_date)}</td>
                  <td className="px-3 py-2">{formatDate(group.end_date)}</td>
                  <td className="px-3 py-2 text-right">
                    {canWrite && group.can_rollback ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={rollbackMutation.isPending}
                        onClick={() => handleRollback(group)}
                        title="Undo this change"
                      >
                        <RotateCcw size={14} />
                        Roll back
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
