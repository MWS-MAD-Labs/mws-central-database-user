import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Edit,
  Eye,
  EyeOff,
  FileSignature,
  HeartPulse,
  RefreshCw,
  Trash2,
  UserCheck,
  UserRound,
  UsersRound,
  UserX,
} from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { Tabs } from "../../../components/ui/Tabs.jsx";
import { EnrollmentHistoryPanel } from "../../academic/components/EnrollmentHistoryPanel.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { canWriteInUnit, editBlockedReason } from "../../../lib/capabilities.js";
import { loadStudentFormOptions } from "../api/studentFormOptions.js";
import { enrollmentsApi } from "../../academic/api/academicApi.js";
import {
  studentsApi,
  studentEntryTypes,
  terminalStudentStatuses,
} from "../api/studentsApi.js";
import { SearchableSelect } from "../../../components/ui/FormControls.jsx";
import { GoogleAccountRow } from "../../google/components/GoogleAccountRow.jsx";
import {
  StudentConsentPanel,
  StudentHealthPanel,
  StudentParentsPanel,
  StudentPcActivitiesPanel,
  StudentSpecialNeedsPanel,
  StudentSupportAssignmentPanel,
  StudentVaccinePanel,
} from "../components/StudentSensitivePanels.jsx";
import { StudentMutationHistoryPanel } from "../components/StudentMutationHistoryPanel.jsx";
import { SpecialNeedsEligibilityStatus } from "../constants/specialNeeds.js";
import {
  formatDate,
  formatStatus,
  getBirthDateWarning,
  IMPORT_DEFAULTED_FIELD_LABELS,
  statusTone,
  UNKNOWN_LEGACY_GRADE_NAME,
} from "../../../lib/format.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { useEffect, useState } from "react";
import { DetailRow } from "../components/DetailRow.jsx";
import { useStudentPiiReveal } from "../hooks/useStudentPiiReveal.js";
import { ServiceBadge } from "../components/ServiceBadge.jsx";
import { PhotoLightbox } from "../../../components/photo/PhotoLightbox.jsx";
import {
  decodeLegacyNisHints,
  formatEntryType,
  getClassName,
  getYearName,
  sortSuggestedFirst,
} from "../format.js";

function DefaultedValue({ fieldKey, defaultedFields, children }) {
  if (!defaultedFields?.includes(fieldKey)) return children;
  return (
    <span
      className="text-(--mws-gold)"
      title="Auto-filled placeholder from import. Update with the real value once known."
    >
      {children}
    </span>
  );
}

function GradeValue({ isDefaulted, overrideReason, children }) {
  if (!isDefaulted && !overrideReason) return children;

  const titles = [
    isDefaulted &&
      "Auto-filled placeholder from import. Update with the real value once known.",
    overrideReason &&
      `Grade consistency check overridden by a Super Admin: "${overrideReason}"`,
  ].filter(Boolean);

  return (
    <span
      className={isDefaulted ? "text-(--mws-gold)" : "text-[#1d4ed8]"}
      title={titles.join(" ")}
    >
      {children}
    </span>
  );
}

function HiddenValue({ loading = false }) {
  return (
    <span
      className="text-(--mws-muted)"
      title={loading ? "Loading" : "Hidden until you choose Show birth details"}
    >
      {loading ? "Loading..." : "••••••••"}
    </span>
  );
}

