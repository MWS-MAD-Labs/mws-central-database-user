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
    <section className="rounded-md border border-[#deded7] bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-[#e7e4dc] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-[#202326]">
            Class History
          </h2>
          <p className="text-sm text-[#676c70]">
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

      {historyQuery.isError ? (
        <div className="border-b border-[#e7e4dc] bg-[#fff4f2] px-4 py-3 text-sm text-[#8f2f2f]">
          {historyQuery.error.message || 'Failed to load class history.'}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-[#f3f3ee] text-xs font-semibold uppercase text-[#62676b]">
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
                <td className="px-4 py-10 text-center text-[#77736a]" colSpan={6}>
                  Loading class history...
                </td>
              </tr>
            ) : (historyQuery.data || []).length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-[#77736a]" colSpan={6}>
                  No class history found.
                </td>
              </tr>
            ) : (
              historyQuery.data.map((enrollment) => (
                <tr
                  key={enrollment.id}
                  className="border-t border-[#eceae3] bg-white hover:bg-[#fbfbf7]"
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
