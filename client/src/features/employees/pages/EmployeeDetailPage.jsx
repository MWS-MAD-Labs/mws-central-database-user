import { ArrowLeft, Camera, CalendarClock, Edit, Eye, EyeOff, Mail, Phone, Trash2, UserRound, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { useConfirm } from '../../../components/ui/useConfirm.js'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { PhotoCropDialog } from '../../../components/photo/PhotoCropDialog.jsx'
import { PhotoLightbox } from '../../../components/photo/PhotoLightbox.jsx'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { employeesApi } from '../api/employeesApi.js'
import { formatDate, formatEducationLevel, formatStatus, formatTenure, getBirthDateWarning, getContractExpiryFlag, getEmployeeFlagBadges, getFarFutureDateWarning, statusTone } from '../../../lib/format.js'
import { FlagBadgeList } from '../../../components/ui/FlagBadgeList.jsx'
import { MAX_PHOTO_SIZE_BYTES, validateFileSize } from '../../../lib/fileSize.js'
import { showErrorToast, showSuccessToast } from '../../../lib/toast.js'
import { DetailRow } from '../components/DetailRow.jsx'
import { ContactRow } from '../components/ContactRow.jsx'
import { EmployeeMutationHistoryPanel } from '../components/EmployeeMutationHistoryPanel.jsx'
import { EmployeeDisciplinaryActionsPanel } from '../components/EmployeeDisciplinaryActionsPanel.jsx'
import { EmployeeTeachingAssignmentsPanel } from '../components/EmployeeTeachingAssignmentsPanel.jsx'
import { EmployeeSupportAssignmentsPanel } from '../components/EmployeeSupportAssignmentsPanel.jsx'
import { EmployeePcActivityMentorshipsPanel } from '../components/EmployeePcActivityMentorshipsPanel.jsx'
import { ExtendContractDialog } from '../components/ExtendContractDialog.jsx'
import { forgetReveal, hasRecentReveal, rememberReveal } from '../../../lib/piiRevealMemory.js'
import {
  canManageEmployeeDisciplinaryData,
  canViewEmployeeDisciplinaryData,
  canWriteInUnit,
  editBlockedReason,
} from '../../../lib/capabilities.js'

const employeePiiScope = (employeeId) => `employee:${employeeId}`

export function EmployeeDetailPage() {
  const { employeeId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const confirm = useConfirm()
  const photoInputRef = useRef(null)
  const [isPhotoPreviewOpen, setIsPhotoPreviewOpen] = useState(false)
  const [cropFile, setCropFile] = useState(null)
  const [isExtendDialogOpen, setIsExtendDialogOpen] = useState(false)
  const [sensitiveFieldsRevealed, setSensitiveFieldsRevealed] = useState(
    () => Boolean(employeeId) && hasRecentReveal(employeePiiScope(employeeId)),
  )
  const [pii, setPii] = useState(null)

  const employeeQuery = useQuery({
    queryKey: ['employees', employeeId],
    queryFn: () => employeesApi.get(employeeId),
    enabled: Boolean(employeeId),
  })

  const deleteMutation = useMutation({
    mutationFn: () => employeesApi.remove(employeeId),
    onSuccess: () => {
      // Only invalidate the LIST query (key shape ['employees', {filters}])
      // - invalidating the bare ['employees'] prefix also matches every
      // still-mounted detail-scoped query (['employees', employeeId, ...],
      // used by this page and its panels), forcing them to refetch the
      // just-archived record before navigation unmounts them, which 404s
      // and surfaces as a stray "Employee not found" toast.
      queryClient.invalidateQueries({
        queryKey: ['employees'],
        predicate: (query) =>
          typeof query.queryKey[1] === 'object' && query.queryKey[1] !== null,
      })
      navigate('/employees?is_deleted=true', { replace: true })
    },
  })

  const uploadPhotoMutation = useMutation({
    mutationFn: (file) => employeesApi.uploadPhoto(employeeId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees', employeeId] })
      showSuccessToast('Photo updated.')
    },
    onError: (error) => showErrorToast(error, 'Photo upload failed.'),
  })

  const removePhotoMutation = useMutation({
    mutationFn: () => employeesApi.removePhoto(employeeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees', employeeId] })
      showSuccessToast('Photo removed.')
    },
    onError: (error) => showErrorToast(error, 'Photo removal failed.'),
  })

  const extendContractMutation = useMutation({
    mutationFn: (contractEndDate) =>
      employeesApi.extendContract(employeeId, contractEndDate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees', employeeId] })
      setIsExtendDialogOpen(false)
      showSuccessToast('Contract extended.')
    },
    onError: (error) => showErrorToast(error, 'Could not extend contract.'),
  })

  const revealSensitiveFieldsMutation = useMutation({
    mutationFn: () => employeesApi.recordSensitiveFieldsAccess(employeeId),
    onSuccess: (revealed) => {
      rememberReveal(employeePiiScope(employeeId))
      setPii(revealed)
      setSensitiveFieldsRevealed(true)
    },
    onError: (error) => showErrorToast(error, 'Could not reveal sensitive fields.'),
  })

  function handlePhotoFileChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const sizeError = validateFileSize(file, MAX_PHOTO_SIZE_BYTES)
    if (sizeError) {
      showErrorToast(sizeError)
      return
    }
    setCropFile(file)
  }

  function handleCropped(blob) {
    setCropFile(null)
    uploadPhotoMutation.mutate(blob)
  }

  async function handleRemovePhoto() {
    const confirmed = await confirm({
      title: 'Remove photo',
      description: "Remove this employee's photo?",
      confirmLabel: 'Remove',
      tone: 'danger',
    })
    if (confirmed) {
      removePhotoMutation.mutate()
    }
  }

  const employee = employeeQuery.data
  const contractFlag = employee ? getContractExpiryFlag(employee) : null
  const flagBadges = employee ? getEmployeeFlagBadges(employee) : []
  const birthDateWarning = employee
    ? getBirthDateWarning(pii?.birth_date)
    : null
  const joinDateWarning = employee
    ? getFarFutureDateWarning(employee.employment.join_date)
    : null
  const contractEndDateWarning = employee
    ? contractFlag === 'missing'
      ? 'No contract end date on file. Edit this employee to set one.'
      : getFarFutureDateWarning(employee.status_info.contract_end_date)
    : null
  const canWriteBase =
    user?.role === 'SUPER_ADMIN' ||
    (user?.role === 'DATABASE_ADMIN' && Boolean(user?.can_write_employee_data))
  const canWrite =
    canWriteBase &&
    (user?.role === 'SUPER_ADMIN' ||
      canWriteInUnit(user, employee?.employment?.unit_id, 'employee'))
  const editBlockedText = employee
    ? editBlockedReason(user, {
        hasWriteFlag: Boolean(user?.can_write_employee_data),
        sameUnit: canWriteInUnit(user, employee.employment?.unit_id, 'employee'),
      })
    : null
  const canDelete = user?.role === 'SUPER_ADMIN'
  const canViewDisciplinary = canViewEmployeeDisciplinaryData(user)
  const canManageDisciplinary = canManageEmployeeDisciplinaryData(user, employee)
  const canManagePhoto = canWrite && employee && employee.identity.can_view_pii
  const canExtendContract =
    canWrite &&
    employee &&
    employee.status_info.employment_type !== 'PERMANENT' &&
    employee.status_info.status !== 'RESIGNED'
  const isSelfView = Boolean(employee?.identity?.is_self)
  const isSensitiveFieldsRevealed = Boolean(pii) && (sensitiveFieldsRevealed || isSelfView)

  // Values are never kept past the page, so a remembered reveal (or a self
  // view) fetches them again. The server dedupes the audit entry.
  const { mutate: fetchPii } = revealSensitiveFieldsMutation
  const hasRequestedPiiRef = useRef(false)
  const piiAllowed = Boolean(employee?.identity?.can_view_pii)
  useEffect(() => {
    if (!piiAllowed || pii || hasRequestedPiiRef.current) return
    if (!isSelfView && !sensitiveFieldsRevealed) return
    hasRequestedPiiRef.current = true
    fetchPii()
  }, [piiAllowed, pii, isSelfView, sensitiveFieldsRevealed, fetchPii])

  async function handleDelete() {
    const confirmed = await confirm({
      title: 'Archive employee',
      description: 'Archive this employee? You can restore it from the trash bin.',
      confirmLabel: 'Archive',
      tone: 'danger',
    })
    if (confirmed) {
      deleteMutation.mutate()
    }
  }

  async function handleRevealSensitiveFields() {
    const confirmed = await confirm({
      title: 'View sensitive fields',
      description: `View ${employee?.identity?.full_name || 'this employee'}'s gender, religion, birth details, and PII (NIK/NPWP/bank account/BPJS)? This access is logged.`,
      confirmLabel: 'View',
    })
    if (confirmed) {
      revealSensitiveFieldsMutation.mutate()
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
            {canWrite && !editBlockedText ? (
              <Button asChild variant="secondary">
                <Link to={`/employees/${employeeId}/edit`}>
                  <Edit size={16} />
                  Edit
                </Link>
              </Button>
            ) : employee && editBlockedText ? (
              <Button type="button" variant="secondary" disabled title={editBlockedText}>
                <Edit size={16} />
                Edit
              </Button>
            ) : null}
            {canExtendContract ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setIsExtendDialogOpen(true)}
              >
                <CalendarClock size={16} />
                Extend contract
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
        <div className="min-w-0 space-y-5">
          <section className="min-w-0 overflow-hidden rounded-2xl border border-(--mws-line) bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
            <div className="flex items-center gap-4 border-b border-(--mws-line) p-5">
              <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
                {employee.identity.photo_url ? (
                  <button
                    type="button"
                    onClick={() => setIsPhotoPreviewOpen(true)}
                    className="h-14 w-14 shrink-0 rounded-full"
                    aria-label="View Full-Size Photo"
                  >
                    <img
                      src={employee.identity.photo_url}
                      alt={employee.identity.full_name}
                      className="h-14 w-14 rounded-full object-cover"
                    />
                  </button>
                ) : (
                  <UserRound size={24} />
                )}
                {canManagePhoto ? (
                  <>
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      disabled={uploadPhotoMutation.isPending}
                      className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-(--mws-burgundy) text-white shadow-sm hover:bg-(--mws-burgundy-dark) disabled:opacity-60"
                      aria-label="Change Photo"
                    >
                      <Camera size={12} />
                    </button>
                    {employee.identity.photo_url ? (
                      <button
                        type="button"
                        onClick={handleRemovePhoto}
                        disabled={removePhotoMutation.isPending}
                        className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-(--mws-rose) text-white shadow-sm hover:bg-[#9f3d41] disabled:opacity-60"
                        aria-label="Remove Photo"
                      >
                        <X size={10} />
                      </button>
                    ) : null}
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={handlePhotoFileChange}
                    />
                  </>
                ) : null}
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-(--mws-charcoal)">
                  {employee.identity.full_name}
                  <FlagBadgeList badges={flagBadges} />
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <StatusBadge tone={statusTone(employee.status_info.status)}>
                    {formatStatus(employee.status_info.status)}
                  </StatusBadge>
                  <StatusBadge
                    tone="neutral"
                    className={
                      contractFlag === 'expired'
                        ? 'text-[#9f3d41]'
                        : contractFlag === 'soon'
                          ? 'text-(--mws-burgundy)'
                          : undefined
                    }
                    title={
                      contractFlag === 'expired'
                        ? 'Contract expired'
                        : contractFlag === 'soon'
                          ? 'Contract ending soon'
                          : undefined
                    }
                  >
                    {formatStatus(employee.status_info.employment_type)}
                  </StatusBadge>
                </div>
              </div>
            </div>

            <dl className="p-5">
              <DetailRow label="Nick Name" value={employee.identity.nick_name} />
              <DetailRow label="Employee ID" value={employee.employment.employee_id} />
              <DetailRow label="Unit" value={employee.employment.unit} />
              <DetailRow label="Job Position" value={employee.employment.job_position} />
              <DetailRow label="Job Level" value={employee.employment.job_level} />
              <DetailRow
                label="PC Mentor Eligible"
                value={
                  employee.employment.is_pc_mentor_eligible
                    ? employee.employment.pc_mentor_units?.length
                      ? `Yes (${employee.employment.pc_mentor_units.map((unit) => unit.name).join(', ')})`
                      : 'Yes (own unit only)'
                    : 'No'
                }
              />
              <DetailRow label="Building" value={employee.employment.building} />
              <DetailRow
                label="Join Date"
                value={formatDate(employee.employment.join_date)}
                warning={joinDateWarning}
              />
              <DetailRow
                label="Days Worked"
                value={formatTenure(
                  employee.employment.join_date,
                  employee.status_info.last_working_date,
                )}
              />
              {employee.status_info.employment_type !== 'PERMANENT' ? (
                <DetailRow
                  label="Contract End Date"
                  value={formatDate(employee.status_info.contract_end_date)}
                  warning={contractEndDateWarning}
                />
              ) : null}
              <DetailRow label="Created At" value={formatDate(employee.created_at)} />
            </dl>
          </section>

          <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
            <h2 className="mb-3 text-xs font-display font-bold uppercase tracking-wide text-(--mws-muted)">
              Contact
            </h2>
            <div className="space-y-3 text-sm">
              <ContactRow icon={Mail} value={employee.identity.email} />
              <ContactRow
                icon={Phone}
                value={employee.identity.mobile_phone || '-'}
              />
            </div>
            {'residential_address' in employee.identity ? (
              <dl className="mt-3 border-t border-(--mws-line) pt-1">
                <DetailRow
                  compact
                  label="Address"
                  value={employee.identity.residential_address}
                />
              </dl>
            ) : null}

            {employee.identity.can_view_pii ? (
              <>
                <h2 className="mb-3 mt-5 border-t border-(--mws-line) pt-5 text-xs font-display font-bold uppercase tracking-wide text-(--mws-muted)">
                  Education
                </h2>
                <dl>
                  <DetailRow compact label="Education Level" value={formatEducationLevel(employee.identity.education_level)} />
                  <DetailRow compact label="Institution" value={employee.identity.institution_name} />
                  <DetailRow compact label="Major" value={employee.identity.major} />
                  <DetailRow compact label="Graduation Year" value={employee.identity.graduation_year} />
                </dl>
              </>
            ) : null}
          </section>

        {employee.identity.can_view_pii ? (
          <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-(--mws-charcoal)">
                Sensitive Fields
              </h2>
              {sensitiveFieldsRevealed && !isSelfView ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    forgetReveal(employeePiiScope(employeeId))
                    setSensitiveFieldsRevealed(false)
                    setPii(null)
                    hasRequestedPiiRef.current = false
                  }}
                >
                  <EyeOff size={15} />
                  Hide
                </Button>
              ) : null}
            </div>

            {isSensitiveFieldsRevealed ? (
              <dl className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
                <DetailRow compact label="Gender" value={formatStatus(pii.gender)} />
                <DetailRow compact label="Religion" value={formatStatus(pii.religion)} />
                <DetailRow compact label="Birth Place" value={pii.birth_place} />
                <DetailRow compact label="Birth Date" value={formatDate(pii.birth_date)} warning={birthDateWarning} />
                <DetailRow compact label="Marital Status" value={formatStatus(pii.marital_status)} />
                <DetailRow compact label="NIK" value={pii.nik} />
                <DetailRow compact label="NPWP" value={pii.npwp} />
                <DetailRow compact label="Bank Account" value={pii.bank_account_number} />
                <DetailRow compact label="BPJS Kesehatan" value={pii.bpjs_number} />
                <DetailRow compact label="BPJS Ketenagakerjaan" value={pii.bpjs_employment_number} />
                <DetailRow compact label="KPJ Number" value={pii.kpj_number} />
              </dl>
            ) : (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <p className="text-sm text-(--mws-muted)">
                  Gender, religion, birth details, and PII (NIK/NPWP/bank account/BPJS) are hidden by default.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={revealSensitiveFieldsMutation.isPending}
                  onClick={handleRevealSensitiveFields}
                >
                  <Eye size={15} />
                  Show Sensitive Fields
                </Button>
              </div>
            )}
          </section>
        ) : null}

        <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <h2 className="mb-4 text-base font-semibold text-(--mws-charcoal)">
            Offboarding
          </h2>
          <dl className="grid gap-x-6 sm:grid-cols-2">
            <DetailRow compact label="Last Working Date" value={formatDate(employee.offboarding.last_working_date)} />
            <DetailRow compact label="Notes" value={employee.offboarding.notes} />
          </dl>
        </section>

        {canViewDisciplinary ? (
          <EmployeeDisciplinaryActionsPanel
            employeeId={employeeId}
            canManage={canManageDisciplinary}
          />
        ) : null}
        <EmployeeMutationHistoryPanel employeeId={employeeId} canWrite={canWrite} />
        <EmployeeTeachingAssignmentsPanel
          employeeId={employeeId}
          isTeachingRole={employee.employment.is_teaching_role}
        />
        <EmployeeSupportAssignmentsPanel
          employeeId={employeeId}
          isTeachingRole={employee.employment.is_teaching_role}
          canWrite={canWrite}
        />
        <EmployeePcActivityMentorshipsPanel
          employeeId={employeeId}
          isTeachingRole={employee.employment.is_teaching_role}
        />
        </div>
      ) : null}

      {isPhotoPreviewOpen && employee?.identity.photo_url ? (
        <PhotoLightbox
          photoUrl={employee.identity.photo_url}
          fullName={employee.identity.full_name}
          canManage={canManagePhoto}
          onClose={() => setIsPhotoPreviewOpen(false)}
          onRequestReplace={() => photoInputRef.current?.click()}
          onRemove={handleRemovePhoto}
          isReplacing={uploadPhotoMutation.isPending}
          isRemoving={removePhotoMutation.isPending}
        />
      ) : null}

      {cropFile ? (
        <PhotoCropDialog
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onCropped={handleCropped}
          isSaving={uploadPhotoMutation.isPending}
        />
      ) : null}

      {isExtendDialogOpen && employee ? (
        <ExtendContractDialog
          employee={employee}
          onClose={() => setIsExtendDialogOpen(false)}
          onConfirm={(contractEndDate) =>
            extendContractMutation.mutate(contractEndDate)
          }
          isSaving={extendContractMutation.isPending}
        />
      ) : null}
    </div>
  )
}
