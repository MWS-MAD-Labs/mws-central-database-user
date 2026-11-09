import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EyeOff, HeartPulse, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../../components/ui/Button.jsx'
import { useConfirm } from '../../../../components/ui/useConfirm.js'
import { CrudDialog } from '../../../../components/ui/CrudDialog.jsx'
import {
  DateField,
  Field,
  LimitedField,
  SearchableSelect,
} from '../../../../components/ui/FormControls.jsx'
import { PanelMessage } from '../../../../components/ui/PanelMessage.jsx'
import { StatusBadge } from '../../../../components/ui/StatusBadge.jsx'
import { cleanPayload, dateInputFromIso, isoFromDateInput, trimmedOrUndefined } from '../../../../lib/form.js'
import { enumOptions, formatDate, formatStatus, statusTone } from '../../../../lib/format.js'
import { forgetReveal, hasRecentReveal, rememberReveal } from '../../../../lib/piiRevealMemory.js'
import { bloodTypes, healthNoteStatuses, studentSensitiveApi } from '../../api/studentSensitiveApi.js'
import { DialogFooter, PanelFrame, SensitiveDataReveal, SummaryCard } from './panelPrimitives.jsx'

const studentHealthPiiScope = (studentId) => `student-health:${studentId}`

export function StudentHealthPanel({ studentId, canWrite, canViewSensitive }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [revealed, setRevealed] = useState(
    () => Boolean(studentId) && hasRecentReveal(studentHealthPiiScope(studentId)),
  )
  const [noteDialog, setNoteDialog] = useState(null)
  const [recordDialog, setRecordDialog] = useState(false)

  async function handleReveal() {
    const confirmed = await confirm({
      title: 'View health information',
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
    queryKey: ['students', studentId, 'health-notes', 'HEALTH_INFO'],
    queryFn: () =>
      studentSensitiveApi.listHealthNotes(studentId, {
        category: 'HEALTH_INFO',
      }),
    enabled: Boolean(studentId) && canViewSensitive && revealed,
  })

  const createNoteMutation = useMutation({
    meta: { successMessage: "Health note added." },
    mutationFn: (payload) => studentSensitiveApi.createHealthNote(studentId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students', studentId, 'health-notes'] })
      setNoteDialog(null)
    },
  })
  const updateNoteMutation = useMutation({
    meta: { successMessage: "Health note updated." },
    mutationFn: ({ id, payload }) => studentSensitiveApi.updateHealthNote(studentId, id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students', studentId, 'health-notes'] })
      setNoteDialog(null)
    },
  })
  const saveRecordMutation = useMutation({
    meta: { successMessage: "Health record saved." },
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
      <PanelFrame title="Health Information" icon={HeartPulse} isFetching={false}>
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
        title="Health Information"
        onReveal={handleReveal}
      />
    )
  }

  return (
    <PanelFrame
      title="Health Information"
      icon={HeartPulse}
      isFetching={recordQuery.isFetching || notesQuery.isFetching}
      action={
        <>
          <Button type="button" variant="ghost" onClick={() => {
            forgetReveal(studentHealthPiiScope(studentId))
            setRevealed(false)
          }}
            size="icon" aria-label="Hide" title="Hide"
          >
            <EyeOff size={15} />
          </Button>
          {canWrite ? <Button type="button" variant="secondary" onClick={() => setRecordDialog(true)} size="icon" aria-label={recordQuery.data ? 'Edit Health Information' : 'Create Health Information'} title={recordQuery.data ? 'Edit Health Information' : 'Create Health Information'}>
            {recordQuery.data ? <Pencil size={15} /> : <Plus size={15} />}
          </Button> : null}
          {canWrite ? <Button type="button" onClick={() => setNoteDialog({ mode: 'create' })} size="icon" aria-label="Add Health Note" title="Add Health Note">
            <Plus size={15} />
          </Button> : null}
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
        <PanelMessage>No health notes yet.</PanelMessage>
      ) : (
        <div className="space-y-3">
          {(notesQuery.data || []).map((note) => (
            <article key={note.id} className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={statusTone(note.status)}>{formatStatus(note.status)}</StatusBadge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-(--mws-charcoal)">
                    {note.description}
                  </p>
                  <p className="mt-1 text-xs text-(--mws-muted)">
                    Noted {formatDate(note.noted_date)} / Resolved {formatDate(note.resolved_date)}
                  </p>
                </div>
                {canWrite ? <Button type="button" variant="ghost" size="icon" aria-label="Edit" title="Edit" onClick={() => setNoteDialog({ mode: 'edit', record: note })}>
                  <Pencil size={15} />
                </Button> : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {canWrite && noteDialog ? (
          <HealthNoteDialog
            dialog={noteDialog}
            isSubmitting={
              createNoteMutation.isPending ||
              updateNoteMutation.isPending
            }
            onClose={() => setNoteDialog(null)}
            onSubmit={(notePayload) => {
            if (noteDialog.mode === 'create') createNoteMutation.mutate(notePayload)
            else updateNoteMutation.mutate({ id: noteDialog.record.id, payload: notePayload })
          }}
        />
      ) : null}

      {canWrite && recordDialog ? (
        <HealthInformationDialog
          healthRecord={recordQuery.data}
          isSubmitting={saveRecordMutation.isPending}
          onClose={() => setRecordDialog(false)}
          onSubmit={(payload) => saveRecordMutation.mutate(payload)}
        />
      ) : null}
    </PanelFrame>
  )
}

function HealthNoteDialog({ dialog, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    description: dialog.record?.description || '',
    status: dialog.record?.status || 'ACTIVE',
    noted_date: dateInputFromIso(dialog.record?.noted_date) || new Date().toISOString().slice(0, 10),
    resolved_date: dateInputFromIso(dialog.record?.resolved_date),
  }))
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const descriptionError =
    hasAttemptedSubmit && !values.description.trim()
      ? 'Description is required.'
      : undefined

  function submit(event) {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    if (!values.description.trim()) return
    onSubmit(cleanPayload({
      category: dialog.mode === 'create' ? 'HEALTH_INFO' : undefined,
      description: trimmedOrUndefined(values.description),
      status: values.status,
      noted_date: isoFromDateInput(values.noted_date),
      resolved_date: isoFromDateInput(values.resolved_date),
    }))
  }

  return (
    <CrudDialog title={dialog.mode === 'create' ? 'New Health Note' : 'Edit Health Note'} onClose={onClose} footer={<DialogFooter form="health-note-form" isSubmitting={isSubmitting} onClose={onClose} />}>
      <form id="health-note-form" className="grid gap-4 md:grid-cols-2" onSubmit={submit} noValidate>
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
          values={values}
          errors={{ description: descriptionError }}
          updateValue={(field, value) =>
            setValues((current) => ({ ...current, [field]: value }))
          }
        />
      </form>
    </CrudDialog>
  )
}

function HealthInformationDialog({ healthRecord, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    blood_type: healthRecord?.blood_type || '',
    needs_assistance: Boolean(healthRecord?.needs_assistance),
  }))

  function submit(event) {
    event.preventDefault()
    onSubmit({
      blood_type: values.blood_type || undefined,
      needs_assistance: values.needs_assistance,
    })
  }

  return (
    <CrudDialog title={healthRecord ? 'Edit Health Information' : 'Create Health Information'} onClose={onClose} footer={<DialogFooter form="health-information-form" isSubmitting={isSubmitting} onClose={onClose} />}>
      <form id="health-information-form" className="grid gap-4" onSubmit={submit} noValidate>
        <Field label="Blood Type">
          <SearchableSelect
            value={values.blood_type}
            onChange={(value) => setValues({ ...values, blood_type: value })}
            options={enumOptions(bloodTypes)}
            placeholder="Select Blood Type"
            searchPlaceholder="Search Blood Type"
          />
        </Field>
        <label className="flex min-h-11 items-center gap-3 rounded-xl border border-(--mws-line) bg-white px-3 py-2.5 text-sm text-(--mws-charcoal)">
          <input type="checkbox" className="h-4 w-4 accent-(--mws-burgundy)" checked={values.needs_assistance} onChange={(event) => setValues({ ...values, needs_assistance: event.target.checked })} />
          <span className="font-medium">Needs Assistance</span>
        </label>
      </form>
    </CrudDialog>
  )
}
