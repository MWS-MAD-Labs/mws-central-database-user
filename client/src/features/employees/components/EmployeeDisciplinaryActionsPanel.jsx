import {
  AlertTriangle,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import {
  DateField,
  Field,
  SearchableSelect,
  TextAreaInput,
  ToggleChip,
} from '../../../components/ui/FormControls.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { useConfirm } from '../../../components/ui/useConfirm.js'
import { cleanPayload, isoFromDateInput, trimmedOrUndefined } from '../../../lib/form.js'
import { formatDate, formatStatus } from '../../../lib/format.js'
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  formatMaxSizeMB,
  validateFileSize,
} from '../../../lib/fileSize.js'
import { showErrorToast, showSuccessToast } from '../../../lib/toast.js'
import {
  disciplinaryActionTypeLabels,
  disciplinaryActionTypes,
  disciplinaryActionValidityOptions,
  employeesApi,
} from '../api/employeesApi.js'

const DEFAULT_VALIDITY_DAYS = 180
const MAX_ISSUE_ATTACHMENTS = 5

function actionStatusTone(status) {
  switch (status) {
    case 'ACTIVE':
      return 'red'
    case 'RESOLVED':
      return 'green'
    case 'EXPIRED':
    case 'SUPERSEDED':
      return 'neutral'
    case 'REVOKED':
      return 'amber'
    default:
      return 'neutral'
  }
}

function formatDisciplinaryType(type) {
  return disciplinaryActionTypeLabels[type] || formatStatus(type)
}

function typeOptions() {
  return disciplinaryActionTypes.map((type) => ({
    value: type,
    label: formatDisciplinaryType(type),
  }))
}

