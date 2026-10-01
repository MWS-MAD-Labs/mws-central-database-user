import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import { Field, LimitedField, TextInput } from '../../../components/ui/FormControls.jsx'
import { showSuccessToast } from '../../../lib/toast.js'
import { changeRequestsApi } from '../api/changeRequestsApi.js'

export function RequestIdentifierChangeDialog({
  entityType,
  entityId,
  fieldName,
  fieldLabel,
  currentValue,
  formatValue = (value) => value,
  onClose,
}) {
  const queryClient = useQueryClient()
  const [newValue, setNewValue] = useState('')
  const [reason, setReason] = useState('')
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)

  const errors = hasAttemptedSubmit
    ? {
        newValue: !newValue.trim() ? 'New value is required.' : undefined,
        reason: reason.trim().length < 5 ? 'Explain why, at least 5 characters.' : undefined,
      }
    : {}

  const statusQuery = useQuery({
    queryKey: ['change-requests', 'approver-status'],
    queryFn: () => changeRequestsApi.approverStatus(),
  })
  // Only blocks once the answer is in, so a slow check never stops a valid request.
  const noApprover =
    statusQuery.data && !statusQuery.data[entityType === 'Employee' ? 'employee' : 'student']

  const mutation = useMutation({
    mutationFn: () =>
      changeRequestsApi.create({
        entity_type: entityType,
        entity_id: entityId,
        field_name: fieldName,
        new_value: newValue.trim(),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['change-requests'] })
      showSuccessToast('Change request sent. An approver will review it.')
      onClose()
    },
  })

  function submit(event) {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    if (noApprover || !newValue.trim() || reason.trim().length < 5) return
    mutation.mutate()
  }

  return (
    <CrudDialog
      title={`Request ${fieldLabel} Change`}
      description="This field is locked. The new value is applied once an approver approves it."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="request-identifier-change-form"
            type="submit"
            disabled={mutation.isPending || Boolean(noApprover)}
            loading={mutation.isPending}
          >
            <Send size={16} />
            Send request
          </Button>
        </>
      }
    >
      <form
        id="request-identifier-change-form"
        onSubmit={submit}
        noValidate
        className="grid gap-4"
      >
        {noApprover ? (
          <p
            role="alert"
            className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]"
          >
            No approver is set up yet, so this request can't be reviewed. Ask a
            Super Admin to set one on the Access page.
          </p>
        ) : null}
        <Field label={`Current ${fieldLabel}`}>
          <TextInput value={currentValue || ''} disabled />
        </Field>
        <Field label={`New ${fieldLabel}`} error={errors.newValue}>
          <TextInput
            invalid={Boolean(errors.newValue)}
            value={newValue}
            onChange={(event) => setNewValue(formatValue(event.target.value))}
          />
        </Field>
        <LimitedField
          label="Reason"
          field="reason"
          as="textarea"
          max={100}
          rows={3}
          placeholder="e.g. Typo when the record was created."
          values={{ reason }}
          errors={errors}
          updateValue={(_, value) => setReason(value)}
        />
      </form>
    </CrudDialog>
  )
}
