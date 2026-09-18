import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, HeartHandshake, Plus, Repeat, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../../../../components/ui/Button.jsx'
import { useConfirm } from '../../../../components/ui/useConfirm.js'
import { CrudDialog } from '../../../../components/ui/CrudDialog.jsx'
import { Field, LimitedField, SearchableSelect } from '../../../../components/ui/FormControls.jsx'
import { PanelMessage } from '../../../../components/ui/PanelMessage.jsx'
import { StatusBadge } from '../../../../components/ui/StatusBadge.jsx'
import { cleanPayload, trimmedOrUndefined } from '../../../../lib/form.js'
import { formatDate, formatStatus } from '../../../../lib/format.js'
import { fetchAllPages } from '../../../../lib/pagination.js'
import { employeesApi } from '../../../employees/api/employeesApi.js'
import { studentSensitiveApi } from '../../api/studentSensitiveApi.js'
import { DialogFooter, PanelFrame } from './panelPrimitives.jsx'
import { invalidateStudentRelation } from './panelHelpers.js'

export function StudentSupportAssignmentPanel({ studentId, studentUnitName, canWrite }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
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
        fetchAllPages(employeesApi.list, {
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
  const dropMutation = useMutation({
    mutationFn: (id) => studentSensitiveApi.removeSupportAssignment(studentId, id),
    onSuccess: () =>
      invalidateStudentRelation(queryClient, studentId, 'support-assignments'),
  })
  const reactivateMutation = useMutation({
    mutationFn: (id) => studentSensitiveApi.reactivateSupportAssignment(studentId, id),
    onSuccess: () =>
      invalidateStudentRelation(queryClient, studentId, 'support-assignments'),
  })
  const changeMutation = useMutation({
    mutationFn: async ({ endAssignmentId, payload }) => {
      await studentSensitiveApi.endSupportAssignment(studentId, endAssignmentId)
      return studentSensitiveApi.createSupportAssignment(studentId, payload)
    },
    onSuccess: () => {
      invalidateStudentRelation(queryClient, studentId, 'support-assignments')
      setDialog(null)
    },
  })

  const teachingEmployees = studentUnitName
    ? (employeesQuery.data || []).filter(
        (employee) => employee.employment.unit === studentUnitName,
      )
    : employeesQuery.data || []
  const activeAssignment = (assignmentsQuery.data || []).find((a) => !a.end_date)

  async function handleEnd(assignment) {
    if (
      await confirm({
        title: 'End assignment',
        description: `End ${assignment.employee.full_name}'s Special Education Teacher assignment?`,
        confirmLabel: 'End assignment',
        tone: 'danger',
      })
    ) {
      endMutation.mutate(assignment.id)
    }
  }

  async function handleDrop(assignment) {
    if (
      await confirm({
        title: 'Drop assignment',
        description: `Drop ${assignment.employee.full_name}'s Special Education Teacher assignment? Use this only to undo a mistaken assignment - it won't be kept in this student's assignment history at all. For a real, legitimate handover, use "End assignment" instead.`,
        confirmLabel: 'Drop assignment',
        tone: 'danger',
      })
    ) {
      dropMutation.mutate(assignment.id)
    }
  }

  async function handleReactivate(assignment) {
    if (
      await confirm({
        title: 'Reactivate assignment',
        description: `Undo ending ${assignment.employee.full_name}'s Special Education Teacher assignment and make it active again?`,
        confirmLabel: 'Reactivate',
      })
    ) {
      reactivateMutation.mutate(assignment.id)
    }
  }

  return (
    <PanelFrame
      title="Special Education Teacher"
      icon={HeartHandshake}
      isFetching={assignmentsQuery.isFetching}
      onRefresh={() => {
        assignmentsQuery.refetch()
        employeesQuery.refetch()
      }}
      action={
        !activeAssignment ? (
          <Button
            type="button"
            size="sm"
            disabled={!canWrite}
            onClick={() => setDialog({ mode: 'create' })}
          >
            <Plus size={15} />
            Assign
          </Button>
        ) : null
      }
    >
      {(assignmentsQuery.data || []).length === 0 ? (
        <PanelMessage>No Special Education teacher assigned yet.</PanelMessage>
      ) : (
        <div className="space-y-3">
          {(assignmentsQuery.data || []).map((assignment) => (
            <article key={assignment.id} className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/employees/${assignment.employee.id}`}
                      className="font-display text-sm font-bold text-(--mws-burgundy) hover:underline"
                    >
                      {assignment.employee.full_name}
                    </Link>
                    <StatusBadge tone="neutral">{formatStatus(assignment.role)}</StatusBadge>
                    <StatusBadge tone={assignment.end_date ? 'red' : 'green'}>
                      {assignment.end_date ? 'Ended' : 'Active'}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-sm text-(--mws-muted)">
                    Since {formatDate(assignment.start_date)}
                    {assignment.end_date ? ` / Ended ${formatDate(assignment.end_date)}` : ''}
                  </p>
                  {assignment.notes ? (
                    <p className="mt-2 text-sm leading-6 text-(--mws-charcoal)">
                      {assignment.notes}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  {!assignment.end_date ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-8 px-0"
                        title="Change teacher"
                        aria-label="Change teacher"
                        disabled={!canWrite}
                        onClick={() => setDialog({ mode: 'change', assignmentId: assignment.id })}
                      >
                        <Repeat size={15} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-8 px-0"
                        title="End assignment"
                        aria-label="End assignment"
                        disabled={!canWrite || endMutation.variables === assignment.id}
                        onClick={() => handleEnd(assignment)}
                      >
                        <Ban size={15} />
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-8 px-0"
                      title="Reactivate assignment (undo an accidental End)"
                      aria-label="Reactivate assignment"
                      disabled={!canWrite || reactivateMutation.variables === assignment.id}
                      onClick={() => handleReactivate(assignment)}
                    >
                      <RotateCcw size={15} />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-8 px-0"
                    title="Drop assignment (undo a mistake)"
                    aria-label="Drop assignment"
                    disabled={!canWrite || dropMutation.variables === assignment.id}
                    onClick={() => handleDrop(assignment)}
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {dialog ? (
        <SupportAssignmentDialog
          title={dialog.mode === 'change' ? 'Change Special Education Teacher' : undefined}
          employees={
            dialog.mode === 'change' && activeAssignment
              ? teachingEmployees.filter(
                  (employee) => employee.id !== activeAssignment.employee.id,
                )
              : teachingEmployees
          }
          isSubmitting={
            dialog.mode === 'change' ? changeMutation.isPending : createMutation.isPending
          }
          onClose={() => setDialog(null)}
          onSubmit={(payload) =>
            dialog.mode === 'change'
              ? changeMutation.mutate({ endAssignmentId: dialog.assignmentId, payload })
              : createMutation.mutate(payload)
          }
        />
      ) : null}
    </PanelFrame>
  )
}

export function SupportAssignmentDialog({ title, employees, studentName, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState({ employee_id: '', notes: '' })
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const employeeError =
    hasAttemptedSubmit && !values.employee_id
      ? 'Special Education Teacher is required.'
      : undefined
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
    setHasAttemptedSubmit(true)
    if (!values.employee_id) return
    onSubmit(cleanPayload({
      employee_id: values.employee_id,
      role: 'SPECIAL_ED',
      notes: trimmedOrUndefined(values.notes),
    }))
  }

  return (
    <CrudDialog
      title={title || 'Assign Special Education Teacher'}
      description={studentName ? `For ${studentName}.` : undefined}
      onClose={onClose}
      footer={<DialogFooter form="support-assignment-form" isSubmitting={isSubmitting} onClose={onClose} />}
    >
      <form id="support-assignment-form" className="grid gap-4" onSubmit={submit} noValidate>
        <Field label="Special Education Teacher" error={employeeError}>
          <SearchableSelect
            value={values.employee_id}
            onChange={(employeeId) => setValues({ ...values, employee_id: employeeId })}
            options={employeeOptions}
            placeholder="Select A Teacher"
            searchPlaceholder="Search Employee"
            searchableThreshold={1}
            required={hasAttemptedSubmit}
          />
        </Field>
        <LimitedField
          label="Notes"
          field="notes"
          max={500}
          as="textarea"
          placeholder="Weekly reading support, sensory breaks, etc."
          values={values}
          updateValue={(field, value) =>
            setValues((current) => ({ ...current, [field]: value }))
          }
        />
      </form>
    </CrudDialog>
  )
}

function caseloadLabel(count) {
  return `${count || 0} student${count === 1 ? '' : 's'}`
}
