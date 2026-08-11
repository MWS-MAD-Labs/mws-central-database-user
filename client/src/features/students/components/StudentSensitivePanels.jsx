import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Download,
  FileSignature,
  HeartHandshake,
  HeartPulse,
  Paperclip,
  Plus,
  RotateCcw,
  Syringe,
  Trash2,
  UsersRound,
  CalendarCheck,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import {
  CheckboxField,
  Field,
  SearchableSelect,
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
  parentTypes,
  pcDays,
  studentSensitiveApi,
  vaccineTypes,
} from '../api/studentSensitiveApi.js'
import { employeesApi } from '../../employees/api/employeesApi.js'
import { academicYearsApi } from '../../academic/api/academicApi.js'
import { jobLevelsApi, pcActivitiesApi } from '../../master-data/api/masterDataApi.js'

export function StudentParentsPanel({ studentId, canWrite }) {
  const queryClient = useQueryClient()
  const [showDeleted, setShowDeleted] = useState(false)
  const [dialog, setDialog] = useState(null)

  const parentsQuery = useQuery({
    queryKey: ['students', studentId, 'parents', showDeleted],
    queryFn: () =>
      studentSensitiveApi.listParents(studentId, { is_deleted: showDeleted }),
    enabled: Boolean(studentId),
  })

  const createMutation = useMutation({
    mutationFn: (payload) => studentSensitiveApi.createParent(studentId, payload),
    onSuccess: () => {
      invalidateStudentRelation(queryClient, studentId, 'parents')
      setDialog(null)
    },
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) =>
      studentSensitiveApi.updateParent(studentId, id, payload),
    onSuccess: () => {
      invalidateStudentRelation(queryClient, studentId, 'parents')
      setDialog(null)
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (id) => studentSensitiveApi.removeParent(studentId, id),
    onSuccess: () => invalidateStudentRelation(queryClient, studentId, 'parents'),
  })
  const restoreMutation = useMutation({
    mutationFn: (id) => studentSensitiveApi.restoreParent(studentId, id),
    onSuccess: () => invalidateStudentRelation(queryClient, studentId, 'parents'),
  })

  return (
    <PanelFrame
      title="Parents & Guardians"
      icon={UsersRound}
      isFetching={parentsQuery.isFetching}
      action={
        <>
          <CheckboxField
            label="Show deleted"
            checked={showDeleted}
            onChange={(event) => setShowDeleted(event.target.checked)}
            className="min-h-8 rounded-full px-3 py-1.5"
          />
          <Button
            type="button"
            size="sm"
            disabled={!canWrite}
            onClick={() => setDialog({ mode: 'create' })}
          >
            <Plus size={15} />
            Parent
          </Button>
        </>
      }
    >
      {(parentsQuery.data || []).length === 0 ? (
        <PanelMessage>No parent or guardian records yet.</PanelMessage>
      ) : (
        <div className="space-y-3">
          {(parentsQuery.data || []).map((parent) => (
            <article key={parent.id} className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-sm font-bold text-[var(--mws-charcoal)]">
                      {parent.full_name}
                    </h3>
                    <StatusBadge tone="neutral">{formatStatus(parent.type)}</StatusBadge>
                    {parent.is_primary ? <StatusBadge tone="green">Primary</StatusBadge> : null}
                    {parent.deleted_at ? <StatusBadge tone="red">Deleted</StatusBadge> : null}
                  </div>
                  <p className="mt-1 text-sm text-[var(--mws-muted)]">
                    {[parent.phone, parent.email].filter(Boolean).join(' / ') || '-'}
                  </p>
                  {parent.address ? (
                    <p className="mt-2 text-sm leading-6 text-[var(--mws-charcoal)]">
                      {parent.address}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-1">
                  {parent.deleted_at ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!canWrite || restoreMutation.variables === parent.id}
                      onClick={() => restoreMutation.mutate(parent.id)}
                    >
                      <RotateCcw size={15} />
                      Restore
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!canWrite}
                        onClick={() => setDialog({ mode: 'edit', record: parent })}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!canWrite || deleteMutation.variables === parent.id}
                        onClick={() => deleteMutation.mutate(parent.id)}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {dialog ? (
        <ParentDialog
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

export function StudentConsentPanel({ studentId, canWrite }) {
  const queryClient = useQueryClient()
  const [showDeleted, setShowDeleted] = useState(false)
  const [dialog, setDialog] = useState(null)

  const consentsQuery = useQuery({
    queryKey: ['students', studentId, 'consents', showDeleted],
    queryFn: () =>
      studentSensitiveApi.listConsents(studentId, { is_deleted: showDeleted }),
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
  const restoreMutation = useMutation({
    mutationFn: (id) => studentSensitiveApi.restoreConsent(studentId, id),
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
        <>
          <CheckboxField
            label="Show deleted"
            checked={showDeleted}
            onChange={(event) => setShowDeleted(event.target.checked)}
            className="min-h-8 rounded-full px-3 py-1.5"
          />
          <Button
            type="button"
            size="sm"
            disabled={!canWrite}
            onClick={() => setDialog({ mode: 'create' })}
          >
            <Plus size={15} />
            Consent
          </Button>
        </>
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
              onRestore={() => restoreMutation.mutate(consent.id)}
              isRestoring={restoreMutation.variables === consent.id}
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

function ConsentCard({
  studentId,
  consent,
  canWrite,
  onEdit,
  onDelete,
  onRestore,
  isRestoring,
}) {
  return (
    <article className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-sm font-bold text-[var(--mws-charcoal)]">
              {formatStatus(consent.consent_type)}
            </h3>
            <StatusBadge tone={consentStatusTone(consent.status)}>
              {formatStatus(consent.status)}
            </StatusBadge>
            {consent.deleted_at ? <StatusBadge tone="red">Deleted</StatusBadge> : null}
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
          {consent.deleted_at ? (
            <Button type="button" variant="ghost" size="sm" disabled={!canWrite || isRestoring} onClick={onRestore}>
              <RotateCcw size={15} />
              Restore
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" size="sm" disabled={!canWrite} onClick={onEdit}>
                Edit
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={!canWrite} onClick={onDelete}>
                <Trash2 size={15} />
              </Button>
            </>
          )}
        </div>
      </div>
      <ConsentAttachments
        studentId={studentId}
        consentId={consent.id}
        canWrite={canWrite && !consent.deleted_at}
      />
    </article>
  )
}

function ConsentAttachments({ studentId, consentId, canWrite }) {
  const queryClient = useQueryClient()
  const [showDeleted, setShowDeleted] = useState(false)
  const attachmentsQuery = useQuery({
    queryKey: ['students', studentId, 'consents', consentId, 'attachments', showDeleted],
    queryFn: () =>
      studentSensitiveApi.listAttachments(studentId, consentId, {
        is_deleted: showDeleted,
      }),
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
  const restoreMutation = useMutation({
    mutationFn: (attachmentId) =>
      studentSensitiveApi.restoreAttachment(studentId, consentId, attachmentId),
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
        <div className="flex flex-wrap items-center gap-2">
          <CheckboxField
            label="Show deleted"
            checked={showDeleted}
            onChange={(event) => setShowDeleted(event.target.checked)}
            className="min-h-8 rounded-full bg-white px-3 py-1.5"
          />
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
                  {attachment.deleted_at ? (
                    <StatusBadge tone="red" className="ml-2">Deleted</StatusBadge>
                  ) : null}
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
                {attachment.deleted_at ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!canWrite || restoreMutation.variables === attachment.id}
                    onClick={() => restoreMutation.mutate(attachment.id)}
                  >
                    <RotateCcw size={15} />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!canWrite || deleteMutation.variables === attachment.id}
                    onClick={() => deleteMutation.mutate(attachment.id)}
                  >
                    <Trash2 size={15} />
                  </Button>
                )}
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
  const [showDeletedNotes, setShowDeletedNotes] = useState(false)
  const [noteDialog, setNoteDialog] = useState(null)

  const recordQuery = useQuery({
    queryKey: ['students', studentId, 'health-record'],
    queryFn: () => studentSensitiveApi.getHealthRecord(studentId),
    enabled: Boolean(studentId),
  })
  const notesQuery = useQuery({
    queryKey: ['students', studentId, 'health-notes', showDeletedNotes],
    queryFn: () =>
      studentSensitiveApi.listHealthNotes(studentId, {
        is_deleted: showDeletedNotes,
      }),
    enabled: Boolean(studentId),
  })

  const createNoteMutation = useMutation({
    mutationFn: (payload) => saveHealthNoteWithAssistance({
      studentId,
      payload,
      healthRecord: recordQuery.data,
      mode: 'create',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students', studentId, 'health-record'] })
      queryClient.invalidateQueries({ queryKey: ['students', studentId, 'health-notes'] })
      setNoteDialog(null)
    },
  })
  const updateNoteMutation = useMutation({
    mutationFn: ({ id, payload }) => saveHealthNoteWithAssistance({
      studentId,
      payload,
      healthRecord: recordQuery.data,
      mode: 'update',
      noteId: id,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students', studentId, 'health-record'] })
      queryClient.invalidateQueries({ queryKey: ['students', studentId, 'health-notes'] })
      setNoteDialog(null)
    },
  })
  const deleteNoteMutation = useMutation({
    mutationFn: (id) => studentSensitiveApi.removeHealthNote(studentId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['students', studentId, 'health-notes'] }),
  })
  const restoreNoteMutation = useMutation({
    mutationFn: (id) => studentSensitiveApi.restoreHealthNote(studentId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['students', studentId, 'health-notes'] }),
  })
  const deleteRecordMutation = useMutation({
    mutationFn: () => studentSensitiveApi.removeHealthRecord(studentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['students', studentId, 'health-record'] }),
  })
  const restoreRecordMutation = useMutation({
    mutationFn: () => studentSensitiveApi.restoreHealthRecord(studentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['students', studentId, 'health-record'] }),
  })

  return (
    <PanelFrame
      title="Health & Special Needs"
      icon={HeartPulse}
      isFetching={recordQuery.isFetching || notesQuery.isFetching}
      action={
        <>
          <CheckboxField
            label="Show deleted notes"
            checked={showDeletedNotes}
            onChange={(event) => setShowDeletedNotes(event.target.checked)}
            className="min-h-8 rounded-full px-3 py-1.5"
          />
          {!recordQuery.data ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!canWrite || restoreRecordMutation.isPending}
              onClick={() => restoreRecordMutation.mutate()}
            >
              <RotateCcw size={15} />
              Restore Record
            </Button>
          ) : null}
          {recordQuery.data ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!canWrite || deleteRecordMutation.isPending}
              onClick={() => deleteRecordMutation.mutate()}
            >
              <Trash2 size={15} />
            </Button>
          ) : null}
          <Button type="button" size="sm" disabled={!canWrite} onClick={() => setNoteDialog({ mode: 'create' })}>
            <Plus size={15} />
            Health Form
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
            <article key={note.id} className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone="neutral">{formatStatus(note.category)}</StatusBadge>
                    <StatusBadge tone={statusTone(note.status)}>{formatStatus(note.status)}</StatusBadge>
                    {note.deleted_at ? <StatusBadge tone="red">Deleted</StatusBadge> : null}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--mws-charcoal)]">
                    {note.description}
                  </p>
                  <p className="mt-1 text-xs text-[var(--mws-muted)]">
                    Noted {formatDate(note.noted_date)} / Resolved {formatDate(note.resolved_date)}
                  </p>
                </div>
                <div className="flex gap-1">
                  {note.deleted_at ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!canWrite || restoreNoteMutation.variables === note.id}
                      onClick={() => restoreNoteMutation.mutate(note.id)}
                    >
                      <RotateCcw size={15} />
                      Restore
                    </Button>
                  ) : (
                    <>
                      <Button type="button" variant="ghost" size="sm" disabled={!canWrite} onClick={() => setNoteDialog({ mode: 'edit', record: note })}>
                        Edit
                      </Button>
                      <Button type="button" variant="ghost" size="sm" disabled={!canWrite} onClick={() => deleteNoteMutation.mutate(note.id)}>
                        <Trash2 size={15} />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {noteDialog ? (
          <HealthNoteDialog
            dialog={noteDialog}
            healthRecord={recordQuery.data}
            isSubmitting={
              createNoteMutation.isPending ||
              updateNoteMutation.isPending
            }
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

export function StudentVaccinePanel({ studentId, canWrite }) {
  const queryClient = useQueryClient()
  const [showDeleted, setShowDeleted] = useState(false)
  const [dialog, setDialog] = useState(null)

  const vaccinesQuery = useQuery({
    queryKey: ['students', studentId, 'vaccine-records', showDeleted],
    queryFn: () =>
      studentSensitiveApi.listVaccines(studentId, { is_deleted: showDeleted }),
    enabled: Boolean(studentId),
  })
  const createMutation = useMutation({
    mutationFn: (payload) => studentSensitiveApi.createVaccine(studentId, payload),
    onSuccess: () => {
      invalidateStudentRelation(queryClient, studentId, 'vaccine-records')
      setDialog(null)
    },
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) =>
      studentSensitiveApi.updateVaccine(studentId, id, payload),
    onSuccess: () => {
      invalidateStudentRelation(queryClient, studentId, 'vaccine-records')
      setDialog(null)
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (id) => studentSensitiveApi.removeVaccine(studentId, id),
    onSuccess: () => invalidateStudentRelation(queryClient, studentId, 'vaccine-records'),
  })
  const restoreMutation = useMutation({
    mutationFn: (id) => studentSensitiveApi.restoreVaccine(studentId, id),
    onSuccess: () => invalidateStudentRelation(queryClient, studentId, 'vaccine-records'),
  })

  return (
    <PanelFrame
      title="Vaccine Records"
      icon={Syringe}
      isFetching={vaccinesQuery.isFetching}
      action={
        <>
          <CheckboxField
            label="Show deleted"
            checked={showDeleted}
            onChange={(event) => setShowDeleted(event.target.checked)}
            className="min-h-8 rounded-full px-3 py-1.5"
          />
          <Button
            type="button"
            size="sm"
            disabled={!canWrite}
            onClick={() => setDialog({ mode: 'create' })}
          >
            <Plus size={15} />
            Vaccine
          </Button>
        </>
      }
    >
      {(vaccinesQuery.data || []).length === 0 ? (
        <PanelMessage>No vaccine records yet.</PanelMessage>
      ) : (
        <div className="space-y-3">
          {(vaccinesQuery.data || []).map((record) => (
            <article key={record.id} className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-sm font-bold text-[var(--mws-charcoal)]">
                      {formatStatus(record.vaccine_type)}
                    </h3>
                    <StatusBadge tone={record.received ? 'green' : 'amber'}>
                      {record.received ? 'Received' : 'Pending'}
                    </StatusBadge>
                    {record.deleted_at ? <StatusBadge tone="red">Deleted</StatusBadge> : null}
                  </div>
                  <p className="mt-1 text-sm text-[var(--mws-muted)]">
                    Date {formatDate(record.date)}
                  </p>
                </div>
                <div className="flex gap-1">
                  {record.deleted_at ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!canWrite || restoreMutation.variables === record.id}
                      onClick={() => restoreMutation.mutate(record.id)}
                    >
                      <RotateCcw size={15} />
                      Restore
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!canWrite}
                        onClick={() => setDialog({ mode: 'edit', record })}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!canWrite || deleteMutation.variables === record.id}
                        onClick={() => deleteMutation.mutate(record.id)}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {dialog ? (
        <VaccineDialog
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

export function StudentPcActivitiesPanel({ studentId, canWrite }) {
  const queryClient = useQueryClient()
  const [showDeleted, setShowDeleted] = useState(false)
  const [dialog, setDialog] = useState(null)

  const activitiesQuery = useQuery({
    queryKey: ['students', studentId, 'pc-activities', showDeleted],
    queryFn: () =>
      studentSensitiveApi.listPcActivities(studentId, { is_deleted: showDeleted }),
    enabled: Boolean(studentId),
  })
  const employeesQuery = useQuery({
    queryKey: ['pc-activity-mentor-options'],
    queryFn: async () => {
      const [employees, jobLevels] = await Promise.all([
        employeesApi.list({
          page: 1,
          size: 100,
          status: 'ACTIVE',
          sort_by: 'full_name',
          sort_order: 'asc',
        }),
        jobLevelsApi.list({
          page: 1,
          size: 100,
          sort_by: 'name',
          sort_order: 'asc',
        }),
      ])
      const teachingLevelNames = new Set(
        (jobLevels.data || [])
          .filter((level) => level.is_teaching_role)
          .map((level) => level.name),
      )
      const activeEmployees = employees.data || []

      return {
        employees: activeEmployees,
        teachingEmployees: activeEmployees.filter((employee) =>
          teachingLevelNames.has(employee.employment.job_level),
        ),
      }
    },
  })
  const yearsQuery = useQuery({
    queryKey: ['pc-activity-academic-years'],
    queryFn: () =>
      academicYearsApi.list({
        page: 1,
        size: 100,
        sort_by: 'created_at',
        sort_order: 'desc',
      }),
  })
  const activityOptionsQuery = useQuery({
    queryKey: ['pc-activity-options'],
    queryFn: () =>
      pcActivitiesApi.list({
        page: 1,
        size: 100,
        sort_by: 'name',
        sort_order: 'asc',
      }),
  })
  const createMutation = useMutation({
    mutationFn: (payload) => studentSensitiveApi.createPcActivity(studentId, payload),
    onSuccess: () => {
      invalidateStudentRelation(queryClient, studentId, 'pc-activities')
      setDialog(null)
    },
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) =>
      studentSensitiveApi.updatePcActivity(studentId, id, payload),
    onSuccess: () => {
      invalidateStudentRelation(queryClient, studentId, 'pc-activities')
      setDialog(null)
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (id) => studentSensitiveApi.removePcActivity(studentId, id),
    onSuccess: () => invalidateStudentRelation(queryClient, studentId, 'pc-activities'),
  })
  const restoreMutation = useMutation({
    mutationFn: (id) => studentSensitiveApi.restorePcActivity(studentId, id),
    onSuccess: () => invalidateStudentRelation(queryClient, studentId, 'pc-activities'),
  })

  const employees = employeesQuery.data?.employees || []
  const teachingEmployees = employeesQuery.data?.teachingEmployees || []
  const years = yearsQuery.data?.data || []
  const activityOptions = activityOptionsQuery.data?.data || []

  return (
    <PanelFrame
      title="PC Activities"
      icon={CalendarCheck}
      isFetching={activitiesQuery.isFetching}
      action={
        <>
          <CheckboxField
            label="Show deleted"
            checked={showDeleted}
            onChange={(event) => setShowDeleted(event.target.checked)}
            className="min-h-8 rounded-full px-3 py-1.5"
          />
          <Button
            type="button"
            size="sm"
            disabled={!canWrite}
            onClick={() => setDialog({ mode: 'create' })}
          >
            <Plus size={15} />
            Activity
          </Button>
        </>
      }
    >
      {(activitiesQuery.data || []).length === 0 ? (
        <PanelMessage>No PC activities yet.</PanelMessage>
      ) : (
        <div className="space-y-3">
          {(activitiesQuery.data || []).map((activity) => {
            const mentor = employees.find((employee) => employee.id === activity.mentor_id)
            const year = years.find((item) => item.id === activity.academic_year_id)
            return (
              <article key={activity.id} className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="neutral">{formatStatus(activity.day)}</StatusBadge>
                      {activity.deleted_at ? <StatusBadge tone="red">Deleted</StatusBadge> : null}
                    </div>
                    <p className="mt-2 text-sm font-semibold text-[var(--mws-charcoal)]">
                      {activity.activity}
                    </p>
                    <p className="mt-1 text-xs text-[var(--mws-muted)]">
                      {mentor?.identity.full_name || 'No mentor'} / {year?.name || activity.academic_year_id}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {activity.deleted_at ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!canWrite || restoreMutation.variables === activity.id}
                        onClick={() => restoreMutation.mutate(activity.id)}
                      >
                        <RotateCcw size={15} />
                        Restore
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={!canWrite}
                          onClick={() => setDialog({ mode: 'edit', record: activity })}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={!canWrite || deleteMutation.variables === activity.id}
                          onClick={() => deleteMutation.mutate(activity.id)}
                        >
                          <Trash2 size={15} />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {dialog ? (
        <PcActivityDialog
          dialog={dialog}
          employees={teachingEmployees}
          academicYears={years}
          activities={activityOptions}
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

export function StudentSupportAssignmentPanel({ studentId, canWrite }) {
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState(null)

  const assignmentsQuery = useQuery({
    queryKey: ['students', studentId, 'support-assignments'],
    queryFn: () => studentSensitiveApi.listSupportAssignments(studentId),
    enabled: Boolean(studentId),
  })
  const employeesQuery = useQuery({
    queryKey: ['special-education-teacher-options'],
    queryFn: async () => {
      const [employees, caseload] = await Promise.all([
        employeesApi.list({
          page: 1,
          size: 100,
          status: 'ACTIVE',
          sort_by: 'full_name',
          sort_order: 'asc',
        }),
        studentSensitiveApi.getSupportAssignmentCaseload(),
      ])
      const caseloadByEmployeeId = new Map(
        caseload.map((entry) => [entry.employee_id, entry.active_student_count]),
      )

      return (employees.data || [])
        .filter(
          (employee) =>
            employee.employment.job_level === 'SE Teacher' &&
            employee.employment.job_position === 'Special Education Teacher',
        )
        .map((employee) => ({
          ...employee,
          active_student_count: caseloadByEmployeeId.get(employee.id) || 0,
        }))
    },
  })

  const createMutation = useMutation({
    mutationFn: (payload) =>
      studentSensitiveApi.createSupportAssignment(studentId, payload),
    onSuccess: () => {
      invalidateStudentRelation(queryClient, studentId, 'support-assignments')
      setDialog(null)
    },
  })
  const endMutation = useMutation({
    mutationFn: (id) => studentSensitiveApi.endSupportAssignment(studentId, id),
    onSuccess: () =>
      invalidateStudentRelation(queryClient, studentId, 'support-assignments'),
  })

  const teachingEmployees = employeesQuery.data || []

  function handleEnd(assignment) {
    if (
      window.confirm(
        `End ${assignment.employee.full_name}'s Special Education Teacher assignment?`,
      )
    ) {
      endMutation.mutate(assignment.id)
    }
  }

  return (
    <PanelFrame
      title="Special Education Teacher"
      icon={HeartHandshake}
      isFetching={assignmentsQuery.isFetching}
      action={
        <Button
          type="button"
          size="sm"
          disabled={!canWrite}
          onClick={() => setDialog({ mode: 'create' })}
        >
          <Plus size={15} />
          Assign
        </Button>
      }
    >
      {(assignmentsQuery.data || []).length === 0 ? (
        <PanelMessage>No Special Education teacher assigned yet.</PanelMessage>
      ) : (
        <div className="space-y-3">
          {(assignmentsQuery.data || []).map((assignment) => (
            <article key={assignment.id} className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-sm font-bold text-[var(--mws-charcoal)]">
                      {assignment.employee.full_name}
                    </h3>
                    <StatusBadge tone="neutral">{formatStatus(assignment.role)}</StatusBadge>
                    <StatusBadge tone={assignment.end_date ? 'red' : 'green'}>
                      {assignment.end_date ? 'Ended' : 'Active'}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-sm text-[var(--mws-muted)]">
                    Since {formatDate(assignment.start_date)}
                    {assignment.end_date ? ` / Ended ${formatDate(assignment.end_date)}` : ''}
                  </p>
                  {assignment.notes ? (
                    <p className="mt-2 text-sm leading-6 text-[var(--mws-charcoal)]">
                      {assignment.notes}
                    </p>
                  ) : null}
                </div>
                {!assignment.end_date ? (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!canWrite || endMutation.variables === assignment.id}
                      onClick={() => handleEnd(assignment)}
                    >
                      End
                    </Button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {dialog ? (
        <SupportAssignmentDialog
          employees={teachingEmployees}
          isSubmitting={createMutation.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => createMutation.mutate(payload)}
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

function ParentDialog({ dialog, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    type: dialog.record?.type || 'FATHER',
    full_name: dialog.record?.full_name || '',
    phone: dialog.record?.phone || '',
    email: dialog.record?.email || '',
    address: dialog.record?.address || '',
    is_primary: Boolean(dialog.record?.is_primary),
  }))

  function submit(event) {
    event.preventDefault()
    onSubmit(cleanPayload({
      type: values.type,
      full_name: trimmedOrUndefined(values.full_name),
      phone: trimmedOrUndefined(values.phone),
      email: trimmedOrUndefined(values.email),
      address: trimmedOrUndefined(values.address),
      is_primary: values.is_primary,
    }))
  }

  return (
    <CrudDialog
      title={dialog.mode === 'create' ? 'New Parent / Guardian' : 'Edit Parent / Guardian'}
      onClose={onClose}
      footer={<DialogFooter form="parent-form" isSubmitting={isSubmitting} onClose={onClose} />}
    >
      <form id="parent-form" className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
        <Field label="Type">
          <SelectInput value={values.type} onChange={(event) => setValues({ ...values, type: event.target.value })}>
            {parentTypes.map((type) => <option key={type} value={type}>{formatStatus(type)}</option>)}
          </SelectInput>
        </Field>
        <Field label="Full Name">
          <TextInput required value={values.full_name} onChange={(event) => setValues({ ...values, full_name: event.target.value })} />
        </Field>
        <Field label="Phone">
          <TextInput value={values.phone} onChange={(event) => setValues({ ...values, phone: event.target.value })} />
        </Field>
        <Field label="Email">
          <TextInput type="email" value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} />
        </Field>
        <Field label="Address" className="md:col-span-2">
          <TextAreaInput value={values.address} onChange={(event) => setValues({ ...values, address: event.target.value })} />
        </Field>
        <CheckboxField
          label="Primary contact"
          checked={values.is_primary}
          onChange={(event) => setValues({ ...values, is_primary: event.target.checked })}
          className="md:col-span-2"
        />
      </form>
    </CrudDialog>
  )
}

function VaccineDialog({ dialog, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    vaccine_type: dialog.record?.vaccine_type || 'POLIO',
    received: dialog.record?.received ?? true,
    date: dateInputFromIso(dialog.record?.date),
  }))

  function submit(event) {
    event.preventDefault()
    onSubmit(cleanPayload({
      vaccine_type: dialog.mode === 'create' ? values.vaccine_type : undefined,
      received: values.received,
      date: isoFromDateInput(values.date),
    }))
  }

  return (
    <CrudDialog
      title={dialog.mode === 'create' ? 'New Vaccine Record' : 'Edit Vaccine Record'}
      onClose={onClose}
      footer={<DialogFooter form="vaccine-form" isSubmitting={isSubmitting} onClose={onClose} />}
    >
      <form id="vaccine-form" className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
        <Field label="Vaccine Type">
          <SelectInput
            disabled={dialog.mode !== 'create'}
            value={values.vaccine_type}
            onChange={(event) => setValues({ ...values, vaccine_type: event.target.value })}
          >
            {vaccineTypes.map((type) => <option key={type} value={type}>{formatStatus(type)}</option>)}
          </SelectInput>
        </Field>
        <Field label="Date">
          <TextInput type="date" value={values.date} onChange={(event) => setValues({ ...values, date: event.target.value })} />
        </Field>
        <CheckboxField
          label="Received"
          checked={values.received}
          onChange={(event) => setValues({ ...values, received: event.target.checked })}
          className="md:col-span-2"
        />
      </form>
    </CrudDialog>
  )
}

function PcActivityDialog({ dialog, employees, academicYears, activities, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    day: dialog.record?.day || 'MONDAY',
    activity_id: dialog.record?.activity_id || '',
    mentor_id: dialog.record?.mentor_id || '',
    academic_year_id: dialog.record?.academic_year_id || '',
  }))
  const employeeOptions = employees.map((employee) => ({
    value: employee.id,
    label: employee.identity.full_name,
    description: employee.identity.email,
    badge: employee.employment.job_position,
    searchText: employee.employment.employee_id,
  }))
  const activityOptions = activities.map((activity) => ({
    value: activity.id,
    label: activity.name,
  }))

  function submit(event) {
    event.preventDefault()
    onSubmit(cleanPayload({
      day: dialog.mode === 'create' ? values.day : undefined,
      activity_id: trimmedOrUndefined(values.activity_id),
      mentor_id: values.mentor_id || (dialog.mode === 'edit' ? null : undefined),
      academic_year_id: dialog.mode === 'create'
        ? trimmedOrUndefined(values.academic_year_id)
        : undefined,
    }))
  }

  return (
    <CrudDialog
      title={dialog.mode === 'create' ? 'New PC Activity' : 'Edit PC Activity'}
      onClose={onClose}
      footer={<DialogFooter form="pc-activity-form" isSubmitting={isSubmitting} onClose={onClose} />}
    >
      <form id="pc-activity-form" className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
        <Field label="Day">
          <SelectInput
            disabled={dialog.mode !== 'create'}
            value={values.day}
            onChange={(event) => setValues({ ...values, day: event.target.value })}
          >
            {pcDays.map((day) => <option key={day} value={day}>{formatStatus(day)}</option>)}
          </SelectInput>
        </Field>
        <Field label="Academic Year">
          <SelectInput
            disabled={dialog.mode !== 'create'}
            value={values.academic_year_id}
            onChange={(event) => setValues({ ...values, academic_year_id: event.target.value })}
          >
            <option value="">Use active year</option>
            {academicYears.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}
          </SelectInput>
        </Field>
        <Field label="Mentor" className="md:col-span-2">
          <SearchableSelect
            value={values.mentor_id}
            onChange={(mentorId) => setValues({ ...values, mentor_id: mentorId })}
            options={[{ value: '', label: 'No mentor' }, ...employeeOptions]}
            placeholder="Select mentor"
            searchPlaceholder="Search employee"
            searchableThreshold={1}
          />
        </Field>
        <Field label="Activity" className="md:col-span-2">
          <SearchableSelect
            required
            value={values.activity_id}
            onChange={(activityId) => setValues({ ...values, activity_id: activityId })}
            options={activityOptions}
            placeholder="Select activity"
            searchPlaceholder="Search activity"
            searchableThreshold={1}
          />
        </Field>
      </form>
    </CrudDialog>
  )
}

function SupportAssignmentDialog({ employees, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState({ employee_id: '', notes: '' })
  const employeeOptions = employees.map((employee) => ({
    value: employee.id,
    label: employee.identity.full_name,
    description: employee.identity.email,
    badge: caseloadLabel(employee.active_student_count),
    tone: employee.active_student_count > 0 ? 'amber' : 'green',
    searchText: employee.employment.employee_id,
  }))

  function submit(event) {
    event.preventDefault()
    onSubmit(cleanPayload({
      employee_id: values.employee_id,
      role: 'SPECIAL_ED',
      notes: trimmedOrUndefined(values.notes),
    }))
  }

  return (
    <CrudDialog
      title="Assign Special Education Teacher"
      onClose={onClose}
      footer={<DialogFooter form="support-assignment-form" isSubmitting={isSubmitting} onClose={onClose} />}
    >
      <form id="support-assignment-form" className="grid gap-4" onSubmit={submit}>
        <Field label="Special Education Teacher">
          <SearchableSelect
            value={values.employee_id}
            onChange={(employeeId) => setValues({ ...values, employee_id: employeeId })}
            options={employeeOptions}
            placeholder="Select a teacher"
            searchPlaceholder="Search employee"
            searchableThreshold={1}
            required
          />
        </Field>
        <Field label="Notes">
          <TextAreaInput
            value={values.notes}
            placeholder="Weekly reading support, sensory breaks, etc."
            onChange={(event) => setValues({ ...values, notes: event.target.value })}
          />
        </Field>
      </form>
    </CrudDialog>
  )
}

function HealthNoteDialog({ dialog, healthRecord, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    blood_type: healthRecord?.blood_type || '',
    category: dialog.record?.category || 'HEALTH_INFO',
    description: dialog.record?.description || '',
    status: dialog.record?.status || 'ACTIVE',
    noted_date: dateInputFromIso(dialog.record?.noted_date) || new Date().toISOString().slice(0, 10),
    resolved_date: dateInputFromIso(dialog.record?.resolved_date),
    needs_assistance: Boolean(healthRecord?.needs_assistance),
  }))
  const isSpecialNeeds = values.category === 'SPECIAL_NEEDS'

  function submit(event) {
    event.preventDefault()
    onSubmit(cleanPayload({
      blood_type: trimmedOrUndefined(values.blood_type),
      category: values.category,
      description: trimmedOrUndefined(values.description),
      status: values.status,
      noted_date: isoFromDateInput(values.noted_date),
      resolved_date: isoFromDateInput(values.resolved_date),
      needs_assistance: isSpecialNeeds ? values.needs_assistance : undefined,
    }))
  }

  return (
    <CrudDialog title={dialog.mode === 'create' ? 'New Health Form' : 'Edit Health Form'} onClose={onClose} footer={<DialogFooter form="health-note-form" isSubmitting={isSubmitting} onClose={onClose} />}>
      <form id="health-note-form" className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
        <Field label="Blood Type">
          <TextInput
            value={values.blood_type}
            placeholder="A, B, AB, O, unknown"
            onChange={(event) => setValues({ ...values, blood_type: event.target.value })}
          />
        </Field>
        <Field label="Category">
          <SelectInput
            value={values.category}
            onChange={(event) => setValues({ ...values, category: event.target.value })}
          >
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
          <TextAreaInput
            required
            value={values.description}
            placeholder={isSpecialNeeds ? 'Autism spectrum, ADHD, sensory sensitivity, learning support needs...' : undefined}
            onChange={(event) => setValues({ ...values, description: event.target.value })}
          />
        </Field>
        {isSpecialNeeds ? (
          <CheckboxField
            label="Needs assistance"
            description="Check this when the student needs extra assistance or special handling."
            checked={values.needs_assistance}
            onChange={(event) => setValues({ ...values, needs_assistance: event.target.checked })}
            className="md:col-span-2"
          />
        ) : null}
      </form>
    </CrudDialog>
  )
}

function PanelFrame({ title, icon: Icon, isFetching, action, children }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--mws-line)] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
            <Icon size={18} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[var(--mws-charcoal)]">{title}</h2>
            <StatusBadge tone={isFetching ? 'amber' : 'green'}>
              {isFetching ? 'Syncing' : 'Live'}
            </StatusBadge>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">{action}</div>
      </div>
      <div className="min-w-0 p-5">{children}</div>
    </section>
  )
}

function SummaryCard({ label, value, tone = 'neutral' }) {
  return (
    <div className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-4">
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

function caseloadLabel(count) {
  return `${count || 0} student${count === 1 ? '' : 's'}`
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

async function saveHealthNoteWithAssistance({
  studentId,
  payload,
  healthRecord,
  mode,
  noteId,
}) {
  const {
    blood_type: bloodType,
    needs_assistance: needsAssistance,
    ...notePayload
  } = payload
  const note = mode === 'update'
    ? await studentSensitiveApi.updateHealthNote(studentId, noteId, notePayload)
    : await studentSensitiveApi.createHealthNote(studentId, notePayload)

  if (bloodType !== undefined || needsAssistance !== undefined) {
    const recordPayload = {
      blood_type: bloodType ?? healthRecord?.blood_type ?? undefined,
      needs_assistance: needsAssistance ?? Boolean(healthRecord?.needs_assistance),
    }

    if (healthRecord) {
      await studentSensitiveApi.updateHealthRecord(studentId, recordPayload)
    } else {
      await studentSensitiveApi.createHealthRecord(studentId, recordPayload)
    }
  }

  return note
}

function invalidateConsents(queryClient, studentId) {
  queryClient.invalidateQueries({ queryKey: ['students', studentId, 'consents'] })
}

function invalidateStudentRelation(queryClient, studentId, relation) {
  queryClient.invalidateQueries({ queryKey: ['students', studentId, relation] })
}
