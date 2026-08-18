import { useState } from 'react'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import {
  CheckboxField,
  Field,
  TextInput,
} from '../../../components/ui/FormControls.jsx'
import { cleanPayload, trimmedOrUndefined } from '../../../lib/form.js'

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
              setValues((current) => ({ ...current, name: event.target.value }))
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
      </form>
    </CrudDialog>
  )
}
