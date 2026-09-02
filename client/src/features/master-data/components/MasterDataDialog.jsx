import { useState } from 'react'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import {
  CheckboxField,
  Field,
  SearchableSelect,
  TextInput,
} from '../../../components/ui/FormControls.jsx'
import { capitalizeWords, cleanPayload, trimmedOrUndefined } from '../../../lib/form.js'
import { useMentorOptions } from '../hooks/useMentorOptions.js'

export function MasterDataDialog({
  dialog,
  resource,
  isSubmitting,
  onClose,
  onSubmit,
}) {
  const mentorOptionsQuery = useMentorOptions(Boolean(resource.mentorField))
  const teachingEmployees = mentorOptionsQuery.data?.teachingEmployees || []
  const [values, setValues] = useState(() => ({
    name: dialog.record?.name || '',
    teachingFlag: resource.teachingFlag
      ? Boolean(dialog.record?.[resource.teachingFlag.field])
      : false,
    mentorId: resource.mentorField
      ? dialog.record?.[resource.mentorField.field] || ''
      : '',
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
      ...(resource.mentorField
        ? {
            [resource.mentorField.field]:
              values.mentorId || (dialog.mode === 'edit' ? null : undefined),
          }
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

        {resource.mentorField ? (
          <Field
            label={resource.mentorField.label}
            hint={resource.mentorField.description}
          >
            <SearchableSelect
              value={values.mentorId}
              onChange={(mentorId) =>
                setValues((current) => ({ ...current, mentorId }))
              }
              options={[
                { value: '', label: 'No default mentor' },
                ...teachingEmployees.map((employee) => ({
                  value: employee.id,
                  label: employee.identity.full_name,
                  description: employee.identity.email,
                  badge: employee.employment.job_position,
                })),
              ]}
              placeholder="Select Mentor"
              searchPlaceholder="Search Employee"
              searchableThreshold={1}
            />
          </Field>
        ) : null}
      </form>
    </CrudDialog>
  )
}
