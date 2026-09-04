import { Undo2, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../components/ui/Button.jsx'
import { cn } from '../../../lib/cn.js'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import { DateField, Field, SearchableSelect } from '../../../components/ui/FormControls.jsx'
import {
  CONTRACT_DURATION_OPTIONS,
  addMonthsToDateInput,
  dateInputFromIso,
  isoFromDateInput,
} from '../../../lib/form.js'
import { formatStatus } from '../../../lib/format.js'
import { employeeStatuses, employmentTypes } from '../api/employeesApi.js'

const FIELD_OPTIONS = [
  { value: 'employment_type', label: 'Employment Type' },
  { value: 'status', label: 'Status' },
  { value: 'unit_id', label: 'Unit' },
  { value: 'job_level_id', label: 'Job Level' },
  { value: 'job_position_id', label: 'Job Position' },
  { value: 'building_id', label: 'Building' },
]

function namedOptions(items) {
  return items.map((item) => ({ value: item.id, label: item.name }))
}

function enumOptions(values) {
  return values.map((value) => ({ value, label: formatStatus(value) }))
}

// Which master-data list (from loadEmployeeFormOptions) backs the "New
// value" picker, and how to read each employee's current value for that
// field - employment_type/status live on status_info, the other four are
// name strings on employment (list responses only carry the name, not the
// id, so the review list shows the name and the picker below shows ids).
function fieldConfig(field, options) {
  switch (field) {
    case 'employment_type':
      return {
        valueOptions: enumOptions(employmentTypes),
        currentLabel: (employee) => formatStatus(employee.status_info.employment_type),
      }
    case 'status':
      return {
        valueOptions: enumOptions(employeeStatuses),
        currentLabel: (employee) => formatStatus(employee.status_info.status),
      }
    case 'unit_id':
      return {
        valueOptions: namedOptions(options.units || []),
        currentLabel: (employee) => employee.employment.unit,
      }
    case 'job_level_id':
      return {
        valueOptions: namedOptions(options.jobLevels || []),
        currentLabel: (employee) => employee.employment.job_level,
      }
    case 'job_position_id':
      return {
        valueOptions: namedOptions(options.jobPositions || []),
        currentLabel: (employee) => employee.employment.job_position,
      }
    case 'building_id':
      return {
        valueOptions: namedOptions(options.buildings || []),
        currentLabel: (employee) => employee.employment.building,
      }
    default:
      return { valueOptions: [], currentLabel: () => '-' }
  }
}

// One dialog for every bulk-edit field instead of a separate menu item per
// employment type - fields that need extra per-employee data (a contract
// end date when switching to a non-PERMANENT type, a last working date when
// switching to RESIGNED) show the selected employees as an editable list,
// same pattern as BulkExtendContractDialog's missing-baseline rows.
export function BulkEditEmployeeDialog({
  employees,
  isLoadingEmployees,
  options,
  isSaving,
  onClose,
  onConfirm,
}) {
  const [field, setField] = useState('employment_type')
  const [newValue, setNewValue] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [duration, setDuration] = useState('')
  const [contractEndDateInputs, setContractEndDateInputs] = useState({})
  const [lastWorkingDateInputs, setLastWorkingDateInputs] = useState({})
  // Rows the admin marked out of this batch without leaving the dialog -
  // easier than closing, reselecting on the list, and reopening.
  const [excludedIds, setExcludedIds] = useState(() => new Set())

  const { valueOptions, currentLabel } = fieldConfig(field, options)
  const needsContractEndDate =
    field === 'employment_type' && newValue && newValue !== 'PERMANENT'
  const clearsContractEndDate = field === 'employment_type' && newValue === 'PERMANENT'
  const needsLastWorkingDate = field === 'status' && newValue === 'RESIGNED'
  const includedEmployees = employees.filter((employee) => !excludedIds.has(employee.id))

  function toggleExcluded(id) {
    setExcludedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleFieldChange(nextField) {
    setField(nextField)
    setNewValue('')
    setDuration('')
    setContractEndDateInputs({})
    setLastWorkingDateInputs({})
  }

  function handleDurationChange(months) {
    setDuration(months)
    const today = dateInputFromIso(new Date().toISOString())
    const computed = addMonthsToDateInput(today, months)
    const next = {}
    for (const employee of includedEmployees) next[employee.id] = computed
    setContractEndDateInputs(next)
  }

  function handleSubmit(event) {
    event.preventDefault()
    if (!field || !newValue || includedEmployees.length === 0) return

    onConfirm({
      ids: includedEmployees.map((employee) => employee.id),
      [field]: newValue,
      effective_date: effectiveDate ? isoFromDateInput(effectiveDate) : undefined,
      contract_end_date_overrides: needsContractEndDate
        ? includedEmployees
            .map((employee) => [employee.id, contractEndDateInputs[employee.id]])
            .filter(([, value]) => value)
            .map(([id, value]) => ({ id, contract_end_date: isoFromDateInput(value) }))
        : undefined,
      last_working_date_overrides: needsLastWorkingDate
        ? includedEmployees
            .map((employee) => [employee.id, lastWorkingDateInputs[employee.id]])
            .filter(([, value]) => value)
            .map(([id, value]) => ({ id, last_working_date: isoFromDateInput(value) }))
        : undefined,
    })
  }

  return (
    <CrudDialog
      title="Bulk Edit Employees"
      description={`Apply one change to ${employees.length || '...'} selected employee(s).`}
      onClose={onClose}
      panelClassName="max-w-lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="bulk-edit-employee-form"
            disabled={isSaving || !field || !newValue || includedEmployees.length === 0}
          >
            {isSaving ? 'Saving...' : 'Apply'}
          </Button>
        </>
      }
    >
      <form
        id="bulk-edit-employee-form"
        onSubmit={handleSubmit}
        noValidate
        className="space-y-4"
      >
        <Field label="Field To Update">
          <SearchableSelect
            value={field}
            onChange={handleFieldChange}
            options={FIELD_OPTIONS}
            placeholder="Select Field"
            searchPlaceholder="Search Field"
          />
        </Field>

        <Field label="New Value">
          <SearchableSelect
            value={newValue}
            onChange={setNewValue}
            options={valueOptions}
            placeholder="Select Value"
            searchPlaceholder="Search Value"
          />
        </Field>

        {needsContractEndDate ? (
          <Field
            label="Set Contract Duration For All"
            hint="Computed from today. Each row below is still editable."
          >
            <SearchableSelect
              value={duration}
              onChange={handleDurationChange}
              options={CONTRACT_DURATION_OPTIONS}
              placeholder="Select Duration"
              searchPlaceholder="Search Durations"
            />
          </Field>
        ) : null}

        {clearsContractEndDate ? (
          <p className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]">
            Permanent employees can't have a contract end date. Any existing end date will be
            cleared for employees who have one.
          </p>
        ) : null}

        <Field
          label="Effective Date"
          hint="When this change actually took effect. Backdates the mutation history entry. Defaults to now."
        >
          <DateField
            value={effectiveDate}
            onChange={(event) => setEffectiveDate(event.target.value)}
          />
        </Field>

        <div className="space-y-2 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-3">
          <p className="text-sm font-semibold text-[var(--mws-muted)]">
            {isLoadingEmployees
              ? 'Loading selected employees...'
              : `${includedEmployees.length} of ${employees.length} employee(s) will be updated.`}
          </p>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {employees.map((employee) => {
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
                      {employee.employment.employee_id} / Current: {currentLabel(employee)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {!isExcluded && needsContractEndDate ? (
                      <DateField
                        className="h-8 w-36 text-xs"
                        value={contractEndDateInputs[employee.id] || ''}
                        onChange={(event) =>
                          setContractEndDateInputs((current) => ({
                            ...current,
                            [employee.id]: event.target.value,
                          }))
                        }
                      />
                    ) : null}

                    {!isExcluded && needsLastWorkingDate ? (
                      <DateField
                        className="h-8 w-36 text-xs"
                        value={lastWorkingDateInputs[employee.id] || ''}
                        onChange={(event) =>
                          setLastWorkingDateInputs((current) => ({
                            ...current,
                            [employee.id]: event.target.value,
                          }))
                        }
                      />
                    ) : null}

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
                  </div>
                </div>
              )
            })}
          </div>
          {needsLastWorkingDate ? (
            <p className="text-xs text-[#9f3d41]">
              Resigned requires a last working date. Employees left blank above (and without one
              already on file) will fail and be skipped.
            </p>
          ) : null}
        </div>
      </form>
    </CrudDialog>
  )
}
