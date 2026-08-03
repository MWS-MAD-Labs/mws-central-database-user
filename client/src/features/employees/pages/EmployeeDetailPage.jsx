import { ArrowLeft, Edit, Mail, Phone, Trash2, UserRound } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { employeesApi } from '../api/employeesApi.js'
import { formatDate, formatStatus, statusTone } from '../../../lib/format.js'

export function EmployeeDetailPage() {
  const { employeeId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const employeeQuery = useQuery({
    queryKey: ['employees', employeeId],
    queryFn: () => employeesApi.get(employeeId),
    enabled: Boolean(employeeId),
  })

  const deleteMutation = useMutation({
    mutationFn: () => employeesApi.remove(employeeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      navigate('/employees?is_deleted=true', { replace: true })
    },
  })

  const employee = employeeQuery.data
  const canWrite = user?.type === 'admin' && user?.role !== 'VIEWER'
  const canDelete = user?.role === 'SUPER_ADMIN'

  function handleDelete() {
    const confirmed = window.confirm(
      'Archive this employee? You can restore it from the trash bin.',
    )
    if (confirmed) {
      deleteMutation.mutate()
    }
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title={employee?.identity?.full_name || 'Employee Detail'}
        description={
          employee
            ? `${employee.employment.employee_id} / ${employee.employment.unit}`
            : 'Employee profile and employment data.'
        }
        actions={
          <>
            <Button asChild variant="secondary">
              <Link to="/employees">
                <ArrowLeft size={16} />
                Back
              </Link>
            </Button>
            {canWrite ? (
              <Button asChild variant="secondary">
                <Link to={`/employees/${employeeId}/edit`}>
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
                Archive
              </Button>
            ) : null}
          </>
        }
      />

      {employeeQuery.isLoading ? (
        <PanelMessage>Loading employee...</PanelMessage>
      ) : employeeQuery.isError ? (
        <PanelMessage>Employee data is unavailable.</PanelMessage>
      ) : employee ? (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
          <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
            <div className="flex items-center gap-4 border-b border-[var(--mws-line)] p-5">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
                <UserRound size={24} />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-[var(--mws-charcoal)]">
                  {employee.identity.full_name}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <StatusBadge tone={statusTone(employee.status_info.status)}>
                    {formatStatus(employee.status_info.status)}
                  </StatusBadge>
                  <StatusBadge tone="neutral">
                    {formatStatus(employee.status_info.employment_type)}
                  </StatusBadge>
                </div>
              </div>
            </div>

            <dl className="p-5">
              <DetailRow label="Nick name" value={employee.identity.nick_name} />
              <DetailRow label="Employee ID" value={employee.employment.employee_id} />
              <DetailRow label="Unit" value={employee.employment.unit} />
              <DetailRow label="Job position" value={employee.employment.job_position} />
              <DetailRow label="Job level" value={employee.employment.job_level} />
              <DetailRow label="Building" value={employee.employment.building} />
              <DetailRow label="Join date" value={formatDate(employee.employment.join_date)} />
              {employee.status_info.contract_end_date ? (
                <DetailRow
                  label="Contract end date"
                  value={formatDate(employee.status_info.contract_end_date)}
                />
              ) : null}
              <DetailRow label="Created at" value={formatDate(employee.created_at)} />
            </dl>
          </section>

          <div className="min-w-0 space-y-5">
            <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
              <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
                Contact
              </h2>
              <div className="space-y-3 text-sm">
                <ContactRow icon={Mail} value={employee.identity.email} />
                <ContactRow
                  icon={Phone}
                  value={employee.identity.mobile_phone || '-'}
                />
              </div>
            </section>

            {'gender' in employee.identity ? (
              <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
                <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
                  Sensitive Fields
                </h2>
                <dl>
                  <DetailRow compact label="Gender" value={formatStatus(employee.identity.gender)} />
                  <DetailRow compact label="Religion" value={formatStatus(employee.identity.religion)} />
                  <DetailRow compact label="Birth place" value={employee.identity.birth_place} />
                  <DetailRow compact label="Birth date" value={formatDate(employee.identity.birth_date)} />
                  <DetailRow compact label="Marital status" value={formatStatus(employee.identity.marital_status)} />
                  <DetailRow compact label="NIK" value={employee.identity.nik} />
                  <DetailRow compact label="NPWP" value={employee.identity.npwp} />
                  <DetailRow compact label="Bank account" value={employee.identity.bank_account_number} />
                  <DetailRow compact label="BPJS" value={employee.identity.bpjs_number} />
                </dl>
              </section>
            ) : null}

            <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
              <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
                Offboarding
              </h2>
              <dl>
                <DetailRow compact label="Resignation date" value={formatDate(employee.offboarding.resignation_date)} />
                <DetailRow compact label="Last working date" value={formatDate(employee.offboarding.last_working_date)} />
                <DetailRow compact label="Notes" value={employee.offboarding.notes} />
              </dl>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function DetailRow({ label, value, compact = false }) {
  return (
    <div className="grid min-w-0 gap-1 border-b border-[var(--mws-line)] py-3 last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)]">
      <dt className="text-sm font-medium text-[var(--mws-muted)]">{label}</dt>
      <dd className={compact ? 'break-words text-sm text-[var(--mws-charcoal)]' : 'break-words text-sm font-medium text-[var(--mws-charcoal)]'}>
        {value || '-'}
      </dd>
    </div>
  )
}

function ContactRow({ icon: Icon, value }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--mws-line)] px-3 py-2">
      <Icon size={16} className="text-[var(--mws-burgundy)]" />
      <span className="min-w-0 truncate text-[var(--mws-charcoal)]">{value}</span>
    </div>
  )
}
