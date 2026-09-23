import { useQuery } from '@tanstack/react-query'
import { CalendarCheck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { PanelMessage } from '../../../../components/ui/PanelMessage.jsx'
import { StatusBadge } from '../../../../components/ui/StatusBadge.jsx'
import { ToggleChip } from '../../../../components/ui/FormControls.jsx'
import { formatStatus } from '../../../../lib/format.js'
import { academicYearsApi } from '../../../academic/api/academicApi.js'
import { studentSensitiveApi } from '../../api/studentSensitiveApi.js'
import { PanelFrame } from './panelPrimitives.jsx'

// Read-only: assigning/removing a PC activity now happens from the
// class's own PC Activities section, which writes to this same table.
// "Show History" only toggles the view - no restore here, that stays a
// class-context action (see ClassPcActivitiesSection's EnrolledStudentsDialog).
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
  const activities = activitiesQuery.data || []

  return (
    <PanelFrame
      title="PC Activities"
      icon={CalendarCheck}
      isFetching={activitiesQuery.isFetching}
      onRefresh={() => {
        activitiesQuery.refetch()
        yearsQuery.refetch()
      }}
      action={
        <ToggleChip checked={showHistory} onChange={setShowHistory}>
          Show History
        </ToggleChip>
      }
    >
      {activities.length === 0 ? (
        <PanelMessage>
          {showHistory
            ? 'No past PC activities.'
            : "No PC activities yet. Assign one from the student's class instead."}
        </PanelMessage>
      ) : (
        <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
          {activities.map((activity) => {
            const year = years.find((item) => item.id === activity.academic_year_id)
            return (
              <article key={activity.id} className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="neutral">{formatStatus(activity.day)}</StatusBadge>
                  {showHistory ? <StatusBadge tone="red">Removed</StatusBadge> : null}
                </div>
                <p className="mt-2 text-sm font-semibold text-(--mws-charcoal)">
                  {activity.activity}
                </p>
                <p className="mt-1 text-xs text-(--mws-muted)">
                  {activity.mentor_name ? (
                    <Link
                      to={
                        activity.mentor_type === 'INTERN'
                          ? `/interns/${activity.mentor_id}`
                          : `/employees/${activity.mentor_id}`
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="text-(--mws-charcoal) hover:text-(--mws-burgundy) hover:underline"
                    >
                      {activity.mentor_name}
                    </Link>
                  ) : (
                    'No mentor'
                  )}{' '}
                  / {year?.name || activity.academic_year_id}
                  {activity.class_name ? (
                    <>
                      {' '}
                      /{' '}
                      {activity.class_id ? (
                        <Link
                          to={`/academic/classes/${activity.class_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-(--mws-charcoal) hover:text-(--mws-burgundy) hover:underline"
                        >
                          {activity.class_name}
                        </Link>
                      ) : (
                        activity.class_name
                      )}
                    </>
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
