import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button } from "../../../components/ui/Button.jsx";
import { cn } from "../../../lib/cn.js";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import {
  CheckboxField,
  DateField,
  Field,
  SearchableSelect,
  TextAreaInput,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { SelectFilter } from "./SelectFilter.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { studentsApi } from "../../students/api/studentsApi.js";
import {
  classesApi,
  enrollmentCloseStatuses,
  enrollmentsApi,
} from "../api/academicApi.js";
import {
  capitalizeWords,
  cleanPayload,
  dateInputFromIso,
  isoFromDateInput,
  trimmedOrUndefined,
} from "../../../lib/form.js";
import { formatDate, formatStatus, statusTone } from "../../../lib/format.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";

// Mirrors PROMOTE_WINDOW_DAYS in enrollment-service.ts.
const PROMOTE_WINDOW_DAYS = 30;

// The exact moment PROMOTE_WINDOW_DAYS opens, given the source year's end date.
function windowOpensAt(endDate) {
  return new Date(
    new Date(endDate).getTime() - PROMOTE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
}

// "3d 04:12:09" (or just "04:12:09" once under a day) - live countdown text,
// ticking down to the second so the "too early" banner doesn't just sit
// there looking frozen. null once time's up.
function formatCountdown(remainingMs) {
  if (remainingMs <= 0) return null;
  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

// Every grade a class accepts - its primary plus, for a mixed-age class
// (see ClassAdditionalGrade), whatever's in additional_grades. Most classes
// only ever have the one primary grade; this just makes both cases uniform
// wherever a class's grade(s) need checking against something else.
function classAllowedGrades(klass) {
  if (!klass) return [];
  return [klass.grade, ...(klass.additional_grades || [])].filter(Boolean);
}

// Which of a class's allowed grades a promotion from sourceLevel could
// actually land in - mirrors assertValidGradeProgression's rules on the
// backend (retention stays at the same level; a normal promotion moves up
// exactly one level unless allowSkip is set).
function promoteRuleSatisfyingGrades(klass, sourceLevel, isRetention, allowSkip) {
  if (sourceLevel === undefined) return classAllowedGrades(klass);
  return classAllowedGrades(klass).filter((grade) => {
    if (isRetention) return grade.level === sourceLevel;
    if (grade.level <= sourceLevel) return false;
    if (!allowSkip && grade.level > sourceLevel + 1) return false;
    return true;
  });
}

// Shared by AcademicPage's Enrollment tab and ClassDetailPage - one dialog
// for the full enrollment lifecycle: create, transfer, promote, close, and
// their bulk (multi-enrollment) variants. `presetClassId` lets ClassDetailPage
// reuse the "create" mode with the class already fixed - hides the Class
// field and pre-fills the start date from that class's academic year.
export function EnrollmentDialog({
  dialog,
  options,
  presetClassId,
  // Only meaningful alongside presetClassId - ClassDetailPage's own class
  // data always has the real status, whereas the Class field's own options
  // list is ACTIVE-only, so an inactive preset class wouldn't be findable
  // there at all. Lets this dialog warn/block rather than silently having
  // nothing to submit.
  presetClassStatus,
  // Student ids to hide from the "add student" picker - e.g. students
  // already on this exact class's roster, who'd just hit the "already has
  // an enrollment record" conflict.
  excludeStudentIds,
  isSubmitting,
  onClose,
  onSubmit,
}) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  // Which student's BackfillPreviewDialog "Use this class" is in flight -
  // handleManualStep() below calls the API directly rather than going
  // through the parent's onSubmit/mutation, so it needs its own pending
  // flag to disable that one row's button while the request is out.
  const [manualStepPendingStudentId, setManualStepPendingStudentId] =
    useState(null);
  const record = dialog.record;
  const isBulkPromote = dialog.mode === "bulk-promote";
  const isBulkTransfer = dialog.mode === "bulk-transfer";
  const isBulkClose = dialog.mode === "bulk-close";
  const isBulkAction = isBulkPromote || isBulkTransfer || isBulkClose;
  const [values, setValues] = useState(() => {
    const presetClass = presetClassId
      ? (options?.classes || []).find((klass) => klass.id === presetClassId)
      : null;
    const presetYear = presetClass
      ? (options?.academicYears || []).find(
          (year) => year.id === presetClass.academic_year?.id,
        )
      : null;
    const closeAcademicYear = (options?.academicYears || []).find(
      (year) => year.id === resolveCloseAcademicYearId(record, dialog.records),
    );
    return {
      student_id: record?.student?.id || "",
      class_id: presetClassId || record?.class?.id || "",
      start_date:
        presetClass && dialog.mode === "create"
          ? dateInputFromIso(presetYear?.start_date)
          : "",
      effective_date: "",
      // Which grade within the target class this promotion lands in - only
      // meaningful (and shown) when that class is mixed-age; a normal
      // single-grade class always lands in its one grade, so this stays
      // untouched and the primary grade is used instead at submit time.
      promote_grade_id: "",
      end_date: computeCloseEndDateDefault(
        "TRANSFERRED",
        closeAcademicYear,
        resolveCloseFloorStartDate(record, dialog.records),
      ),
      status: "TRANSFERRED",
      is_legacy: false,
      is_retention: false,
      retention_reason: "",
      allow_grade_skip: false,
      special_education_employee_id: "",
      // Prefilled from whatever's being closed - grade_level/academic_year
      // are already known, so there's usually nothing to type for a
      // same-cohort graduation. Still editable for edge cases.
      graduation_grade: (record || dialog.records?.[0])?.grade_level || "",
      leave_year: (record || dialog.records?.[0])?.academic_year?.name || "",
    };
  });
  const [selectedStudentIds, setSelectedStudentIds] = useState(() =>
    record?.student?.id ? [record.student.id] : [],
  );
  const [studentSearch, setStudentSearch] = useState("");
  // Only meaningful on a mixed-age class (see ClassAdditionalGrade), whose
  // candidate list spans more than one grade - narrows the picker down to
  // one grade at a time, e.g. to check off just the K1 half.
  const [studentGradeFilter, setStudentGradeFilter] = useState("");
  const [studentPage, setStudentPage] = useState(1);
  const [studentPageSize, setStudentPageSize] = useState(10);
  // Search/paging for the bulk-action (promote/transfer/close) records list
  // below - separate from the Students picker's own state above, since a
  // bulk action's set of records is fixed (chosen via table checkboxes
  // before this dialog opened) rather than browsed from scratch.
  const [bulkRecordSearch, setBulkRecordSearch] = useState("");
  const [bulkRecordPage, setBulkRecordPage] = useState(1);
  const [bulkRecordPageSize, setBulkRecordPageSize] = useState(10);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  // True only while the pre-submit backfill check (see submit() below) is
  // in flight - kept separate from isSubmitting (the real create request)
  // so Save shows a distinct state instead of looking like it's already
  // enrolling before the admin has even confirmed the backfill.
  const [isPreviewingBackfill, setIsPreviewingBackfill] = useState(false);
  // Set only when previewBackfill() (see submit() below) found students
  // that would land in placeholder classes - holds the preview entries
  // until the admin picks Cancel, Backfill Manually, or Confirm & Enroll on
  // BackfillPreviewDialog below.
  const [backfillPreview, setBackfillPreview] = useState(null);
  // Ticks every second so the promote/graduate "too early" countdown below
  // actually counts down instead of sitting frozen at whatever it computed
  // on first render.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);
  // Rows the admin marked out of this batch without leaving the dialog -
  // easier than closing, reselecting on the list, and reopening. Only
  // meaningful for the bulk-promote/bulk-transfer/bulk-close modes.
  const [excludedEnrollmentIds, setExcludedEnrollmentIds] = useState(
    () => new Set(),
  );
  const showClassField =
    dialog.mode !== "close" && !isBulkClose && !presetClassId;
  const showRetentionReason =
    (dialog.mode === "promote" || isBulkPromote) && values.is_retention;
  const showGraduationFields =
    (dialog.mode === "close" || isBulkClose) && values.status === "COMPLETED";
  // Only a mixed-age class (see ClassAdditionalGrade) needs an explicit
  // grade choice for promote - a normal single-grade class always lands in
  // its one grade, resolved automatically at submit time below.
  const rawSelectedClass = (options?.classes || []).find(
    (klass) => klass.id === values.class_id,
  );
  const showTargetGrade =
    (dialog.mode === "promote" || isBulkPromote) &&
    classAllowedGrades(rawSelectedClass).length > 1;
  const errors = hasAttemptedSubmit
    ? computeEnrollmentErrors(values, {
        showClassField,
        showRetentionReason,
        showGraduationFields,
        showTargetGrade,
      })
    : {};
  const includedRecords = (dialog.records || []).filter(
    (enrollment) => !excludedEnrollmentIds.has(enrollment.id),
  );

  // Search/paging over the full records list (excluded ones stay visible,
  // just dimmed - same as before) rather than just includedRecords, so
  // searching doesn't hide a record the admin already excluded and might
  // want to re-include.
  const bulkRecordSearchTerm = bulkRecordSearch.trim().toLowerCase();
  const filteredBulkRecords = bulkRecordSearchTerm
    ? (dialog.records || []).filter((enrollment) =>
        `${enrollment.student.full_name} ${enrollment.student.nis || ""} ${enrollment.class.name}`
          .toLowerCase()
          .includes(bulkRecordSearchTerm),
      )
    : dialog.records || [];
  const bulkRecordTotalPages = Math.max(
    Math.ceil(filteredBulkRecords.length / bulkRecordPageSize),
    1,
  );
  const clampedBulkRecordPage = Math.min(
    bulkRecordPage,
    bulkRecordTotalPages,
  );
  const pagedBulkRecords = filteredBulkRecords.slice(
    (clampedBulkRecordPage - 1) * bulkRecordPageSize,
    clampedBulkRecordPage * bulkRecordPageSize,
  );

  function toggleExcludedEnrollment(id) {
    setExcludedEnrollmentIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // create() rejects enrolling into an INACTIVE class outright unless
  // is_legacy is set (backfilling historical data explicitly skips that
  // check). With a preset class the Class field is hidden, so there's no
  // dropdown to just not offer this class in - block the form directly
  // instead of letting the admin fill it out and hit a submit-time 400.
  const presetClassIsBlocked =
    dialog.mode === "create" &&
    Boolean(presetClassId) &&
    presetClassStatus === "INACTIVE" &&
    !values.is_legacy;

  const { user } = useAuth();
  // Historical mode needs the full classes list (inactive ones included -
  // a past year's classes get cascade-deactivated, see
  // AcademicYearService.update), not just the ACTIVE/UPCOMING list used
  // for live enrollment.
  const legacyClassesQuery = useQuery({
    queryKey: ["enrollment-legacy-classes"],
    enabled: dialog.mode === "create" && values.is_legacy,
    queryFn: () => classesApi.list({ page: 1, size: 100 }),
  });

  // Database Admin only ever needs to enroll a student into a class within
  // their own unit - narrow the picker instead of listing every class in
  // the school. Super Admin sees everything, same as before. unitIdByGradeId
  // is grade-keyed, so it applies the same regardless of which classes list
  // (ACTIVE/UPCOMING or the broader legacy one) is the source. Live
  // enrollment excludes INACTIVE classes here - the caller's fetch no
  // longer pre-filters by status, since UPCOMING classes (next year's,
  // prepared ahead of time) are a valid target too, only INACTIVE isn't.
  const allClasses = values.is_legacy
    ? legacyClassesQuery.data?.data || []
    : (options?.classes || []).filter((klass) => klass.status !== "INACTIVE");
  const unitFilteredClasses =
    user?.role === "DATABASE_ADMIN"
      ? allClasses.filter(
          (klass) =>
            options?.unitIdByGradeId?.get(klass.grade.id) === user.unit_id,
        )
      : allClasses;
  // Transfer moves a student sideways within the same academic year and
  // same grade - a lateral class change, not a grade change (that's
  // Promote's job, with its own lineage/history). Mirrors the backend's
  // transfer() grade guard. Bulk transfer only narrows when every selected
  // enrollment shares the same academic year, since a mixed-year selection
  // has no single year to narrow to.
  const transferSourceAcademicYearId =
    dialog.mode === "transfer"
      ? record?.academic_year?.id
      : isBulkTransfer &&
          (dialog.records || []).every(
            (enrollment) => enrollment.academic_year?.id === dialog.records[0]?.academic_year?.id,
          )
        ? dialog.records?.[0]?.academic_year?.id
        : undefined;
  // Also drop the student's own current class(es) - transferring into the
  // class a student is already in is a no-op, not a real move.
  const transferSourceClassIds = new Set(
    dialog.mode === "transfer"
      ? [record?.class?.id].filter(Boolean)
      : isBulkTransfer
        ? (dialog.records || []).map((enrollment) => enrollment.class?.id).filter(Boolean)
        : [],
  );
  // Promote must move to a strictly higher grade unless Retention is
  // checked - mirrors assertValidGradeProgression on the backend. Retention
  // re-enrolls in the *same* grade only (never higher - that's a normal
  // promotion; never lower either, since not moving up just means staying
  // put) in a *later* academic year than the current one, never the
  // current year itself.
  const gradeLevelByName = new Map(
    (options?.grades || []).map((grade) => [grade.name, grade.level]),
  );
  // A single bulk-promote request carries exactly one target grade_id for
  // the whole batch - that only makes sense when every included student is
  // currently at the same grade. A mixed-age class (see ClassAdditionalGrade)
  // makes it easy to select two students who share a class but not a grade
  // (e.g. one Pre-K, one K1 in the same physical room); bulkPromoteMixedSourceGrades
  // below flags that case so it can be blocked with a clear message instead
  // of silently disabling the class picker's filtering.
  const promoteSourceGradeLevel =
    dialog.mode === "promote"
      ? gradeLevelByName.get(record?.grade_level)
      : isBulkPromote &&
          includedRecords.every(
            (enrollment) => enrollment.grade_level === includedRecords[0]?.grade_level,
          )
        ? gradeLevelByName.get(includedRecords[0]?.grade_level)
        : undefined;
  const bulkPromoteMixedSourceGrades =
    isBulkPromote &&
    new Set(includedRecords.map((enrollment) => enrollment.grade_level)).size > 1;
  // Same idea as promoteSourceGradeLevel, but for narrowing transfer's
  // class picker to the grade the student(s) are already in - mirrors the
  // backend's transfer() grade guard (enrollment-service.ts).
  const transferSourceGradeLevel =
    dialog.mode === "transfer"
      ? gradeLevelByName.get(record?.grade_level)
      : isBulkTransfer &&
          (dialog.records || []).every(
            (enrollment) => enrollment.grade_level === dialog.records[0]?.grade_level,
          )
        ? gradeLevelByName.get(dialog.records?.[0]?.grade_level)
        : undefined;
  const academicYearById = new Map(
    (options?.academicYears || []).map((year) => [year.id, year]),
  );
  const promoteSourceAcademicYearId =
    dialog.mode === "promote"
      ? record?.academic_year?.id
      : isBulkPromote &&
          includedRecords.every(
            (enrollment) => enrollment.academic_year?.id === includedRecords[0]?.academic_year?.id,
          )
        ? includedRecords[0]?.academic_year?.id
        : undefined;
  const promoteSourceAcademicYear = academicYearById.get(
    promoteSourceAcademicYearId,
  );
  const promoteSourceAcademicYearStart = promoteSourceAcademicYear?.start_date;
  // The one academic year immediately after the source, by start_date -
  // mirrors assertValidGradeProgression's backend guard against skipping
  // straight past an intervening year (a gap nothing else can backfill
  // afterward, since backfill only ever covers a student's own join year).
  const promoteTargetAcademicYearId = promoteSourceAcademicYearStart
    ? (options?.academicYears || [])
        .filter(
          (year) =>
            new Date(year.start_date) > new Date(promoteSourceAcademicYearStart),
        )
        .sort((a, b) => new Date(a.start_date) - new Date(b.start_date))[0]
        ?.id
    : undefined;
  // The next academic year genuinely doesn't exist yet (not just "has no
  // classes for this grade") - nothing in classOptions below can ever be a
  // valid target, so surface it as an explicit blocker rather than a
  // silently empty Class dropdown.
  const noPromoteTargetYear =
    (dialog.mode === "promote" || isBulkPromote) &&
    !bulkPromoteMixedSourceGrades &&
    promoteSourceGradeLevel !== undefined &&
    !promoteTargetAcademicYearId;
  // Mirrors assertValidGradeProgression's hard block on the backend - no
  // point letting the form submit only to bounce off the same 400. Skipped
  // when end_date isn't set, same as the backend (it's an optional field).
  const promoteWindowRemainingMs =
    (dialog.mode === "promote" || isBulkPromote) &&
    promoteSourceAcademicYear?.end_date
      ? windowOpensAt(promoteSourceAcademicYear.end_date).getTime() -
        now.getTime()
      : null;
  const promoteWindowBlocked =
    promoteWindowRemainingMs !== null && promoteWindowRemainingMs > 0;
  // Mirrors assertGraduationNotTooEarly's hard block on the backend -
  // graduating (closing with status COMPLETED) is treated the same as
  // promoting, since both are "this year is ending" events. Skipped when
  // end_date isn't set, same as promote. Doesn't apply to the Historical
  // Data checkbox above (a create(), not a close() - deliberately bypasses
  // this the same way it bypasses the backend gate).
  const closeSourceAcademicYear = academicYearById.get(
    resolveCloseAcademicYearId(record, dialog.records),
  );
  const graduationWindowRemainingMs =
    (dialog.mode === "close" || isBulkClose) &&
    values.status === "COMPLETED" &&
    closeSourceAcademicYear?.end_date
      ? windowOpensAt(closeSourceAcademicYear.end_date).getTime() -
        now.getTime()
      : null;
  const graduationWindowBlocked =
    graduationWindowRemainingMs !== null && graduationWindowRemainingMs > 0;
  const classOptions = unitFilteredClasses.filter((klass) => {
    // No single target grade works for a batch whose students aren't all
    // at the same grade right now - see bulkPromoteMixedSourceGrades above.
    if (bulkPromoteMixedSourceGrades) return false;
    if (
      transferSourceAcademicYearId &&
      klass.academic_year?.id !== transferSourceAcademicYearId
    ) {
      return false;
    }
    if (transferSourceClassIds.has(klass.id)) return false;
    if (
      transferSourceGradeLevel !== undefined &&
      !classAllowedGrades(klass).some(
        (grade) => grade.level === transferSourceGradeLevel,
      )
    ) {
      return false;
    }
    if (promoteSourceGradeLevel !== undefined) {
      // Promote always moves to the immediately next academic year, never
      // further ahead - mirrors assertValidGradeProgression on the backend.
      // Fail closed when that year doesn't exist yet (promoteTargetAcademicYearId
      // undefined) - no class from any year is a valid target then, not
      // "skip the year check" (that previously let current-year classes
      // leak through whenever the next academic year hadn't been created).
      if (klass.academic_year?.id !== promoteTargetAcademicYearId) {
        return false;
      }
      // A mixed-age class only qualifies if at least one of its grades
      // (primary or additional) satisfies the progression rule - mirrors
      // assertValidGradeProgression on the backend, which now rejects a
      // bigger jump (e.g. Grade 7 straight to Grade 9) unless
      // confirm_grade_skip is set. "Allow Grade Skip" below widens this.
      if (
        promoteRuleSatisfyingGrades(
          klass,
          promoteSourceGradeLevel,
          values.is_retention,
          values.allow_grade_skip,
        ).length === 0
      ) {
        return false;
      }
    }
    return true;
  });

  const selectedClass = classOptions.find(
    (klass) => klass.id === values.class_id,
  );
  // A mixed-age class's roster can include students from any of its
  // allowed grades (primary or additional) - see assertClassMatchesGrade in
  // enrollment-service.ts. Query every one of them, not just the primary,
  // so a student sitting in an additional grade is still findable here.
  const selectedClassGradeIds = classAllowedGrades(selectedClass).map(
    (grade) => grade.id,
  );
  const classStudentOptionsQuery = useQuery({
    queryKey: ["enrollment-student-options", selectedClassGradeIds.join(",")],
    enabled:
      dialog.mode === "create" &&
      !values.is_legacy &&
      selectedClassGradeIds.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        selectedClassGradeIds.flatMap((gradeId) => [
          studentsApi.list({
            page: 1,
            size: 100,
            current_grade_id: gradeId,
            status: "REGISTERED",
          }),
          studentsApi.list({
            page: 1,
            size: 100,
            current_grade_id: gradeId,
            status: "ACTIVE",
          }),
        ]),
      );
      const students = dedupeStudents(
        results.flatMap((result) => result.data || []),
      );
      // New Enrollment is a first placement, not a move - a student who
      // already has a current class needs Transfer (lateral, same year) or
      // Promote (next year) instead, both of which carry their own
      // lineage/history. Showing them here as if unplaced would let two
      // active enrollments exist for the same student at once.
      return students.filter((student) => !student.academic.current_class_id);
    },
  });
  // A historical student's current grade/status has usually moved on since
  // the class being backfilled, so this drops both filters entirely and
  // instead only lists students for whom this class's academic year is
  // actually their next unfilled step (own join year with zero enrollments,
  // or immediately after their latest enrollment - no gaps allowed).
  const legacyStudentOptionsQuery = useQuery({
    queryKey: [
      "enrollment-legacy-student-options",
      selectedClass?.academic_year?.id,
      selectedClassGradeIds.join(","),
    ],
    enabled:
      dialog.mode === "create" &&
      values.is_legacy &&
      Boolean(selectedClass?.academic_year?.id) &&
      selectedClassGradeIds.length > 0,
    queryFn: async () => {
      // A mixed-age class (see ClassAdditionalGrade) can backfill students
      // from any of its allowed grades, not just the primary one - query
      // every one and merge, same as classStudentOptionsQuery above.
      const results = await Promise.all(
        selectedClassGradeIds.map((gradeId) =>
          studentsApi.listBackfillCandidates({
            page: 1,
            size: 100,
            academic_year_id: selectedClass.academic_year.id,
            grade_id: gradeId,
          }),
        ),
      );
      return dedupeStudents(results.flatMap((result) => result.data || []));
    },
  });
  const studentOptionsQuery = values.is_legacy
    ? legacyStudentOptionsQuery
    : classStudentOptionsQuery;
  const excludedStudentIdSet = new Set(excludeStudentIds || []);
  const selectedStudents = (studentOptionsQuery.data || []).filter(
    (student) => selectedStudentIds.includes(student.id),
  );
  const candidateStudents = (studentOptionsQuery.data || [])
    .filter((student) => !excludedStudentIdSet.has(student.id))
    .filter((student) =>
      studentGradeFilter
        ? student.academic.current_grade === studentGradeFilter
        : true,
    );
  const studentSearchTerm = studentSearch.trim().toLowerCase();
  const filteredCandidateStudents = studentSearchTerm
    ? candidateStudents.filter((student) =>
        `${student.identity.full_name} ${student.academic.nis || ""}`
          .toLowerCase()
          .includes(studentSearchTerm),
      )
    : candidateStudents;
  const studentTotalPages = Math.max(
    Math.ceil(filteredCandidateStudents.length / studentPageSize),
    1,
  );
  const clampedStudentPage = Math.min(studentPage, studentTotalPages);
  const pagedCandidateStudents = filteredCandidateStudents.slice(
    (clampedStudentPage - 1) * studentPageSize,
    clampedStudentPage * studentPageSize,
  );
  const allCandidatesSelected =
    filteredCandidateStudents.length > 0 &&
    filteredCandidateStudents.every((student) =>
      selectedStudentIds.includes(student.id),
    );

  // Class options only carry {id, name, status} for academic_year (see
  // ClassResponse) - look up the full row from the separately-fetched
  // academicYears list to get its date range for the hints below.
  const selectedAcademicYear = (options?.academicYears || []).find(
    (year) => year.id === selectedClass?.academic_year?.id,
  );
  const recordAcademicYear = (options?.academicYears || []).find(
    (year) => year.id === record?.academic_year?.id,
  );

  // Start date / effective date default to the picked class's academic
  // year start - most enrollments/promotions land right at the year's
  // start, so this saves re-entering a date that's already known. Admins
  // can still edit it afterward for a mid-year admission.
  function handleClassChange(classId) {
    const klass = classOptions.find((item) => item.id === classId);
    const year = (options?.academicYears || []).find(
      (item) => item.id === klass?.academic_year?.id,
    );
    const yearStartDate = dateInputFromIso(year?.start_date);
    // Auto-pick when only one of the class's grades actually qualifies -
    // covers every normal single-grade class transparently, and a
    // mixed-age one whenever the rules only leave one option open. Left
    // blank (forcing an explicit choice) only when more than one qualifies.
    const candidateGrades = klass
      ? promoteRuleSatisfyingGrades(
          klass,
          promoteSourceGradeLevel,
          values.is_retention,
          values.allow_grade_skip,
        )
      : [];

    setValues((current) => ({
      ...current,
      class_id: classId,
      student_id: "",
      ...(dialog.mode === "create" ? { start_date: yearStartDate } : {}),
      ...(dialog.mode === "promote" || isBulkPromote
        ? {
            effective_date: yearStartDate,
            promote_grade_id:
              candidateGrades.length === 1 ? candidateGrades[0].id : "",
          }
        : {}),
    }));
    if (dialog.mode === "create") {
      setSelectedStudentIds([]);
      setStudentSearch("");
      setStudentGradeFilter("");
      setStudentPage(1);
    }
  }

  function toggleStudent(studentId) {
    setSelectedStudentIds((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId],
    );
  }

  // Selects/deselects every student currently matching the search + grade
  // filter (not just the visible page) - mirrors the "select all" checkbox
  // convention used elsewhere (ClassDetailPage, EnrollmentsPanel). Checking
  // it adds to whatever's already selected rather than replacing it, so
  // switching the grade filter afterward doesn't silently drop an earlier
  // selection.
  function toggleAllCandidates(checked) {
    setSelectedStudentIds((current) => {
      const filteredIds = new Set(filteredCandidateStudents.map((s) => s.id));
      if (checked) {
        return Array.from(new Set([...current, ...filteredIds]));
      }
      return current.filter((id) => !filteredIds.has(id));
    });
  }

  // studentIdsOverride lets handleManualStep() below re-submit just
  // whichever students are left after pulling one out for a one-off manual
  // backfill, without waiting for setSelectedStudentIds' state update to
  // land first.
  function submitCreate(studentIdsOverride) {
    const studentIds = studentIdsOverride ?? selectedStudentIds;
    onSubmit({
      studentId: studentIds[0],
      studentIds,
      // Only used to label failures by name if the bulk submit partially
      // fails - the request itself only needs the ids above.
      students: selectedStudents
        .filter((student) => studentIds.includes(student.id))
        .map((student) => ({
          id: student.id,
          full_name: student.identity.full_name,
        })),
      payload: cleanPayload({
        class_id: values.class_id,
        academic_year_id: selectedClass?.academic_year?.id,
        start_date: isoFromDateInput(values.start_date),
        ...(values.is_legacy ? { is_legacy: true } : {}),
      }),
      specialEducationEmployeeId: values.is_legacy
        ? undefined
        : values.special_education_employee_id || undefined,
    });
  }

  // BackfillPreviewDialog's per-step "use this class" action - creates a
  // real Historical Data enrollment for just this one student's earliest
  // missing year, right from the preview, instead of sending the admin back
  // to re-fill the form. Calls the API directly rather than going through
  // onSubmit/the parent's bulk mutation - this is a one-off action for a
  // single student, and needs to wait for the real result before touching
  // any state (an earlier version fired a success toast unconditionally
  // right after onSubmit, which just queues an async mutation - so it lied
  // about succeeding whenever the create actually failed).
  async function handleManualStep(entry, step, klass) {
    setManualStepPendingStudentId(entry.student_id);
    try {
      await enrollmentsApi.create(entry.student_id, {
        class_id: klass.id,
        academic_year_id: step.academic_year_id,
        is_legacy: true,
      });
    } catch (error) {
      showErrorToast(error, "Couldn't create that enrollment.");
      setManualStepPendingStudentId(null);
      return;
    }
    setManualStepPendingStudentId(null);

    queryClient.invalidateQueries({ queryKey: ["enrollments"] });
    queryClient.invalidateQueries({ queryKey: ["students"] });
    queryClient.invalidateQueries({ queryKey: ["classes"] });
    queryClient.invalidateQueries({ queryKey: ["enrollment-form-options"] });
    queryClient.invalidateQueries({ queryKey: ["class-detail-options"] });

    showSuccessToast(
      `${entry.full_name} enrolled into ${klass.name}. Promote them forward from there when ready.`,
    );

    // Once this student has a real first enrollment, they no longer belong
    // in the batch this dialog is about to submit (a second Historical Data
    // create for the same student is rejected - assertLegacyEnrollmentIsFirstEver
    // on the backend), so they're pulled out here rather than left for
    // submitCreate() to hit that error.
    const remainingStudentIds = selectedStudentIds.filter(
      (id) => id !== entry.student_id,
    );
    const remainingPreview = (backfillPreview || []).filter(
      (item) => item.student_id !== entry.student_id,
    );
    setSelectedStudentIds(remainingStudentIds);

    if (remainingPreview.length > 0) {
      setBackfillPreview(remainingPreview);
      return;
    }
    setBackfillPreview(null);
    if (remainingStudentIds.length > 0) {
      submitCreate(remainingStudentIds);
    } else {
      onClose();
    }
  }

  async function submit(event) {
    event.preventDefault();
    setHasAttemptedSubmit(true);
    if (
      Object.keys(
        computeEnrollmentErrors(values, {
          showClassField,
          showRetentionReason,
          showGraduationFields,
          showTargetGrade,
        }),
      ).length > 0
    ) {
      return;
    }
    if (isBulkAction && includedRecords.length === 0) return;
    if (dialog.mode === "create") {
      if (selectedStudentIds.length === 0) {
        showErrorToast("Select at least one student.");
        return;
      }
      // Historical Data never triggers auto-backfill (it's already a
      // one-at-a-time manual reconstruction) - only worth checking for a
      // normal live enrollment.
      if (!values.is_legacy) {
        setIsPreviewingBackfill(true);
        let preview = [];
        try {
          preview = await enrollmentsApi.previewBackfill({
            student_ids: selectedStudentIds,
            class_id: values.class_id,
            academic_year_id: selectedClass?.academic_year?.id,
          });
        } catch {
          // Advisory only - a failed check shouldn't block a legitimate
          // enrollment. create()/bulkCreate() still run their own
          // validation regardless of whether this preview succeeded.
        }
        setIsPreviewingBackfill(false);
        if (preview.length > 0) {
          setBackfillPreview(preview);
          return;
        }
      }
      const confirmed = await confirm({
        title: `Enroll ${selectedStudents.length} student${
          selectedStudents.length === 1 ? "" : "s"
        } into ${selectedClass?.name}?`,
        wide: true,
        description: (
          <>
            <p>These students will get a new enrollment record:</p>
            <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-[var(--mws-line)]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--mws-soft)] font-semibold text-[var(--mws-muted)]">
                  <tr>
                    <th className="px-3 py-2">Student</th>
                    <th className="px-3 py-2">NIS</th>
                    <th className="px-3 py-2">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedStudents.map((student) => (
                    <tr
                      key={student.id}
                      className="border-t border-[var(--mws-line)]"
                    >
                      <td className="px-3 py-2">
                        {student.identity.full_name}
                      </td>
                      <td className="px-3 py-2">
                        {student.academic.nis || "-"}
                      </td>
                      <td className="px-3 py-2">
                        {student.academic.current_grade}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ),
        confirmLabel: "Enroll",
      });
      if (!confirmed) return;
      submitCreate();
      return;
    }

    if (dialog.mode === "transfer" || isBulkTransfer) {
      onSubmit(
        cleanPayload({ class_id: values.class_id }),
        isBulkTransfer ? includedRecords : undefined,
      );
      return;
    }

    if (dialog.mode === "promote" || isBulkPromote) {
      onSubmit(
        cleanPayload({
          class_id: values.class_id,
          academic_year_id: selectedClass?.academic_year?.id,
          grade_id: values.promote_grade_id || selectedClass?.grade?.id,
          effective_date: isoFromDateInput(values.effective_date),
          is_retention: values.is_retention,
          retention_reason: values.is_retention
            ? trimmedOrUndefined(values.retention_reason)
            : undefined,
          confirm_grade_skip: values.allow_grade_skip,
        }),
        isBulkPromote ? includedRecords : undefined,
      );
      return;
    }

    if (dialog.mode === "close" || isBulkClose) {
      onSubmit(
        cleanPayload({
          status: values.status,
          end_date: isoFromDateInput(values.end_date),
          ...(values.status === "COMPLETED"
            ? {
                graduation_grade: trimmedOrUndefined(values.graduation_grade),
                leave_year: trimmedOrUndefined(values.leave_year),
              }
            : {}),
        }),
        isBulkClose ? includedRecords : undefined,
      );
      return;
    }
  }

  return (
    <>
    <CrudDialog
      title={getEnrollmentDialogTitle(dialog.mode)}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="enrollment-form"
            type="submit"
            disabled={
              isSubmitting ||
              isPreviewingBackfill ||
              presetClassIsBlocked ||
              promoteWindowBlocked ||
              graduationWindowBlocked ||
              bulkPromoteMixedSourceGrades ||
              (isBulkAction && includedRecords.length === 0)
            }
          >
            {isPreviewingBackfill ? "Checking..." : "Save"}
          </Button>
        </>
      }
    >
      <form
        id="enrollment-form"
        onSubmit={submit}
        noValidate
        className="grid gap-4 md:grid-cols-2"
      >
        {dialog.mode === "create" ? (
          <CheckboxField
            className="md:col-span-2"
            label="Historical Data (Backfill A Past Enrollment)"
            description="Shows inactive classes too, for a student's very first enrollment, matched to their join grade. Always lands Active. Promote them forward from there to rebuild a Graduated, Transferred, or Withdrawn student's history one class at a time."
            checked={values.is_legacy}
            onChange={async (event) => {
              const checked = event.target.checked;
              // The candidate pool (and often the class) is different
              // between live and Historical Data mode, so switching
              // always clears the queue - but an accidental click
              // shouldn't silently wipe a queue someone already built up.
              if (selectedStudentIds.length > 0) {
                const confirmed = await confirm({
                  title: "Switch enrollment mode?",
                  description: `${selectedStudentIds.length} queued student${selectedStudentIds.length === 1 ? "" : "s"} will be cleared - the student list is different in ${checked ? "Historical Data" : "live enrollment"} mode.`,
                  confirmLabel: "Switch and clear",
                  tone: "danger",
                });
                if (!confirmed) return;
              }
              setValues((current) => ({
                ...current,
                is_legacy: checked,
                class_id: presetClassId || "",
              }));
              setSelectedStudentIds([]);
              setStudentSearch("");
              setStudentPage(1);
            }}
          />
        ) : null}

        {presetClassIsBlocked ? (
          <div className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18] md:col-span-2">
            This class is {formatStatus(presetClassStatus).toLowerCase()}, so
            it can't take a live enrollment. Check "Historical data" above to
            backfill a past record, or activate the class first.
          </div>
        ) : null}

        {bulkPromoteMixedSourceGrades ? (
          <div className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18] md:col-span-2">
            These students aren't all in the same grade, so they can't be
            promoted together. Exclude some, or promote them separately.
          </div>
        ) : null}

        {noPromoteTargetYear ? (
          <div className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18] md:col-span-2">
            The next academic year hasn't been created yet, so there's no
            class to promote into. Create it (and this grade's class) in
            Master Data first.
          </div>
        ) : null}

        {promoteWindowBlocked ? (
          <div className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18] md:col-span-2">
            Too early to promote. {promoteSourceAcademicYear?.name} doesn't
            end until {formatDate(promoteSourceAcademicYear.end_date)}.
            Opens in {formatCountdown(promoteWindowRemainingMs)}.
          </div>
        ) : null}

        {graduationWindowBlocked ? (
          <div className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18] md:col-span-2">
            Too early to graduate. {closeSourceAcademicYear?.name} doesn't
            end until {formatDate(closeSourceAcademicYear.end_date)}.
            Opens in {formatCountdown(graduationWindowRemainingMs)}.
          </div>
        ) : null}

        {dialog.mode !== "close" && !isBulkClose && !presetClassId ? (
          <Field
            label="Class"
            className="md:col-span-2"
            error={errors.class_id}
            hint={
              errors.class_id
                ? undefined
                : dialog.mode === "create"
                  ? "Choose the destination class first."
                  : transferSourceAcademicYearId
                    ? "Only showing other classes in the same grade and academic year. To change grade, use Promote instead."
                    : promoteSourceGradeLevel !== undefined
                      ? values.is_retention
                        ? "Retention checked. Showing the same grade in the next academic year."
                        : values.allow_grade_skip
                          ? "Grade skip allowed. Showing every grade above the student's current one, in the next academic year."
                          : "Only showing the next grade up from the student's current one, in the next academic year. Check \"Allow Grade Skip\" below to jump further in grade."
                      : undefined
            }
          >
            <SearchableSelect
              required={hasAttemptedSubmit}
              value={values.class_id}
              onChange={handleClassChange}
              options={classSelectOptions(classOptions)}
              placeholder="Select Class"
              searchPlaceholder="Search Classes"
            />
          </Field>
        ) : null}

        {dialog.mode === "create" ? (
          <div className="space-y-2 md:col-span-2">
            <Field
              label="Students"
              hint={
                values.is_legacy
                  ? selectedClass
                    ? "Only students with no enrollment yet, whose join year and join grade match this class. One-time only. After this, use Promote instead of backfilling again."
                    : "Select a class before adding students."
                  : selectedClass
                    ? `Showing ${classAllowedGrades(selectedClass).map((grade) => grade.name).join(" or ") || "matching"} students only. Check the ones to enroll, then save once.`
                    : "Select a class before adding students."
              }
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex-1">
                  <TextInput
                    value={studentSearch}
                    onChange={(event) => {
                      setStudentSearch(event.target.value);
                      setStudentPage(1);
                    }}
                    disabled={!selectedClass || studentOptionsQuery.isLoading}
                    placeholder={
                      !selectedClass
                        ? "Select class first"
                        : studentOptionsQuery.isLoading
                          ? "Loading students..."
                          : "Search Name or NIS"
                    }
                  />
                </div>
                {selectedClass && classAllowedGrades(selectedClass).length > 1 ? (
                  <SelectFilter
                    value={studentGradeFilter}
                    onChange={(value) => {
                      setStudentGradeFilter(value);
                      setStudentPage(1);
                    }}
                    options={[
                      { value: "", label: "All Grades" },
                      ...classAllowedGrades(selectedClass).map((grade) => ({
                        value: grade.name,
                        label: grade.name,
                      })),
                    ]}
                    placeholder="All Grades"
                  />
                ) : null}
              </div>
            </Field>

            <div className="overflow-hidden rounded-xl border border-[var(--mws-line)] bg-white">
              {filteredCandidateStudents.length > 0 ? (
                <label className="flex cursor-pointer items-center gap-3 border-b border-[var(--mws-line)] bg-[var(--mws-soft)] px-3 py-2 text-sm font-semibold text-[var(--mws-charcoal)]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-[var(--mws-burgundy)]"
                    checked={allCandidatesSelected}
                    onChange={(event) => toggleAllCandidates(event.target.checked)}
                  />
                  Select all {filteredCandidateStudents.length} matching
                  student{filteredCandidateStudents.length === 1 ? "" : "s"}
                </label>
              ) : null}
              {filteredCandidateStudents.length === 0 ? (
                <p
                  className={cn(
                    "p-3 text-sm text-[var(--mws-muted)]",
                    !selectedClass || studentOptionsQuery.isLoading
                      ? "font-semibold"
                      : "leading-6",
                  )}
                >
                  {!selectedClass
                    ? "Select a class first."
                    : studentOptionsQuery.isLoading
                      ? "Loading students..."
                      : values.is_legacy
                        ? "No students match. This only lists students with no enrollment yet, whose join grade and join year match this class exactly."
                        : `No students currently at ${classAllowedGrades(selectedClass).map((grade) => grade.name).join(" or ") || "this grade"}. A student who already has an active enrollment elsewhere (even a Historical Data record) won't show here. Promote them forward from their current class instead.`}
                </p>
              ) : (
                <div className="divide-y divide-[var(--mws-line)]">
                  {pagedCandidateStudents.map((student) => (
                    <div
                      key={student.id}
                      className="flex min-w-0 items-center gap-3 px-3 py-2 hover:bg-[var(--mws-soft)]"
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-[var(--mws-burgundy)]"
                          checked={selectedStudentIds.includes(student.id)}
                          onChange={() => toggleStudent(student.id)}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-display text-sm font-bold text-[var(--mws-charcoal)]">
                            {student.identity.full_name}
                          </p>
                          <p className="truncate text-xs text-[var(--mws-muted)]">
                            {[
                              student.academic.nis,
                              student.academic.current_grade,
                            ]
                              .filter(Boolean)
                              .join(" / ")}
                          </p>
                        </div>
                      </label>
                      <Link
                        to={`/students/${student.id}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Open student detail in a new tab"
                        className="shrink-0 rounded-lg p-1.5 text-[var(--mws-muted)] hover:bg-white hover:text-[var(--mws-burgundy)]"
                      >
                        <Eye size={15} />
                      </Link>
                    </div>
                  ))}
                </div>
              )}
              {filteredCandidateStudents.length > 0 ? (
                <PaginationBar
                  paging={{
                    current_page: clampedStudentPage,
                    total_page: studentTotalPages,
                    total_item: filteredCandidateStudents.length,
                    size: studentPageSize,
                  }}
                  itemLabel="students"
                  onPrevious={() => setStudentPage((page) => Math.max(page - 1, 1))}
                  onNext={() =>
                    setStudentPage((page) => Math.min(page + 1, studentTotalPages))
                  }
                  onPageSizeChange={(size) => {
                    setStudentPageSize(size);
                    setStudentPage(1);
                  }}
                />
              ) : null}
            </div>
            <p className="text-xs font-semibold text-[var(--mws-muted)]">
              {selectedStudents.length} student
              {selectedStudents.length === 1 ? "" : "s"} selected.
            </p>
          </div>
        ) : null}

        {isBulkAction ? (
          <div className="space-y-2 md:col-span-2">
            <Field
              label="Selected Enrollments"
              hint={`${includedRecords.length} of ${dialog.records?.length || 0} selected enrollment(s) will be ${isBulkClose ? "closed" : "updated to this target class"}. Uncheck any you want to leave out.`}
            >
              <TextInput
                value={bulkRecordSearch}
                onChange={(event) => {
                  setBulkRecordSearch(event.target.value);
                  setBulkRecordPage(1);
                }}
                placeholder="Search Name, NIS, or Class"
              />
            </Field>

            <div className="overflow-hidden rounded-xl border border-[var(--mws-line)] bg-white">
              {pagedBulkRecords.length === 0 ? (
                <p className="p-3 text-sm font-semibold text-[var(--mws-muted)]">
                  No matching enrollments.
                </p>
              ) : (
                <div className="divide-y divide-[var(--mws-line)]">
                  {pagedBulkRecords.map((enrollment) => {
                    const isExcluded = excludedEnrollmentIds.has(enrollment.id);
                    return (
                      <div
                        key={enrollment.id}
                        className={cn(
                          "flex min-w-0 items-center gap-3 px-3 py-2 hover:bg-[var(--mws-soft)]",
                          isExcluded ? "opacity-50" : null,
                        )}
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 accent-[var(--mws-burgundy)]"
                            checked={!isExcluded}
                            onChange={() => toggleExcludedEnrollment(enrollment.id)}
                          />
                          <div className="min-w-0">
                            <p className="truncate font-display text-sm font-bold text-[var(--mws-charcoal)]">
                              {enrollment.student.full_name}
                            </p>
                            <p className="truncate text-xs text-[var(--mws-muted)]">
                              {[enrollment.student.nis, enrollment.class.name]
                                .filter(Boolean)
                                .join(" / ")}
                            </p>
                          </div>
                        </label>
                        <StatusBadge
                          tone={enrollmentStatusTone(enrollment.enrollment_status)}
                        >
                          {formatStatus(enrollment.enrollment_status)}
                        </StatusBadge>
                        <Link
                          to={`/students/${enrollment.student.id}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Open student detail in a new tab"
                          className="shrink-0 rounded-lg p-1.5 text-[var(--mws-muted)] hover:bg-white hover:text-[var(--mws-burgundy)]"
                        >
                          <Eye size={15} />
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
              {filteredBulkRecords.length > 0 ? (
                <PaginationBar
                  paging={{
                    current_page: clampedBulkRecordPage,
                    total_page: bulkRecordTotalPages,
                    total_item: filteredBulkRecords.length,
                    size: bulkRecordPageSize,
                  }}
                  itemLabel="enrollments"
                  onPrevious={() =>
                    setBulkRecordPage((page) => Math.max(page - 1, 1))
                  }
                  onNext={() =>
                    setBulkRecordPage((page) =>
                      Math.min(page + 1, bulkRecordTotalPages),
                    )
                  }
                  onPageSizeChange={(size) => {
                    setBulkRecordPageSize(size);
                    setBulkRecordPage(1);
                  }}
                />
              ) : null}
            </div>
          </div>
        ) : null}

        {dialog.mode === "create" && !values.is_legacy ? (
          <Field
            label="Special Education Teacher"
            className="md:col-span-2"
            hint="Student count shown is each teacher's current active caseload."
          >
            <SearchableSelect
              value={values.special_education_employee_id}
              onChange={(value) =>
                setValues({ ...values, special_education_employee_id: value })
              }
              options={specialEducationTeacherOptions(
                options?.specialEducationTeachers || [],
              )}
              placeholder="No Special Education teacher"
              searchPlaceholder="Search Employee"
            />
          </Field>
        ) : null}

        {dialog.mode === "create" ? (
          <Field
            label="Start Date"
            hint={academicYearRangeHint(selectedAcademicYear)}
          >
            <DateField
              value={values.start_date}
              onChange={(event) =>
                setValues({ ...values, start_date: event.target.value })
              }
            />
          </Field>
        ) : null}

        {dialog.mode === "promote" || isBulkPromote ? (
          <Field
            label="Effective Date"
            hint={academicYearRangeHint(selectedAcademicYear)}
          >
            <DateField
              value={values.effective_date}
              onChange={(event) =>
                setValues({ ...values, effective_date: event.target.value })
              }
            />
          </Field>
        ) : null}

        {showTargetGrade ? (
          <Field
            label="Target Grade"
            className="md:col-span-2"
            error={errors.promote_grade_id}
            hint="This class teaches more than one grade. Pick which one this promotion lands in."
          >
            <SearchableSelect
              required={hasAttemptedSubmit}
              value={values.promote_grade_id}
              onChange={(value) =>
                setValues((current) => ({
                  ...current,
                  promote_grade_id: value,
                }))
              }
              options={promoteRuleSatisfyingGrades(
                selectedClass,
                promoteSourceGradeLevel,
                values.is_retention,
                values.allow_grade_skip,
              ).map((grade) => ({ value: grade.id, label: grade.name }))}
              placeholder="Select Grade"
              searchPlaceholder="Search Grades"
            />
          </Field>
        ) : null}

        {dialog.mode === "promote" || isBulkPromote ? (
          <>
            {!values.is_retention ? (
              <CheckboxField
                className="md:col-span-2"
                label="Allow Grade Skip"
                description="The Class picker above only shows the next grade up by default. Check this to also allow jumping more than one grade (e.g. Grade 7 straight to Grade 9)."
                checked={values.allow_grade_skip}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    allow_grade_skip: event.target.checked,
                  }))
                }
              />
            ) : null}
            <CheckboxField
              className="md:col-span-2"
              label="Retention (Repeat Grade)"
              description="Check this if the student is repeating the same grade, or moving to a lower grade, instead of a normal promotion."
              checked={values.is_retention}
              onChange={(event) =>
                setValues({ ...values, is_retention: event.target.checked })
              }
            />
            {values.is_retention ? (
              <Field
                label="Retention Reason"
                className="md:col-span-2"
                error={errors.retention_reason}
              >
                <TextAreaInput
                  invalid={Boolean(errors.retention_reason)}
                  value={values.retention_reason}
                  onChange={(event) =>
                    setValues({
                      ...values,
                      retention_reason: event.target.value,
                    })
                  }
                />
              </Field>
            ) : null}
          </>
        ) : null}

        {dialog.mode === "close" || isBulkClose ? (
          <>
            <Field label="Close Status">
              <SearchableSelect
                value={values.status}
                onChange={(value) =>
                  setValues((current) => ({
                    ...current,
                    status: value,
                    end_date: computeCloseEndDateDefault(
                      value,
                      (options?.academicYears || []).find(
                        (year) =>
                          year.id ===
                          resolveCloseAcademicYearId(record, dialog.records),
                      ),
                      resolveCloseFloorStartDate(record, dialog.records),
                    ),
                  }))
                }
                options={closeStatusOptions(enrollmentCloseStatuses)}
                placeholder="Select Status"
                searchPlaceholder="Search Status"
              />
            </Field>
            <Field
              label="End Date"
              hint={
                isBulkClose ? undefined : academicYearRangeHint(recordAcademicYear)
              }
            >
              <DateField
                value={values.end_date}
                onChange={(event) =>
                  setValues({ ...values, end_date: event.target.value })
                }
              />
            </Field>
            {values.status === "COMPLETED" ? (
              <>
                <Field
                  label="Graduation Grade"
                  error={errors.graduation_grade}
                  hint={
                    errors.graduation_grade
                      ? undefined
                      : "The grade the student is graduating from."
                  }
                >
                  <TextInput
                    invalid={Boolean(errors.graduation_grade)}
                    value={values.graduation_grade}
                    onChange={(event) =>
                      setValues({
                        ...values,
                        graduation_grade: capitalizeWords(event.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Leave Year" error={errors.leave_year}>
                  <TextInput
                    invalid={Boolean(errors.leave_year)}
                    value={values.leave_year}
                    onChange={(event) =>
                      setValues({ ...values, leave_year: event.target.value })
                    }
                  />
                </Field>
              </>
            ) : null}
          </>
        ) : null}
      </form>
    </CrudDialog>
    {backfillPreview ? (
      <BackfillPreviewDialog
        entries={backfillPreview}
        pendingStudentId={manualStepPendingStudentId}
        onCancel={() => setBackfillPreview(null)}
        onManualStep={handleManualStep}
        onConfirm={() => {
          setBackfillPreview(null);
          submitCreate();
        }}
      />
    ) : null}
    </>
  );
}

// Mirrors UNKNOWN_LEGACY_CLASS_PREFIX in server/src/service/enrollment-service.ts.
const UNKNOWN_LEGACY_CLASS_PREFIX = "Unknown (Legacy Import)";

// Leaner than classSelectOptions() below - every candidate here already
// shares the same grade and academic year (see candidateRealClasses), so
// repeating "Kindergarten Pre-K / 2025/2026" on every single row just made
// the dropdown wrap across several lines for nothing. Only capacity varies.
function candidateClassOptions(classes) {
  return classes.map((klass) => {
    const capacity = getClassCapacityLabel(klass);
    return {
      value: klass.id,
      label: klass.name,
      description: capacity.description,
      badge: capacity.badge,
      tone: capacity.tone,
      searchText: `${klass.name} ${capacity.description}`,
    };
  });
}

// Only a student's earliest missing year can be created directly (Historical
// Data only ever backfills a student's very first enrollment - see
// assertLegacyEnrollmentIsFirstEver on the backend), so only steps[0] gets
// the picker below. Any step after it still needs the normal Promote chain
// once the first one is real, same as any other student's history.
function candidateRealClasses(allClasses, step) {
  return allClasses.filter((klass) => {
    if (klass.name.startsWith(UNKNOWN_LEGACY_CLASS_PREFIX)) return false;
    if (klass.academic_year?.id !== step.academic_year_id) return false;
    return [klass.grade, ...(klass.additional_grades || [])]
      .filter(Boolean)
      .some((grade) => grade.id === step.grade_id);
  });
}

// Shown when previewBackfill() finds students who'd land in placeholder
// classes - stacks on top of the still-open EnrollmentDialog, same as
// useConfirm()'s own dialog does elsewhere in this form. Each row's earliest
// step doubles as a small inline form: pick the real class it should have
// been, then the "Use this class" link commits just that one student right
// away - no separate confirm, no button that does something unexplained.
function BackfillPreviewDialog({
  entries,
  pendingStudentId,
  onCancel,
  onManualStep,
  onConfirm,
}) {
  const [selectedClassByStudentId, setSelectedClassByStudentId] = useState({});
  const classesQuery = useQuery({
    queryKey: ["backfill-preview-classes"],
    queryFn: () => classesApi.list({ page: 1, size: 100 }),
  });
  const allClasses = classesQuery.data?.data || [];
  const studentWord = entries.length === 1 ? "student" : "students";

  return (
    <CrudDialog
      title="This will also backfill earlier years"
      description={`${entries.length} of the selected ${studentWord} joined at a lower grade than this class. The gap years will land in placeholder classes since nobody knows which real class they were actually in - pick one below if you already do.`}
      onClose={onCancel}
      panelClassName="max-w-3xl"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            disabled={Boolean(pendingStudentId)}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={Boolean(pendingStudentId)}
            onClick={onConfirm}
          >
            Enroll & Backfill
          </Button>
        </>
      }
    >
      <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--mws-line)]">
        <table className="w-full text-left text-xs">
          <thead className="bg-[var(--mws-soft)] font-semibold text-[var(--mws-muted)]">
            <tr>
              <th className="px-3 py-2">Student</th>
              <th className="px-3 py-2">Backfilled Into</th>
              <th className="px-3 py-2">Real Class</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const [firstStep, ...laterSteps] = entry.steps;
              const candidates = classesQuery.isLoading
                ? []
                : candidateRealClasses(allClasses, firstStep);
              const selectedClassId =
                selectedClassByStudentId[entry.student_id] || "";
              const isPending = pendingStudentId === entry.student_id;
              return (
                <tr
                  key={entry.student_id}
                  className="border-t border-[var(--mws-line)] align-top"
                >
                  <td className="px-3 py-2">{entry.full_name}</td>
                  <td className="px-3 py-2">
                    <p>
                      {firstStep.placeholder_class_id ? (
                        <Link
                          to={`/academic/classes/${firstStep.placeholder_class_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--mws-burgundy)] hover:underline"
                        >
                          {firstStep.grade_name} ({firstStep.academic_year_name})
                        </Link>
                      ) : (
                        <span>
                          {firstStep.grade_name} ({firstStep.academic_year_name})
                          <span className="text-[var(--mws-muted)]"> - new</span>
                        </span>
                      )}
                    </p>
                    {laterSteps.length > 0 ? (
                      <p className="mt-1 text-[var(--mws-muted)]">
                        Then{" "}
                        {laterSteps
                          .map(
                            (step) =>
                              `${step.grade_name} (${step.academic_year_name})`,
                          )
                          .join(", ")}{" "}
                        - Promote forward once the first year is real.
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {classesQuery.isLoading ? null : candidates.length === 0 ? (
                      <p className="text-[var(--mws-muted)]">
                        None yet.{" "}
                        <Link
                          to={`/academic?tab=classes&academic_year_id=${firstStep.academic_year_id}&grade_id=${firstStep.grade_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--mws-burgundy)] hover:underline"
                        >
                          View/create it
                        </Link>
                      </p>
                    ) : (
                      <div className="flex items-center gap-2">
                        <SearchableSelect
                          value={selectedClassId}
                          onChange={(value) =>
                            setSelectedClassByStudentId((current) => ({
                              ...current,
                              [entry.student_id]: value,
                            }))
                          }
                          options={candidateClassOptions(candidates)}
                          placeholder="Pick a class"
                          searchPlaceholder="Search classes"
                          className="w-40 shrink-0"
                          buttonClassName="h-8 text-xs"
                          disabled={isPending}
                        />
                        <button
                          type="button"
                          disabled={!selectedClassId || isPending}
                          onClick={() =>
                            onManualStep(
                              entry,
                              firstStep,
                              candidates.find((k) => k.id === selectedClassId),
                            )
                          }
                          className="shrink-0 whitespace-nowrap text-[var(--mws-burgundy)] hover:underline disabled:pointer-events-none disabled:text-[var(--mws-muted)]"
                        >
                          {isPending ? "Enrolling..." : "Use this"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-[var(--mws-muted)]">
        Left as a placeholder for now? Fix it later from that class's own
        page (Fix Class button) once the real one is known.
      </p>
    </CrudDialog>
  );
}

function computeEnrollmentErrors(
  values,
  { showClassField, showRetentionReason, showGraduationFields, showTargetGrade },
) {
  const errors = {};
  if (showClassField && !values.class_id) errors.class_id = "Class is required.";
  if (showTargetGrade && !values.promote_grade_id) {
    errors.promote_grade_id = "Grade is required.";
  }
  if (showRetentionReason && !values.retention_reason.trim()) {
    errors.retention_reason = "Retention reason is required.";
  }
  if (showGraduationFields && !values.graduation_grade.trim()) {
    errors.graduation_grade = "Graduation grade is required when status is Graduated.";
  }
  if (showGraduationFields && !values.leave_year.trim()) {
    errors.leave_year = "Leave year is required when status is Graduated.";
  }
  return errors;
}

// Transferred/Withdrawn are almost always closed as of today - default to
// that and show it right away instead of leaving the field blank. Graduated
// is different: it's tied to the enrollment's own academic year ending, so
// it defaults to that year's end date (falling back to today if the year
// has none set yet) rather than "today", which would usually be wrong for
// a graduation logged after the fact.
//
// "Today" isn't always valid, though - a class prepped ahead of time for a
// future academic year (see UPCOMING class status) can have a start_date
// that's still ahead of today, and the backend rejects an end_date before
// the enrollment's own start_date. Mirrors resolveDefaultCloseEndDate in
// enrollment-service.ts: clamp into the [enrollment start, academic year
// end] range instead of blindly using today.
//
// The class page's Close action is always bulk (see the "Bulk-only" note
// on bulkCloseMutation) - single-record `record` is undefined there, so
// the floor has to come from dialog.records instead. Uses the *latest*
// start_date among the selection, since that's the one still-invalid date
// "today" would need to clear for every selected enrollment at once.
function resolveCloseFloorStartDate(record, records) {
  if (record) return record.start_date;
  return (records || []).reduce(
    (latest, item) =>
      item?.start_date && (!latest || item.start_date > latest)
        ? item.start_date
        : latest,
    null,
  );
}

// Same bulk-vs-single gap as above - only meaningful when every selected
// enrollment shares one academic year (mirrors the pattern used elsewhere
// in this file for narrowing the class picker); a mixed selection has no
// single year to pin the Graduated end-date default to, so it just falls
// back to today in that case.
function resolveCloseAcademicYearId(record, records) {
  if (record) return record.academic_year?.id;
  if (!records || records.length === 0) return undefined;
  const firstYearId = records[0]?.academic_year?.id;
  return records.every((item) => item.academic_year?.id === firstYearId)
    ? firstYearId
    : undefined;
}

function computeCloseEndDateDefault(status, academicYear, enrollmentStartDate) {
  const today = dateInputFromIso(new Date().toISOString());
  if (status === "COMPLETED") {
    return dateInputFromIso(academicYear?.end_date) || today;
  }
  if (status === "TRANSFERRED" || status === "WITHDRAWN") {
    const startDate = dateInputFromIso(enrollmentStartDate);
    const yearStart = dateInputFromIso(academicYear?.start_date);
    const floor = startDate && startDate > yearStart ? startDate : yearStart;
    if (floor && today < floor) return floor;
    const yearEnd = dateInputFromIso(academicYear?.end_date);
    if (yearEnd && today > yearEnd) return yearEnd;
    return today;
  }
  return "";
}

// "COMPLETED" is the enrollment_status behind graduation (see
// TERMINAL_STUDENT_STATUS_TO_ENROLLMENT_STATUS in student-service.ts) -
// formatStatus() would render it as the generic "Completed", which doesn't
// read as a close reason next to Transferred/Withdrawn.
function closeStatusOptions(values) {
  return values.map((value) => ({
    value,
    label: value === "COMPLETED" ? "Graduated" : formatStatus(value),
  }));
}

function specialEducationTeacherOptions(employees) {
  return employees.map((employee) => {
    const count = employee.active_student_count || 0;
    return {
      value: employee.id,
      label: employee.identity.full_name,
      description: employee.identity.email,
      badge: `${count} student${count === 1 ? "" : "s"}`,
      tone: count > 0 ? "amber" : "green",
      searchText: employee.identity.full_name,
    };
  });
}

function dedupeStudents(students) {
  const byId = new Map();
  students.forEach((student) => {
    byId.set(student.id, student);
  });
  return Array.from(byId.values()).sort((left, right) =>
    left.identity.full_name.localeCompare(right.identity.full_name),
  );
}

function classSelectOptions(classes) {
  return classes.map((klass) => {
    const capacity = getClassCapacityLabel(klass);
    // UPCOMING classes (next year's, prepared ahead of time) are valid to
    // pick, but worth flagging so it's not mistaken for a live class -
    // capacity's own badge (Full/seats left) still wins when present.
    const isUpcoming = klass.status === "UPCOMING";
    return {
      value: klass.id,
      label: klass.name,
      description: [
        klass.grade?.name,
        klass.academic_year?.name,
        isUpcoming ? "Upcoming" : null,
        capacity.description,
      ]
        .filter(Boolean)
        .join(" / "),
      badge: capacity.badge ?? (isUpcoming ? "Upcoming" : null),
      tone: capacity.badge ? capacity.tone : isUpcoming ? "amber" : capacity.tone,
      searchText: `${klass.name} ${klass.grade?.name || ""} ${klass.academic_year?.name || ""} ${capacity.description}`,
    };
  });
}

function getClassCapacityLabel(klass) {
  if (klass.capacity === null || klass.capacity === undefined) {
    return { description: "No capacity limit", badge: null, tone: "neutral" };
  }

  const activeCount = klass.active_enrollment_count ?? 0;
  const remaining = Math.max(klass.capacity - activeCount, 0);
  if (remaining === 0) {
    return {
      description: `${activeCount}/${klass.capacity} students`,
      badge: "Full",
      tone: "red",
    };
  }

  return {
    description: `${activeCount}/${klass.capacity} students, ${remaining} seats left`,
    badge: `${remaining} seats`,
    tone: remaining <= 3 ? "amber" : "green",
  };
}

// Mirrors assertDateWithinAcademicYear in enrollment-service.ts - years
// without dates set yet (nullable) skip the check server-side too.
function academicYearRangeHint(academicYear) {
  if (!academicYear?.start_date || !academicYear?.end_date) return undefined;
  return `Must fall within ${academicYear.name}: ${formatDate(academicYear.start_date)} - ${formatDate(academicYear.end_date)}`;
}

function getEnrollmentDialogTitle(mode) {
  switch (mode) {
    case "create":
      return "New Enrollment";
    case "transfer":
      return "Move to Another Class";
    case "promote":
      return "Promote Student";
    case "bulk-promote":
      return "Promote Selected Students";
    case "bulk-transfer":
      return "Move Selected Students";
    case "close":
      return "Close Enrollment";
    case "bulk-close":
      return "Close Selected Enrollments";
    default:
      return "Enrollment";
  }
}

function enrollmentStatusTone(status) {
  switch (status) {
    case "ACTIVE":
      return "green";
    case "COMPLETED":
      return "neutral";
    case "TRANSFERRED":
      return "amber";
    case "WITHDRAWN":
      return "red";
    default:
      return statusTone(status);
  }
}
