import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { formatDate } from '../../../lib/format.js'
import { employeesApi } from '../api/employeesApi.js'

// "One mentor for all units" saves as one row per unit (see
// PCActivityMentorHistoryPanel.jsx's identical grouping) - collapse a batch
// of same-activity, same-end-date rows that landed together and covers
// every unit this employee mentors that activity in, into one "All Units"
// row. A real per-unit split (different time, or genuinely only some units)
// still lists one row per unit.
const SAME_BATCH_WINDOW_MS = 30_000

function groupMentorshipRows(rows) {
  const totalUnitsByActivity = new Map()
  for (const row of rows) {
    const set = totalUnitsByActivity.get(row.activity_id) || new Set()
    set.add(row.unit_id)
    totalUnitsByActivity.set(row.activity_id, set)
  }

  const sorted = [...rows].sort(
    (a, b) => new Date(a.start_date) - new Date(b.start_date),
  )

  const clusters = []
  for (const entry of sorted) {
    const cluster = clusters[clusters.length - 1]
    const lastEntry = cluster?.entries[cluster.entries.length - 1]
    const sameBatch =
      cluster &&
      cluster.activity_id === entry.activity_id &&
      cluster.end_date === entry.end_date &&
      Math.abs(new Date(entry.start_date) - new Date(lastEntry.start_date)) <=
        SAME_BATCH_WINDOW_MS
    if (sameBatch) {
      cluster.entries.push(entry)
    } else {
      clusters.push({
        activity_id: entry.activity_id,
        end_date: entry.end_date,
        entries: [entry],
      })
    }
  }

  const groups = []
  for (const cluster of clusters) {
    const totalUnits = totalUnitsByActivity.get(cluster.activity_id)?.size ?? 0
    if (totalUnits > 1 && cluster.entries.length === totalUnits) {
      const first = cluster.entries[0]
      groups.push({
        key: cluster.entries.map((entry) => entry.id).join('-'),
        activity_id: first.activity_id,
        activity_name: first.activity_name,
        unitLabel: 'All Units',
        start_date: first.start_date,
        end_date: first.end_date,
      })
    } else {
      for (const entry of cluster.entries) {
        groups.push({
          key: entry.id,
          activity_id: entry.activity_id,
          activity_name: entry.activity_name,
          unitLabel: entry.unit_name,
          start_date: entry.start_date,
          end_date: entry.end_date,
        })
      }
    }
  }

  return groups.sort((a, b) => {
    const nameCompare = a.activity_name.localeCompare(b.activity_name)
    if (nameCompare !== 0) return nameCompare
    return new Date(b.start_date) - new Date(a.start_date)
  })
}

// Every (activity, unit) this employee is or was the default mentor for -
// set from Master Data > PC Activities > Manage Mentors, not editable here.
// The activity name links to that panel to actually change it.
export function EmployeePcActivityMentorshipsPanel({ employeeId, isTeachingRole }) {
  const mentorshipsQuery = useQuery({
    queryKey: ['employees', employeeId, 'pc-activity-mentorships'],
    queryFn: () => employeesApi.getPcActivityMentorships(employeeId),
    enabled: Boolean(employeeId),
  })

  const rows = mentorshipsQuery.data || []
  const groups = groupMentorshipRows(rows)

  // A non-teaching job level can never be set as a default mentor - hide
  // the section entirely instead of showing an empty table that reads as
  // "not set up yet" for a role this doesn't apply to. Past mentorships
  // still show even if the employee later moved to a non-teaching role.
  if (!isTeachingRole && !mentorshipsQuery.isLoading && rows.length === 0) {
    return null
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="min-w-0 border-b border-[var(--mws-line)] p-5">
        <h2 className="text-base font-semibold text-[var(--mws-charcoal)]">
          PC Activity Mentorships
        </h2>
        <p className="text-sm text-[var(--mws-muted)]">
          Activities this employee mentors, by unit, past and present. Set
          from Master Data.
        </p>
      </div>

      <div className="w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
            <tr>
              <th className="px-4 py-3">Activity</th>
              <th className="px-4 py-3">Unit</th>
              <th className="px-4 py-3">Start</th>
              <th className="px-4 py-3">End</th>
            </tr>
          </thead>
          <tbody>
            {mentorshipsQuery.isLoading ? (
              <tr>
                <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={4}>
                  Loading PC activity mentorships...
                </td>
              </tr>
            ) : groups.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={4}>
                  Not a default mentor for any PC activity.
                </td>
              </tr>
            ) : (
              groups.map((group) => (
                <tr
                  key={group.key}
                  className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]"
                >
                  <td className="px-4 py-3 font-semibold">
                    <Link
                      to={`/academic?tab=pc-activities&search=${encodeURIComponent(group.activity_name)}`}
                      className="text-[var(--mws-charcoal)] hover:text-[var(--mws-burgundy)] hover:underline"
                    >
                      {group.activity_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{group.unitLabel}</td>
                  <td className="px-4 py-3">{formatDate(group.start_date)}</td>
                  <td className="px-4 py-3">{formatDate(group.end_date)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
