import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import {
  CheckboxField,
  Field,
  NumberInput,
  SearchableSelect,
  TextInput,
} from '../../../components/ui/FormControls.jsx'
import { LIMITS } from '../../../lib/limits.js'
import { capitalizeWords, cleanPayload, trimmedOrUndefined } from '../../../lib/form.js'
import { gradesApi } from '../../academic/api/academicApi.js'
import { unitsApi } from '../api/masterDataApi.js'
import { distinctGradeUnits, isOperationalUnit } from '../utils/pcActivityUnits.js'
import { ReassignmentImpactDialog } from './ReassignmentImpactDialog.jsx'

export function MasterDataDialog({
  dialog,
  resource,
  isSubmitting,
  onClose,
  onSubmit,
}) {
  const [values, setValues] = useState(() => ({
    name: dialog.record?.name || '',
    flagValues: (resource.flags ?? []).reduce(
      (acc, flag) => ({
        ...acc,
        [flag.field]: Boolean(dialog.record?.[flag.field]),
      }),
      {},
    ),
    unitIds: resource.unitScope
      ? (dialog.record?.units || []).map((unit) => unit.id)
      : [],
    // Empty scope is stored as "all units"; new records must pick explicitly.
    allUnits: dialog.mode !== 'create' && !(dialog.record?.units || []).length,
    capacityScope: dialog.record?.capacity_scope || '',
    maxActiveHolders: dialog.record?.max_active_holders
      ? String(dialog.record.max_active_holders)
      : '',
  }))

  // Teaching roles only exist in units that have grades, so the other units
  // are disabled while the teaching flag is on.
  const isTeachingFlag = Boolean(
    values.flagValues.is_teaching_position || values.flagValues.is_teaching_role,
  )
  const unitsQuery = useQuery({
    queryKey: ['master-data-units-for-select'],
    queryFn: () => unitsApi.list({ size: 100 }),
    enabled: Boolean(resource.unitScope) && !resource.academicUnitsOnly,
  })
  const gradeUnitsQuery = useQuery({
    queryKey: ['master-data', 'grades', 'all'],
    queryFn: () => gradesApi.list({ page: 1, size: 100 }),
    enabled: Boolean(resource.academicUnitsOnly || isTeachingFlag),
  })
  const unitOptions = (
    resource.academicUnitsOnly
      ? distinctGradeUnits(gradeUnitsQuery.data?.data || [])
      : (unitsQuery.data?.data || []).filter(isOperationalUnit)
  ).map((unit) => ({
    value: unit.id,
    label: unit.name,
  }))
  const academicUnitIds = new Set(
    distinctGradeUnits(gradeUnitsQuery.data?.data || []).map((unit) => unit.id),
  )
  const isUnitDisabled = (unitId) =>
    isTeachingFlag && gradeUnitsQuery.isSuccess && !academicUnitIds.has(unitId)

  // "All units" and every selectable unit being checked are the same thing.
  const selectableUnitIds = unitOptions
    .map((option) => option.value)
    .filter((id) => !isUnitDisabled(id))
  const isUnitChecked = (unitId) =>
    !isUnitDisabled(unitId) &&
    (values.allUnits || values.unitIds.includes(unitId))
  const allUnitsChecked =
    values.allUnits ||
    (selectableUnitIds.length > 0 &&
      selectableUnitIds.every((id) => values.unitIds.includes(id)))

  function toggleUnit(unitId) {
    setValues((current) => {
      const currentIds = current.allUnits
        ? selectableUnitIds
        : current.unitIds
      const nextIds = currentIds.includes(unitId)
        ? currentIds.filter((id) => id !== unitId)
        : [...currentIds, unitId]
      const isEverything =
        selectableUnitIds.length > 0 &&
        selectableUnitIds.every((id) => nextIds.includes(id))
      return {
        ...current,
        allUnits: isEverything,
        unitIds: isEverything ? [] : nextIds,
      }
    })
  }
  function toggleAllUnits(checked) {
    setValues((current) => ({
      ...current,
      allUnits: checked,
      unitIds: [],
    }))
  }
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const [isCheckingImpact, setIsCheckingImpact] = useState(false)
  const [showImpactDialog, setShowImpactDialog] = useState(false)
  const nameError =
    hasAttemptedSubmit && !values.name.trim()
      ? `${resource.singular} name is required.`
      : undefined
  const missing = []
  if (!values.name.trim()) missing.push(`${resource.singular} name is required.`)
  if (resource.unitScope && !values.allUnits && values.unitIds.length === 0) {
    missing.push(
      `Select ${isTeachingFlag ? 'All Academic Units' : 'All Units'} or at least one unit.`,
    )
  }
  if (
    resource.positionCapacity &&
    values.capacityScope &&
    !(Number.isInteger(Number(values.maxActiveHolders)) && Number(values.maxActiveHolders) >= 1)
  ) {
    missing.push('Maximum active holders must be at least 1.')
  }
  if (
    resource.positionCapacity &&
    values.capacityScope &&
    Number(values.maxActiveHolders) > LIMITS.JOB_POSITION_HOLDERS_MAX
  ) {
    missing.push(`Maximum active holders can be at most ${LIMITS.JOB_POSITION_HOLDERS_MAX}.`)
  }
  const title =
    dialog.mode === 'create'
      ? `New ${resource.singular}`
      : `Edit ${resource.singular}`

  async function handleSubmit(event) {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    if (!values.name.trim()) return
    if (missing.length > 0) return
    const payload = cleanPayload({
      name: trimmedOrUndefined(values.name),
      ...values.flagValues,
      ...(resource.unitScope
        ? { unit_ids: values.allUnits ? [] : values.unitIds }
        : {}),
      ...(resource.positionCapacity
        ? {
            capacity_scope: values.capacityScope || null,
            max_active_holders: values.capacityScope
              ? Number(values.maxActiveHolders)
              : null,
          }
        : {}),
    })

    if (resource.unitScope && dialog.mode === 'edit' && values.unitIds.length > 0) {
      setIsCheckingImpact(true)
      try {
        const preview = await resource.api.previewReassignmentImpact(
          dialog.record.id,
          values.unitIds,
          { page: 1, size: 1 },
        )
        if ((preview.paging?.total_item || 0) > 0) {
          setShowImpactDialog(true)
          return
        }
      } finally {
        setIsCheckingImpact(false)
      }
    }

    onSubmit(payload)
  }

  return (
    <CrudDialog
      title={title}
      description={resource.description}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="master-data-form"
            disabled={isSubmitting || isCheckingImpact || missing.length > 0}
            title={missing.length > 0 ? missing.join(' ') : undefined}
            loading={isSubmitting || isCheckingImpact}
          >
            Save
          </Button>
        </>
      }
    >
      <form id="master-data-form" className="space-y-4" onSubmit={handleSubmit} noValidate>
        <Field
          label={`${resource.singular} Name`}
          error={nameError}
          hint={`${values.name.length}/${LIMITS.MASTER_NAME_MAX}`}
        >
          <TextInput
            invalid={Boolean(nameError)}
            maxLength={LIMITS.MASTER_NAME_MAX}
            value={values.name}
            placeholder={`Enter ${resource.singular.toLowerCase()} name`}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                name: capitalizeWords(event.target.value),
              }))
            }
          />
        </Field>

        {(resource.flags ?? []).map((flag) => (
          <CheckboxField
            key={flag.field}
            checked={values.flagValues[flag.field]}
            label={flag.checkboxLabel}
            description={flag.checkboxDescription}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                flagValues: {
                  ...current.flagValues,
                  [flag.field]: event.target.checked,
                },
                unitIds:
                  (flag.field === 'is_teaching_position' ||
                    flag.field === 'is_teaching_role') &&
                  event.target.checked &&
                  gradeUnitsQuery.isSuccess
                    ? current.unitIds.filter((id) => academicUnitIds.has(id))
                    : current.unitIds,
              }))
            }
          />
        ))}

        {resource.unitScope ? (
          <Field
            label="Units"
            hint={
              (isTeachingFlag
                ? 'Teaching roles only apply to units that have grades, so the other units are disabled. '
                : '') +
              (resource.unitScopeHint ||
                'Check All Units if this applies everywhere, or pick only the units it is scoped to (e.g. Head of CARE -> CARE).')
            }
          >
            <div className="space-y-2">
              <CheckboxField
                checked={allUnitsChecked}
                label={isTeachingFlag ? 'All Academic Units' : 'All Units'}
                onChange={(event) => toggleAllUnits(event.target.checked)}
              />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {unitOptions.map((option) => (
                  <CheckboxField
                    key={option.value}
                    checked={isUnitChecked(option.value)}
                    disabled={isUnitDisabled(option.value)}
                    className={
                      isUnitDisabled(option.value)
                        ? 'cursor-not-allowed opacity-50 hover:border-(--mws-line)'
                        : undefined
                    }
                    label={option.label}
                    onChange={() => toggleUnit(option.value)}
                  />
                ))}
              </div>
            </div>
          </Field>
        ) : null}

        {resource.positionCapacity ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Active Holder Limit"
              hint="Leave unlimited for positions without a headcount cap."
            >
              <SearchableSelect
                value={values.capacityScope}
                onChange={(capacityScope) =>
                  setValues((current) => ({
                    ...current,
                    capacityScope,
                    maxActiveHolders: capacityScope
                      ? current.maxActiveHolders || '1'
                      : '',
                  }))
                }
                options={[
                  { value: '', label: 'Unlimited' },
                  { value: 'PER_UNIT', label: 'Per Unit' },
                  { value: 'GLOBAL', label: 'Global' },
                ]}
                searchableThreshold={99}
              />
            </Field>
            {values.capacityScope ? (
              <Field
                label="Maximum Active Holders"
                hint={
                  (values.capacityScope === 'PER_UNIT'
                    ? 'Applied separately in each unit.'
                    : 'Applied across all units combined.') + ` Up to ${LIMITS.JOB_POSITION_HOLDERS_MAX}.`
                }
              >
                <NumberInput
                  min={1}
                  max={LIMITS.JOB_POSITION_HOLDERS_MAX}
                  value={values.maxActiveHolders}
                  onChange={(maxActiveHolders) =>
                    setValues((current) => ({ ...current, maxActiveHolders }))
                  }
                />
              </Field>
            ) : null}
          </div>
        ) : null}
      </form>

      {showImpactDialog ? (
        <ReassignmentImpactDialog
          resource={resource}
          record={dialog.record}
          unitIds={values.unitIds}
          onClose={() => setShowImpactDialog(false)}
        />
      ) : null}
    </CrudDialog>
  )
}
