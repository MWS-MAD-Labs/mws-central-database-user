import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, HeartHandshake, Plus, Repeat, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../../../../components/ui/Button.jsx'
import { useConfirm } from '../../../../components/ui/useConfirm.js'
import { CrudDialog } from '../../../../components/ui/CrudDialog.jsx'
import { Field, LimitedField } from '../../../../components/ui/FormControls.jsx'
import { PanelMessage } from '../../../../components/ui/PanelMessage.jsx'
import { PaginatedSingleSelect } from '../../../../components/ui/PaginatedSingleSelect.jsx'
import { StatusBadge } from '../../../../components/ui/StatusBadge.jsx'
import { cleanPayload, trimmedOrUndefined } from '../../../../lib/form.js'
import { formatDate, formatStatus } from '../../../../lib/format.js'
import { workforceTargetPayload, workforceTargetValue } from '../../../academic/utils/selectOptions.js'
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

  const activeAssignment = (assignmentsQuery.data || []).find((a) => !a.end_date)
  const assignmentMember = (assignment) => assignment.workforce_member || {
    ...assignment.employee,
    type: 'EMPLOYEE',
  }

  async function handleEnd(assignment) {
    if (
      await confirm({
        title: 'End assignment',
        description: `End ${assignmentMember(assignment).full_name}'s Special Education Teacher assignment?`,
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
        description: `Drop ${assignmentMember(assignment).full_name}'s Special Education Teacher assignment? Use this only to undo a mistaken assignment - it won't be kept in this student's assignment history at all. For a real, legitimate handover, use "End assignment" instead.`,
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
        description: `Undo ending ${assignmentMember(assignment).full_name}'s Special Education Teacher assignment and make it active again?`,
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
            (() => {
              const member = assignmentMember(assignment)
              return (
            <article key={assignment.id} className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={member.type === 'INTERN' ? `/interns/${member.id}` : `/employees/${member.id}`}
                      className="font-display text-sm font-bold text-(--mws-burgundy) hover:underline"
                    >
                      {member.full_name}
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
                        disabled={!canWrite}
                        loading={endMutation.variables === assignment.id}
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
                      disabled={!canWrite}
                      loading={reactivateMutation.variables === assignment.id}
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
                    disabled={!canWrite}
                    loading={dropMutation.variables === assignment.id}
                    onClick={() => handleDrop(assignment)}
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
            </article>
              )
            })()
          ))}
        </div>
      )}

      {dialog ? (
        <SupportAssignmentDialog
          title={dialog.mode === 'change' ? 'Change Special Education Teacher' : undefined}
          unitName={studentUnitName}
          excludeWorkforceMemberIds={
            dialog.mode === 'change' && activeAssignment
              ? [assignmentMember(activeAssignment).id]
              : []
          }
          isSubmitting={
            dialog.mode === 'change' ? changeMutation.isPending : createMutation.isPending
          }
          onClose={() => setDialog(null)}
          mode={dialog.mode}
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

export function SupportAssignmentDialog({ title, studentName, mode = 'create', unitId, unitName, excludeWorkforceMemberIds = [], isSubmitting, onClose, onSubmit }) {
  const confirm = useConfirm()
  const [values, setValues] = useState({ workforce_target: '', notes: '' })
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selectedCandidate, setSelectedCandidate] = useState(null)
  const candidatesQuery = useQuery({
    queryKey: ['support-assignment-candidates', { page, pageSize, search, unitId, unitName }],
    queryFn: () => studentSensitiveApi.listSupportAssignmentCandidates({
      page,
      size: pageSize,
      search: search || undefined,
      unit_id: unitId || undefined,
      unit_name: unitName || undefined,
    }),
  })
  const employees = (candidatesQuery.data?.data || []).filter(
    (candidate) => !excludeWorkforceMemberIds.includes(candidate.id),
  )
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const employeeError =
    hasAttemptedSubmit && !values.workforce_target
      ? 'Special Education Teacher is required.'
      : undefined
  const employeeOptions = employees.map(employeeOption)

  async function submit(event) {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    if (!values.workforce_target) return
    const targetPayload = workforceTargetPayload(values.workforce_target)
    const employee = selectedCandidate || employees.find((candidate) => candidate.id === targetPayload?.employee_id || candidate.id === targetPayload?.intern_id)
    if (mode === 'select') {
      onSubmit(cleanPayload({
        ...targetPayload,
        role: 'SPECIAL_ED',
        notes: trimmedOrUndefined(values.notes),
      }), employee)
      return
    }
    const confirmed = await confirm({
      title: mode === 'change' ? 'Confirm teacher change' : 'Confirm teacher assignment',
      description:
        mode === 'change'
          ? `End the current assignment and assign ${employee?.identity.full_name} as the new Special Education Teacher?`
          : `Assign ${employee?.identity.full_name} as Special Education Teacher${studentName ? ` for ${studentName}` : ''}?`,
      confirmLabel: mode === 'change' ? 'Change teacher' : 'Assign teacher',
    })
    if (!confirmed) return
    onSubmit(cleanPayload({
      ...targetPayload,
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
          <PaginatedSingleSelect
            itemLabel="teacher"
            options={employeeOptions}
            value={values.workforce_target}
            paging={candidatesQuery.data?.paging || { current_page: page, total_page: 1, total_item: employees.length, size: pageSize }}
            search={search}
            isLoading={candidatesQuery.isLoading}
            emptyMessage="No special education teachers match."
            onChange={(workforceTarget) => {
              setValues({ ...values, workforce_target: workforceTarget })
              setSelectedCandidate(employees.find((candidate) => workforceTargetValue(candidate.workforce_type || 'EMPLOYEE', candidate.id) === workforceTarget) || null)
            }}
            onSearchChange={(value) => { setSearch(value); setPage(1) }}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
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

function employeeOption(member) {
  return {
    value: workforceTargetValue(member.workforce_type || 'EMPLOYEE', member.id),
    label: `${member.identity.full_name}${member.workforce_type === 'INTERN' ? ' (Intern)' : ''}`,
    description: member.identity.email,
    badge: caseloadLabel(member.active_student_count),
    tone: member.active_student_count > 0 ? 'amber' : 'green',
  }
}

function caseloadLabel(count) {
  return `${count || 0} student${count === 1 ? '' : 's'}`
}
