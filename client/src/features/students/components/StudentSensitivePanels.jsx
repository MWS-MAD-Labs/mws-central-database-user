import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Download,
  FileSignature,
  HeartPulse,
  Paperclip,
  Plus,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import {
  CheckboxField,
  Field,
  SelectInput,
  TextAreaInput,
  TextInput,
} from '../../../components/ui/FormControls.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { env } from '../../../config/env.js'
import {
  cleanPayload,
  dateInputFromIso,
  isoFromDateInput,
  trimmedOrUndefined,
} from '../../../lib/form.js'
import { formatDate, formatStatus, statusTone } from '../../../lib/format.js'
import {
  consentStatuses,
  consentTypes,
  healthNoteCategories,
  healthNoteStatuses,
  studentSensitiveApi,
} from '../api/studentSensitiveApi.js'

export function StudentConsentPanel({ studentId, canWrite }) {
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState(null)

  const consentsQuery = useQuery({
    queryKey: ['students', studentId, 'consents'],
    queryFn: () => studentSensitiveApi.listConsents(studentId),
    enabled: Boolean(studentId),
  })

  const createMutation = useMutation({
    mutationFn: (payload) => studentSensitiveApi.createConsent(studentId, payload),
    onSuccess: () => {
      invalidateConsents(queryClient, studentId)
      setDialog(null)
    },
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) =>
      studentSensitiveApi.updateConsent(studentId, id, payload),
    onSuccess: () => {
      invalidateConsents(queryClient, studentId)
      setDialog(null)
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (id) => studentSensitiveApi.removeConsent(studentId, id),
    onSuccess: () => invalidateConsents(queryClient, studentId),
  })

  function handleDelete(consent) {
    if (window.confirm(`Delete ${formatStatus(consent.consent_type)} consent?`)) {
      deleteMutation.mutate(consent.id)
    }
  }

  return (
    <PanelFrame
      title="Consent"
      icon={FileSignature}
      isFetching={consentsQuery.isFetching}
      action={
        <Button
          type="button"
          size="sm"
          disabled={!canWrite}
          onClick={() => setDialog({ mode: 'create' })}
        >
          <Plus size={15} />
          Consent
        </Button>
      }
    >
      {(consentsQuery.data || []).length === 0 ? (
        <PanelMessage>No consent records yet.</PanelMessage>
      ) : (
        <div className="space-y-3">
          {(consentsQuery.data || []).map((consent) => (
            <ConsentCard
              key={consent.id}
              studentId={studentId}
              consent={consent}
              canWrite={canWrite}
              onEdit={() => setDialog({ mode: 'edit', record: consent })}
              onDelete={() => handleDelete(consent)}
            />
          ))}
        </div>
      )}

      {dialog ? (
        <ConsentDialog
          dialog={dialog}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => {
            if (dialog.mode === 'create') createMutation.mutate(payload)
            else updateMutation.mutate({ id: dialog.record.id, payload })
          }}
        />
      ) : null}
    </PanelFrame>
  )
}

function ConsentCard({ studentId, consent, canWrite, onEdit, onDelete }) {
  return (
    <article className="rounded-2xl border border-[var(--mws-line)] bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-sm font-bold text-[var(--mws-charcoal)]">
              {formatStatus(consent.consent_type)}
            </h3>
            <StatusBadge tone={consentStatusTone(consent.status)}>
              {formatStatus(consent.status)}
            </StatusBadge>
          </div>
          <p className="mt-1 text-sm text-[var(--mws-muted)]">
            Signed by {consent.signed_by || '-'} on {formatDate(consent.consent_date)}
          </p>
          {consent.notes ? (
            <p className="mt-2 text-sm leading-6 text-[var(--mws-charcoal)]">
              {consent.notes}
            </p>
          ) : null}
        </div>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" disabled={!canWrite} onClick={onEdit}>
            Edit
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={!canWrite} onClick={onDelete}>
            <Trash2 size={15} />
          </Button>
        </div>
      </div>
      <ConsentAttachments studentId={studentId} consentId={consent.id} canWrite={canWrite} />
    </article>
  )
}

