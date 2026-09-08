import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import {
  CheckboxField,
  Field,
  SearchableSelect,
  TextInput,
} from '../../../components/ui/FormControls.jsx'
import { capitalizeWords, cleanPayload, trimmedOrUndefined } from '../../../lib/form.js'
import { unitsApi } from '../api/masterDataApi.js'

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
    unitId: resource.unitScope ? dialog.record?.unit_id || '' : '',
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
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const nameError =
    hasAttemptedSubmit && !values.name.trim()
      ? `${resource.singular} name is required.`
      : undefined
  const title =
    dialog.mode === 'create'
      ? `New ${resource.singular}`
      : `Edit ${resource.singular}`

  function handleSubmit(event) {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    if (!values.name.trim()) return
    const payload = cleanPayload({
      name: trimmedOrUndefined(values.name),
      ...(resource.teachingFlag
        ? { [resource.teachingFlag.field]: values.teachingFlag }
        : {}),
      // Explicit null (not stripped by cleanPayload, unlike '') so clearing
      // the unit back to "No specific unit" actually reaches the backend
      // instead of silently being dropped from the payload.
      ...(resource.unitScope ? { unit_id: values.unitId || null } : {}),
    })
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
          <Button type="submit" form="master-data-form" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save'}
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
            label="Unit"
            hint="Only set this if this position is genuinely specific to one unit (e.g. Head of CARE). Leave it as No specific unit for everything else."
          >
            <SearchableSelect
              value={values.unitId}
              placeholder="No specific unit"
              onChange={(unitId) =>
                setValues((current) => ({ ...current, unitId: unitId || '' }))
              }
              options={[
                { value: '', label: 'No specific unit (available everywhere)' },
                ...unitOptions,
              ]}
            />
          </Field>
        ) : null}
      </form>
    </CrudDialog>
  )
}
