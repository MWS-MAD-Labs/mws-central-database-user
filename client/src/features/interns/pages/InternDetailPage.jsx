import { ArrowLeft, Edit, Mail, Phone, Trash2, UserRound } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { useConfirm } from '../../../components/ui/useConfirm.js'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { internsApi } from '../api/internsApi.js'
import { unitsApi } from '../../master-data/api/masterDataApi.js'
import {
  formatDate,
  formatEducationLevel,
  formatStatus,
  getBirthDateWarning,
  getFarFutureDateWarning,
  statusTone,
} from '../../../lib/format.js'
import { DetailRow } from '../../employees/components/DetailRow.jsx'
import { ContactRow } from '../../employees/components/ContactRow.jsx'

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

  // Only needed to resolve the DB Admin's own unit name so it can be
  // compared against intern.employment.unit (a name, not an id) - mirrors
  // EmployeeDetailPage's own myUnitQuery.
  const myUnitQuery = useQuery({
    queryKey: ['units', user?.unit_id],
    queryFn: () => unitsApi.get(user.unit_id),
    enabled: user?.role === 'DATABASE_ADMIN' && Boolean(user?.unit_id),
  })

  const deleteMutation = useMutation({
    mutationFn: () => internsApi.remove(internId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['interns'] })
      navigate('/interns?is_deleted=true', { replace: true })
    },
  })

  const intern = internQuery.data
  const birthDateWarning = intern
    ? getBirthDateWarning(intern.identity.birth_date)
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
  const canDelete = user?.role === 'SUPER_ADMIN'
  const hasDetail = intern && 'gender' in intern.identity

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
            {canWrite ? (
              <Button asChild variant="secondary">
                <Link to={`/interns/${internId}/edit`}>
                  <Edit size={16} />
                  Edit
                </Link>
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                type="button"
                variant="danger"
                disabled={deleteMutation.isPending}
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
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
          <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
            <div className="flex items-center gap-4 border-b border-[var(--mws-line)] p-5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
                <UserRound size={24} />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-[var(--mws-charcoal)]">
                  {intern.identity.full_name}
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
              <DetailRow label="Building" value={intern.employment.building} />
              <DetailRow label="Join Date" value={formatDate(intern.employment.join_date)} warning={joinDateWarning} />
              <DetailRow label="End Date" value={formatDate(intern.employment.end_date)} warning={endDateWarning} />
              <DetailRow label="Notes" value={intern.notes} />
              <DetailRow label="Created At" value={formatDate(intern.created_at)} />
            </dl>
          </section>

          <div className="min-w-0 space-y-5">
            <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
              <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
                Contact
              </h2>
              <div className="space-y-3 text-sm">
                <ContactRow icon={Mail} value={intern.identity.email} />
                <ContactRow icon={Phone} value={intern.identity.mobile_phone || '-'} />
              </div>
            </section>

            {hasDetail ? (
              <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
                <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
                  Identity
                </h2>
                <dl>
                  <DetailRow compact label="Gender" value={formatStatus(intern.identity.gender)} />
                  <DetailRow compact label="Religion" value={formatStatus(intern.identity.religion)} />
                  <DetailRow compact label="Birth Place" value={intern.identity.birth_place} />
                  <DetailRow compact label="Birth Date" value={formatDate(intern.identity.birth_date)} warning={birthDateWarning} />
                  <DetailRow compact label="Address" value={intern.identity.residential_address} />
                </dl>
              </section>
            ) : null}

            {hasDetail ? (
              <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
                <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
                  Education
                </h2>
                <dl>
                  <DetailRow compact label="Education Level" value={formatEducationLevel(intern.identity.education_level)} />
                  <DetailRow compact label="Institution" value={intern.identity.institution_name} />
                  <DetailRow compact label="Major" value={intern.identity.major} />
                  <DetailRow compact label="Graduation Year" value={intern.identity.graduation_year} />
                </dl>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
