import { ArrowLeft, Camera, CalendarClock, Edit, Mail, Phone, Trash2, UserRound, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
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
import { unitsApi } from '../../master-data/api/masterDataApi.js'
import { formatDate, formatEducationLevel, formatStatus, getContractExpiryFlag, statusTone } from '../../../lib/format.js'
import { showErrorToast, showSuccessToast } from '../../../lib/toast.js'
import { DetailRow } from '../components/DetailRow.jsx'
import { ContactRow } from '../components/ContactRow.jsx'
import { EmployeeMutationHistoryPanel } from '../components/EmployeeMutationHistoryPanel.jsx'
import { EmployeeTeachingAssignmentsPanel } from '../components/EmployeeTeachingAssignmentsPanel.jsx'
import { ExtendContractDialog } from '../components/ExtendContractDialog.jsx'

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

  const employeeQuery = useQuery({
    queryKey: ['employees', employeeId],
    queryFn: () => employeesApi.get(employeeId),
    enabled: Boolean(employeeId),
  })

  // Only needed to resolve the DB Admin's own unit name so it can be
  // compared against employee.employment.unit (a name, not an id) - reads
  // can be unrestricted (can_view_all_units), but update() still 403s
  // outside the admin's own unit.
  const myUnitQuery = useQuery({
    queryKey: ['units', user?.unit_id],
    queryFn: () => unitsApi.get(user.unit_id),
    enabled: user?.role === 'DATABASE_ADMIN' && Boolean(user?.unit_id),
  })

  const deleteMutation = useMutation({
    mutationFn: () => employeesApi.remove(employeeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
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

  function handlePhotoFileChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) setCropFile(file)
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
  const canWriteBase =
    user?.role === 'SUPER_ADMIN' ||
    (user?.role === 'DATABASE_ADMIN' && Boolean(user?.can_write_data))
  const canWrite =
    canWriteBase &&
    (user?.role === 'SUPER_ADMIN' ||
      employee?.employment?.unit === myUnitQuery.data?.name)
  const canDelete = user?.role === 'SUPER_ADMIN'
  // photo_url/gender/etc only appear on the detail response, gated by
  // can_view_employee_pii server-side (see EmployeeService.get) - mirrors
  // that same gate here since photo write requires it unconditionally too.
  const canManagePhoto = canWrite && employee && 'gender' in employee.identity
  const canExtendContract =
    canWrite &&
    employee &&
    employee.status_info.employment_type !== 'PERMANENT' &&
    employee.status_info.status !== 'RESIGNED'

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
        <div className="min-w-0 space-y-5">
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
          <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
            <div className="flex items-center gap-4 border-b border-[var(--mws-line)] p-5">
              <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
                {employee.identity.photo_url ? (
                  <button
                    type="button"
                    onClick={() => setIsPhotoPreviewOpen(true)}
                    className="h-14 w-14 shrink-0 rounded-full"
                    aria-label="View full-size photo"
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
                      className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-[var(--mws-burgundy)] text-white shadow-sm hover:bg-[var(--mws-burgundy-dark)] disabled:opacity-60"
                      aria-label="Change photo"
                    >
                      <Camera size={12} />
                    </button>
                    {employee.identity.photo_url ? (
                      <button
                        type="button"
                        onClick={handleRemovePhoto}
                        disabled={removePhotoMutation.isPending}
                        className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-[var(--mws-rose)] text-white shadow-sm hover:bg-[#9f3d41] disabled:opacity-60"
                        aria-label="Remove photo"
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
                <h2 className="truncate text-lg font-semibold text-[var(--mws-charcoal)]">
                  {employee.identity.full_name}
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
                          ? 'text-[var(--mws-burgundy)]'
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
                  <DetailRow compact label="BPJS Kesehatan" value={employee.identity.bpjs_number} />
                  <DetailRow compact label="BPJS Ketenagakerjaan" value={employee.identity.bpjs_employment_number} />
                </dl>
              </section>
            ) : null}

            {'gender' in employee.identity ? (
              <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
                <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
                  Education
                </h2>
                <dl>
                  <DetailRow compact label="Education level" value={formatEducationLevel(employee.identity.education_level)} />
                  <DetailRow compact label="Institution" value={employee.identity.institution_name} />
                  <DetailRow compact label="Major" value={employee.identity.major} />
                  <DetailRow compact label="Graduation year" value={employee.identity.graduation_year} />
                </dl>
              </section>
            ) : null}

            <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
              <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
                Offboarding
              </h2>
              <dl>
                <DetailRow compact label="Last working date" value={formatDate(employee.offboarding.last_working_date)} />
                <DetailRow compact label="Notes" value={employee.offboarding.notes} />
              </dl>
            </section>
          </div>
        </div>
        <EmployeeMutationHistoryPanel employeeId={employeeId} canWrite={canWrite} />
        <EmployeeTeachingAssignmentsPanel employeeId={employeeId} />
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


