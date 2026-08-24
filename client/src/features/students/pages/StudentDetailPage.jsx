import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Edit,
  GraduationCap,
  Mail,
  RefreshCw,
  Trash2,
  UserCheck,
  UserRound,
  UserX,
  X,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { EnrollmentHistoryPanel } from "../../academic/components/EnrollmentHistoryPanel.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { loadStudentFormOptions } from "../api/studentFormOptions.js";
import { enrollmentsApi } from "../../academic/api/academicApi.js";
import {
  studentsApi,
  studentEntryTypes,
  terminalStudentStatuses,
} from "../api/studentsApi.js";
import { SearchableSelect } from "../../../components/ui/FormControls.jsx";
import {
  StudentConsentPanel,
  StudentHealthPanel,
  StudentParentsPanel,
  StudentPcActivitiesPanel,
  StudentSupportAssignmentPanel,
  StudentVaccinePanel,
} from "../components/StudentSensitivePanels.jsx";
import { StudentMutationHistoryPanel } from "../components/StudentMutationHistoryPanel.jsx";
import { formatDate, formatStatus, statusTone } from "../../../lib/format.js";
import { MAX_PHOTO_SIZE_BYTES, validateFileSize } from "../../../lib/fileSize.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { useRef, useState } from "react";
import { DetailRow } from "../components/DetailRow.jsx";
import { ServiceBadge } from "../components/ServiceBadge.jsx";
import { PhotoCropDialog } from "../../../components/photo/PhotoCropDialog.jsx";
import { PhotoLightbox } from "../../../components/photo/PhotoLightbox.jsx";
import { getClassName, getYearName } from "../format.js";