export function StudentDetailPage() {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isReissueModalOpen, setIsReissueModalOpen] = useState(false);
  const [isPhotoPreviewOpen, setIsPhotoPreviewOpen] = useState(false);
  const [reissueEntryType, setReissueEntryType] = useState("");
  const [reissueJoinGradeId, setReissueJoinGradeId] = useState("");
  const [reissueJoinAcademicYearId, setReissueJoinAcademicYearId] =
    useState("");

  const studentQuery = useQuery({
    queryKey: ["students", studentId],
    queryFn: () => studentsApi.get(studentId),
    enabled: Boolean(studentId),
  });

  const optionsQuery = useQuery({
    queryKey: ["student-form-options"],
    queryFn: loadStudentFormOptions,
  });

  const enrollmentHistoryQuery = useQuery({
    queryKey: ["students", studentId, "enrollments"],
    queryFn: () => enrollmentsApi.history(studentId),
    enabled: Boolean(studentId),
  });
  const latestPromotion = (enrollmentHistoryQuery.data || []).find(
    (enrollment) => enrollment.promoted_from_enrollment_id,
  );
  const earliestEnrollment = (enrollmentHistoryQuery.data || []).reduce(
    (earliest, enrollment) =>
      !earliest ||
      new Date(enrollment.academic_year.start_date) <
        new Date(earliest.academic_year.start_date)
        ? enrollment
        : earliest,
    null,
  );

  const deleteMutation = useMutation({
    mutationFn: () => studentsApi.remove(studentId),
    onSuccess: () => {
      // Only invalidate the LIST query (key shape ["students", {filters}])
      // - invalidating the bare ["students"] prefix also matches every
      // still-mounted detail-scoped query, forcing it to refetch the
      // just-archived record before navigation unmounts it, which 404s
      // and surfaces as a stray "Student not found" toast.
      queryClient.invalidateQueries({
        queryKey: ["students"],
        predicate: (query) =>
          typeof query.queryKey[1] === "object" && query.queryKey[1] !== null,
      });
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
    meta: { successMessage: "NIS reissued." },
    mutationFn: () =>
      studentsApi.reissueNis(studentId, reissueEntryType, {
        joinGradeId: reissueJoinGradeId,
        joinAcademicYearId: reissueJoinAcademicYearId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["students", studentId] });
    },
  });

  const student = studentQuery.data;
  const pii = useStudentPiiReveal(studentId, student?.identity?.full_name);
  const birthDateWarning = pii.data?.birth_date
    ? getBirthDateWarning(pii.data.birth_date)
    : null;
  const className = getClassName(
    optionsQuery.data?.classes || [],
    student?.academic?.current_class_id,
  );
  const joinYearName = getYearName(
    optionsQuery.data?.academicYears || [],
    student?.academic?.join_academic_year_id,
  );
  const studentGrade = (optionsQuery.data?.grades || []).find(
    (grade) => grade.name === student?.academic?.current_grade,
  );
  const canWrite =
    (user?.role === "SUPER_ADMIN" ||
      (user?.role === "DATABASE_ADMIN" &&
        Boolean(user?.can_write_student_data))) &&
    (user?.role === "SUPER_ADMIN" ||
      canWriteInUnit(user, studentGrade?.unit_id, "student"));
  const editBlockedText = student
    ? editBlockedReason(user, {
        hasWriteFlag: Boolean(user?.can_write_student_data),
        sameUnit: studentGrade
          ? canWriteInUnit(user, studentGrade.unit_id, "student")
          : true,
      })
    : null;
  const canDelete = user?.role === "SUPER_ADMIN";
  const canViewSensitive =
    user?.role === "SUPER_ADMIN" || Boolean(user?.can_view_sensitive_data);
  const effectiveCanWrite = canWrite && !editBlockedText;
  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "academic", label: "Academic" },
    { id: "family-consent", label: "Family & Consent" },
    ...(canViewSensitive
      ? [
          { id: "health", label: "Health" },
          { id: "special-education", label: "Special Education" },
        ]
      : []),
  ];
  const requestedTab = searchParams.get("tab") || "overview";
  const activeTab = tabs.some((tab) => tab.id === requestedTab)
    ? requestedTab
    : "overview";

  useEffect(() => {
    if (requestedTab === activeTab) return;
    const next = new URLSearchParams(searchParams);
    next.set("tab", activeTab);
    setSearchParams(next, { replace: true });
  }, [activeTab, requestedTab, searchParams, setSearchParams]);

  function changeTab(tab) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next);
  }

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
        "Deactivate this student? Their class enrollment stays as it is.",
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
            <Button asChild variant="secondary" size="icon" aria-label="Back" title="Back">
              <Link to="/students"><ArrowLeft size={16} /></Link>
            </Button>
            {canWrite && !editBlockedText ? (
              <Button asChild variant="secondary" size="icon" aria-label="Edit" title="Edit">
                <Link to={`/students/${studentId}/edit`}><Edit size={16} /></Link>
              </Button>
            ) : student && editBlockedText ? (
              <Button type="button" variant="secondary" disabled title={editBlockedText} size="icon" aria-label="Edit">
                <Edit size={16} />
              </Button>
            ) : null}
            {canWrite && student?.status === "INACTIVE" ? (
              <Button
                type="button"
                variant="secondary"
                loading={reactivateMutation.isPending}
                onClick={() => reactivateMutation.mutate()}
                size="icon" aria-label="Reactivate" title="Reactivate"
              >
                <UserCheck size={16} />
              </Button>
            ) : canWrite ? (
              <Button
                type="button"
                variant="secondary"
                disabled={
                  student?.status !== "ACTIVE"
                }
                loading={deactivateMutation.isPending}
                title={
                  student?.status !== "ACTIVE"
                    ? "Only an Active student can be deactivated."
                    : undefined
                }
                onClick={handleDeactivate}
                size="icon" aria-label="Deactivate"
              >
                <UserX size={16} />
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                type="button"
                variant="danger"
                loading={deleteMutation.isPending}
                onClick={handleDelete}
                size="icon" aria-label="Archive" title="Archive"
              >
                <Trash2 size={16} />
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
          <Tabs
            label="Student detail sections"
            tabs={tabs}
            active={activeTab}
            onChange={changeTab}
          />
          {activeTab === "overview" ? (
            <>
          {student.academic.import_defaulted_fields?.length ? (
            <div className="flex items-start gap-3 rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <span>
                Imported with placeholder data for{" "}
                <strong>
                  {student.academic.import_defaulted_fields
                    .map((key) => IMPORT_DEFAULTED_FIELD_LABELS[key] || key)
                    .join(", ")}
                </strong>
                . The sheet had nothing on file, so these were auto-filled.
                Update the real value once known. This notice clears itself
                once you do.
              </span>
            </div>
          ) : null}
          {student.academic.grade_consistency_override_reason ? (
            <div className="flex items-start gap-3 rounded-xl border border-[#c3d4ef] bg-[#eef3fb] px-4 py-3 text-sm text-(--mws-navy)">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <span>
                Grade mismatch approved by a Super Admin: "
                {student.academic.grade_consistency_override_reason}". Fix
                Current Grade or Join Grade if it's actually wrong. This
                clears itself once you do.
              </span>
            </div>
          ) : null}
          {student.academic.next_unenrolled_academic_year ? (
            <div className="flex items-start gap-3 rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <span>
                {student.academic.next_unenrolled_academic_year.id ===
                student.academic.join_academic_year_id ? (
                  student.academic.next_unenrolled_academic_year
                    .expected_grade?.name === UNKNOWN_LEGACY_GRADE_NAME ? (
                    <>
                      This student has never been enrolled into a class, but
                      their Join Grade was never recorded during import
                      (shown as <strong>Unknown (Legacy Import)</strong>),
                      so there's no real class to match against. Fix their{" "}
                      <strong>Join Grade</strong> to the correct historical
                      grade first, then backfill this enrollment from that
                      grade's class.{" "}
                      <Link
                        className="font-medium underline underline-offset-2"
                        to={`/students/${studentId}/edit`}
                      >
                        Edit student
                      </Link>
                    </>
                  ) : (
                    <>
                      This student has never been enrolled into a class. No
                      record yet for their own join year,{" "}
                      <strong>
                        {student.academic.next_unenrolled_academic_year.name}
                      </strong>
                      . Backfill it (Historical Data) from the matching
                      class's Enrollment dialog.{" "}
                      <Link
                        className="font-medium underline underline-offset-2"
                        to={`/academic?tab=classes&academic_year_id=${student.academic.next_unenrolled_academic_year.id}${
                          student.academic.next_unenrolled_academic_year
                            .expected_grade
                            ? `&grade_id=${student.academic.next_unenrolled_academic_year.expected_grade.id}`
                            : ""
                        }`}
                      >
                        View matching classes
                      </Link>
                    </>
                  )
                ) : (
                  <>
                    This student is missing their next expected enrollment.
                    No record yet for{" "}
                    <strong>
                      {student.academic.next_unenrolled_academic_year.name}
                    </strong>
                    . Backfill only covers a student's very first enrollment,
                    so use <strong>Promote</strong> from their current class
                    to carry them forward. Confirm whether retention/skip-grade
                    changes what's actually expected next.{" "}
                    {student.academic.current_class_id ? (
                      <Link
                        className="font-medium underline underline-offset-2"
                        to={`/academic/classes/${student.academic.current_class_id}`}
                      >
                        Go to {student.academic.current_class || "current class"}
                      </Link>
                    ) : (
                      "See Class History below."
                    )}
                  </>
                )}
              </span>
            </div>
          ) : null}

            <section className="min-w-0 overflow-hidden rounded-2xl border border-(--mws-line) bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
              <div className="flex items-center gap-4 border-b border-(--mws-line) p-5">
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
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold text-(--mws-charcoal)">
                    {student.identity.full_name}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusBadge tone={statusTone(student.status)}>
                      {formatStatus(student.status)}
                    </StatusBadge>
                    {student.academic.import_defaulted_fields?.includes(
                      "status",
                    ) ? (
                      <StatusBadge
                        tone="gold"
                        title="Status was blank on import and defaulted to this. Update once the real value is known."
                      >
                        Auto-Filled
                      </StatusBadge>
                    ) : null}
                    {student.academic.grade_consistency_override_reason ? (
                      <StatusBadge
                        tone="neutral"
                        title={`Grade consistency check overridden by a Super Admin: "${student.academic.grade_consistency_override_reason}"`}
                      >
                        Override
                      </StatusBadge>
                    ) : null}
                    <StatusBadge tone="neutral">
                      {student.academic.current_grade}
                    </StatusBadge>
                    {terminalStudentStatuses.includes(student.status) &&
                    !student.academic.has_class_history ? (
                      <StatusBadge
                        tone="amber"
                        title="No class enrollment was ever recorded for this student. Review their data."
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
                        <span className="text-(--mws-muted)">
                          Not yet assigned
                        </span>
                        {canDelete ? (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={reissueNisMutation.isPending}
                            onClick={() => {
                              setReissueEntryType("");
                              setReissueJoinGradeId(
                                student.academic.join_grade_id || "",
                              );
                              setReissueJoinAcademicYearId(
                                student.academic.join_academic_year_id || "",
                              );
                              setIsReissueModalOpen(true);
                            }}
                            size="icon" aria-label="Reissue NIS" title="Reissue NIS"
                          >
                            <RefreshCw size={14} />
                          </Button>
                        ) : null}
                      </span>
                    )
                  }
                />
                <DetailRow
                  label="Legacy NIS"
                  value={student.academic.legacy_nis}
                />
                <DetailRow label="NISN" value={student.academic.nisn} />
                <DetailRow
                  label="Legacy NISN"
                  value={student.academic.legacy_nisn}
                />
                <DetailRow
                  label="Current Grade"
                  value={
                    <GradeValue
                      isDefaulted={student.academic.import_defaulted_fields?.includes(
                        "current_grade",
                      )}
                      overrideReason={
                        student.academic.grade_consistency_override_reason
                      }
                    >
                      {student.academic.current_grade}
                    </GradeValue>
                  }
                />
                <DetailRow label="Current Class" value={className} />
                <DetailRow
                  label="Last Promoted"
                  value={
                    latestPromotion
                      ? `${latestPromotion.grade_level} - ${latestPromotion.class.name} (${latestPromotion.academic_year.name}), ${formatDate(latestPromotion.start_date)}${latestPromotion.is_retention ? " - retention" : ""}`
                      : null
                  }
                />
                <DetailRow label="Join Academic Year" value={joinYearName} />
                <DetailRow
                  label="Join Grade"
                  value={
                    <GradeValue
                      overrideReason={
                        student.academic.grade_consistency_override_reason
                      }
                    >
                      {student.academic.join_grade}
                    </GradeValue>
                  }
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
              <div className="border-t border-(--mws-line) px-5 py-3">
                <GoogleAccountRow resource="students" id={studentId} email={student.identity.email} name={student.identity.full_name} />
              </div>
            </section>

            {"gender" in student.identity || "pickup_drop_service" in student.academic ? (
              <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
                {"gender" in student.identity ? (
                  <>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-xs font-display font-bold uppercase tracking-wide text-(--mws-muted)">
                      Profile Details
                    </h2>
                    {canViewSensitive ? (
                      pii.revealed ? (
                        <Button type="button" variant="secondary" onClick={pii.hide} size="icon" aria-label="Hide birth details" title="Hide birth details">
                          <EyeOff size={15} />
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          loading={pii.isRevealing}
                          onClick={pii.reveal}
                          size="icon" aria-label="Show birth details" title="Show birth details"
                        >
                          <Eye size={15} />
                        </Button>
                      )
                    ) : null}
                  </div>
                  <dl>
                    <DetailRow
                      compact
                      label="Gender"
                      value={formatStatus(student.identity.gender)}
                    />
                    <DetailRow
                      compact
                      label="Religion"
                      value={
                        <DefaultedValue
                          fieldKey="religion"
                          defaultedFields={
                            student.academic.import_defaulted_fields
                          }
                        >
                          {formatStatus(student.identity.religion)}
                        </DefaultedValue>
                      }
                    />
                    <DetailRow
                      compact
                      label="Birth Place"
                      value={
                        canViewSensitive && !pii.data ? (
                          <HiddenValue loading={pii.revealed} />
                        ) : (
                        <DefaultedValue
                          fieldKey="birth_place"
                          defaultedFields={
                            student.academic.import_defaulted_fields
                          }
                        >
                          {pii.data?.birth_place ?? student.identity.birth_place}
                        </DefaultedValue>
                        )
                      }
                    />
                    <DetailRow
                      compact
                      label="Birth Date"
                      warning={canViewSensitive && !pii.data ? null : birthDateWarning}
                      value={
                        canViewSensitive && !pii.data ? (
                          <HiddenValue loading={pii.revealed} />
                        ) : (
                        <DefaultedValue
                          fieldKey="birth_date"
                          defaultedFields={
                            student.academic.import_defaulted_fields
                          }
                        >
                          {formatDate(pii.data?.birth_date ?? student.identity.birth_date)}
                        </DefaultedValue>
                        )
                      }
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
                  </>
                ) : null}

                {"pickup_drop_service" in student.academic ? (
                  <>
                  <h2
                    className={`mb-3 text-xs font-display font-bold uppercase tracking-wide text-(--mws-muted) ${"gender" in student.identity ? "mt-5 border-t border-(--mws-line) pt-5" : ""}`}
                  >
                    Services
                  </h2>
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
                  </>
                ) : null}
              </section>
            ) : null}
            </>
          ) : null}

          {activeTab === "academic" ? (
            <>
              <EnrollmentHistoryPanel studentId={studentId} />
              <StudentMutationHistoryPanel studentId={studentId} canWrite={false} />
              <StudentPcActivitiesPanel studentId={studentId} />
            </>
          ) : null}

          {activeTab === "family-consent" ? (
            <>
              {effectiveCanWrite && canViewSensitive ? (
                <div className="flex justify-end gap-2">
                  <Button asChild variant="secondary" size="sm" className="h-8 px-3"><Link to={`/students/${studentId}/manage/contacts`}><UsersRound size={14} />Manage Contacts</Link></Button>
                  <Button asChild variant="secondary" size="sm" className="h-8 px-3"><Link to={`/students/${studentId}/manage/consent`}><FileSignature size={14} />Manage Consent</Link></Button>
                </div>
              ) : null}
              <StudentParentsPanel
                studentId={studentId}
                canWrite={false}
                revealed={!canViewSensitive || pii.revealed}
                onReveal={pii.reveal}
                onHide={canViewSensitive ? pii.hide : undefined}
              />
              <StudentConsentPanel
                studentId={studentId}
                canWrite={false}
                canViewSensitive={canViewSensitive}
              />
            </>
          ) : null}

          {activeTab === "health" ? (
            <>
              {effectiveCanWrite ? (
                <div className="flex justify-end">
                  <Button asChild variant="secondary" size="sm" className="h-8 px-3"><Link to={`/students/${studentId}/manage/health`}><HeartPulse size={14} />Manage Health</Link></Button>
                </div>
              ) : null}
              <div className="grid min-w-0 gap-5 xl:grid-cols-2">
                <StudentHealthPanel studentId={studentId} canWrite={false} canViewSensitive={canViewSensitive} />
                <StudentVaccinePanel studentId={studentId} canWrite={false} canViewSensitive={canViewSensitive} />
              </div>
            </>
          ) : null}

          {activeTab === "special-education" ? (
            <>
              <StudentSpecialNeedsPanel studentId={studentId} canWrite={effectiveCanWrite} canViewSensitive={canViewSensitive} />
              <StudentSupportAssignmentPanel
                studentId={studentId}
                studentUnitName={studentGrade?.unit_name}
                canWrite={false}
                isEligible={student.academic.special_needs_status === SpecialNeedsEligibilityStatus.PROFILED}
              />
            </>
          ) : null}
        </div>
      ) : null}
      {isReissueModalOpen && (() => {
        const nisHints = decodeLegacyNisHints(student?.academic.legacy_nis, {
          gradeLevel: (optionsQuery.data?.grades || []).find(
            (grade) => grade.id === reissueJoinGradeId,
          )?.level,
          academicYear: (optionsQuery.data?.academicYears || []).find(
            (year) => year.id === reissueJoinAcademicYearId,
          ),
          academicYears: optionsQuery.data?.academicYears,
        });
        const hasLockedMismatch =
          Boolean(earliestEnrollment) &&
          Boolean(nisHints) &&
          (!nisHints.yearMatches || !nisHints.unitMatches);
        return (
        <CrudDialog
          title="Reissue NIS"
          description="This action will generate a permanent NIS based on the student's current academic data."
          isOpen={isReissueModalOpen}
          onClose={() => setIsReissueModalOpen(false)}
        >
          <div className="space-y-4">
            <div className="space-y-3 rounded-lg bg-(--mws-soft) p-4 text-sm text-(--mws-charcoal)">
              <p>
                Generated from Join Grade, Join Year, and Entry Type below.
                Double check these are correct first. Legacy imports often
                still show Join Grade as "{UNKNOWN_LEGACY_GRADE_NAME}".
              </p>
              <p className="font-semibold text-red-600">
                Warning: The NIS cannot be changed once generated.
              </p>
            </div>

            {nisHints ? (
              <div className="space-y-2 rounded-lg bg-[#eef3fb] p-4 text-sm text-(--mws-navy)">
                <p className="font-semibold">
                  Legacy NIS "{student?.academic.legacy_nis}" breaks down as:
                </p>
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide opacity-70">
                      <th className="pb-1 pr-3 font-semibold">Digits</th>
                      <th className="pb-1 pr-3 font-semibold">Means</th>
                      <th className="pb-1 font-semibold">Decoded as</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#c3d4ef]">
                    <tr>
                      <td className="py-1 pr-3 font-mono">
                        {nisHints.yearDigits}
                      </td>
                      <td className="py-1 pr-3">Year</td>
                      <td className="py-1 font-semibold">
                        20{nisHints.yearDigits}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1 pr-3 font-mono">
                        {nisHints.unitDigit}
                      </td>
                      <td className="py-1 pr-3">Unit</td>
                      <td className="py-1 font-semibold">
                        {nisHints.unitLabel || "Unknown"}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1 pr-3 font-mono">
                        {nisHints.entryTypeDigit}
                      </td>
                      <td className="py-1 pr-3">Entry Type</td>
                      <td className="py-1 font-semibold">
                        {nisHints.entryType
                          ? formatEntryType(nisHints.entryType)
                          : "Unknown"}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1 pr-3 font-mono">
                        {nisHints.sequenceDigits}
                      </td>
                      <td className="py-1 pr-3">Sequence</td>
                      <td className="py-1 font-semibold">
                        #{nisHints.sequenceDigits}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : null}

            {earliestEnrollment ? (
              <div className="flex items-start justify-between gap-3 rounded-lg bg-(--mws-soft) px-3 py-2 text-xs text-(--mws-charcoal)">
                <p>
                  Join Grade and Join Year are locked. This student already
                  has an enrollment in{" "}
                  <strong>{earliestEnrollment.class.name}</strong> (
                  {earliestEnrollment.academic_year.name}). Changing them
                  here would conflict with that record. Fix or move the
                  enrollment first if they're actually wrong.
                </p>
                <Link
                  to={`/academic/classes/${earliestEnrollment.class.id}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Open class in a new tab"
                  className="shrink-0 rounded-lg p-1.5 text-(--mws-muted) hover:bg-white hover:text-(--mws-burgundy)"
                >
                  <Eye size={15} />
                </Link>
              </div>
            ) : null}

            <div className="space-y-1">
              <label className="text-sm font-medium text-(--mws-charcoal)">
                Join Grade
              </label>
              <SearchableSelect
                required
                disabled={Boolean(earliestEnrollment)}
                value={reissueJoinGradeId}
                onChange={setReissueJoinGradeId}
                options={(optionsQuery.data?.grades || []).map((grade) => ({
                  value: grade.id,
                  label: grade.name,
                }))}
                placeholder="Select Join Grade"
                searchPlaceholder="Search Grade"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-(--mws-charcoal)">
                Join Year
              </label>
              <SearchableSelect
                required
                disabled={Boolean(earliestEnrollment)}
                value={reissueJoinAcademicYearId}
                onChange={setReissueJoinAcademicYearId}
                options={sortSuggestedFirst(
                  (optionsQuery.data?.academicYears || []).map((year) => ({
                    value: year.id,
                    label: year.name,
                  })),
                  nisHints?.suggestedYear?.id,
                )}
                placeholder="Select Join Year"
                searchPlaceholder="Search Year"
              />
              <p className="text-xs text-(--mws-muted)">
                Can't be moved past an enrollment already on file for this
                student, if one exists.
              </p>
              {nisHints && !nisHints.yearMatches ? (
                earliestEnrollment ? (
                  <p className="rounded-lg bg-[#fff0f1] px-3 py-2 text-xs text-[#a43c41]">
                    Legacy NIS decodes to year "20{nisHints.yearDigits}",
                    which doesn't match the locked Join Year above. Fix the
                    enrollment first before generating. Otherwise this bakes
                    in a NIS from a Join Year that's likely wrong.
                  </p>
                ) : (
                  <div className="flex items-start justify-between gap-3 rounded-lg bg-[#eef3fb] px-3 py-2 text-xs text-(--mws-navy)">
                    <p>
                      Legacy NIS decodes to year "20{nisHints.yearDigits}",
                      which doesn't match the Join Year selected above.{" "}
                      {nisHints.suggestedYear ? (
                        <>
                          Only <strong>{nisHints.suggestedYear.name}</strong>{" "}
                          starts in 20{nisHints.yearDigits}.
                        </>
                      ) : (
                        "Double check whether Join Year is actually correct before generating."
                      )}
                    </p>
                    {nisHints.suggestedYear ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-6 shrink-0 whitespace-nowrap px-2 text-xs"
                        onClick={() =>
                          setReissueJoinAcademicYearId(
                            nisHints.suggestedYear.id,
                          )
                        }
                      >
                        Use this
                      </Button>
                    ) : null}
                  </div>
                )
              ) : null}
              {nisHints && nisHints.yearMatches && !nisHints.unitMatches ? (
                <p
                  className={
                    earliestEnrollment
                      ? "rounded-lg bg-[#fff0f1] px-3 py-2 text-xs text-[#a43c41]"
                      : "rounded-lg bg-[#eef3fb] px-3 py-2 text-xs text-(--mws-navy)"
                  }
                >
                  Legacy NIS decodes to unit "{nisHints.unitLabel}", which
                  doesn't match the Join Grade{" "}
                  {earliestEnrollment ? "locked" : "selected"} above.{" "}
                  {earliestEnrollment
                    ? "Fix the enrollment first before generating. Otherwise this bakes in a NIS from a Join Grade that's likely wrong."
                    : "Double check whether Join Grade is actually correct before generating."}
                </p>
              ) : null}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-(--mws-charcoal)">
                Confirm Entry Type
              </label>
              <SearchableSelect
                required
                disabled={hasLockedMismatch}
                value={reissueEntryType}
                onChange={setReissueEntryType}
                options={sortSuggestedFirst(
                  studentEntryTypes.map((option) => ({
                    value: option,
                    label: formatEntryType(option),
                  })),
                  nisHints?.yearMatches && nisHints.unitMatches
                    ? nisHints.entryType
                    : undefined,
                )}
                placeholder="Select Entry Type"
                searchPlaceholder="Search Entry Type"
              />
              <p className="text-xs text-(--mws-muted)">
                Legacy rows default to PSB on import. Confirm the real value
                before generating.
              </p>
              {nisHints?.yearMatches &&
              nisHints.unitMatches &&
              nisHints.entryType &&
              nisHints.entryType !== reissueEntryType ? (
                <div className="flex items-start justify-between gap-3 rounded-lg bg-[#eef3fb] px-3 py-2 text-xs text-(--mws-navy)">
                  <p>
                    Legacy NIS decodes to{" "}
                    <strong>{formatEntryType(nisHints.entryType)}</strong> for
                    this Join Grade/Year.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-6 shrink-0 whitespace-nowrap px-2 text-xs"
                    onClick={() => setReissueEntryType(nisHints.entryType)}
                  >
                    Use this
                  </Button>
                </div>
              ) : null}
            </div>

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
                disabled={
                  !reissueEntryType ||
                  !reissueJoinGradeId ||
                  !reissueJoinAcademicYearId ||
                  hasLockedMismatch
                }
                loading={reissueNisMutation.isPending}
                onClick={async () => {
                  const gradeName = (optionsQuery.data?.grades || []).find(
                    (grade) => grade.id === reissueJoinGradeId,
                  )?.name;
                  const yearName = (
                    optionsQuery.data?.academicYears || []
                  ).find(
                    (year) => year.id === reissueJoinAcademicYearId,
                  )?.name;
                  const confirmed = await confirm({
                    title: "Generate this NIS?",
                    description: (
                      <div className="space-y-3">
                        <table className="w-full border-collapse">
                          <tbody className="divide-y divide-(--mws-line)">
                            <tr>
                              <td className="py-1 pr-3 text-(--mws-muted)">
                                Join Grade
                              </td>
                              <td className="py-1 text-right font-semibold text-(--mws-charcoal)">
                                {gradeName}
                              </td>
                            </tr>
                            <tr>
                              <td className="py-1 pr-3 text-(--mws-muted)">
                                Join Year
                              </td>
                              <td className="py-1 text-right font-semibold text-(--mws-charcoal)">
                                {yearName}
                              </td>
                            </tr>
                            <tr>
                              <td className="py-1 pr-3 text-(--mws-muted)">
                                Entry Type
                              </td>
                              <td className="py-1 text-right font-semibold text-(--mws-charcoal)">
                                {formatEntryType(reissueEntryType)}
                              </td>
                            </tr>
                            <tr>
                              <td className="py-1 pr-3 text-(--mws-muted)">
                                NIS
                              </td>
                              <td className="py-1 text-right font-mono font-semibold text-(--mws-charcoal)">
                                {nisHints?.yearMatches &&
                                nisHints.unitMatches &&
                                nisHints.entryType === reissueEntryType
                                  ? student?.academic.legacy_nis
                                  : "Auto-generated (new number)"}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                        <p className="font-semibold text-red-600">
                          This is permanent. It cannot be undone or
                          regenerated.
                        </p>
                      </div>
                    ),
                    confirmLabel: "Generate NIS",
                    tone: "danger",
                    delaySeconds: 5,
                  });
                  if (!confirmed) return;
                  reissueNisMutation.mutate(undefined, {
                    onSuccess: () => setIsReissueModalOpen(false),
                  });
                }}
              >
                Generate NIS
              </Button>
            </div>
          </div>
        </CrudDialog>
        );
      })()}

      {isPhotoPreviewOpen && student?.identity.photo_url ? (
        <PhotoLightbox
          photoUrl={student.identity.photo_url}
          fullName={student.identity.full_name}
          canManage={false}
          onClose={() => setIsPhotoPreviewOpen(false)}
        />
      ) : null}
    </div>
  );
}
