import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'
import { formatDate } from '../../../lib/format.js'
import { employeesApi } from '../api/employeesApi.js'

const MENTORSHIP_PAGE_SIZE = 10

function groupMentorshipRows(rows) {
  return [...rows].sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
}

export function PcActivityMentorshipsPanel({
  memberId,
  memberType,
  isTeachingRole,
  getMentorships,
}) {
  const [page, setPage] = useState(1)
  const mentorshipsQuery = useQuery({
    queryKey: [memberType, memberId, 'pc-activity-mentorships'],
    queryFn: () => getMentorships(memberId),
    enabled: Boolean(memberId),
  })

  const rows = mentorshipsQuery.data || []
  const groups = groupMentorshipRows(rows)
  const totalPages = Math.max(Math.ceil(groups.length / MENTORSHIP_PAGE_SIZE), 1)
  const clampedPage = Math.min(page, totalPages)
  const pagedGroups = groups.slice(
    (clampedPage - 1) * MENTORSHIP_PAGE_SIZE,
    clampedPage * MENTORSHIP_PAGE_SIZE,
  )

  if (!isTeachingRole && !mentorshipsQuery.isLoading && rows.length === 0) {
    return null
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-(--mws-line) bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="min-w-0 border-b border-(--mws-line) p-5">
        <h2 className="text-base font-semibold text-(--mws-charcoal)">
          PC Activity Room History
        </h2>
        <p className="text-sm text-(--mws-muted)">
          Actual PC Activity rooms assigned to this member, past and present.
        </p>
      </div>

      <div className="w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
            <tr>
              <th className="px-4 py-3">Room</th>
              <th className="px-4 py-3">Schedule</th>
              <th className="px-4 py-3">Start</th>
              <th className="px-4 py-3">End</th>
            </tr>
          </thead>
          <tbody>
            {mentorshipsQuery.isLoading ? (
              <tr>
                <td className="px-4 py-10 text-center text-(--mws-muted)" colSpan={4}>
                  Loading PC activity mentorships...
                </td>
              </tr>
            ) : groups.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-(--mws-muted)" colSpan={4}>
                  No PC Activity room mentorships.
                </td>
              </tr>
            ) : (
              pagedGroups.map((group) => (
                <tr
                    key={group.id}
                  className="border-t border-(--mws-line) bg-white hover:bg-(--mws-soft)"
                >
                  <td className="px-4 py-3 font-semibold">
                    <Link
                      to={`/academic?tab=pc-activity-rooms&search=${encodeURIComponent(group.room_name)}`}
                      className="text-(--mws-charcoal) hover:text-(--mws-burgundy) hover:underline"
                    >
                      {group.room_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{group.day} / {group.academic_year_name}</td>
                  <td className="px-4 py-3">{formatDate(group.start_date)}</td>
                  <td className="px-4 py-3">{formatDate(group.end_date)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {groups.length > MENTORSHIP_PAGE_SIZE ? (
        <PaginationBar
          paging={{
            current_page: clampedPage,
            total_page: totalPages,
            total_item: groups.length,
            size: MENTORSHIP_PAGE_SIZE,
          }}
          itemLabel="mentorships"
          onPrevious={() => setPage((current) => Math.max(current - 1, 1))}
          onNext={() => setPage((current) => Math.min(current + 1, totalPages))}
        />
      ) : null}
    </section>
  )
}

export function EmployeePcActivityMentorshipsPanel({ employeeId, isTeachingRole }) {
  return (
    <PcActivityMentorshipsPanel
      memberId={employeeId}
      memberType="employees"
      isTeachingRole={isTeachingRole}
      getMentorships={employeesApi.getPcActivityMentorships}
    />
  )
}