function ConsentAttachments({ studentId, consentId, canWrite }) {
  const queryClient = useQueryClient()
  const attachmentsQuery = useQuery({
    queryKey: ['students', studentId, 'consents', consentId, 'attachments'],
    queryFn: () => studentSensitiveApi.listAttachments(studentId, consentId),
  })
  const uploadMutation = useMutation({
    mutationFn: (file) => studentSensitiveApi.uploadAttachment(studentId, consentId, file),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['students', studentId, 'consents', consentId, 'attachments'],
      }),
  })
  const deleteMutation = useMutation({
    mutationFn: (attachmentId) =>
      studentSensitiveApi.removeAttachment(studentId, consentId, attachmentId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['students', studentId, 'consents', consentId, 'attachments'],
      }),
  })

  return (
    <div className="mt-4 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-3">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--mws-charcoal)]">
          <Paperclip size={15} />
          Attachments
        </div>
        <label className="inline-flex h-8 cursor-pointer items-center justify-center rounded-full border border-[var(--mws-line)] bg-white px-3 font-display text-xs font-semibold text-[var(--mws-charcoal)] hover:border-[var(--mws-burgundy)]">
          Upload
          <input
            type="file"
            className="hidden"
            disabled={!canWrite || uploadMutation.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) uploadMutation.mutate(file)
              event.target.value = ''
            }}
          />
        </label>
      </div>
      {(attachmentsQuery.data || []).length === 0 ? (
        <p className="text-sm text-[var(--mws-muted)]">No signed files uploaded.</p>
      ) : (
        <div className="space-y-2">
          {(attachmentsQuery.data || []).map((attachment) => (
            <div
              key={attachment.id}
              className="flex flex-col gap-2 rounded-xl border border-[var(--mws-line)] bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-semibold text-[var(--mws-charcoal)]">
                  {attachment.file_name}
                </p>
                <p className="text-xs text-[var(--mws-muted)]">
                  {formatFileSize(attachment.file_size)} / {formatDate(attachment.uploaded_at)}
                </p>
              </div>
              <div className="flex gap-1">
                <Button asChild variant="ghost" size="sm">
                  <a href={attachmentDownloadUrl(studentId, consentId, attachment.id)} target="_blank" rel="noreferrer">
                    <Download size={15} />
                  </a>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!canWrite || deleteMutation.variables === attachment.id}
                  onClick={() => deleteMutation.mutate(attachment.id)}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function StudentHealthPanel({ studentId, canWrite }) {
  const queryClient = useQueryClient()
  const [recordDialogOpen, setRecordDialogOpen] = useState(false)
  const [noteDialog, setNoteDialog] = useState(null)

  const recordQuery = useQuery({
    queryKey: ['students', studentId, 'health-record'],
    queryFn: () => studentSensitiveApi.getHealthRecord(studentId),
    enabled: Boolean(studentId),
  })
  const notesQuery = useQuery({
    queryKey: ['students', studentId, 'health-notes'],
    queryFn: () => studentSensitiveApi.listHealthNotes(studentId),
    enabled: Boolean(studentId),
  })

  const saveRecordMutation = useMutation({
    mutationFn: (payload) =>
      recordQuery.data
        ? studentSensitiveApi.updateHealthRecord(studentId, payload)
        : studentSensitiveApi.createHealthRecord(studentId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students', studentId, 'health-record'] })
      setRecordDialogOpen(false)
    },
  })
  const createNoteMutation = useMutation({
    mutationFn: (payload) => studentSensitiveApi.createHealthNote(studentId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students', studentId, 'health-notes'] })
      setNoteDialog(null)
    },
  })
  const updateNoteMutation = useMutation({
    mutationFn: ({ id, payload }) => studentSensitiveApi.updateHealthNote(studentId, id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students', studentId, 'health-notes'] })
      setNoteDialog(null)
    },
  })
  const deleteNoteMutation = useMutation({
    mutationFn: (id) => studentSensitiveApi.removeHealthNote(studentId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['students', studentId, 'health-notes'] }),
  })

  return (
    <PanelFrame
      title="Health & Special Needs"
      icon={HeartPulse}
      isFetching={recordQuery.isFetching || notesQuery.isFetching}
      action={
        <>
          <Button type="button" variant="secondary" size="sm" disabled={!canWrite} onClick={() => setRecordDialogOpen(true)}>
            Health Record
          </Button>
          <Button type="button" size="sm" disabled={!canWrite} onClick={() => setNoteDialog({ mode: 'create' })}>
            <Plus size={15} />
            Note
          </Button>
        </>
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <SummaryCard label="Blood Type" value={recordQuery.data?.blood_type || '-'} />
        <SummaryCard
          label="Needs Assistance"
          value={recordQuery.data?.needs_assistance ? 'Yes' : 'No'}
          tone={recordQuery.data?.needs_assistance ? 'amber' : 'green'}
        />
      </div>

      {(notesQuery.data || []).length === 0 ? (
        <PanelMessage>No health or special needs notes yet.</PanelMessage>
      ) : (
        <div className="space-y-3">
          {(notesQuery.data || []).map((note) => (
            <article key={note.id} className="rounded-2xl border border-[var(--mws-line)] bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone="neutral">{formatStatus(note.category)}</StatusBadge>
                    <StatusBadge tone={statusTone(note.status)}>{formatStatus(note.status)}</StatusBadge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--mws-charcoal)]">
                    {note.description}
                  </p>
                  <p className="mt-1 text-xs text-[var(--mws-muted)]">
                    Noted {formatDate(note.noted_date)} / Resolved {formatDate(note.resolved_date)}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="sm" disabled={!canWrite} onClick={() => setNoteDialog({ mode: 'edit', record: note })}>
                    Edit
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={!canWrite} onClick={() => deleteNoteMutation.mutate(note.id)}>
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {recordDialogOpen ? (
        <HealthRecordDialog
          record={recordQuery.data}
          isSubmitting={saveRecordMutation.isPending}
          onClose={() => setRecordDialogOpen(false)}
          onSubmit={(payload) => saveRecordMutation.mutate(payload)}
        />
      ) : null}

      {noteDialog ? (
        <HealthNoteDialog
          dialog={noteDialog}
          isSubmitting={createNoteMutation.isPending || updateNoteMutation.isPending}
          onClose={() => setNoteDialog(null)}
          onSubmit={(payload) => {
            if (noteDialog.mode === 'create') createNoteMutation.mutate(payload)
            else updateNoteMutation.mutate({ id: noteDialog.record.id, payload })
          }}
        />
      ) : null}
    </PanelFrame>
  )
}

function ConsentDialog({ dialog, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    consent_type: dialog.record?.consent_type || 'MEDIA_CONSENT',
    status: dialog.record?.status || 'PENDING',
    consent_date: dateInputFromIso(dialog.record?.consent_date),
    signed_by: dialog.record?.signed_by || '',
    validity_period: dateInputFromIso(dialog.record?.validity_period),
    notes: dialog.record?.notes || '',
  }))

  function submit(event) {
    event.preventDefault()
    onSubmit(cleanPayload({
      consent_type: dialog.mode === 'create' ? values.consent_type : undefined,
      status: values.status,
      consent_date: isoFromDateInput(values.consent_date),
      signed_by: trimmedOrUndefined(values.signed_by),
      validity_period: isoFromDateInput(values.validity_period),
      notes: trimmedOrUndefined(values.notes),
    }))
  }

  return (
    <CrudDialog
      title={dialog.mode === 'create' ? 'New Consent' : 'Edit Consent'}
      onClose={onClose}
      footer={<DialogFooter form="consent-form" isSubmitting={isSubmitting} onClose={onClose} />}
    >
      <form id="consent-form" className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
        <Field label="Consent Type">
          <SelectInput disabled={dialog.mode !== 'create'} value={values.consent_type} onChange={(event) => setValues({ ...values, consent_type: event.target.value })}>
            {consentTypes.map((type) => <option key={type} value={type}>{formatStatus(type)}</option>)}
          </SelectInput>
        </Field>
        <Field label="Status">
          <SelectInput value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value })}>
            {consentStatuses.map((status) => <option key={status} value={status}>{formatStatus(status)}</option>)}
          </SelectInput>
        </Field>
        <Field label="Consent Date">
          <TextInput type="date" value={values.consent_date} onChange={(event) => setValues({ ...values, consent_date: event.target.value })} />
        </Field>
        <Field label="Valid Until">
          <TextInput type="date" value={values.validity_period} onChange={(event) => setValues({ ...values, validity_period: event.target.value })} />
        </Field>
        <Field label="Signed By" className="md:col-span-2">
          <TextInput value={values.signed_by} onChange={(event) => setValues({ ...values, signed_by: event.target.value })} />
        </Field>
        <Field label="Notes" className="md:col-span-2">
          <TextAreaInput value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} />
        </Field>
      </form>
    </CrudDialog>
  )
}

function HealthRecordDialog({ record, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    blood_type: record?.blood_type || '',
    needs_assistance: Boolean(record?.needs_assistance),
  }))

  function submit(event) {
    event.preventDefault()
    onSubmit(cleanPayload({
      blood_type: trimmedOrUndefined(values.blood_type),
      needs_assistance: values.needs_assistance,
    }))
  }

  return (
    <CrudDialog title="Health Record" onClose={onClose} footer={<DialogFooter form="health-record-form" isSubmitting={isSubmitting} onClose={onClose} />}>
      <form id="health-record-form" className="space-y-4" onSubmit={submit}>
        <Field label="Blood Type">
          <TextInput value={values.blood_type} placeholder="A, B, AB, O, unknown" onChange={(event) => setValues({ ...values, blood_type: event.target.value })} />
        </Field>
        <CheckboxField
          checked={values.needs_assistance}
          label="Needs assistance"
          description="Mark this when the student needs extra assistance or special handling."
          onChange={(event) => setValues({ ...values, needs_assistance: event.target.checked })}
        />
      </form>
    </CrudDialog>
  )
}

