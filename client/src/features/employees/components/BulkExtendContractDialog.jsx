import { Undo2, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../components/ui/Button.jsx'
import { cn } from '../../../lib/cn.js'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import { DateField, Field, SearchableSelect } from '../../../components/ui/FormControls.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { CONTRACT_DURATION_OPTIONS, isoFromDateInput } from '../../../lib/form.js'
import { formatDate } from '../../../lib/format.js'

// Two modes:
// - "duration": each selected employee has its own current contract_end_date
//   (or none yet), so it's extended by a fixed duration counted from its
//   own current end date - not a single shared target date.
// - "exact": every included employee is set to the exact same literal end
//   date instead, ignoring their individual current end dates (still
//   subject to the same "must be strictly after the current end date"
//   server-side rule per employee, so one with a later date already on
//   file simply fails that item rather than the whole batch).
//
// Mirrors EnrollmentDialog.jsx's bulk-promote/transfer/close list - shows
// every selected record so a blind bulk extend doesn't silently surprise
// anyone. PERMANENT and RESIGNED employees are flagged and skipped
// automatically server-side. Employees with no contract_end_date yet need
// an explicit baseline set right here before they can be included in
// duration mode - same "don't guess today" rule as the single-employee
// Extend dialog. Exact-date mode doesn't need a baseline at all.
export function BulkExtendContractDialog({
  employees,
  isLoadingEmployees,
  onClose,
  onConfirm,
  isSaving,
}) {
  const [mode, setMode] = useState('duration')
  const [duration, setDuration] = useState('')
  const [exactDate, setExactDate] = useState('')
  const [baselineInputs, setBaselineInputs] = useState({})
  // Rows the admin marked out of this batch without leaving the dialog -
  // easier than closing, reselecting on the list, and reopening.
  const [excludedIds, setExcludedIds] = useState(() => new Set())

  const extendable = employees.filter(
    (employee) =>
      employee.status_info.employment_type !== 'PERMANENT' &&
      employee.status_info.status !== 'RESIGNED',
  )
  const skippedCount = employees.length - extendable.length
  const included = extendable.filter((employee) => !excludedIds.has(employee.id))
  const needsBaseline =
    mode === 'duration'
      ? included.filter((employee) => !employee.status_info.contract_end_date)
      : []
  const missingBaselineCount = needsBaseline.filter(
    (employee) => !baselineInputs[employee.id],
  ).length

  const canSubmit =
    !isLoadingEmployees &&
    (mode === 'duration' ? Boolean(duration) : Boolean(exactDate)) &&
    included.length > 0 &&
    missingBaselineCount === 0

  function toggleExcluded(id) {
    setExcludedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSubmit(event) {
    event.preventDefault()
    if (!canSubmit) return

    if (mode === 'exact') {
      onConfirm(
        { contractEndDate: isoFromDateInput(exactDate) },
        included.map((employee) => employee.id),
      )
      return
    }

    const baselineOverrides = needsBaseline
      .filter((employee) => baselineInputs[employee.id])
      .map((employee) => ({
        id: employee.id,
        baseline_date: isoFromDateInput(baselineInputs[employee.id]),
      }))

    onConfirm(
      { durationMonths: Number(duration), baselineOverrides },
      included.map((employee) => employee.id),
    )
  }

  return (
    <CrudDialog
      title="Extend contracts"
      description={
        mode === 'exact'
          ? `Set the same exact contract end date for ${employees.length} selected employee(s).`
          : `Extend ${employees.length} selected employee(s)' contracts by a fixed duration, counted from each one's own current end date.`
      }
      onClose={onClose}
      panelClassName="max-w-lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" form="bulk-extend-contract-form" disabled={isSaving || !canSubmit}>
            {isSaving ? 'Extending...' : 'Extend'}
          </Button>
        </>
      }
    >
      <form
        id="bulk-extend-contract-form"
        onSubmit={handleSubmit}
        noValidate
        className="space-y-4"
      >
        {skippedCount > 0 ? (
          <p className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]">
            {skippedCount} selected employee(s) are PERMANENT or already RESIGNED and don't have a contract to extend - they'll be skipped.
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button
            type="button"
            variant={mode === 'duration' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setMode('duration')}
          >
            By Duration
          </Button>
          <Button
            type="button"
            variant={mode === 'exact' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setMode('exact')}
          >
            To Exact Date
          </Button>
        </div>

        {mode === 'duration' ? (
          <Field label="Extend By">
            <SearchableSelect
              value={duration}
              onChange={setDuration}
              options={CONTRACT_DURATION_OPTIONS}
              placeholder="Select Duration"
              searchPlaceholder="Search Durations"
            />
          </Field>
        ) : (
          <Field label="New Contract End Date">
            <DateField
              value={exactDate}
              onChange={(event) => setExactDate(event.target.value)}
            />
          </Field>
        )}

        <div className="space-y-2 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-3">
          <p className="text-sm font-semibold text-[var(--mws-muted)]">
            {isLoadingEmployees
              ? 'Loading selected employees...'
              : `${included.length} of ${extendable.length} employee(s) will be extended.`}
          </p>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {employees.map((employee) => {
              const isPermanent = employee.status_info.employment_type === 'PERMANENT'
              const isResigned = employee.status_info.status === 'RESIGNED'
              const hasEndDate = Boolean(employee.status_info.contract_end_date)
              const isSkippedAutomatically = isPermanent || isResigned
              const isExcluded = excludedIds.has(employee.id)

              return (
                <div
                  key={employee.id}
                  className={cn(
                    'flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--mws-line)] bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between',
                    isExcluded ? 'opacity-50' : null,
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate font-display text-sm font-bold text-[var(--mws-charcoal)]">
                      {employee.identity.full_name}
                    </p>
                    <p className="truncate text-xs text-[var(--mws-muted)]">
                      {employee.employment.employee_id}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {isPermanent ? (
                      <StatusBadge tone="neutral">PERMANENT</StatusBadge>
                    ) : isResigned ? (
                      <StatusBadge tone="neutral">RESIGNED</StatusBadge>
                    ) : hasEndDate ? (
                      <p className="text-xs text-[var(--mws-muted)]">
                        Current end date:{' '}
                        <span className="font-semibold text-[var(--mws-charcoal)]">
                          {formatDate(employee.status_info.contract_end_date)}
                        </span>
                      </p>
                    ) : mode === 'duration' && !isExcluded ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[#9f3d41]">No end date set</span>
                        <DateField
                          className="h-8 w-36 text-xs"
                          value={baselineInputs[employee.id] || ''}
                          onChange={(event) =>
                            setBaselineInputs((current) => ({
                              ...current,
                              [employee.id]: event.target.value,
                            }))
                          }
                        />
                      </div>
                    ) : mode === 'exact' ? (
                      <span className="text-xs text-[var(--mws-muted)]">No end date set</span>
                    ) : null}

                    {!isSkippedAutomatically ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-[var(--mws-muted)] hover:text-[var(--mws-charcoal)]"
                        title={isExcluded ? 'Include this employee' : 'Exclude this employee'}
                        aria-label={
                          isExcluded ? 'Include this employee' : 'Exclude this employee'
                        }
                        onClick={() => toggleExcluded(employee.id)}
                      >
                        {isExcluded ? <Undo2 size={15} /> : <X size={15} />}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
          {missingBaselineCount > 0 ? (
            <p className="text-xs text-[#9f3d41]">
              Set a baseline date for {missingBaselineCount} employee(s) above before extending.
            </p>
          ) : null}
        </div>
      </form>
    </CrudDialog>
  )
}
