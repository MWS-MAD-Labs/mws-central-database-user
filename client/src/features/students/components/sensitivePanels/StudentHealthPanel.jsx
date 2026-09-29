import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EyeOff, HeartPulse, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ActionsMenu, ActionsMenuItem } from '../../../../components/ui/ActionsMenu.jsx'
import { Button } from '../../../../components/ui/Button.jsx'
import { useConfirm } from '../../../../components/ui/useConfirm.js'
import { CrudDialog } from '../../../../components/ui/CrudDialog.jsx'
import {
  CheckboxField,
  DateField,
  Field,
  LimitedField,
  SearchableSelect,
} from '../../../../components/ui/FormControls.jsx'
import { PanelMessage } from '../../../../components/ui/PanelMessage.jsx'
import { StatusBadge } from '../../../../components/ui/StatusBadge.jsx'
import { cleanPayload, dateInputFromIso, isoFromDateInput, trimmedOrUndefined } from '../../../../lib/form.js'
import { enumOptions, formatDate, formatStatus, statusTone } from '../../../../lib/format.js'
import { hasRecentReveal, rememberReveal } from '../../../../lib/piiRevealMemory.js'
import {
  bloodTypes,
  healthNoteCategories,
  healthNoteStatuses,
  studentSensitiveApi,
} from '../../api/studentSensitiveApi.js'
import { DialogFooter, PanelFrame, SensitiveDataReveal, SummaryCard } from './panelPrimitives.jsx'

const studentHealthPiiScope = (studentId) => `student-health:${studentId}`

export function StudentHealthPanel({ studentId, canWrite, canViewSensitive }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [revealed, setRevealed] = useState(
    () => Boolean(studentId) && hasRecentReveal(studentHealthPiiScope(studentId)),
  )
  const [showDeletedNotes, setShowDeletedNotes] = useState(false)
  const [noteDialog, setNoteDialog] = useState(null)
  const [recordDialog, setRecordDialog] = useState(false)

  async function handleReveal() {
    const confirmed = await confirm({
      title: 'View health & special needs',
      description: 'View this student\'s blood type, needs-assistance flag, and health notes? This access is logged.',
      confirmLabel: 'View',
    })
    if (confirmed) {
      rememberReveal(studentHealthPiiScope(studentId))
      setRevealed(true)
    }
  }

  const recordQuery = useQuery({
    queryKey: ['students', studentId, 'health-record'],
    queryFn: () => studentSensitiveApi.getHealthRecord(studentId),
    enabled: Boolean(studentId) && canViewSensitive && revealed,
  })
  const notesQuery = useQuery({
    queryKey: ['students', studentId, 'health-notes', showDeletedNotes],
    queryFn: () =>
      studentSensitiveApi.listHealthNotes(studentId, {
        is_deleted: showDeletedNotes,
      }),
    enabled: Boolean(studentId) && canViewSensitive && revealed,
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
  const saveRecordMutation = useMutation({
    mutationFn: (payload) => recordQuery.data
      ? studentSensitiveApi.updateHealthRecord(studentId, payload)
      : studentSensitiveApi.createHealthRecord(studentId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students', studentId, 'health-record'] })
      setRecordDialog(false)
    },
  })

  if (!canViewSensitive) {
    return (
      <PanelFrame title="Health & Special Needs" icon={HeartPulse} isFetching={false}>
        <PanelMessage>
          Restricted. You don't have permission to view sensitive data.
        </PanelMessage>
      </PanelFrame>
    )
  }

  if (!revealed) {
    return (
      <SensitiveDataReveal
        icon={HeartPulse}
        title="Health & Special Needs"
        onReveal={handleReveal}
      />
    )
  }

  return (
    <PanelFrame
      title="Health & Special Needs"
      icon={HeartPulse}
      isFetching={recordQuery.isFetching || notesQuery.isFetching}
      action={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRevealed(false)}>
            <EyeOff size={15} />
            Hide
          </Button>
          <Button type="button" size="sm" disabled={!canWrite} onClick={() => setNoteDialog({ mode: 'create' })}>
            <Plus size={15} />
            Health Note
          </Button>
          <ActionsMenu label="More Actions" disabled={!canWrite}>
            {(close) => (
              <>
                <ActionsMenuItem
                  checked={showDeletedNotes}
                  onClick={() => {
                    setShowDeletedNotes((current) => !current)
                    close()
                  }}
                >
                  Show deleted notes
                </ActionsMenuItem>
                <ActionsMenuItem
                  onClick={() => {
                    setRecordDialog(true)
                    close()
                  }}
                >
                  Edit Blood Type
                </ActionsMenuItem>
                {!recordQuery.data ? (
                  <ActionsMenuItem
                    disabled={restoreRecordMutation.isPending}
                    onClick={() => {
                      restoreRecordMutation.mutate()
                      close()
                    }}
                  >
                    Restore Blood Type
                  </ActionsMenuItem>
                ) : (
                  <ActionsMenuItem
                    tone="danger"
                    disabled={deleteRecordMutation.isPending}
                    onClick={() => {
                      deleteRecordMutation.mutate()
                      close()
                    }}
                  >
                    Delete Blood Type
                  </ActionsMenuItem>
                )}
              </>
            )}
          </ActionsMenu>
        </>
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <SummaryCard label="Blood Type" value={formatStatus(recordQuery.data?.blood_type)} />
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
            <article key={note.id} className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone="neutral">{formatStatus(note.category)}</StatusBadge>
                    <StatusBadge tone={statusTone(note.status)}>{formatStatus(note.status)}</StatusBadge>
                    {note.deleted_at ? <StatusBadge tone="red">Deleted</StatusBadge> : null}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-(--mws-charcoal)">
                    {note.description}
                  </p>
                  <p className="mt-1 text-xs text-(--mws-muted)">
                    Noted {formatDate(note.noted_date)} / Resolved {formatDate(note.resolved_date)}
                  </p>
                </div>
                <div className="flex gap-1">
                  {note.deleted_at ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                       disabled={!canWrite}
                       loading={restoreNoteMutation.variables === note.id}
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
                       <Button type="button" variant="ghost" size="sm" disabled={!canWrite} loading={deleteNoteMutation.variables === note.id} onClick={() => deleteNoteMutation.mutate(note.id)}>
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
              updateNoteMutation.isPending ||
              saveRecordMutation.isPending
            }
            onClose={() => setNoteDialog(null)}
            onSubmit={({ notePayload, needsAssistance }) => {
            if (noteDialog.mode === 'create') createNoteMutation.mutate(notePayload)
            else updateNoteMutation.mutate({ id: noteDialog.record.id, payload: notePayload })
            if (needsAssistance !== undefined && needsAssistance !== Boolean(recordQuery.data?.needs_assistance)) {
              saveRecordMutation.mutate({
                blood_type: recordQuery.data?.blood_type || undefined,
                needs_assistance: needsAssistance,
              })
            }
          }}
        />
      ) : null}

      {recordDialog ? (
        <BloodTypeDialog
          healthRecord={recordQuery.data}
          isSubmitting={saveRecordMutation.isPending}
          onClose={() => setRecordDialog(false)}
          onSubmit={(payload) => saveRecordMutation.mutate(payload)}
        />
      ) : null}
    </PanelFrame>
  )
}

