import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { formatDate, formatStatus } from '../../../lib/format.js'
import { employeesApi } from '../api/employeesApi.js'

const ASSIGNMENT_PAGE_SIZE = 10

export function EmployeeTeachingAssignmentsPanel({ employeeId, isTeachingRole }) {
  const [page, setPage] = useState(1)
  const assignmentsQuery = useQuery({
    queryKey: ['employees', employeeId, 'teaching-assignments'],
    queryFn: () => employeesApi.getTeachingAssignments(employeeId),
    enabled: Boolean(employeeId),
  })

  const rows = assignmentsQuery.data || []
  const totalPages = Math.max(Math.ceil(rows.length / ASSIGNMENT_PAGE_SIZE), 1)
  const clampedPage = Math.min(page, totalPages)
  const pagedRows = rows.slice(
    (clampedPage - 1) * ASSIGNMENT_PAGE_SIZE,
    clampedPage * ASSIGNMENT_PAGE_SIZE,
  )

  if (!isTeachingRole && !assignmentsQuery.isLoading && rows.length === 0) {
    return null
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-(--mws-line) bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="min-w-0 border-b border-(--mws-line) p-5">
        <h2 className="text-base font-semibold text-(--mws-charcoal)">
          Teaching Assignments
        </h2>
        <p className="text-sm text-(--mws-muted)">
          Classes taught across academic years, as homeroom, supporting, or subject teacher.
        </p>
      </div>

      <div className="w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
            <tr>
              <th className="px-4 py-3">Academic Year</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Grade</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Start</th>
              <th className="px-4 py-3">End</th>
            </tr>
          </thead>
          <tbody>
            {assignmentsQuery.isLoading ? (
              <tr>
                <td className="px-4 py-10 text-center text-(--mws-muted)" colSpan={6}>
                  Loading teaching assignments...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-(--mws-muted)" colSpan={6}>
                  No teaching assignments found.
                </td>
              </tr>
            ) : (
              pagedRows.map((assignment) => (
                <tr
                  key={assignment.id}
                  className="border-t border-(--mws-line) bg-white hover:bg-(--mws-soft)"
                >
                  <td className="px-4 py-3">{assignment.academic_year.name}</td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/academic/classes/${assignment.class.id}`}
                      className="font-semibold text-(--mws-burgundy) hover:underline"
                    >
                      {assignment.class.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{assignment.grade}</td>
                  <td className="px-4 py-3">
                    <StatusBadge tone="neutral">
                      {formatStatus(assignment.role)}
                    </StatusBadge>
                    {assignment.subject ? (
                      <p className="mt-1 text-xs text-(--mws-muted)">
                        {assignment.subject}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{formatDate(assignment.start_date)}</td>
                  <td className="px-4 py-3">{formatDate(assignment.end_date)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {rows.length > ASSIGNMENT_PAGE_SIZE ? (
        <PaginationBar
          paging={{
            current_page: clampedPage,
            total_page: totalPages,
            total_item: rows.length,
            size: ASSIGNMENT_PAGE_SIZE,
          }}
          itemLabel="assignments"
          onPrevious={() => setPage((current) => Math.max(current - 1, 1))}
          onNext={() => setPage((current) => Math.min(current + 1, totalPages))}
        />
      ) : null}
    </section>
  )
}