function HealthNoteDialog({ dialog, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    category: dialog.record?.category || 'HEALTH_INFO',
    description: dialog.record?.description || '',
    status: dialog.record?.status || 'ACTIVE',
    noted_date: dateInputFromIso(dialog.record?.noted_date) || new Date().toISOString().slice(0, 10),
    resolved_date: dateInputFromIso(dialog.record?.resolved_date),
  }))

  function submit(event) {
    event.preventDefault()
    onSubmit(cleanPayload({
      category: values.category,
      description: trimmedOrUndefined(values.description),
      status: values.status,
      noted_date: isoFromDateInput(values.noted_date),
      resolved_date: isoFromDateInput(values.resolved_date),
    }))
  }

  return (
    <CrudDialog title={dialog.mode === 'create' ? 'New Health Note' : 'Edit Health Note'} onClose={onClose} footer={<DialogFooter form="health-note-form" isSubmitting={isSubmitting} onClose={onClose} />}>
      <form id="health-note-form" className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
        <Field label="Category">
          <SelectInput value={values.category} onChange={(event) => setValues({ ...values, category: event.target.value })}>
            {healthNoteCategories.map((category) => <option key={category} value={category}>{formatStatus(category)}</option>)}
          </SelectInput>
        </Field>
        <Field label="Status">
          <SelectInput value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value })}>
            {healthNoteStatuses.map((status) => <option key={status} value={status}>{formatStatus(status)}</option>)}
          </SelectInput>
        </Field>
        <Field label="Noted Date">
          <TextInput type="date" value={values.noted_date} onChange={(event) => setValues({ ...values, noted_date: event.target.value })} />
        </Field>
        <Field label="Resolved Date">
          <TextInput type="date" value={values.resolved_date} onChange={(event) => setValues({ ...values, resolved_date: event.target.value })} />
        </Field>
        <Field label="Description" className="md:col-span-2">
          <TextAreaInput required value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} />
        </Field>
      </form>
    </CrudDialog>
  )
}

