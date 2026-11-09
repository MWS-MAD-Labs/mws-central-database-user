import { useQuery } from '@tanstack/react-query'
import { HeartHandshake, Pencil } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../../../../components/ui/Button.jsx'
import { PanelMessage } from '../../../../components/ui/PanelMessage.jsx'
import { StatusBadge } from '../../../../components/ui/StatusBadge.jsx'
import { useConfirm } from '../../../../components/ui/useConfirm.js'
import { studentSensitiveApi } from '../../api/studentSensitiveApi.js'
import { SPECIAL_NEED_TYPES } from '../../constants/specialNeeds.js'
import { PanelFrame, SensitiveDataReveal } from './panelPrimitives.jsx'

export function StudentSpecialNeedsPanel({ studentId, canWrite, canViewSensitive }) {
  const confirm = useConfirm()
  const [revealed, setRevealed] = useState(false)

  const profileQuery = useQuery({
    queryKey: ['students', studentId, 'special-needs-profile'],
    queryFn: () => studentSensitiveApi.getSpecialNeedsProfile(studentId),
    enabled: Boolean(studentId) && canViewSensitive && revealed,
  })

  async function reveal() {
    if (await confirm({
      title: 'View Special Needs profile',
      description: "View this student's support profile? This access is logged.",
      confirmLabel: 'View',
    })) setRevealed(true)
  }

  if (!canViewSensitive) {
    return (
      <PanelFrame title="Special Needs Profile" icon={HeartHandshake} isFetching={false}>
        <PanelMessage>Restricted. You don't have permission to view sensitive data.</PanelMessage>
      </PanelFrame>
    )
  }

  if (!revealed) {
    return <SensitiveDataReveal icon={HeartHandshake} title="Special Needs Profile" onReveal={reveal} />
  }

  const profile = profileQuery.data
  return (
    <PanelFrame
      title="Special Needs Profile"
      icon={HeartHandshake}
      isFetching={profileQuery.isFetching}
      action={canWrite ? (
        <Button asChild variant="secondary" size="sm" className="h-8 px-3">
          <Link to={`/students/${studentId}/edit?section=special-needs`}><Pencil size={14} />Edit Student</Link>
        </Button>
      ) : null}
    >
      {!profile ? (
        <PanelMessage>No completed Special Needs profile.</PanelMessage>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="grid gap-3 md:grid-cols-2">
            {profile.needs.map((need) => (
              <article key={need.need_type} className="rounded-2xl border border-(--mws-line) bg-white p-4">
                <StatusBadge tone="info">
                  {SPECIAL_NEED_TYPES.find((item) => item.value === need.need_type)?.label || need.need_type}
                </StatusBadge>
                <p className="mt-3 whitespace-pre-wrap text-(--mws-charcoal)">{need.description}</p>
              </article>
            ))}
          </div>
          <ProfileText label="Learning Support Summary" value={profile.learning_support_summary} />
          <ProfileText label="Classroom Accommodations" value={profile.accommodations} />
          <div className="grid gap-3 sm:grid-cols-2">
            <ProfileText label="Needs Identified Date" value={profile.identified_date || '-'} />
            {profile.has_professional_report ? (
              <ProfileText label="Professional Report Date" value={profile.report_date || 'Date not recorded'} />
            ) : (
              <ProfileText label="Professional Report" value="Not available" />
            )}
          </div>
        </div>
      )}
    </PanelFrame>
  )
}

function ProfileText({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold text-(--mws-muted)">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-(--mws-charcoal)">{value || '-'}</p>
    </div>
  )
}
