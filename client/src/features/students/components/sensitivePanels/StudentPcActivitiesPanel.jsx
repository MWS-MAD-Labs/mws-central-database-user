import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../../components/ui/CrudDialog.jsx'
import { Field, SearchableSelect, ToggleChip } from '../../../../components/ui/FormControls.jsx'
import { PanelMessage } from '../../../../components/ui/PanelMessage.jsx'
import { StatusBadge } from '../../../../components/ui/StatusBadge.jsx'
import { cleanPayload, trimmedOrUndefined } from '../../../../lib/form.js'
import { enumOptions, formatStatus } from '../../../../lib/format.js'
import { academicYearsApi } from '../../../academic/api/academicApi.js'
import { pcActivitiesApi } from '../../../master-data/api/masterDataApi.js'
import { pcDays, studentSensitiveApi } from '../../api/studentSensitiveApi.js'
import { DialogFooter, PanelFrame } from './panelPrimitives.jsx'
import { invalidateStudentRelation } from './panelHelpers.js'

export function StudentPcActivitiesPanel({ studentId, canWrite, studentUnitId }) {
  const queryClient = useQueryClient()
  const [showDeleted, setShowDeleted] = useState(false)
  const [dialog, setDialog] = useState(null)

  const activitiesQuery = useQuery({
    queryKey: ['students', studentId, 'pc-activities', showDeleted],
    queryFn: () =>
      studentSensitiveApi.listPcActivities(studentId, { is_deleted: showDeleted }),
    enabled: Boolean(studentId),
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

  const years = yearsQuery.data?.data || []
  const activityOptions = (activityOptionsQuery.data?.data || []).filter(
    (activity) =>
      !activity.units?.length ||
      !studentUnitId ||
      activity.units.some((unit) => unit.id === studentUnitId),
  )

  return (
    <PanelFrame
      title="PC Activities"
      icon={CalendarCheck}
      isFetching={activitiesQuery.isFetching}
      onRefresh={() => {
        activitiesQuery.refetch()
        yearsQuery.refetch()
        activityOptionsQuery.refetch()
      }}
      action={
        <>
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
            const year = years.find((item) => item.id === activity.academic_year_id)
            return (
              <article key={activity.id} className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="neutral">{formatStatus(activity.day)}</StatusBadge>
                      {activity.deleted_at ? <StatusBadge tone="red">Deleted</StatusBadge> : null}
                    </div>
                    <p className="mt-2 text-sm font-semibold text-(--mws-charcoal)">
                      {activity.activity}
                    </p>
                    <p className="mt-1 text-xs text-(--mws-muted)">
                      {activity.mentor_name || 'No mentor'} / {year?.name || activity.academic_year_id}
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

function PcActivityDialog({ dialog, academicYears, activities, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    day: dialog.record?.day || 'MONDAY',
    activity_id: dialog.record?.activity_id || '',
    academic_year_id: dialog.record?.academic_year_id || '',
  }))
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const activityError =
    hasAttemptedSubmit && !values.activity_id ? 'Activity is required.' : undefined
  const activityOptions = activities.map((activity) => ({
    value: activity.id,
    label: activity.name,
  }))

  function submit(event) {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    if (!values.activity_id) return
    onSubmit(cleanPayload({
      day: dialog.mode === 'create' ? values.day : undefined,
      activity_id: trimmedOrUndefined(values.activity_id),
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
      <form id="pc-activity-form" className="grid gap-4 md:grid-cols-2" onSubmit={submit} noValidate>
        <Field label="Day">
          <SearchableSelect
            disabled={dialog.mode !== 'create'}
            value={values.day}
            onChange={(value) => setValues({ ...values, day: value })}
            options={enumOptions(pcDays)}
            placeholder="Select Day"
            searchPlaceholder="Search Day"
          />
        </Field>
        <Field label="Academic Year">
          <SearchableSelect
            disabled={dialog.mode !== 'create'}
            value={values.academic_year_id}
            onChange={(value) => setValues({ ...values, academic_year_id: value })}
            options={[
              { value: '', label: 'Use active year' },
              ...academicYears.map((year) => ({ value: year.id, label: year.name })),
            ]}
            placeholder="Select Academic Year"
            searchPlaceholder="Search Academic Year"
          />
        </Field>
        <Field label="Activity" className="md:col-span-2" error={activityError}>
          <SearchableSelect
            required={hasAttemptedSubmit}
            value={values.activity_id}
            onChange={(activityId) => setValues({ ...values, activity_id: activityId })}
            options={activityOptions}
            placeholder="Select Activity"
            searchPlaceholder="Search Activity"
            searchableThreshold={1}
          />
        </Field>
      </form>
    </CrudDialog>
  )
}
