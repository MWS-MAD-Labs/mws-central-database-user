import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, RotateCcw, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '../../../components/ui/Button.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { useConfirm } from '../../../components/ui/useConfirm.js'
import { formatDate, formatStatus } from '../../../lib/format.js'
import { studentSensitiveApi } from '../../students/api/studentSensitiveApi.js'
import { employeesApi } from '../api/employeesApi.js'

export function EmployeeSupportAssignmentsPanel({ employeeId, isTeachingRole, canWrite }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const assignmentsQuery = useQuery({
    queryKey: ['employees', employeeId, 'support-assignments'],
    queryFn: () => employeesApi.getSupportAssignments(employeeId),
    enabled: Boolean(employeeId),
  })

  // The underlying endpoint is student-scoped (support-assignments live
  // under /students/:id, same as the "End assignment" action on the
  // student's own page - see StudentSensitivePanels.jsx) - each row
  // already carries assignment.student.id, so no employee-scoped mutation
  // endpoint is needed just to drop one from here too.
  const endMutation = useMutation({
    mutationFn: ({ studentId, assignmentId }) =>
      studentSensitiveApi.endSupportAssignment(studentId, assignmentId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['employees', employeeId, 'support-assignments'],
      }),
  })
  // Distinct from endMutation - drops a mistaken assignment entirely
  // instead of closing it out, so it no longer shows up here at all
  // (unlike "End", which keeps it visible as a closed record).
  const dropMutation = useMutation({
    mutationFn: ({ studentId, assignmentId }) =>
      studentSensitiveApi.removeSupportAssignment(studentId, assignmentId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['employees', employeeId, 'support-assignments'],
      }),
  })
  // Undoes an accidental "End" click - clears end_date on the same row
  // instead of dropping and recreating it, so the original start date
  // isn't lost.
  const reactivateMutation = useMutation({
    mutationFn: ({ studentId, assignmentId }) =>
      studentSensitiveApi.reactivateSupportAssignment(studentId, assignmentId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['employees', employeeId, 'support-assignments'],
      }),
  })

  async function handleEnd(assignment) {
    if (
      await confirm({
        title: 'End assignment',
        description: `End the Special Education Teacher assignment for ${assignment.student.full_name}?`,
        confirmLabel: 'End assignment',
        tone: 'danger',
      })
    ) {
      endMutation.mutate({ studentId: assignment.student.id, assignmentId: assignment.id })
    }
  }

  async function handleDrop(assignment) {
    if (
      await confirm({
        title: 'Drop assignment',
        description: `Drop the Special Education Teacher assignment for ${assignment.student.full_name}? Use this only to undo a mistaken assignment - it won't be kept in this student's assignment history at all. For a real, legitimate handover, use "End assignment" instead.`,
        confirmLabel: 'Drop assignment',
        tone: 'danger',
      })
    ) {
      dropMutation.mutate({ studentId: assignment.student.id, assignmentId: assignment.id })
    }
  }

  async function handleReactivate(assignment) {
    if (
      await confirm({
        title: 'Reactivate assignment',
        description: `Undo ending the Special Education Teacher assignment for ${assignment.student.full_name} and make it active again?`,
        confirmLabel: 'Reactivate',
      })
    ) {
      reactivateMutation.mutate({ studentId: assignment.student.id, assignmentId: assignment.id })
    }
  }

  const rows = assignmentsQuery.data || []

  // A non-teaching job level can never be assigned one of these - hide the
  // section entirely instead of showing an empty table that reads as "not
  // set up yet" for a role this doesn't apply to. Past assignments still
  // show even if the employee later moved to a non-teaching role.
  if (!isTeachingRole && !assignmentsQuery.isLoading && rows.length === 0) {
    return null
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="min-w-0 border-b border-[var(--mws-line)] p-5">
        <h2 className="text-base font-semibold text-[var(--mws-charcoal)]">
          Student Support Assignments
        </h2>
        <p className="text-sm text-[var(--mws-muted)]">
          Students this employee supports individually (e.g. Special Ed), past and present.
        </p>
      </div>

      <div className="w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
            <tr>
              <th className="px-4 py-3">Student</th>
              <th className="px-4 py-3">NIS</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Start</th>
              <th className="px-4 py-3">End</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {assignmentsQuery.isLoading ? (
              <tr>
                <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={6}>
                  Loading support assignments...
                </td>
              </tr>
            ) : (
              rows.map((assignment) => (
                <tr
                  key={assignment.id}
                  className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]"
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/students/${assignment.student.id}`}
                      className="font-semibold text-[var(--mws-burgundy)] hover:underline"
                    >
                      {assignment.student.full_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{assignment.student.nis || '-'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={assignment.end_date ? 'neutral' : 'green'}>
                      {formatStatus(assignment.role)}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3">{formatDate(assignment.start_date)}</td>
                  <td className="px-4 py-3">{formatDate(assignment.end_date)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      {!assignment.end_date ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="w-8 px-0"
                          title="End assignment"
                          aria-label="End assignment"
                          disabled={!canWrite || endMutation.variables?.assignmentId === assignment.id}
                          onClick={() => handleEnd(assignment)}
                        >
                          <Ban size={15} />
                        </Button>
                      ) : (
                        // Ended assignment - offer Reactivate for an
                        // accidental End, on top of Drop below.
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="w-8 px-0"
                          title="Reactivate assignment (undo an accidental End)"
                          aria-label="Reactivate assignment"
                          disabled={!canWrite || reactivateMutation.variables?.assignmentId === assignment.id}
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
                        disabled={!canWrite || dropMutation.variables?.assignmentId === assignment.id}
                        onClick={() => handleDrop(assignment)}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
