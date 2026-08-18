import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { formatDate, formatStatus } from '../../../lib/format.js'
import { employeesApi } from '../api/employeesApi.js'

export function EmployeeSupportAssignmentsPanel({ employeeId }) {
  const assignmentsQuery = useQuery({
    queryKey: ['employees', employeeId, 'support-assignments'],
    queryFn: () => employeesApi.getSupportAssignments(employeeId),
    enabled: Boolean(employeeId),
  })

  const rows = assignmentsQuery.data || []

  // Only teaching-eligible employees can ever be assigned one of these, but
  // an empty state is harmless - no need to hide the section, and it keeps
  // history visible for someone who moved from a teaching role to staff.
  if (!assignmentsQuery.isLoading && rows.length === 0) return null

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
            </tr>
          </thead>
          <tbody>
            {assignmentsQuery.isLoading ? (
              <tr>
                <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={5}>
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
