import { RotateCcw } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../../components/ui/Button.jsx'
import { PageHint } from '../../../components/ui/PageHint.jsx'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'
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

const PERIOD_PAGE_SIZE = 10

// Flat rows come back one per (field, period) - e.g. a single reassignment
// day produces separate UNIT/JOB_POSITION/JOB_LEVEL rows that all share the
// same start/end dates. Reading them as a flat list makes it hard to tell
// which changes actually happened together vs. which field changed on its
// own - group by that shared date range instead, so one row of history =
// one moment in time, however many fields it touched.
function groupMutationRows(rows) {
  const groups = new Map()
  for (const entry of rows) {
    const key = `${entry.start_date}|${entry.end_date || ''}`
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        start_date: entry.start_date,
        end_date: entry.end_date,
        fields: [],
      })
    }
    groups.get(key).fields.push(entry)
  }
  return [...groups.values()].sort(
    (a, b) => new Date(b.start_date) - new Date(a.start_date),
  )
}

export function EmployeeMutationHistoryPanel({ employeeId, canWrite }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [page, setPage] = useState(1)

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
  const periods = groupMutationRows(rows)
  const totalPages = Math.max(Math.ceil(periods.length / PERIOD_PAGE_SIZE), 1)
  const clampedPage = Math.min(page, totalPages)
  const pagedPeriods = periods.slice(
    (clampedPage - 1) * PERIOD_PAGE_SIZE,
    clampedPage * PERIOD_PAGE_SIZE,
  )

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

      {historyQuery.isLoading ? (
        <p className="px-5 py-10 text-center text-sm text-[var(--mws-muted)]">
          Loading mutation history...
        </p>
      ) : periods.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-[var(--mws-muted)]">
          No mutation history found.
        </p>
      ) : (
        <ol className="min-w-0 p-5">
          {pagedPeriods.map((period) => (
            <li
              key={period.key}
              className="relative border-l-2 border-[var(--mws-line)] py-0.5 pb-5 pl-5 last:border-transparent last:pb-0"
            >
              <span
                className="absolute -left-[7px] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-[var(--mws-burgundy)]"
                aria-hidden="true"
              />
              <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-display text-sm font-bold text-[var(--mws-charcoal)]">
                  {formatDate(period.start_date)}
                </span>
                <span className="text-xs text-[var(--mws-muted)]">&rarr;</span>
                {period.end_date ? (
                  <span className="text-sm text-[var(--mws-muted)]">
                    {formatDate(period.end_date)}
                  </span>
                ) : (
                  <StatusBadge tone="green" variant="text">Current</StatusBadge>
                )}
              </div>
              <ul className="space-y-1.5">
                {period.fields.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex min-w-0 items-center justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      <span className="text-[var(--mws-muted)]">
                        {formatStatus(entry.field)}
                      </span>
                      <span className="mx-1.5 text-[var(--mws-line)]">&middot;</span>
                      <span className="font-medium text-[var(--mws-charcoal)]">
                        {formatMutationValue(entry.field, entry.value)}
                      </span>
                    </span>
                    {canWrite && entry.can_rollback ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={rollbackMutation.isPending}
                        onClick={() => handleRollback(entry)}
                        title={`Undo this ${formatStatus(entry.field)} change`}
                        className="shrink-0"
                      >
                        <RotateCcw size={14} />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {periods.length > PERIOD_PAGE_SIZE ? (
        <PaginationBar
          paging={{
            current_page: clampedPage,
            total_page: totalPages,
            total_item: periods.length,
            size: PERIOD_PAGE_SIZE,
          }}
          itemLabel="periods"
          onPrevious={() => setPage((current) => Math.max(current - 1, 1))}
          onNext={() => setPage((current) => Math.min(current + 1, totalPages))}
        />
      ) : null}

      <PageHint id="employee-mutation-history-rollback">
        Roll back closes the current record for that field and reactivates
        the previous one. It's only available on the field's current,
        active row, and only when an earlier value exists to go back to.
      </PageHint>
    </section>
  )
}