function HealthNoteDialog({ dialog, healthRecord, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    category: dialog.record?.category || 'HEALTH_INFO',
    description: dialog.record?.description || '',
    status: dialog.record?.status || 'ACTIVE',
    noted_date: dateInputFromIso(dialog.record?.noted_date) || new Date().toISOString().slice(0, 10),
    resolved_date: dateInputFromIso(dialog.record?.resolved_date),
    needs_assistance: Boolean(healthRecord?.needs_assistance),
  }))
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const isSpecialNeeds = values.category === 'SPECIAL_NEEDS'
  const descriptionError =
    hasAttemptedSubmit && !values.description.trim()
      ? 'Description is required.'
      : undefined

  function submit(event) {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    if (!values.description.trim()) return
    onSubmit({
      notePayload: cleanPayload({
        category: values.category,
        description: trimmedOrUndefined(values.description),
        status: values.status,
        noted_date: isoFromDateInput(values.noted_date),
        resolved_date: isoFromDateInput(values.resolved_date),
      }),
      needsAssistance: isSpecialNeeds ? values.needs_assistance : undefined,
    })
  }

  return (
    <CrudDialog title={dialog.mode === 'create' ? 'New Health Note' : 'Edit Health Note'} onClose={onClose} footer={<DialogFooter form="health-note-form" isSubmitting={isSubmitting} onClose={onClose} />}>
      <form id="health-note-form" className="grid gap-4 md:grid-cols-2" onSubmit={submit} noValidate>
        <Field label="Category">
          <SearchableSelect
            value={values.category}
            onChange={(value) => setValues({ ...values, category: value })}
            options={enumOptions(healthNoteCategories)}
            placeholder="Select Category"
            searchPlaceholder="Search Category"
          />
        </Field>
        <Field label="Status">
          <SearchableSelect
            value={values.status}
            onChange={(value) => setValues({ ...values, status: value })}
            options={enumOptions(healthNoteStatuses)}
            placeholder="Select Status"
            searchPlaceholder="Search Status"
          />
        </Field>
        <Field label="Noted Date">
          <DateField value={values.noted_date} onChange={(event) => setValues({ ...values, noted_date: event.target.value })} />
        </Field>
        <Field label="Resolved Date">
          <DateField value={values.resolved_date} onChange={(event) => setValues({ ...values, resolved_date: event.target.value })} />
        </Field>
        <LimitedField
          label="Description"
          field="description"
          max={500}
          as="textarea"
          className="md:col-span-2"
          required
          placeholder={isSpecialNeeds ? 'Autism spectrum, ADHD, sensory sensitivity, learning support needs...' : undefined}
          values={values}
          errors={{ description: descriptionError }}
          updateValue={(field, value) =>
            setValues((current) => ({ ...current, [field]: value }))
          }
        />
        {isSpecialNeeds ? (
          <CheckboxField
            className="md:col-span-2"
            label="Needs Assistance"
            description="Check this when the student needs extra assistance or special handling."
            checked={values.needs_assistance}
            onChange={(event) => setValues({ ...values, needs_assistance: event.target.checked })}
          />
        ) : null}
      </form>
    </CrudDialog>
  )
}

function BloodTypeDialog({ healthRecord, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    blood_type: healthRecord?.blood_type || '',
  }))

  function submit(event) {
    event.preventDefault()
    onSubmit({
      blood_type: values.blood_type || undefined,
    })
  }

  return (
    <CrudDialog title="Edit Blood Type" onClose={onClose} footer={<DialogFooter form="blood-type-form" isSubmitting={isSubmitting} onClose={onClose} />}>
      <form id="blood-type-form" className="grid gap-4" onSubmit={submit} noValidate>
        <Field label="Blood Type">
          <SearchableSelect
            value={values.blood_type}
            onChange={(value) => setValues({ ...values, blood_type: value })}
            options={enumOptions(bloodTypes)}
            placeholder="Select Blood Type"
            searchPlaceholder="Search Blood Type"
          />
        </Field>
      </form>
    </CrudDialog>
  )
}
