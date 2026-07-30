import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { ExternalLink } from 'lucide-react'
import { Button } from '../../../components/ui/Button.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { formatDate, formatStatus, statusTone } from '../../../lib/format.js'
import { enrollmentsApi } from '../api/academicApi.js'

export function EnrollmentHistoryPanel({ studentId }) {
  const historyQuery = useQuery({
    queryKey: ['students', studentId, 'enrollments'],
    queryFn: () => enrollmentsApi.history(studentId),
    enabled: Boolean(studentId),
  })

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--mws-line)] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--mws-charcoal)]">
            Class History
          </h2>
          <p className="text-sm text-[var(--mws-muted)]">
            Enrollment records across academic years and classes.
          </p>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link to="/academic?tab=enrollments">
            <ExternalLink size={15} />
            Manage
          </Link>
        </Button>
      </div>

      <div className="w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
            <tr>
              <th className="px-4 py-3">Academic Year</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Grade</th>
              <th className="px-4 py-3">Start</th>
              <th className="px-4 py-3">End</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {historyQuery.isLoading ? (
              <tr>
                <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={6}>
                  Loading class history...
                </td>
              </tr>
            ) : (historyQuery.data || []).length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={6}>
                  No class history found.
                </td>
              </tr>
            ) : (
              historyQuery.data.map((enrollment) => (
                <tr
                  key={enrollment.id}
                  className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]"
                >
                  <td className="px-4 py-3">{enrollment.academic_year.name}</td>
                  <td className="px-4 py-3">{enrollment.class.name}</td>
                  <td className="px-4 py-3">{enrollment.grade_level}</td>
                  <td className="px-4 py-3">{formatDate(enrollment.start_date)}</td>
                  <td className="px-4 py-3">{formatDate(enrollment.end_date)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={statusTone(enrollment.enrollment_status)}>
                      {formatStatus(enrollment.enrollment_status)}
                    </StatusBadge>
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