function PanelFrame({ title, icon: Icon, isFetching, action, children }) {
  return (
    <section className="rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="flex flex-col gap-3 border-b border-[var(--mws-line)] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
            <Icon size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--mws-charcoal)]">{title}</h2>
            <StatusBadge tone={isFetching ? 'amber' : 'green'}>
              {isFetching ? 'Syncing' : 'Live'}
            </StatusBadge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">{action}</div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function SummaryCard({ label, value, tone = 'neutral' }) {
  return (
    <div className="rounded-2xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-4">
      <p className="text-xs font-semibold text-[var(--mws-muted)]">{label}</p>
      <StatusBadge tone={tone} className="mt-2">{value}</StatusBadge>
    </div>
  )
}

function DialogFooter({ form, isSubmitting, onClose }) {
  return (
    <>
      <Button type="button" variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" form={form} disabled={isSubmitting}>
        Save
      </Button>
    </>
  )
}

function consentStatusTone(status) {
  switch (status) {
    case 'SIGNED':
      return 'green'
    case 'DECLINED':
    case 'EXPIRED':
      return 'red'
    default:
      return 'amber'
  }
}

function attachmentDownloadUrl(studentId, consentId, attachmentId) {
  return `${env.apiBaseUrl}/api/admin/students/${studentId}/consents/${consentId}/attachments/${attachmentId}/download`
}

function formatFileSize(size) {
  if (!size) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function invalidateConsents(queryClient, studentId) {
  queryClient.invalidateQueries({ queryKey: ['students', studentId, 'consents'] })
}
