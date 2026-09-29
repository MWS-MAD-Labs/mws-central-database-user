import { useQuery } from '@tanstack/react-query'
import { CalendarCheck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { PanelMessage } from '../../../../components/ui/PanelMessage.jsx'
import { StatusBadge } from '../../../../components/ui/StatusBadge.jsx'
import { ToggleChip } from '../../../../components/ui/FormControls.jsx'
import { formatDate, formatStatus } from '../../../../lib/format.js'
import { academicYearsApi } from '../../../academic/api/academicApi.js'
import { studentSensitiveApi } from '../../api/studentSensitiveApi.js'
import { PanelFrame } from './panelPrimitives.jsx'

// ENDED/SCHEDULED/EXPIRED rows already come back from the API by default
// (deleted_at stays null when a room move/end happens - only a hard drop
// sets it) - "Show Removed" here only toggles is_deleted, i.e. soft-deleted
// rows. So the default view is already this student's full PC activity
// history, not just what's currently active; the badge below is what makes
// that legible instead of every row looking like an active assignment.
function assignmentStatusTone(status) {
  switch (status) {
    case 'ACTIVE':
      return 'green'
    case 'SCHEDULED':
      return 'amber'
    case 'EXPIRED':
      return 'amber'
    case 'ENDED':
      return 'neutral'
    default:
      return 'neutral'
  }
}

// Read-only: assigning/removing a PC activity now happens from the room's
// own Students tab on the PC Activity Rooms page, which writes to this
// same table. "Show Removed" only toggles the view - no restore here.
export function StudentPcActivitiesPanel({ studentId }) {
  const [showHistory, setShowHistory] = useState(false)

  const activitiesQuery = useQuery({
    queryKey: ['students', studentId, 'pc-activities', showHistory],
    queryFn: () =>
      studentSensitiveApi.listPcActivities(studentId, { is_deleted: showHistory }),
    enabled: Boolean(studentId),
  })
  const yearsQuery = useQuery({
    queryKey: ['pc-activity-academic-years'],
    queryFn: () =>
      academicYearsApi.list({
        page: 1,
        size: 100,
        sort_by: 'created_at',
        sort_order: 'desc',
      }),
  })

  const years = yearsQuery.data?.data || []
  const activities = [...(activitiesQuery.data || [])].sort(
    (a, b) => new Date(b.start_date) - new Date(a.start_date),
  )

  return (
    <PanelFrame
      title="PC Activities"
      icon={CalendarCheck}
      isFetching={activitiesQuery.isFetching}
      action={
        <ToggleChip checked={showHistory} onChange={setShowHistory}>
          Show Removed
        </ToggleChip>
      }
    >
      {activities.length === 0 ? (
        <PanelMessage>
          {showHistory
            ? 'No removed PC activities.'
            : 'No PC activities yet. Assign one from PC Activity Rooms instead.'}
        </PanelMessage>
      ) : (
        <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
          {activities.map((activity) => {
            const year = years.find((item) => item.id === activity.academic_year_id)
            return (
              <article key={activity.id} className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="neutral">{formatStatus(activity.day)}</StatusBadge>
                  <StatusBadge tone={assignmentStatusTone(activity.status)}>
                    {formatStatus(activity.status)}
                  </StatusBadge>
                  {showHistory ? <StatusBadge tone="red">Removed</StatusBadge> : null}
                </div>
                <p className="mt-2 text-sm font-semibold text-(--mws-charcoal)">
                  {activity.activity}
                  {activity.room_name ? (
                    <span className="font-normal text-(--mws-muted)"> / {activity.room_name}</span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-(--mws-muted)">
                  {formatDate(activity.start_date)}
                  {activity.end_date ? <> - {formatDate(activity.end_date)}</> : null}
                  {' / '}
                  {activity.mentors.length > 0 ? (
                    activity.mentors.map((mentor, index) => (
                      <span key={mentor.id}>
                        {index > 0 ? ', ' : ''}
                        <Link
                          to={
                            mentor.type === 'INTERN'
                              ? `/interns/${mentor.id}`
                              : `/employees/${mentor.id}`
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="text-(--mws-charcoal) hover:text-(--mws-burgundy) hover:underline"
                        >
                          {mentor.name}
                        </Link>
                      </span>
                    ))
                  ) : (
                    'No mentor'
                  )}{' '}
                  / {year?.name || activity.academic_year_id}
                  {activity.expires_at ? (
                    <> / Expires {formatDate(activity.expires_at)}</>
                  ) : null}
                </p>
              </article>
            )
          })}
        </div>
      )}
    </PanelFrame>
  )
}
