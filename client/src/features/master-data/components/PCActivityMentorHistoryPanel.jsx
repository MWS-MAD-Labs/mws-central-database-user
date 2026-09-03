import { RotateCcw } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../../components/ui/Button.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { useConfirm } from '../../../components/ui/useConfirm.js'
import { formatDate } from '../../../lib/format.js'
import { showErrorToast, showSuccessToast } from '../../../lib/toast.js'
import { pcActivityDefaultMentorsApi } from '../api/masterDataApi.js'

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
    mutationFn: (historyId) =>
      pcActivityDefaultMentorsApi.rollbackMentor(activityId, historyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      queryClient.invalidateQueries({ queryKey: ['pc-activity-default-mentors'] })
      showSuccessToast('Change rolled back.')
    },
    onError: (error) => showErrorToast(error, 'Could not roll back this change.'),
  })

  async function handleRollback(entry) {
    const confirmed = await confirm({
      title: 'Roll back change',
      description: `Undo this change and restore ${entry.unit_name}'s mentor to its previous value?`,
      confirmLabel: 'Roll back',
      tone: 'danger',
    })
    if (confirmed) {
      rollbackMutation.mutate(entry.id)
    }
  }

  const rows = historyQuery.data || []

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
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-[var(--mws-muted)]" colSpan={5}>
                  No mentor changes recorded yet.
                </td>
              </tr>
            ) : (
              rows.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]"
                >
                  <td className="px-3 py-2">{entry.unit_name}</td>
                  <td className="px-3 py-2">
                    <StatusBadge tone={entry.end_date ? 'neutral' : 'green'}>
                      {entry.mentor_name || 'No mentor'}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-2">{formatDate(entry.start_date)}</td>
                  <td className="px-3 py-2">{formatDate(entry.end_date)}</td>
                  <td className="px-3 py-2 text-right">
                    {canWrite && entry.can_rollback ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={rollbackMutation.isPending}
                        onClick={() => handleRollback(entry)}
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
