import { useQuery } from '@tanstack/react-query'
import { employeesApi } from '../api/employeesApi.js'

// Every (activity, unit) this employee is the default mentor for - set
// from Master Data > PC Activities > Manage Mentors, not editable here.
export function EmployeePcActivityMentorshipsPanel({ employeeId }) {
  const mentorshipsQuery = useQuery({
    queryKey: ['employees', employeeId, 'pc-activity-mentorships'],
    queryFn: () => employeesApi.getPcActivityMentorships(employeeId),
    enabled: Boolean(employeeId),
  })

  const rows = mentorshipsQuery.data || []

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="min-w-0 border-b border-[var(--mws-line)] p-5">
        <h2 className="text-base font-semibold text-[var(--mws-charcoal)]">
          PC Activity Mentorships
        </h2>
        <p className="text-sm text-[var(--mws-muted)]">
          Activities this employee is the default mentor for, by unit - set from Master Data.
        </p>
      </div>

      <div className="w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
            <tr>
              <th className="px-4 py-3">Activity</th>
              <th className="px-4 py-3">Unit</th>
            </tr>
          </thead>
          <tbody>
            {mentorshipsQuery.isLoading ? (
              <tr>
                <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={2}>
                  Loading PC activity mentorships...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={2}>
                  Not a default mentor for any PC activity.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]"
                >
                  <td className="px-4 py-3 font-semibold text-[var(--mws-charcoal)]">
                    {row.activity_name}
                  </td>
                  <td className="px-4 py-3">{row.unit_name}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
