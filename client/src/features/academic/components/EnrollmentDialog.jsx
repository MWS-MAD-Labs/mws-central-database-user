import { useQuery } from "@tanstack/react-query";
import { Plus, Undo2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { cn } from "../../../lib/cn.js";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import {
  CheckboxField,
  DateField,
  Field,
  SearchableSelect,
  TextAreaInput,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { studentsApi } from "../../students/api/studentsApi.js";
import { classesApi, enrollmentCloseStatuses } from "../api/academicApi.js";
import {
  capitalizeWords,
  cleanPayload,
  dateInputFromIso,
  isoFromDateInput,
  trimmedOrUndefined,
} from "../../../lib/form.js";
import { formatDate, formatStatus, statusTone } from "../../../lib/format.js";
import { showErrorToast } from "../../../lib/toast.js";

// Mirrors PROMOTE_WINDOW_DAYS in enrollment-service.ts.
const PROMOTE_WINDOW_DAYS = 30;

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
      pending_student_id: "",
      class_id: presetClassId || record?.class?.id || "",
      start_date:
        presetClass && dialog.mode === "create"
          ? dateInputFromIso(presetYear?.start_date)
          : "",
      effective_date: "",
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
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
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
  const errors = hasAttemptedSubmit
    ? computeEnrollmentErrors(values, {
        showClassField,
        showRetentionReason,
        showGraduationFields,
      })
    : {};
  const includedRecords = (dialog.records || []).filter(
    (enrollment) => !excludedEnrollmentIds.has(enrollment.id),
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
  const promoteSourceGradeLevel =
    dialog.mode === "promote"
      ? gradeLevelByName.get(record?.grade_level)
      : isBulkPromote &&
          (dialog.records || []).every(
            (enrollment) => enrollment.grade_level === dialog.records[0]?.grade_level,
          )
        ? gradeLevelByName.get(dialog.records?.[0]?.grade_level)
        : undefined;
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
          (dialog.records || []).every(
            (enrollment) => enrollment.academic_year?.id === dialog.records[0]?.academic_year?.id,
          )
        ? dialog.records?.[0]?.academic_year?.id
        : undefined;
  const promoteSourceAcademicYear = academicYearById.get(
    promoteSourceAcademicYearId,
  );
  const promoteSourceAcademicYearStart = promoteSourceAcademicYear?.start_date;
  // Mirrors assertValidGradeProgression's hard block on the backend - no
  // point letting the form submit only to bounce off the same 400. Skipped
  // when end_date isn't set, same as the backend (it's an optional field).
  const daysUntilPromoteWindowOpens =
    (dialog.mode === "promote" || isBulkPromote) &&
    promoteSourceAcademicYear?.end_date
      ? Math.ceil(
          (new Date(promoteSourceAcademicYear.end_date).getTime() -
            new Date().getTime()) /
            (1000 * 60 * 60 * 24) -
            PROMOTE_WINDOW_DAYS,
        )
      : null;
  const promoteWindowBlocked =
    daysUntilPromoteWindowOpens !== null && daysUntilPromoteWindowOpens > 0;
  // Mirrors assertGraduationNotTooEarly's hard block on the backend -
  // graduating (closing with status COMPLETED) is treated the same as
  // promoting, since both are "this year is ending" events. Skipped when
  // end_date isn't set, same as promote. Doesn't apply to the Historical
  // Data checkbox above (a create(), not a close() - deliberately bypasses
  // this the same way it bypasses the backend gate).
  const closeSourceAcademicYear = academicYearById.get(
    resolveCloseAcademicYearId(record, dialog.records),
  );
  const daysUntilGraduationWindowOpens =
    (dialog.mode === "close" || isBulkClose) &&
    values.status === "COMPLETED" &&
    closeSourceAcademicYear?.end_date
      ? Math.ceil(
          (new Date(closeSourceAcademicYear.end_date).getTime() -
            new Date().getTime()) /
            (1000 * 60 * 60 * 24) -
            PROMOTE_WINDOW_DAYS,
        )
      : null;
  const graduationWindowBlocked =
    daysUntilGraduationWindowOpens !== null &&
    daysUntilGraduationWindowOpens > 0;
  const classOptions = unitFilteredClasses.filter((klass) => {
    if (
      transferSourceAcademicYearId &&
      klass.academic_year?.id !== transferSourceAcademicYearId
    ) {
      return false;
    }
    if (transferSourceClassIds.has(klass.id)) return false;
    if (
      transferSourceGradeLevel !== undefined &&
      klass.grade?.level !== transferSourceGradeLevel
    ) {
      return false;
    }
    if (promoteSourceGradeLevel !== undefined) {
      // Promote always moves to a *later* academic year than the current
      // enrollment - mirrors assertValidGradeProgression on the backend.
      if (promoteSourceAcademicYearStart) {
        const klassYearStart = academicYearById.get(
          klass.academic_year?.id,
        )?.start_date;
        if (
          !klassYearStart ||
          new Date(klassYearStart) <= new Date(promoteSourceAcademicYearStart)
        ) {
          return false;
        }
      }
      if (values.is_retention) {
        if (klass.grade?.level !== promoteSourceGradeLevel) return false;
      } else if (klass.grade?.level <= promoteSourceGradeLevel) {
        return false;
      } else if (
        !values.allow_grade_skip &&
        klass.grade?.level > promoteSourceGradeLevel + 1
      ) {
        // Default to exactly one grade level up - mirrors
        // assertValidGradeProgression on the backend, which now rejects a
        // bigger jump (e.g. Grade 7 straight to Grade 9) unless
        // confirm_grade_skip is set. "Allow Grade Skip" below widens this.
        return false;
      }
    }
    return true;
  });

  const selectedClass = classOptions.find(
    (klass) => klass.id === values.class_id,
  );
  const classStudentOptionsQuery = useQuery({
    queryKey: ["enrollment-student-options", selectedClass?.grade?.id],
    enabled:
      dialog.mode === "create" &&
      !values.is_legacy &&
      Boolean(selectedClass?.grade?.id),
    queryFn: async () => {
      const [registered, active] = await Promise.all([
        studentsApi.list({
          page: 1,
          size: 100,
          current_grade_id: selectedClass.grade.id,
          status: "REGISTERED",
        }),
        studentsApi.list({
          page: 1,
          size: 100,
          current_grade_id: selectedClass.grade.id,
          status: "ACTIVE",
        }),
      ]);
      return dedupeStudents([...(registered.data || []), ...(active.data || [])]);
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
      selectedClass?.grade?.id,
    ],
    enabled:
      dialog.mode === "create" &&
      values.is_legacy &&
      Boolean(selectedClass?.academic_year?.id) &&
      Boolean(selectedClass?.grade?.id),
    queryFn: async () => {
      const result = await studentsApi.listBackfillCandidates({
        page: 1,
        size: 100,
        academic_year_id: selectedClass.academic_year.id,
        grade_id: selectedClass.grade.id,
      });
      return dedupeStudents(result.data || []);
    },
  });
  const studentOptionsQuery = values.is_legacy
    ? legacyStudentOptionsQuery
    : classStudentOptionsQuery;
  const excludedStudentIdSet = new Set(excludeStudentIds || []);
  const selectedStudents = (studentOptionsQuery.data || []).filter(
    (student) => selectedStudentIds.includes(student.id),
  );
  const availableStudents = (studentOptionsQuery.data || []).filter(
    (student) =>
      !selectedStudentIds.includes(student.id) &&
      !excludedStudentIdSet.has(student.id),
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

    setValues((current) => ({
      ...current,
      class_id: classId,
      student_id: "",
      pending_student_id: "",
      ...(dialog.mode === "create" ? { start_date: yearStartDate } : {}),
      ...(dialog.mode === "promote" || isBulkPromote
        ? { effective_date: yearStartDate }
        : {}),
    }));
    if (dialog.mode === "create") {
      setSelectedStudentIds([]);
    }
  }

  function addPendingStudent() {
    if (!values.pending_student_id) return;
    setSelectedStudentIds((current) =>
      current.includes(values.pending_student_id)
        ? current
        : [...current, values.pending_student_id],
    );
    setValues((current) => ({ ...current, pending_student_id: "" }));
  }

  function removeQueuedStudent(studentId) {
    setSelectedStudentIds((current) =>
      current.filter((id) => id !== studentId),
    );
  }

  function submit(event) {
    event.preventDefault();
    setHasAttemptedSubmit(true);
    if (
      Object.keys(
        computeEnrollmentErrors(values, {
          showClassField,
          showRetentionReason,
          showGraduationFields,
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
      onSubmit({
        studentId: selectedStudentIds[0],
        studentIds: selectedStudentIds,
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
          grade_id: selectedClass?.grade?.id,
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
              presetClassIsBlocked ||
              promoteWindowBlocked ||
              graduationWindowBlocked ||
              (isBulkAction && includedRecords.length === 0)
            }
          >
            Save
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
            description="Picks from every class including inactive ones, for a student's next unfilled step. Always lands Active - use Promote afterward to carry them forward year by year."
            checked={values.is_legacy}
            onChange={(event) => {
              const checked = event.target.checked;
              setValues((current) => ({
                ...current,
                is_legacy: checked,
                class_id: presetClassId || "",
                pending_student_id: "",
              }));
              setSelectedStudentIds([]);
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

        {promoteWindowBlocked ? (
          <div className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18] md:col-span-2">
            Too early to promote - {promoteSourceAcademicYear?.name} doesn't
            end until {formatDate(promoteSourceAcademicYear.end_date)}.
            Promotion opens in {daysUntilPromoteWindowOpens} day
            {daysUntilPromoteWindowOpens === 1 ? "" : "s"}.
          </div>
        ) : null}

        {graduationWindowBlocked ? (
          <div className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18] md:col-span-2">
            Too early to graduate - {closeSourceAcademicYear?.name} doesn't
            end until {formatDate(closeSourceAcademicYear.end_date)}.
            Graduation opens in {daysUntilGraduationWindowOpens} day
            {daysUntilGraduationWindowOpens === 1 ? "" : "s"}.
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
                        ? "Retention checked - showing the same grade in a later academic year."
                        : values.allow_grade_skip
                          ? "Grade skip allowed - showing every grade above the student's current one, in a later academic year."
                          : "Only showing the next grade up from the student's current one, in a later academic year. Check \"Allow Grade Skip\" below to jump further."
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
          <div className="space-y-3 md:col-span-2">
            <Field
              label="Students"
              hint={
                values.is_legacy
                  ? selectedClass
                    ? `Only showing students for whom this class is their next unfilled step - own join year at exactly their join grade with no enrollments yet, or right after their latest enrollment at ${selectedClass.grade?.name || "this"} grade or higher. No gaps, no backward grades.`
                    : "Select a class before adding students."
                  : selectedClass
                    ? `Showing ${selectedClass.grade?.name || "matching"} students only. Add students here, then save once.`
                    : "Select a class before adding students."
              }
            >
              <div className="grid gap-2 lg:grid-cols-[1fr_auto]">
                <SearchableSelect
                  value={values.pending_student_id}
                  onChange={(value) =>
                    setValues({ ...values, pending_student_id: value })
                  }
                  options={studentSelectOptions(availableStudents)}
                  placeholder={
                    !selectedClass
                      ? "Select class first"
                      : studentOptionsQuery.isLoading
                        ? "Loading students..."
                        : "Select student to add"
                  }
                  searchPlaceholder="Search Name Or NIS"
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!values.pending_student_id}
                  onClick={addPendingStudent}
                >
                  <Plus size={15} />
                  Add
                </Button>
              </div>
            </Field>

            <div className="min-h-20 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-3">
              {selectedStudents.length === 0 ? (
                <p className="text-sm font-semibold text-[var(--mws-muted)]">
                  No students queued yet.
                </p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {selectedStudents.map((student) => (
                    <div
                      key={student.id}
                      className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--mws-line)] bg-white px-3 py-2"
                    >
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeQueuedStudent(student.id)}
                      >
                        <X size={15} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {isBulkAction ? (
          <div className="space-y-2 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-3 md:col-span-2">
            <p className="text-sm font-semibold text-[var(--mws-muted)]">
              {includedRecords.length} of {dialog.records?.length || 0} selected
              enrollment(s) will be
              {isBulkClose ? " closed." : " updated to this target class."}
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {(dialog.records || []).map((enrollment) => {
                const isExcluded = excludedEnrollmentIds.has(enrollment.id);
                return (
                  <div
                    key={enrollment.id}
                    className={cn(
                      "flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--mws-line)] bg-white px-3 py-2",
                      isExcluded ? "opacity-50" : null,
                    )}
                  >
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
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge
                        tone={enrollmentStatusTone(enrollment.enrollment_status)}
                      >
                        {formatStatus(enrollment.enrollment_status)}
                      </StatusBadge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-[var(--mws-muted)] hover:text-[var(--mws-charcoal)]"
                        title={isExcluded ? "Include this enrollment" : "Exclude this enrollment"}
                        aria-label={
                          isExcluded
                            ? "Include this enrollment"
                            : "Exclude this enrollment"
                        }
                        onClick={() => toggleExcludedEnrollment(enrollment.id)}
                      >
                        {isExcluded ? <Undo2 size={15} /> : <X size={15} />}
                      </Button>
                    </div>
                  </div>
                );
              })}
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
  );
}

function computeEnrollmentErrors(
  values,
  { showClassField, showRetentionReason, showGraduationFields },
) {
  const errors = {};
  if (showClassField && !values.class_id) errors.class_id = "Class is required.";
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

function studentSelectOptions(students) {
  return students.map((student) => ({
    value: student.id,
    label: student.identity.full_name,
    description: [
      student.academic.nis ? `NIS ${student.academic.nis}` : null,
      student.academic.current_grade
        ? `Grade ${student.academic.current_grade}`
        : null,
    ]
      .filter(Boolean)
      .join(" / "),
    badge: formatStatus(student.status),
    tone: statusTone(student.status),
    searchText: `${student.identity.full_name} ${student.academic.nis || ""} ${student.academic.current_grade || ""} ${student.status}`,
  }));
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
