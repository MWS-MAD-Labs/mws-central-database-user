import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Edit, GraduationCap, Users } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { formatDate, formatStatus } from '../../../lib/format.js'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { gradesApi, pcActivityRoomsApi } from '../api/academicApi.js'
import { pcActivitiesApi } from '../../master-data/api/masterDataApi.js'
import { distinctGradeUnits } from '../../master-data/utils/pcActivityUnits.js'
import {
  canManageEnrollments,
  canManageTeacherAssignments,
} from '../../../lib/capabilities.js'
import {
  RoomFormDialog,
  RoomMentorsSection,
  RoomStudentsSection,
} from '../components/PcActivityRoomsPanel.jsx'

// A room's unit/grade/class scope can span everything ("allow all" = every
// current unit or grade checked), which reads badly as full name lists.
// Match the list table's existing convention instead: a count per
// category, full names on hover - compact regardless of how wide the scope is.
function scopePart(items, singular, emptyLabel) {
  if (items.length === 0) {
    return { text: emptyLabel, title: undefined }
  }
  return {
    text: `${items.length} ${singular}${items.length === 1 ? '' : 's'}`,
    title: items.map((item) => item.name).join(', '),
  }
}

function ScopeSummary({ room }) {
  const parts = [
    scopePart(room.units, 'unit'),
    scopePart(room.grades, 'grade', 'Any grade'),
    scopePart(room.classes, 'class', 'Any class'),
  ]
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 text-sm">
      {parts.map((part, index) => (
        <span key={part.text} className="flex items-center gap-x-1.5">
          {index > 0 ? <span className="text-(--mws-line)">·</span> : null}
          <span title={part.title} className="font-semibold text-(--mws-charcoal)">
            {part.text}
          </span>
        </span>
      ))}
    </span>
  )
}

export function PcActivityRoomDetailPage() {
  const { roomId } = useParams()
  const { user } = useAuth()
  const isSuperAdmin = user?.type === 'admin' && user?.role === 'SUPER_ADMIN'
  const isDatabaseAdmin = user?.type === 'admin' && user?.role === 'DATABASE_ADMIN'
  const [editOpen, setEditOpen] = useState(false)

  const roomQuery = useQuery({
    queryKey: ['pc-activity-rooms', 'detail', roomId],
    queryFn: () => pcActivityRoomsApi.get(roomId),
    enabled: Boolean(roomId),
  })
  const room = roomQuery.data

  const gradesQuery = useQuery({
    queryKey: ['master-data', 'grades', 'all'],
    queryFn: () => gradesApi.list({ page: 1, size: 100 }),
  })
  const grades = gradesQuery.data?.data || []
  const units = distinctGradeUnits(grades)

  const activitiesQuery = useQuery({
    queryKey: ['master-data', 'pc-activities', 'all'],
    queryFn: () => pcActivitiesApi.list({ page: 1, size: 100 }),
  })
  const activities = activitiesQuery.data?.data || []

  const unitMatches =
    isSuperAdmin ||
    (isDatabaseAdmin && Boolean(room) && room.units.some((unit) => unit.id === user?.unit_id))
  const canEditRoom = unitMatches
  const canManageStudents = unitMatches && canManageEnrollments(user)
  const canManageMentors = unitMatches && canManageTeacherAssignments(user)

  const backAction = (
    <Button asChild variant="secondary">
      <Link to="/academic?tab=pc-activity-rooms">
        <ArrowLeft size={16} />
        Back
      </Link>
    </Button>
  )

  if (roomQuery.isError) {
    return (
      <div className="min-w-0">
        <PageHeader
          title="PC Activity Room"
          description="This room couldn't be found."
          actions={backAction}
        />
        <PanelMessage tone="error">
          The room may have been deleted, or you don't have access to it.
        </PanelMessage>
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title={room?.display_name || 'PC Activity Room'}
        description={
          room
            ? `${room.activity_name} / ${formatStatus(room.day)} / ${formatDate(room.start_date)} - ${formatDate(room.end_date)}`
            : 'Loading room detail...'
        }
        actions={
          <>
            {canEditRoom && room ? (
              <Button type="button" variant="secondary" onClick={() => setEditOpen(true)}>
                <Edit size={16} />
                Edit room
              </Button>
            ) : null}
            {backAction}
          </>
        }
      />

      {room ? (
        <div className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1">
          <ScopeSummary room={room} />
          <span className="text-(--mws-line)">·</span>
          <span className="text-sm text-(--mws-muted)">
            {room.student_count} active student{room.student_count === 1 ? '' : 's'}
            {room.expired_count > 0 ? `, ${room.expired_count} expired` : ''}
          </span>
        </div>
      ) : null}

      {roomQuery.isLoading ? (
        <PanelMessage>Loading room detail...</PanelMessage>
      ) : room ? (
        <div className="grid min-w-0 gap-6 lg:grid-cols-2">
          <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
            <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-(--mws-charcoal)">
              <Users size={18} />
              Mentors
            </h2>
            <RoomMentorsSection room={room} units={units} canManage={canManageMentors} />
          </section>
          <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
            <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-(--mws-charcoal)">
              <GraduationCap size={18} />
              Students
            </h2>
            <RoomStudentsSection room={room} canManage={canManageStudents} />
          </section>
        </div>
      ) : null}

      {editOpen && room ? (
        <RoomFormDialog
          mode="edit"
          room={room}
          activities={activities}
          units={units}
          grades={grades}
          onClose={() => setEditOpen(false)}
        />
      ) : null}
    </div>
  )
}