export function EmployeeDisciplinaryActionsPanel({ employeeId, canWrite }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [issueDialogOpen, setIssueDialogOpen] = useState(false)
  const [resolveTarget, setResolveTarget] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [detailsTarget, setDetailsTarget] = useState(null)

  const historyQuery = useQuery({
    queryKey: ['employees', employeeId, 'disciplinary-actions'],
    queryFn: () => employeesApi.getDisciplinaryActions(employeeId),
    enabled: Boolean(employeeId),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: ['employees', employeeId, 'disciplinary-actions'],
    })
  }

  const createMutation = useMutation({
    mutationFn: async ({ payload, files }) => {
      const created = await employeesApi.createDisciplinaryAction(employeeId, payload)
      if (files && files.length > 0) {
        // Attachment failures shouldn't undo the record - it was already
        // issued successfully at this point.
        const results = await Promise.allSettled(
          files.map((file) =>
            employeesApi.uploadDisciplinaryActionAttachment(employeeId, created.id, file),
          ),
        )
        const failedCount = results.filter((r) => r.status === 'rejected').length
        if (failedCount > 0) {
          showErrorToast(
            null,
            `Record was issued, but ${failedCount} of ${files.length} attachment(s) failed to upload.`,
          )
        }
      }
      return created
    },
    onSuccess: (data) => {
      invalidate()
      setIssueDialogOpen(false)
      showSuccessToast(
        `${formatDisciplinaryType(data.type)} ${data.level} issued.`,
      )
    },
    onError: (error) => showErrorToast(error, 'Could not issue this record.'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) =>
      employeesApi.updateDisciplinaryAction(employeeId, id, payload),
    onSuccess: () => {
      invalidate()
      setEditTarget(null)
      showSuccessToast('Record updated.')
    },
    onError: (error) => showErrorToast(error, 'Could not update this record.'),
  })

  const resolveMutation = useMutation({
    mutationFn: ({ id, payload }) =>
      employeesApi.resolveDisciplinaryAction(employeeId, id, payload),
    onSuccess: () => {
      invalidate()
      setResolveTarget(null)
      showSuccessToast('Marked as resolved.')
    },
    onError: (error) => showErrorToast(error, 'Could not resolve this record.'),
  })

  const revokeMutation = useMutation({
    mutationFn: (id) => employeesApi.revokeDisciplinaryAction(employeeId, id),
    onSuccess: () => {
      invalidate()
      showSuccessToast('Record revoked.')
    },
    onError: (error) => showErrorToast(error, 'Could not revoke this record.'),
  })

  async function handleRevoke(entry) {
    const confirmed = await confirm({
      title: 'Revoke record',
      description: `Revoke this ${formatDisciplinaryType(entry.type)} ${entry.level}? This marks it as issued by mistake. It stops counting toward escalation, but stays visible in the history.`,
      confirmLabel: 'Revoke',
      tone: 'danger',
    })
    if (confirmed) revokeMutation.mutate(entry.id)
  }

  const rows = historyQuery.data || []

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--mws-line)] p-5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--mws-charcoal)]">
            Disciplinary Actions
          </h2>
          <p className="text-sm text-[var(--mws-muted)]">
            Warning Letter and Reprimand Letter history. Validity length is set per record.
          </p>
        </div>
        {canWrite ? (
          <Button type="button" size="sm" onClick={() => setIssueDialogOpen(true)}>
            <Plus size={15} />
            Issue Record
          </Button>
        ) : null}
      </div>

      <div className="w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Issued</th>
              <th className="px-4 py-3">Valid Until</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {historyQuery.isLoading ? (
              <tr>
                <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={6}>
                  Loading disciplinary history...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={6}>
                  No disciplinary actions on file.
                </td>
              </tr>
            ) : (
              rows.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]"
                >
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2 font-semibold text-[var(--mws-charcoal)]">
                      {entry.status === 'ACTIVE' ? (
                        <AlertTriangle size={14} className="text-[#a43c41]" />
                      ) : null}
                      {formatDisciplinaryType(entry.type)} {entry.level}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={actionStatusTone(entry.status)}>
                      {formatStatus(entry.status)}
                    </StatusBadge>
                  </td>
                  <td className="max-w-xs px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setDetailsTarget(entry)}
                      title={entry.reason}
                      className="flex w-full min-w-0 items-center gap-2 text-left hover:text-[var(--mws-burgundy)]"
                    >
                      <span className="min-w-0 flex-1 truncate underline decoration-dotted underline-offset-2">
                        {entry.reason}
                      </span>
                      {entry.notes || entry.attachment_count > 0 ? (
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--mws-soft)] px-1.5 py-1 text-[var(--mws-muted)]">
                          {entry.notes ? (
                            <StickyNote size={12} title="Has additional notes" />
                          ) : null}
                          {entry.attachment_count > 0 ? (
                            <span
                              className="flex items-center gap-0.5"
                              title={`${entry.attachment_count} attachment${entry.attachment_count === 1 ? '' : 's'}`}
                            >
                              <Paperclip size={12} />
                              {entry.attachment_count > 1 ? (
                                <span className="text-[10px] font-semibold leading-none">
                                  {entry.attachment_count}
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </button>
                  </td>
                  <td className="px-4 py-3">{formatDate(entry.issued_date)}</td>
                  <td className="px-4 py-3">{formatDate(entry.valid_until)}</td>
                  <td className="px-4 py-3 text-right">
                    {canWrite ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          title="Edit reason/notes"
                          onClick={() => setEditTarget(entry)}
                        >
                          <Pencil size={14} />
                        </Button>
                        {entry.status === 'ACTIVE' ? (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setResolveTarget(entry)}
                            >
                              Resolve
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={revokeMutation.isPending}
                              onClick={() => handleRevoke(entry)}
                            >
                              Revoke
                            </Button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {detailsTarget ? (
        <DisciplinaryActionDetailsDialog
          employeeId={employeeId}
          canWrite={canWrite}
          entry={detailsTarget}
          onClose={() => setDetailsTarget(null)}
        />
      ) : null}

      {issueDialogOpen ? (
        <IssueDisciplinaryActionDialog
          isSubmitting={createMutation.isPending}
          onClose={() => setIssueDialogOpen(false)}
          onSubmit={(payload, files) => createMutation.mutate({ payload, files })}
        />
      ) : null}

      {editTarget ? (
        <EditDisciplinaryActionDialog
          entry={editTarget}
          isSubmitting={updateMutation.isPending}
          onClose={() => setEditTarget(null)}
          onSubmit={(payload) => updateMutation.mutate({ id: editTarget.id, payload })}
        />
      ) : null}

      {resolveTarget ? (
        <ResolveDisciplinaryActionDialog
          entry={resolveTarget}
          isSubmitting={resolveMutation.isPending}
          onClose={() => setResolveTarget(null)}
          onSubmit={(payload) =>
            resolveMutation.mutate({ id: resolveTarget.id, payload })
          }
        />
      ) : null}
    </section>
  )
}

function DetailBlock({ label, value }) {
  if (!value) return null
  return (
    <div>
      <p className="font-display text-xs font-bold text-[var(--mws-muted)]">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--mws-charcoal)]">
        {value}
      </p>
    </div>
  )
}

function DisciplinaryActionDetailsDialog({ employeeId, canWrite, entry, onClose }) {
  return (
    <CrudDialog
      title={`${formatDisciplinaryType(entry.type)} ${entry.level}`}
      onClose={onClose}
      panelClassName="max-w-lg"
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={actionStatusTone(entry.status)}>
            {formatStatus(entry.status)}
          </StatusBadge>
          <span className="text-xs text-[var(--mws-muted)]">
            Issued {formatDate(entry.issued_date)} &middot; Valid until{' '}
            {formatDate(entry.valid_until)}
          </span>
        </div>
        <DetailBlock label="Reason" value={entry.reason} />
        <DetailBlock label="Notes" value={entry.notes} />
        <DetailBlock label="Resolution Notes" value={entry.resolved_reason} />
        <p className="text-xs text-[var(--mws-muted)]">
          Issued by {entry.issued_by_admin_name || '-'}
        </p>
        <DisciplinaryActionAttachments
          employeeId={employeeId}
          actionId={entry.id}
          canWrite={canWrite}
        />
      </div>
    </CrudDialog>
  )
}

function formatAttachmentFileSize(size) {
  if (!size) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function DisciplinaryActionAttachments({ employeeId, actionId, canWrite }) {
  const queryClient = useQueryClient()
  const [showDeleted, setShowDeleted] = useState(false)

  const queryKey = ['employees', employeeId, 'disciplinary-actions', actionId, 'attachments', showDeleted]
  const attachmentsQuery = useQuery({
    queryKey,
    queryFn: () =>
      employeesApi.getDisciplinaryActionAttachments(employeeId, actionId, {
        is_deleted: showDeleted,
      }),
  })

  const invalidateAttachments = () =>
    queryClient.invalidateQueries({
      queryKey: ['employees', employeeId, 'disciplinary-actions', actionId, 'attachments'],
    })

  const uploadMutation = useMutation({
    mutationFn: (file) => employeesApi.uploadDisciplinaryActionAttachment(employeeId, actionId, file),
    onSuccess: invalidateAttachments,
    onError: (error) => showErrorToast(error, 'Could not upload this file.'),
  })
  const deleteMutation = useMutation({
    mutationFn: (attachmentId) =>
      employeesApi.removeDisciplinaryActionAttachment(employeeId, actionId, attachmentId),
    onSuccess: invalidateAttachments,
    onError: (error) => showErrorToast(error, 'Could not delete this attachment.'),
  })
  const restoreMutation = useMutation({
    mutationFn: (attachmentId) =>
      employeesApi.restoreDisciplinaryActionAttachment(employeeId, actionId, attachmentId),
    onSuccess: invalidateAttachments,
    onError: (error) => showErrorToast(error, 'Could not restore this attachment.'),
  })

  const attachments = attachmentsQuery.data || []

  return (
    <div className="rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-3">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--mws-charcoal)]">
          <Paperclip size={15} />
          Attachments
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleChip checked={showDeleted} onChange={setShowDeleted}>
            Show Deleted
          </ToggleChip>
          {canWrite ? (
            <label className="inline-flex h-8 cursor-pointer items-center justify-center rounded-full border border-[var(--mws-line)] bg-white px-3 font-display text-xs font-semibold text-[var(--mws-charcoal)] hover:border-[var(--mws-burgundy)]">
              Upload
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                className="hidden"
                disabled={uploadMutation.isPending}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  const sizeError = validateFileSize(file, MAX_ATTACHMENT_SIZE_BYTES)
                  if (sizeError) {
                    showErrorToast(sizeError)
                    return
                  }
                  uploadMutation.mutate(file)
                }}
              />
            </label>
          ) : null}
        </div>
      </div>

      {attachmentsQuery.isLoading ? (
        <p className="text-sm text-[var(--mws-muted)]">Loading attachments...</p>
      ) : attachments.length === 0 ? (
        <p className="text-sm text-[var(--mws-muted)]">No files uploaded.</p>
      ) : (
        <div className="space-y-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex flex-col gap-2 rounded-xl border border-[var(--mws-line)] bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                {attachment.mime_type.startsWith('image/') ? (
                  <a href={attachment.preview_url} target="_blank" rel="noreferrer">
                    <img
                      src={attachment.preview_url}
                      alt={attachment.file_name}
                      className="h-12 w-12 shrink-0 rounded-lg border border-[var(--mws-line)] object-cover"
                    />
                  </a>
                ) : (
                  <a
                    href={attachment.preview_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-[var(--mws-line)] bg-[var(--mws-soft)] text-xs font-bold text-[var(--mws-muted)]"
                  >
                    PDF
                  </a>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--mws-charcoal)]">
                    {attachment.file_name}
                    {attachment.deleted_at ? (
                      <StatusBadge tone="red" className="ml-2">Deleted</StatusBadge>
                    ) : null}
                  </p>
                  <p className="text-xs text-[var(--mws-muted)]">
                    {formatAttachmentFileSize(attachment.file_size)} &middot; {formatDate(attachment.uploaded_at)}
                  </p>
                </div>
              </div>
              {canWrite ? (
                <div className="flex shrink-0 gap-1">
                  {attachment.deleted_at ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={restoreMutation.isPending}
                      onClick={() => restoreMutation.mutate(attachment.id)}
                    >
                      <RotateCcw size={15} />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(attachment.id)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function IssueDisciplinaryActionDialog({ isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState({
    type: 'SURAT_TEGURAN',
    reason: '',
    notes: '',
    issued_date: '',
    validity_days: DEFAULT_VALIDITY_DAYS,
  })
  const [attachmentFiles, setAttachmentFiles] = useState([])
  const [attachmentError, setAttachmentError] = useState('')
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const reasonError =
    hasAttemptedSubmit && !values.reason.trim() ? 'Reason is required.' : undefined

  function handleAttachmentChange(event) {
    const picked = Array.from(event.target.files || [])
    event.target.value = ''
    if (picked.length === 0) return

    const oversized = picked.filter((file) => validateFileSize(file, MAX_ATTACHMENT_SIZE_BYTES))
    const validPicked = picked.filter((file) => !validateFileSize(file, MAX_ATTACHMENT_SIZE_BYTES))
    if (oversized.length > 0) {
      setAttachmentError(
        `${oversized.length} file(s) skipped, over the ${formatMaxSizeMB(MAX_ATTACHMENT_SIZE_BYTES)} limit.`,
      )
    }

    setAttachmentFiles((current) => {
      const combined = [...current, ...validPicked]
      if (combined.length > MAX_ISSUE_ATTACHMENTS) {
        setAttachmentError(`Maximum ${MAX_ISSUE_ATTACHMENTS} files.`)
        return combined.slice(0, MAX_ISSUE_ATTACHMENTS)
      }
      if (oversized.length === 0) setAttachmentError('')
      return combined
    })
  }

  function removeAttachmentAt(index) {
    setAttachmentFiles((current) => current.filter((_, i) => i !== index))
    setAttachmentError('')
  }

  function handleSubmit(event) {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    if (!values.reason.trim()) return
    onSubmit(
      cleanPayload({
        type: values.type,
        reason: trimmedOrUndefined(values.reason),
        notes: trimmedOrUndefined(values.notes),
        issued_date: isoFromDateInput(values.issued_date),
        validity_days: values.validity_days,
      }),
      attachmentFiles,
    )
  }

  return (
    <CrudDialog
      title="Issue Disciplinary Record"
      description="The level (1 or 2) is set automatically based on this employee's current active record, not chosen here."
      onClose={onClose}
      panelClassName="max-w-lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="issue-disciplinary-form" disabled={isSubmitting}>
            {isSubmitting ? 'Issuing...' : 'Issue'}
          </Button>
        </>
      }
    >
      <form id="issue-disciplinary-form" onSubmit={handleSubmit} noValidate className="space-y-4">
        <Field label="Type">
          <SearchableSelect
            value={values.type}
            onChange={(value) => setValues({ ...values, type: value })}
            options={typeOptions()}
            placeholder="Select type"
            searchPlaceholder="Search type"
          />
        </Field>
        <Field
          label="Valid For"
          hint="How long this record stays active before it auto-expires. Not a fixed rule, pick what fits."
        >
          <SearchableSelect
            value={values.validity_days}
            onChange={(value) => setValues({ ...values, validity_days: value })}
            options={disciplinaryActionValidityOptions}
            placeholder="Select duration"
            searchPlaceholder="Search durations"
          />
        </Field>
        <Field label="Reason" error={reasonError} hint={`${values.reason.length}/500`}>
          <TextAreaInput
            invalid={Boolean(reasonError)}
            value={values.reason}
            maxLength={500}
            onChange={(event) => setValues({ ...values, reason: event.target.value })}
          />
        </Field>
        <Field label="Notes" hint={`${values.notes.length}/1000`}>
          <TextAreaInput
            value={values.notes}
            maxLength={1000}
            onChange={(event) => setValues({ ...values, notes: event.target.value })}
          />
        </Field>
        <Field
          label="Attachment"
          error={attachmentError}
          hint={`Optional, up to ${MAX_ISSUE_ATTACHMENTS} files (PDF, JPEG, or PNG). More can be added later from the details view.`}
        >
          <div className="flex items-center justify-end">
            <label className="inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-[var(--mws-line)] bg-white px-3 font-display text-xs font-semibold text-[var(--mws-charcoal)] hover:border-[var(--mws-burgundy)]">
              Choose files
              <input
                type="file"
                multiple
                accept="application/pdf,image/jpeg,image/png"
                className="hidden"
                disabled={attachmentFiles.length >= MAX_ISSUE_ATTACHMENTS}
                onChange={handleAttachmentChange}
              />
            </label>
          </div>
          {attachmentFiles.length > 0 ? (
            <ul className="space-y-1">
              {attachmentFiles.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--mws-line)] bg-white px-2.5 py-1.5 text-xs"
                >
                  <span className="min-w-0 truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachmentAt(index)}
                    className="shrink-0 text-[var(--mws-muted)] hover:text-[#a43c41]"
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </Field>
        <Field
          label="Issued Date"
          hint="Leave blank to use today. Set this if the letter was actually issued earlier and is only being entered now."
        >
          <DateField
            value={values.issued_date}
            onChange={(event) => setValues({ ...values, issued_date: event.target.value })}
          />
        </Field>
      </form>
    </CrudDialog>
  )
}

function EditDisciplinaryActionDialog({ entry, isSubmitting, onClose, onSubmit }) {
  const [reason, setReason] = useState(entry.reason || '')
  const [notes, setNotes] = useState(entry.notes || '')
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const reasonError =
    hasAttemptedSubmit && !reason.trim() ? 'Reason is required.' : undefined

  function handleSubmit(event) {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    if (!reason.trim()) return
    onSubmit({ reason: reason.trim(), notes: notes.trim() })
  }

  return (
    <CrudDialog
      title={`Edit ${formatDisciplinaryType(entry.type)} ${entry.level}`}
      description="Only reason and notes can be corrected here. Type, level, and status stay as issued."
      onClose={onClose}
      panelClassName="max-w-lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="edit-disciplinary-form" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </Button>
        </>
      }
    >
      <form id="edit-disciplinary-form" onSubmit={handleSubmit} noValidate className="space-y-4">
        <Field label="Reason" error={reasonError} hint={`${reason.length}/500`}>
          <TextAreaInput
            invalid={Boolean(reasonError)}
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <Field label="Notes" hint={`${notes.length}/1000`}>
          <TextAreaInput
            value={notes}
            maxLength={1000}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </form>
    </CrudDialog>
  )
}

function ResolveDisciplinaryActionDialog({ entry, isSubmitting, onClose, onSubmit }) {
  const [resolvedReason, setResolvedReason] = useState('')

  function handleSubmit(event) {
    event.preventDefault()
    onSubmit(cleanPayload({ resolved_reason: trimmedOrUndefined(resolvedReason) }))
  }

  return (
    <CrudDialog
      title={`Resolve ${formatDisciplinaryType(entry.type)} ${entry.level}`}
      description="Closes this record early, before its validity window runs out."
      onClose={onClose}
      panelClassName="max-w-md"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="resolve-disciplinary-form" disabled={isSubmitting}>
            {isSubmitting ? 'Resolving...' : 'Resolve'}
          </Button>
        </>
      }
    >
      <form id="resolve-disciplinary-form" onSubmit={handleSubmit} noValidate className="space-y-4">
        <Field label="Resolution Notes" hint={`${resolvedReason.length}/500`}>
          <TextAreaInput
            value={resolvedReason}
            maxLength={500}
            placeholder="e.g. Behavior improved, issue addressed"
            onChange={(event) => setResolvedReason(event.target.value)}
          />
        </Field>
      </form>
    </CrudDialog>
  )
}
