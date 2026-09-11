import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import {
  CheckboxField,
  Field,
  TextInput,
} from '../../../components/ui/FormControls.jsx'
import { capitalizeWords, cleanPayload, trimmedOrUndefined } from '../../../lib/form.js'
import { unitsApi } from '../api/masterDataApi.js'
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
    teachingFlag: resource.teachingFlag
      ? Boolean(dialog.record?.[resource.teachingFlag.field])
      : false,
    unitIds: resource.unitScope
      ? (dialog.record?.units || []).map((unit) => unit.id)
      : [],
  }))

  const unitsQuery = useQuery({
    queryKey: ['master-data-units-for-select'],
    queryFn: () => unitsApi.list({ size: 100 }),
    enabled: Boolean(resource.unitScope),
  })
  const unitOptions = (unitsQuery.data?.data || []).map((unit) => ({
    value: unit.id,
    label: unit.name,
  }))

  function toggleUnit(unitId) {
    setValues((current) => ({
      ...current,
      unitIds: current.unitIds.includes(unitId)
        ? current.unitIds.filter((id) => id !== unitId)
        : [...current.unitIds, unitId],
    }))
  }
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const [isCheckingImpact, setIsCheckingImpact] = useState(false)
  const [showImpactDialog, setShowImpactDialog] = useState(false)
  const nameError =
    hasAttemptedSubmit && !values.name.trim()
      ? `${resource.singular} name is required.`
      : undefined
  const title =
    dialog.mode === 'create'
      ? `New ${resource.singular}`
      : `Edit ${resource.singular}`

  async function handleSubmit(event) {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    if (!values.name.trim()) return
    const payload = cleanPayload({
      name: trimmedOrUndefined(values.name),
      ...(resource.teachingFlag
        ? { [resource.teachingFlag.field]: values.teachingFlag }
        : {}),
      // Always included (even as []), not stripped by cleanPayload like an
      // empty string would be - so clearing back to "Any unit" actually
      // reaches the backend instead of silently being dropped.
      ...(resource.unitScope ? { unit_ids: values.unitIds } : {}),
    })

    // Narrowing an existing resource's units can leave employees outside
    // the new selection - the backend hard-blocks that (same guard this
    // preview call reuses), so check first and show who's affected instead
    // of letting the admin hit a blind "N employee(s)" error toast.
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
            disabled={isSubmitting || isCheckingImpact}
          >
            {isCheckingImpact ? 'Checking...' : isSubmitting ? 'Saving...' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="master-data-form" className="space-y-4" onSubmit={handleSubmit} noValidate>
        <Field label={`${resource.singular} Name`} error={nameError}>
          <TextInput
            invalid={Boolean(nameError)}
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

        {resource.teachingFlag ? (
          <CheckboxField
            checked={values.teachingFlag}
            label={resource.teachingFlag.checkboxLabel}
            description={resource.teachingFlag.checkboxDescription}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                teachingFlag: event.target.checked,
              }))
            }
          />
        ) : null}

        {resource.unitScope ? (
          <Field
            label="Units"
            hint="Leave every unit unchecked if this applies to any unit. Only check specific units if this is genuinely scoped to them (e.g. Head of CARE -> CARE, or Teacher -> Kindergarten/Elementary/Junior High)."
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {unitOptions.map((option) => (
                <CheckboxField
                  key={option.value}
                  checked={values.unitIds.includes(option.value)}
                  label={option.label}
                  onChange={() => toggleUnit(option.value)}
                />
              ))}
            </div>
          </Field>
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
