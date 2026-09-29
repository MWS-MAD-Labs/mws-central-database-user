import { useState } from 'react'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import { DateField, Field, SearchableSelect } from '../../../components/ui/FormControls.jsx'
import {
  addMonthsToDateInput,
  CONTRACT_DURATION_OPTIONS,
  dateInputFromIso,
  isoFromDateInput,
} from '../../../lib/form.js'
import { formatStatus } from '../../../lib/format.js'

function addDays(dateInputValue, days) {
  const date = new Date(`${dateInputValue}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export function ExtendContractDialog({ employee, onClose, onConfirm, isSaving }) {
  const currentEndDate = dateInputFromIso(employee.status_info.contract_end_date)
  const hasBaseline = Boolean(currentEndDate)

  const [manualBaseline, setManualBaseline] = useState('')
  const baseline = hasBaseline ? currentEndDate : manualBaseline
  const [duration, setDuration] = useState('')

  const minEndDate = hasBaseline ? addDays(currentEndDate, 1) : ''
  const [newEndDate, setNewEndDate] = useState(minEndDate)
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const newEndDateError =
    hasAttemptedSubmit && !newEndDate ? 'New contract end date is required.' : undefined

  function handleDurationChange(months) {
    if (!baseline) return
    setDuration(months)
    setNewEndDate(addMonthsToDateInput(baseline, months))
  }

  function handleManualBaselineChange(value) {
    setManualBaseline(value)
    if (!newEndDate) setNewEndDate(value)
  }

  function handleSubmit(event) {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    if (!newEndDate) return
    onConfirm(isoFromDateInput(newEndDate))
  }

  return (
    <CrudDialog
      title="Extend contract"
      description={`Set a new contract end date for this ${formatStatus(employee.status_info.employment_type)} employee.`}
      onClose={onClose}
      panelClassName="max-w-md"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" form="extend-contract-form" disabled={!newEndDate} loading={isSaving}>
            Extend
          </Button>
        </>
      }
    >
      <form id="extend-contract-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        {hasBaseline ? (
          <p className="text-sm text-(--mws-muted)">
            Current end date: <span className="font-semibold text-(--mws-charcoal)">{currentEndDate}</span>
          </p>
        ) : (
          <>
            <p className="text-sm text-(--mws-muted)">
              No contract end date set yet. Set a baseline date before using the duration dropdown.
            </p>
            <Field label="Baseline Date">
              <DateField
                value={manualBaseline}
                onChange={(event) => handleManualBaselineChange(event.target.value)}
              />
            </Field>
          </>
        )}
        <Field label="Extend By" hint={!baseline ? 'Set a baseline date first' : undefined}>
          <SearchableSelect
            value={duration}
            onChange={handleDurationChange}
            options={CONTRACT_DURATION_OPTIONS}
            placeholder="Select Duration"
            searchPlaceholder="Search Durations"
            disabled={!baseline}
          />
        </Field>
        <Field label="New Contract End Date" error={newEndDateError}>
          <DateField
            invalid={Boolean(newEndDateError)}
            min={minEndDate || undefined}
            value={newEndDate}
            onChange={(event) => setNewEndDate(event.target.value)}
          />
        </Field>
      </form>
    </CrudDialog>
  )
}
