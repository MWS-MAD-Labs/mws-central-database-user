import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Edit,
  GraduationCap,
  Mail,
  Trash2,
  UserRound,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { EnrollmentHistoryPanel } from '../../academic/components/EnrollmentHistoryPanel.jsx'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { loadStudentFormOptions } from '../api/studentFormOptions.js'
import { studentsApi } from '../api/studentsApi.js'
import {
  StudentConsentPanel,
  StudentHealthPanel,
  StudentParentsPanel,
  StudentPcActivitiesPanel,
  StudentVaccinePanel,
} from '../components/StudentSensitivePanels.jsx'
import { formatDate, formatStatus, statusTone } from '../../../lib/format.js'

export function StudentDetailPage() {
  const { studentId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const studentQuery = useQuery({
    queryKey: ['students', studentId],
    queryFn: () => studentsApi.get(studentId),
    enabled: Boolean(studentId),
  })

  const optionsQuery = useQuery({
    queryKey: ['student-form-options'],
    queryFn: loadStudentFormOptions,
  })

  const deleteMutation = useMutation({
    mutationFn: () => studentsApi.remove(studentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] })
      navigate('/students?is_deleted=true', { replace: true })
    },
  })

  const student = studentQuery.data
  const className = getClassName(
    optionsQuery.data?.classes || [],
    student?.academic?.current_class_id,
  )
  const joinYearName = getYearName(
    optionsQuery.data?.academicYears || [],
    student?.academic?.join_academic_year_id,
  )
  const canWrite = user?.type === 'admin' && user?.role !== 'VIEWER'
  const canDelete = user?.role === 'SUPER_ADMIN'

  function handleDelete() {
    const confirmed = window.confirm(
      'Archive this student? You can restore it from the trash bin.',
    )
    if (confirmed) {
      deleteMutation.mutate()
    }
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title={student?.identity?.full_name || 'Student Detail'}
        description={
          student
            ? `${student.academic.nis} / ${student.academic.current_grade}`
            : 'Student identity and academic record.'
        }
        actions={
          <>
            <Button asChild variant="secondary">
              <Link to="/students">
                <ArrowLeft size={16} />
                Back
              </Link>
            </Button>
            {canWrite ? (
              <Button asChild variant="secondary">
                <Link to={`/students/${studentId}/edit`}>
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

      {studentQuery.isLoading ? (
        <PanelMessage>Loading student...</PanelMessage>
      ) : studentQuery.isError ? (
        <PanelMessage>Student data is unavailable.</PanelMessage>
      ) : student ? (
        <div className="min-w-0 space-y-5">
          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
            <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
              <div className="flex items-center gap-4 border-b border-[var(--mws-line)] p-5">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
                  <UserRound size={24} />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold text-[var(--mws-charcoal)]">
                    {student.identity.full_name}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusBadge tone={statusTone(student.status)}>
                      {formatStatus(student.status)}
                    </StatusBadge>
                    <StatusBadge tone="neutral">
                      {student.academic.current_grade}
                    </StatusBadge>
                  </div>
                </div>
              </div>

              <dl className="p-5">
                <DetailRow label="Nick name" value={student.identity.nick_name} />
                <DetailRow label="Email" value={student.identity.email} />
                <DetailRow label="NIS" value={student.academic.nis} />
                <DetailRow label="NISN" value={student.academic.nisn} />
                <DetailRow label="Current grade" value={student.academic.current_grade} />
                <DetailRow label="Current class" value={className} />
                <DetailRow label="Join academic year" value={joinYearName} />
                <DetailRow label="Join grade" value={student.academic.join_grade} />
                <DetailRow label="Previous school" value={student.academic.previous_school} />
                <DetailRow label="Created at" value={formatDate(student.created_at)} />
              </dl>
            </section>

            <div className="min-w-0 space-y-5">
              <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
                <div className="mb-4 flex items-center gap-3">
                  <Mail size={18} className="text-[var(--mws-burgundy)]" />
                  <h2 className="text-base font-semibold text-[var(--mws-charcoal)]">
                    Contact
                  </h2>
                </div>
                <p className="truncate rounded-xl border border-[var(--mws-line)] px-3 py-2 text-sm text-[var(--mws-charcoal)]">
                  {student.identity.email}
                </p>
              </section>

              {'gender' in student.identity ? (
                <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
                  <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
                    Profile Details
                  </h2>
                  <dl>
                    <DetailRow compact label="Gender" value={formatStatus(student.identity.gender)} />
                    <DetailRow compact label="Religion" value={formatStatus(student.identity.religion)} />
                    <DetailRow compact label="Birth place" value={student.identity.birth_place} />
                    <DetailRow compact label="Birth date" value={formatDate(student.identity.birth_date)} />
                    <DetailRow compact label="Graduation grade" value={student.academic.graduation_grade} />
                    <DetailRow compact label="Leave year" value={student.academic.leave_year} />
                    <DetailRow compact label="SN" value={student.academic.sn} />
                  </dl>
                </section>
              ) : null}

              {'pickup_drop_service' in student.academic ? (
                <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
                  <div className="mb-4 flex items-center gap-3">
                    <GraduationCap size={18} className="text-[var(--mws-burgundy)]" />
                    <h2 className="text-base font-semibold text-[var(--mws-charcoal)]">
                      Services
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ServiceBadge
                      label="Pickup/drop"
                      active={student.academic.pickup_drop_service}
                    />
                    <ServiceBadge
                      label="Catering"
                      active={student.academic.catering_service}
                    />
                    <ServiceBadge
                      label="PSB guide"
                      active={student.academic.psb_guide}
                    />
                  </div>
                </section>
              ) : null}
            </div>
          </div>
          <EnrollmentHistoryPanel studentId={studentId} />
          <StudentParentsPanel studentId={studentId} canWrite={canWrite} />
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <StudentConsentPanel studentId={studentId} canWrite={canWrite} />
            <StudentHealthPanel studentId={studentId} canWrite={canWrite} />
          </div>
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <StudentVaccinePanel studentId={studentId} canWrite={canWrite} />
            <StudentPcActivitiesPanel studentId={studentId} canWrite={canWrite} />
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

function ServiceBadge({ label, active }) {
  return (
    <StatusBadge tone={active ? 'green' : 'neutral'}>
      {label}: {active ? 'Yes' : 'No'}
    </StatusBadge>
  )
}

function getClassName(classes, classId) {
  if (!classId) return '-'
  return classes.find((klass) => klass.id === classId)?.name || classId
}

function getYearName(years, yearId) {
  if (!yearId) return '-'
  return years.find((year) => year.id === yearId)?.name || yearId
}
