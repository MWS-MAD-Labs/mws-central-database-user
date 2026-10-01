import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EyeOff, Plus, RotateCcw, Syringe, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../../components/ui/Button.jsx'
import { useConfirm } from '../../../../components/ui/useConfirm.js'
import { CrudDialog } from '../../../../components/ui/CrudDialog.jsx'
import {
  CheckboxField,
  DateField,
  Field,
  SearchableSelect,
  ToggleChip,
} from '../../../../components/ui/FormControls.jsx'
import { PanelMessage } from '../../../../components/ui/PanelMessage.jsx'
import { StatusBadge } from '../../../../components/ui/StatusBadge.jsx'
import { cleanPayload, dateInputFromIso, isoFromDateInput } from '../../../../lib/form.js'
import { enumOptions, formatDate, formatStatus } from '../../../../lib/format.js'
import { forgetReveal, hasRecentReveal, rememberReveal } from '../../../../lib/piiRevealMemory.js'
import { studentSensitiveApi, vaccineTypes } from '../../api/studentSensitiveApi.js'
import { DialogFooter, PanelFrame, SensitiveDataReveal } from './panelPrimitives.jsx'
import { invalidateStudentRelation } from './panelHelpers.js'

const studentVaccinePiiScope = (studentId) => `student-vaccine:${studentId}`

export function StudentVaccinePanel({ studentId, canWrite, canViewSensitive }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [revealed, setRevealed] = useState(
    () => Boolean(studentId) && hasRecentReveal(studentVaccinePiiScope(studentId)),
  )
  const [showDeleted, setShowDeleted] = useState(false)
  const [dialog, setDialog] = useState(null)

  async function handleReveal() {
    const confirmed = await confirm({
      title: 'View vaccine records',
      description: 'View this student\'s vaccine records? This access is logged.',
      confirmLabel: 'View',
    })
    if (confirmed) {
      rememberReveal(studentVaccinePiiScope(studentId))
      setRevealed(true)
    }
  }

  const vaccinesQuery = useQuery({
    queryKey: ['students', studentId, 'vaccine-records', showDeleted],
    queryFn: () =>
      studentSensitiveApi.listVaccines(studentId, { is_deleted: showDeleted }),
    enabled: Boolean(studentId) && canViewSensitive && revealed,
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

  if (!canViewSensitive) {
    return (
      <PanelFrame title="Vaccine Records" icon={Syringe} isFetching={false}>
        <PanelMessage>
          Restricted. You don't have permission to view sensitive data.
        </PanelMessage>
      </PanelFrame>
    )
  }

  if (!revealed) {
    return (
      <SensitiveDataReveal
        icon={Syringe}
        title="Vaccine Records"
        onReveal={handleReveal}
      />
    )
  }

  return (
    <PanelFrame
      title="Vaccine Records"
      icon={Syringe}
      isFetching={vaccinesQuery.isFetching}
      action={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={() => {
            forgetReveal(studentVaccinePiiScope(studentId))
            setRevealed(false)
          }}>
            <EyeOff size={15} />
            Hide
          </Button>
          <ToggleChip checked={showDeleted} onChange={setShowDeleted}>
            Show Deleted
          </ToggleChip>
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
            <article key={record.id} className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-sm font-bold text-(--mws-charcoal)">
                      {formatStatus(record.vaccine_type)}
                    </h3>
                    <StatusBadge tone={record.received ? 'green' : 'amber'}>
                      {record.received ? 'Received' : 'Pending'}
                    </StatusBadge>
                    {record.deleted_at ? <StatusBadge tone="red">Deleted</StatusBadge> : null}
                  </div>
                  <p className="mt-1 text-sm text-(--mws-muted)">
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
      <form id="vaccine-form" className="grid gap-4 md:grid-cols-2" onSubmit={submit} noValidate>
        <Field label="Vaccine Type">
          <SearchableSelect
            disabled={dialog.mode !== 'create'}
            value={values.vaccine_type}
            onChange={(value) => setValues({ ...values, vaccine_type: value })}
            options={enumOptions(vaccineTypes)}
            placeholder="Select Vaccine Type"
            searchPlaceholder="Search Vaccine Type"
          />
        </Field>
        <Field label="Date">
          <DateField value={values.date} onChange={(event) => setValues({ ...values, date: event.target.value })} />
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
