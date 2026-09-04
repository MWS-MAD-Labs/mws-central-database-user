import { RotateCcw } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../../components/ui/Button.jsx'
import { PageHint } from '../../../components/ui/PageHint.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { useConfirm } from '../../../components/ui/useConfirm.js'
import { formatDate, formatStatus } from '../../../lib/format.js'
import { showErrorToast, showSuccessToast } from '../../../lib/toast.js'
import { employeesApi } from '../api/employeesApi.js'

// formatStatus expects a SCREAMING_SNAKE_CASE enum - only STATUS and
// EMPLOYMENT_TYPE's values actually are ones. UNIT/JOB_POSITION/JOB_LEVEL/
// BUILDING carry a name already correctly capitalized (e.g. "Junior High")
// - running that through formatStatus mangles it into "Junior high".
const ENUM_VALUED_FIELDS = new Set(['STATUS', 'EMPLOYMENT_TYPE'])

function formatMutationValue(field, value) {
  return ENUM_VALUED_FIELDS.has(field) ? formatStatus(value) : value || '-'
}

export function EmployeeMutationHistoryPanel({ employeeId, canWrite }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()

  const historyQuery = useQuery({
    queryKey: ['employees', employeeId, 'mutation-history'],
    queryFn: () => employeesApi.getMutationHistory(employeeId),
    enabled: Boolean(employeeId),
  })

  const rollbackMutation = useMutation({
    mutationFn: (historyId) =>
      employeesApi.rollbackMutation(employeeId, historyId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['employees', employeeId, 'mutation-history'],
      })
      queryClient.invalidateQueries({ queryKey: ['employees', employeeId] })
      showSuccessToast('Change rolled back.')
    },
    onError: (error) => showErrorToast(error, 'Could not roll back this change.'),
  })

  async function handleRollback(entry) {
    const confirmed = await confirm({
      title: 'Roll back change',
      description: `Undo this change and restore ${formatStatus(entry.field)} to its previous value?`,
      confirmLabel: 'Roll back',
      tone: 'danger',
    })
    if (confirmed) {
      rollbackMutation.mutate(entry.id)
    }
  }

  const rows = historyQuery.data || []

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="min-w-0 border-b border-[var(--mws-line)] p-5">
        <h2 className="text-base font-semibold text-[var(--mws-charcoal)]">
          Mutation History
        </h2>
        <p className="text-sm text-[var(--mws-muted)]">
          Unit, job position, job level, building, and status changes over time.
        </p>
      </div>

      <div className="w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
            <tr>
              <th className="px-4 py-3">Field</th>
              <th className="px-4 py-3">Value</th>
              <th className="px-4 py-3">Start</th>
              <th className="px-4 py-3">End</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {historyQuery.isLoading ? (
              <tr>
                <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={5}>
                  Loading mutation history...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={5}>
                  No mutation history found.
                </td>
              </tr>
            ) : (
              rows.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]"
                >
                  <td className="px-4 py-3">{formatStatus(entry.field)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={entry.end_date ? 'neutral' : 'green'}>
                      {formatMutationValue(entry.field, entry.value)}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3">{formatDate(entry.start_date)}</td>
                  <td className="px-4 py-3">{formatDate(entry.end_date)}</td>
                  <td className="px-4 py-3 text-right">
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

      <PageHint id="employee-mutation-history-rollback">
        Roll back closes the current record for that field and reactivates
        the previous one. It's only available on the field's current,
        active row, and only when an earlier value exists to go back to.
      </PageHint>
    </section>
  )
}
