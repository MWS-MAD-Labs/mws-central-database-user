import { ArrowLeft, Edit, Eye, EyeOff, Mail, Phone, Trash2, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { useConfirm } from '../../../components/ui/useConfirm.js'
import { FlagBadgeList } from '../../../components/ui/FlagBadgeList.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { editBlockedReason } from '../../../lib/capabilities.js'
import { forgetReveal, hasRecentReveal, rememberReveal } from '../../../lib/piiRevealMemory.js'
import { showErrorToast } from '../../../lib/toast.js'
import { internsApi } from '../api/internsApi.js'
import { unitsApi } from '../../master-data/api/masterDataApi.js'
import {
  formatDate,
  formatEducationLevel,
  formatStatus,
  getBirthDateWarning,
  getFarFutureDateWarning,
  getInternFlagBadges,
  statusTone,
} from '../../../lib/format.js'
import { DetailRow } from '../../employees/components/DetailRow.jsx'
import { ContactRow } from '../../employees/components/ContactRow.jsx'
import { InternTeachingAssignmentsPanel } from '../components/InternTeachingAssignmentsPanel.jsx'
import { InternSupportAssignmentsPanel } from '../components/InternSupportAssignmentsPanel.jsx'
import { InternPcActivityMentorshipsPanel } from '../components/InternPcActivityMentorshipsPanel.jsx'
import { InternMutationHistoryPanel } from '../components/InternMutationHistoryPanel.jsx'

export function InternDetailPage() {
  const { internId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const confirm = useConfirm()

  const internQuery = useQuery({
    queryKey: ['interns', internId],
    queryFn: () => internsApi.get(internId),
    enabled: Boolean(internId),
  })

  const myUnitQuery = useQuery({
    queryKey: ['units', user?.unit_id],
    queryFn: () => unitsApi.get(user.unit_id),
    enabled: user?.role === 'DATABASE_ADMIN' && Boolean(user?.unit_id),
  })

  const deleteMutation = useMutation({
    mutationFn: () => internsApi.remove(internId),
    onSuccess: () => {
      // Only invalidate the LIST query (key shape ['interns', {filters}])
      // - invalidating the bare ['interns'] prefix also matches every
      // still-mounted detail-scoped query, forcing it to refetch the
      // just-archived record before navigation unmounts it, which 404s
      // and surfaces as a stray "Intern not found" toast.
      queryClient.invalidateQueries({
        queryKey: ['interns'],
        predicate: (query) =>
          typeof query.queryKey[1] === 'object' && query.queryKey[1] !== null,
      })
      navigate('/interns?is_deleted=true', { replace: true })
    },
  })

  const piiScope = `intern:${internId}`
  const [pii, setPii] = useState(null)
  const [revealRequested, setRevealRequested] = useState(
    () => Boolean(internId) && hasRecentReveal(piiScope),
  )
  const revealMutation = useMutation({
    mutationFn: () => internsApi.recordSensitiveFieldsAccess(internId),
    onSuccess: (revealed) => {
      rememberReveal(piiScope)
      setPii(revealed)
      setRevealRequested(true)
    },
    onError: (error) => showErrorToast(error, 'Could not reveal sensitive fields.'),
  })
  // The values are never kept past the page, so a remembered reveal fetches
  // them again (the server dedupes the audit entry).
  const { mutate: fetchPii } = revealMutation
  const hasRequestedPiiRef = useRef(false)
  useEffect(() => {
    if (!revealRequested || pii || hasRequestedPiiRef.current) return
    hasRequestedPiiRef.current = true
    fetchPii()
  }, [revealRequested, pii, fetchPii])

  async function handleRevealSensitiveFields() {
    const confirmed = await confirm({
      title: 'View sensitive fields',
      description: `View ${intern?.identity?.full_name || 'this intern'}'s gender, religion, and birth details? This access is logged.`,
      confirmLabel: 'View',
    })
    if (confirmed) revealMutation.mutate()
  }

  function handleHideSensitiveFields() {
    forgetReveal(piiScope)
    setPii(null)
    setRevealRequested(false)
    hasRequestedPiiRef.current = false
  }

  const intern = internQuery.data
  const flagBadges = intern ? getInternFlagBadges(intern) : []
  const birthDateWarning = intern
    ? getBirthDateWarning(pii?.birth_date)
    : null
  const joinDateWarning = intern
    ? getFarFutureDateWarning(intern.employment.join_date)
    : null
  const endDateWarning = intern
    ? getFarFutureDateWarning(intern.employment.end_date)
    : null
  const canWriteBase =
    user?.role === 'SUPER_ADMIN' ||
    (user?.role === 'DATABASE_ADMIN' && Boolean(user?.can_write_employee_data))
  const canWrite =
    canWriteBase &&
    (user?.role === 'SUPER_ADMIN' ||
      intern?.employment?.unit === myUnitQuery.data?.name)
  const editBlockedText = intern
    ? editBlockedReason(user, {
        hasWriteFlag: Boolean(user?.can_write_employee_data),
        sameUnit: myUnitQuery.data ? intern.employment?.unit === myUnitQuery.data.name : true,
      })
    : null
  const canDelete = user?.role === 'SUPER_ADMIN'
  const canViewContactPii =
    user?.role === 'SUPER_ADMIN' || Boolean(user?.can_view_employee_pii)
  const hasDetail = intern && Boolean(intern.identity.can_view_pii)

  async function handleDelete() {
    const confirmed = await confirm({
      title: 'Delete intern',
      description: 'Delete this intern? You can restore it from the trash bin.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (confirmed) {
      deleteMutation.mutate()
    }
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title={intern?.identity?.full_name || 'Intern Detail'}
        description={
          intern
            ? `${intern.employment.unit} / ${intern.employment.job_position}`
            : 'Intern profile and employment data.'
        }
        actions={
          <>
            <Button asChild variant="secondary">
              <Link to="/interns">
                <ArrowLeft size={16} />
                Back
              </Link>
            </Button>
            {canWrite && !editBlockedText ? (
              <Button asChild variant="secondary">
                <Link to={`/interns/${internId}/edit`}>
                  <Edit size={16} />
                  Edit
                </Link>
              </Button>
            ) : intern && editBlockedText ? (
              <Button type="button" variant="secondary" disabled title={editBlockedText}>
                <Edit size={16} />
                Edit
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                type="button"
                variant="danger"
                loading={deleteMutation.isPending}
                onClick={handleDelete}
              >
                <Trash2 size={16} />
                Delete
              </Button>
            ) : null}
          </>
        }
      />

      {internQuery.isLoading ? (
        <PanelMessage>Loading intern...</PanelMessage>
      ) : internQuery.isError ? (
        <PanelMessage>Intern data is unavailable.</PanelMessage>
      ) : intern ? (
        <div className="min-w-0 space-y-5">
          <section className="min-w-0 overflow-hidden rounded-2xl border border-(--mws-line) bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
            <div className="flex items-center gap-4 border-b border-(--mws-line) p-5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
                <UserRound size={24} />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-(--mws-charcoal)">
                  {intern.identity.full_name}
                  <FlagBadgeList badges={flagBadges} />
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <StatusBadge tone={statusTone(intern.status)}>
                    {formatStatus(intern.status)}
                  </StatusBadge>
                </div>
              </div>
            </div>

            <dl className="p-5">
              <DetailRow label="Nick Name" value={intern.identity.nick_name} />
              <DetailRow label="Unit" value={intern.employment.unit} />
              <DetailRow label="Job Position" value={intern.employment.job_position} />
              <DetailRow
                label="PC Mentor Eligible"
                value={
                  intern.employment.is_pc_mentor_eligible
                    ? intern.employment.pc_mentor_units?.length
                      ? `Yes (${intern.employment.pc_mentor_units.map((unit) => unit.name).join(', ')})`
                      : 'Yes (own unit only)'
                    : 'No'
                }
              />
              <DetailRow label="Building" value={intern.employment.building} />
              <DetailRow label="Join Date" value={formatDate(intern.employment.join_date)} warning={joinDateWarning} />
              <DetailRow label="End Date" value={formatDate(intern.employment.end_date)} warning={endDateWarning} />
              <DetailRow label="Notes" value={intern.notes} />
              <DetailRow label="Created At" value={formatDate(intern.created_at)} />
            </dl>
          </section>

          <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
            <h2 className="mb-3 text-xs font-display font-bold uppercase tracking-wide text-(--mws-muted)">
              Contact
            </h2>
            <div className="space-y-3 text-sm">
              <ContactRow icon={Mail} value={intern.identity.email} />
              {canViewContactPii ? (
                <ContactRow icon={Phone} value={intern.identity.mobile_phone || '-'} />
              ) : null}
            </div>

            {hasDetail ? (
              <>
                <div className="mb-3 mt-5 flex items-center justify-between border-t border-(--mws-line) pt-5">
                  <h2 className="text-xs font-display font-bold uppercase tracking-wide text-(--mws-muted)">
                    Identity
                  </h2>
                  {pii ? (
                    <Button type="button" variant="ghost" size="sm" onClick={handleHideSensitiveFields}>
                      <EyeOff size={15} />
                      Hide
                    </Button>
                  ) : null}
                </div>
                {pii ? (
                  <dl>
                    <DetailRow compact label="Gender" value={formatStatus(pii.gender)} />
                    <DetailRow compact label="Religion" value={formatStatus(pii.religion)} />
                    <DetailRow compact label="Birth Place" value={pii.birth_place} />
                    <DetailRow compact label="Birth Date" value={formatDate(pii.birth_date)} warning={birthDateWarning} />
                  </dl>
                ) : (
                  <div className="mb-2 flex flex-col items-start gap-2 rounded-xl border border-dashed border-(--mws-line) bg-(--mws-soft) p-3">
                    <p className="text-sm text-(--mws-muted)">
                      Gender, religion, and birth details are hidden by default.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={revealMutation.isPending}
                      onClick={handleRevealSensitiveFields}
                    >
                      <Eye size={15} />
                      Show Sensitive Fields
                    </Button>
                  </div>
                )}
                <dl>
                  <DetailRow compact label="Address" value={intern.identity.residential_address} />
                </dl>

                <h2 className="mb-3 mt-5 border-t border-(--mws-line) pt-5 text-xs font-display font-bold uppercase tracking-wide text-(--mws-muted)">
                  Education
                </h2>
                <dl>
                  <DetailRow compact label="Education Level" value={formatEducationLevel(intern.identity.education_level)} />
                  <DetailRow compact label="Institution" value={intern.identity.institution_name} />
                  <DetailRow compact label="Major" value={intern.identity.major} />
                  <DetailRow compact label="Graduation Year" value={intern.identity.graduation_year} />
                </dl>
              </>
            ) : null}
          </section>

          <InternTeachingAssignmentsPanel
            internId={internId}
            isTeachingRole={intern.employment.is_teaching_position}
          />
          <InternSupportAssignmentsPanel
            internId={internId}
            isTeachingRole={intern.employment.is_teaching_position}
            canWrite={canWrite}
          />
          <InternPcActivityMentorshipsPanel
            internId={internId}
            isTeachingRole={intern.employment.is_teaching_position}
          />
          <InternMutationHistoryPanel internId={internId} canWrite={canWrite} />
        </div>
      ) : null}
    </div>
  )
}