export function StudentDetailPage() {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const confirm = useConfirm();
  const photoInputRef = useRef(null);
  const [isReissueModalOpen, setIsReissueModalOpen] = useState(false);
  const [isPhotoPreviewOpen, setIsPhotoPreviewOpen] = useState(false);
  const [cropFile, setCropFile] = useState(null);
  // Starts blank on purpose - import defaults entry_type to PSB for legacy
  // rows whose real value was never confirmed, so this must be an explicit
  // admin choice each time, not silently reused from the stored value.
  const [reissueEntryType, setReissueEntryType] = useState("");

  const studentQuery = useQuery({
    queryKey: ["students", studentId],
    queryFn: () => studentsApi.get(studentId),
    enabled: Boolean(studentId),
  });

  const optionsQuery = useQuery({
    queryKey: ["student-form-options"],
    queryFn: loadStudentFormOptions,
  });

  // Same query key as EnrollmentHistoryPanel below, so this shares its cache
  // instead of firing a second request - just reads the most recent entry
  // for a quick "where did they last move" summary up top, full history
  // stays in that panel.
  const enrollmentHistoryQuery = useQuery({
    queryKey: ["students", studentId, "enrollments"],
    queryFn: () => enrollmentsApi.history(studentId),
    enabled: Boolean(studentId),
  });
  const latestPromotion = (enrollmentHistoryQuery.data || []).find(
    (enrollment) => enrollment.promoted_from_enrollment_id,
  );

  const deleteMutation = useMutation({
    mutationFn: () => studentsApi.remove(studentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["students"] });
      navigate("/students?is_deleted=true", { replace: true });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: () => studentsApi.deactivate(studentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["students", studentId] });
      showSuccessToast("Student deactivated.");
    },
    onError: (error) => showErrorToast(error, "Could not deactivate student."),
  });

  const reactivateMutation = useMutation({
    mutationFn: () => studentsApi.reactivate(studentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["students", studentId] });
      showSuccessToast("Student reactivated.");
    },
    onError: (error) => showErrorToast(error, "Could not reactivate student."),
  });

  const reissueNisMutation = useMutation({
    mutationFn: () => studentsApi.reissueNis(studentId, reissueEntryType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["students", studentId] });
    },
  });

  const uploadPhotoMutation = useMutation({
    mutationFn: (file) => studentsApi.uploadPhoto(studentId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["students", studentId] });
      showSuccessToast("Photo updated.");
    },
    onError: (error) => showErrorToast(error, "Photo upload failed."),
  });

  const removePhotoMutation = useMutation({
    mutationFn: () => studentsApi.removePhoto(studentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["students", studentId] });
      showSuccessToast("Photo removed.");
    },
    onError: (error) => showErrorToast(error, "Photo removal failed."),
  });

  function handlePhotoFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const sizeError = validateFileSize(file, MAX_PHOTO_SIZE_BYTES);
    if (sizeError) {
      showErrorToast(sizeError);
      return;
    }
    setCropFile(file);
    setIsPhotoPreviewOpen(false);
  }

  function handleCropped(blob) {
    setCropFile(null);
    uploadPhotoMutation.mutate(blob);
  }

  async function handleRemovePhoto() {
    const confirmed = await confirm({
      title: "Remove photo",
      description: "Remove this student's photo?",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (confirmed) {
      removePhotoMutation.mutate();
    }
  }

  const student = studentQuery.data;
  const className = getClassName(
    optionsQuery.data?.classes || [],
    student?.academic?.current_class_id,
  );
  const joinYearName = getYearName(
    optionsQuery.data?.academicYears || [],
    student?.academic?.join_academic_year_id,
  );
  // Mirrors student-service.ts's update() and the parents/consent/health/
  // vaccine/pc-activity services' assertWriteAllowed() - all of them now
  // require can_write_student_data AND the student's current grade to be in
  // the DB Admin's own unit (assertStudentInAdminUnit).
  const studentGrade = (optionsQuery.data?.grades || []).find(
    (grade) => grade.name === student?.academic?.current_grade,
  );
  const canWrite =
    (user?.role === "SUPER_ADMIN" ||
      (user?.role === "DATABASE_ADMIN" &&
        Boolean(user?.can_write_student_data))) &&
    (user?.role === "SUPER_ADMIN" || studentGrade?.unit_id === user?.unit_id);
  const canDelete = user?.role === "SUPER_ADMIN";
  // Mirrors sensitive-data.ts's canViewSensitiveData() - health record,
  // health notes, vaccine records, and consent attachments all reject
  // anyone who fails this check, regardless of write access.
  const canViewSensitive =
    user?.role === "SUPER_ADMIN" || Boolean(user?.can_view_sensitive_data);
  // Mirrors student-photo-service.ts's assertWriteAllowed - photo sits at
  // the same permission tier as the rest of the "detail" response (birth
  // date, health), so writing one needs both grants, not just can_write_student_data.
  const canManagePhoto = canWrite && canViewSensitive;

  async function handleDelete() {
    const confirmed = await confirm({
      title: "Archive student",
      description:
        "Archive this student? You can restore it from the trash bin.",
      confirmLabel: "Archive",
      tone: "danger",
    });
    if (confirmed) {
      deleteMutation.mutate();
    }
  }

  async function handleDeactivate() {
    const confirmed = await confirm({
      title: "Deactivate student",
      description:
        "Deactivate this student? Their class enrollment stays exactly as it is - this only flags them as inactive.",
      confirmLabel: "Deactivate",
      tone: "danger",
    });
    if (confirmed) {
      deactivateMutation.mutate();
    }
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title={student?.identity?.full_name || "Student Detail"}
        description={
          student
            ? `${student.academic.nis || "No NIS yet"} / ${student.academic.current_grade}`
            : "Student identity and academic record."
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
            {/* One button, not two - which one shows depends on current
                status, and it stays visible (just disabled) rather than
                disappearing when neither applies, so the action bar
                doesn't jump around as status changes. */}
            {canWrite && student?.status === "INACTIVE" ? (
              <Button
                type="button"
                variant="secondary"
                disabled={reactivateMutation.isPending}
                onClick={() => reactivateMutation.mutate()}
              >
                <UserCheck size={16} />
                Reactivate
              </Button>
            ) : canWrite ? (
              <Button
                type="button"
                variant="secondary"
                disabled={
                  student?.status !== "ACTIVE" || deactivateMutation.isPending
                }
                title={
                  student?.status !== "ACTIVE"
                    ? "Only an Active student can be deactivated."
                    : undefined
                }
                onClick={handleDeactivate}
              >
                <UserX size={16} />
                Deactivate
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
          {student.academic.next_unenrolled_academic_year ? (
            <div className="flex items-start gap-3 rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <span>
                {student.academic.has_class_history ||
                student.academic.has_active_enrollment_history ||
                student.academic.has_completed_enrollment
                  ? "This student is missing their next expected enrollment - "
                  : "This student has never been enrolled into a class - "}
                no record yet for{" "}
                <strong>
                  {student.academic.next_unenrolled_academic_year.name}
                </strong>
                . Backfill it from the class's Enrollment dialog if this is
                historical data, or confirm whether retention/skip-grade
                changes what's actually expected next.
              </span>
            </div>
          ) : null}

          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
            <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
              <div className="flex items-center gap-4 border-b border-[var(--mws-line)] p-5">
                <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
                  {student.identity.photo_url ? (
                    <button
                      type="button"
                      onClick={() => setIsPhotoPreviewOpen(true)}
                      className="h-14 w-14 shrink-0 rounded-full"
                      aria-label="View Full-Size Photo"
                    >
                      <img
                        src={student.identity.photo_url}
                        alt={student.identity.full_name}
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
                        aria-label="Change Photo"
                      >
                        <Camera size={12} />
                      </button>
                      {student.identity.photo_url ? (
                        <button
                          type="button"
                          onClick={handleRemovePhoto}
                          disabled={removePhotoMutation.isPending}
                          className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-[var(--mws-rose)] text-white shadow-sm hover:bg-[#9f3d41] disabled:opacity-60"
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
                    {terminalStudentStatuses.includes(student.status) &&
                    !student.academic.has_class_history ? (
                      <StatusBadge
                        tone="amber"
                        title="No class enrollment was ever recorded for this student - review their data."
                      >
                        No class history
                      </StatusBadge>
                    ) : null}
                  </div>
                </div>
              </div>

              <dl className="p-5">
                <DetailRow
                  label="Nick Name"
                  value={student.identity.nick_name}
                />
                <DetailRow label="Email" value={student.identity.email} />
                <DetailRow
                  label="NIS"
                  value={
                    student.academic.nis || (
                      <span className="flex items-center gap-2">
                        <span className="text-[var(--mws-muted)]">
                          Not yet assigned
                        </span>
                        {canDelete ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={reissueNisMutation.isPending}
                            onClick={() => {
                              setReissueEntryType("");
                              setIsReissueModalOpen(true);
                            }}
                          >
                            <RefreshCw size={14} />
                            Reissue NIS
                          </Button>
                        ) : null}
                      </span>
                    )
                  }
                />
                {student.academic.legacy_nis ? (
                  <DetailRow
                    label="Legacy NIS"
                    value={student.academic.legacy_nis}
                  />
                ) : null}
                <DetailRow label="NISN" value={student.academic.nisn} />
                <DetailRow
                  label="Current Grade"
                  value={student.academic.current_grade}
                />
                <DetailRow label="Current Class" value={className} />
                {latestPromotion ? (
                  <DetailRow
                    label="Last Promoted"
                    value={`${latestPromotion.grade_level} - ${latestPromotion.class.name} (${latestPromotion.academic_year.name}), ${formatDate(latestPromotion.start_date)}${latestPromotion.is_retention ? " - retention" : ""}`}
                  />
                ) : null}
                <DetailRow label="Join Academic Year" value={joinYearName} />
                <DetailRow
                  label="Join Grade"
                  value={student.academic.join_grade}
                />
                <DetailRow
                  label="Entry Type"
                  value={
                    student.academic.entry_type === "PSB"
                      ? "PSB"
                      : formatStatus(student.academic.entry_type)
                  }
                />
                <DetailRow
                  label="Previous School"
                  value={student.academic.previous_school}
                />
                <DetailRow
                  label="Created At"
                  value={formatDate(student.created_at)}
                />
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

              {"gender" in student.identity ? (
                <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
                  <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
                    Profile Details
                  </h2>
                  <dl>
                    <DetailRow
                      compact
                      label="Gender"
                      value={formatStatus(student.identity.gender)}
                    />
                    <DetailRow
                      compact
                      label="Religion"
                      value={formatStatus(student.identity.religion)}
                    />
                    <DetailRow
                      compact
                      label="Birth Place"
                      value={student.identity.birth_place}
                    />
                    <DetailRow
                      compact
                      label="Birth Date"
                      value={formatDate(student.identity.birth_date)}
                    />
                    <DetailRow
                      compact
                      label="Graduation Grade"
                      value={student.academic.graduation_grade}
                    />
                    <DetailRow
                      compact
                      label="Leave Year"
                      value={student.academic.leave_year}
                    />
                    <DetailRow compact label="SN" value={student.academic.sn} />
                  </dl>
                </section>
              ) : null}

              {"pickup_drop_service" in student.academic ? (
                <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
                  <div className="mb-4 flex items-center gap-3">
                    <GraduationCap
                      size={18}
                      className="text-[var(--mws-burgundy)]"
                    />
                    <h2 className="text-base font-semibold text-[var(--mws-charcoal)]">
                      Services
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ServiceBadge
                      label="Pickup/Drop"
                      active={student.academic.pickup_drop_service}
                    />
                    <ServiceBadge
                      label="Catering"
                      active={student.academic.catering_service}
                    />
                    <ServiceBadge
                      label="PSB Guide"
                      active={student.academic.psb_guide}
                    />
                  </div>
                </section>
              ) : null}
            </div>
          </div>
          <EnrollmentHistoryPanel studentId={studentId} />
          <StudentMutationHistoryPanel studentId={studentId} canWrite={canWrite} />
          {/* phone/email/address are gated by can_view_sensitive_data on
              both read (toParentGuardianResponse) and write (parent-
              guardian-service.ts) - fold it into the write gate here. */}
          <StudentParentsPanel
            studentId={studentId}
            canWrite={canWrite && canViewSensitive}
          />
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <StudentConsentPanel
              studentId={studentId}
              canWrite={canWrite}
              canViewSensitive={canViewSensitive}
            />
            <StudentHealthPanel
              studentId={studentId}
              canWrite={canWrite}
              canViewSensitive={canViewSensitive}
            />
          </div>
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <StudentVaccinePanel
              studentId={studentId}
              canWrite={canWrite}
              canViewSensitive={canViewSensitive}
            />
            <StudentPcActivitiesPanel
              studentId={studentId}
              canWrite={canWrite}
            />
          </div>
          <StudentSupportAssignmentPanel
            studentId={studentId}
            studentUnitName={studentGrade?.unit_name}
            canWrite={canWrite && user?.role === "SUPER_ADMIN"}
          />
        </div>
      ) : null}
      {isReissueModalOpen && (
        <CrudDialog
          title="Reissue NIS"
          description="This action will generate a permanent NIS based on the student's current academic data."
          isOpen={isReissueModalOpen}
          onClose={() => setIsReissueModalOpen(false)}
        >
          <div className="space-y-4">
            <div className="space-y-3 rounded-lg bg-[var(--mws-soft)] p-4 text-sm text-[var(--mws-charcoal)]">
              <p>
                Please ensure the following data is correct before proceeding:
              </p>
              <ul className="list-inside list-disc font-medium text-[var(--mws-muted)]">
                <li>
                  Join Grade:{" "}
                  <span className="text-[var(--mws-charcoal)]">
                    {student?.academic?.join_grade}
                  </span>
                </li>
                <li>
                  Join Year:{" "}
                  <span className="text-[var(--mws-charcoal)]">
                    {joinYearName}
                  </span>
                </li>
              </ul>
              <p className="font-semibold text-red-600">
                Warning: The NIS cannot be changed once generated.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--mws-charcoal)]">
                Confirm Entry Type
              </label>
              <SearchableSelect
                required
                value={reissueEntryType}
                onChange={setReissueEntryType}
                options={studentEntryTypes.map((option) => ({
                  value: option,
                  label: option,
                }))}
                placeholder="Select Entry Type"
                searchPlaceholder="Search Entry Type"
              />
              <p className="text-xs text-[var(--mws-muted)]">
                Import defaults legacy rows to PSB whether or not that's correct
                - pick the real value before generating a permanent NIS.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                disabled={reissueNisMutation.isPending}
                onClick={() => setIsReissueModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={reissueNisMutation.isPending || !reissueEntryType}
                onClick={() => {
                  reissueNisMutation.mutate(undefined, {
                    onSuccess: () => setIsReissueModalOpen(false),
                  });
                }}
              >
                <RefreshCw
                  size={14}
                  className={reissueNisMutation.isPending ? "animate-spin" : ""}
                />
                {reissueNisMutation.isPending
                  ? "Generating..."
                  : "Generate NIS"}
              </Button>
            </div>
          </div>
        </CrudDialog>
      )}

      {isPhotoPreviewOpen && student?.identity.photo_url ? (
        <PhotoLightbox
          photoUrl={student.identity.photo_url}
          fullName={student.identity.full_name}
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
    </div>
  );
}
