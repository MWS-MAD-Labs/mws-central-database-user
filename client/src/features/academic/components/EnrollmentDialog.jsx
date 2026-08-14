import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import {
  CheckboxField,
  Field,
  SearchableSelect,
  TextAreaInput,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { studentsApi } from "../../students/api/studentsApi.js";
import {
  classesApi,
  enrollmentCloseStatuses,
  enrollmentStatuses,
} from "../api/academicApi.js";
import {
  cleanPayload,
  dateInputFromIso,
  isoFromDateInput,
  trimmedOrUndefined,
} from "../../../lib/form.js";
import { formatDate, formatStatus, statusTone } from "../../../lib/format.js";
import { showErrorToast } from "../../../lib/toast.js";

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
      force: false,
      is_legacy: false,
      is_retention: false,
      retention_reason: "",
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
  // Transfer moves a student sideways within the same academic year - a
  // lateral class change or a grade correction, not a promotion, so the
  // grade is deliberately unrestricted here (mirrors the backend, which
  // only checks the class's academic year and active status for a
  // transfer). Bulk transfer only narrows when every selected enrollment
  // shares the same academic year, since a mixed-year selection has no
  // single year to narrow to.
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
  const promoteSourceAcademicYearStart = academicYearById.get(
    promoteSourceAcademicYearId,
  )?.start_date;
  const classOptions = unitFilteredClasses.filter((klass) => {
    if (
      transferSourceAcademicYearId &&
      klass.academic_year?.id !== transferSourceAcademicYearId
    ) {
      return false;
    }
    if (transferSourceClassIds.has(klass.id)) return false;
    if (promoteSourceGradeLevel !== undefined) {
      // Promote always moves to a *later* academic year than the current
      // enrollment - mirrors assertValidGradeProgression on the backend.
      // A same-year grade change goes through transfer() instead.
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
  // the class being backfilled, so this drops both filters entirely instead
  // of narrowing by the selected class's grade - search by name/NIS instead.
  const legacyStudentOptionsQuery = useQuery({
    queryKey: ["enrollment-legacy-student-options"],
    enabled: dialog.mode === "create" && values.is_legacy,
    queryFn: async () => {
      const result = await studentsApi.list({
        page: 1,
        size: 100,
        sort_by: "full_name",
        sort_order: "asc",
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
          force: values.force,
          ...(values.is_legacy
            ? {
                is_legacy: true,
                status: values.status,
                end_date: isoFromDateInput(values.end_date),
              }
            : {}),
        }),
        specialEducationEmployeeId: values.is_legacy
          ? undefined
          : values.special_education_employee_id || undefined,
      });
      return;
    }

    if (dialog.mode === "transfer" || isBulkTransfer) {
      onSubmit(
        cleanPayload({ class_id: values.class_id, force: values.force }),
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
          force: values.force,
          is_retention: values.is_retention,
          retention_reason: values.is_retention
            ? trimmedOrUndefined(values.retention_reason)
            : undefined,
        }),
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
            disabled={isSubmitting || presetClassIsBlocked}
          >
            Save
          </Button>
        </>
      }
    >
      <form
        id="enrollment-form"
        onSubmit={submit}
        className="grid gap-4 md:grid-cols-2"
      >
        {dialog.mode === "create" ? (
          <CheckboxField
            className="md:col-span-2"
            label="Historical data (backfill a past enrollment)"
            description="Picks from every class including inactive ones, sets its final status directly, and doesn't touch the student's current class."
            checked={values.is_legacy}
            onChange={(event) => {
              const checked = event.target.checked;
              setValues((current) => ({
                ...current,
                is_legacy: checked,
                class_id: presetClassId || "",
                pending_student_id: "",
                status: checked ? "COMPLETED" : "TRANSFERRED",
                end_date: "",
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

        {dialog.mode !== "close" && !isBulkClose && !presetClassId ? (
          <Field
            label="Class"
            className="md:col-span-2"
            hint={
              dialog.mode === "create"
                ? "Choose the destination class first."
                : transferSourceAcademicYearId
                  ? "Only showing classes in the same academic year. Grade is not restricted."
                  : promoteSourceGradeLevel !== undefined
                    ? values.is_retention
                      ? "Retention checked - showing the same grade in a later academic year."
                      : "Only showing classes above the student's current grade, in a later academic year."
                    : undefined
            }
          >
            <SearchableSelect
              required
              value={values.class_id}
              onChange={handleClassChange}
              options={classSelectOptions(classOptions)}
              placeholder="Select class"
              searchPlaceholder="Search classes"
            />
          </Field>
        ) : null}

        {dialog.mode === "create" ? (
          <div className="space-y-3 md:col-span-2">
            <Field
              label="Students"
              hint={
                values.is_legacy
                  ? "Search by name or NIS - not limited to this class's grade, since a historical student's current grade has usually moved on."
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
                    !values.is_legacy && !selectedClass
                      ? "Select class first"
                      : studentOptionsQuery.isLoading
                        ? "Loading students..."
                        : "Select student to add"
                  }
                  searchPlaceholder="Search name or NIS"
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
              {dialog.records?.length || 0} selected enrollment(s) will be
              {isBulkClose ? " closed." : " updated to this target class."}
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {(dialog.records || []).map((enrollment) => (
                <div
                  key={enrollment.id}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--mws-line)] bg-white px-3 py-2"
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
                  <StatusBadge
                    tone={enrollmentStatusTone(enrollment.enrollment_status)}
                  >
                    {formatStatus(enrollment.enrollment_status)}
                  </StatusBadge>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {dialog.mode === "create" && !values.is_legacy ? (
          <Field
            label="Special Education teacher"
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
              searchPlaceholder="Search employee"
            />
          </Field>
        ) : null}

        {dialog.mode === "create" ? (
          <Field
            label="Start date"
            hint={academicYearRangeHint(selectedAcademicYear)}
          >
            <TextInput
              type="date"
              value={values.start_date}
              onChange={(event) =>
                setValues({ ...values, start_date: event.target.value })
              }
            />
          </Field>
        ) : null}

        {dialog.mode === "create" && values.is_legacy ? (
          <>
            <Field label="Enrollment status">
              <SearchableSelect
                value={values.status}
                onChange={(value) => setValues({ ...values, status: value })}
                options={closeStatusOptions(enrollmentStatuses)}
                placeholder="Select status"
                searchPlaceholder="Search status"
              />
            </Field>
            {values.status !== "ACTIVE" ? (
              <Field
                label="End date"
                hint={academicYearRangeHint(selectedAcademicYear)}
              >
                <TextInput
                  type="date"
                  value={values.end_date}
                  onChange={(event) =>
                    setValues({ ...values, end_date: event.target.value })
                  }
                />
              </Field>
            ) : null}
          </>
        ) : null}

        {dialog.mode === "promote" || isBulkPromote ? (
          <Field
            label="Effective date"
            hint={academicYearRangeHint(selectedAcademicYear)}
          >
            <TextInput
              type="date"
              value={values.effective_date}
              onChange={(event) =>
                setValues({ ...values, effective_date: event.target.value })
              }
            />
          </Field>
        ) : null}

        {dialog.mode === "promote" || isBulkPromote ? (
          <>
            <CheckboxField
              className="md:col-span-2"
              label="Retention (repeat grade)"
              description="Check this if the student is repeating the same grade, or moving to a lower grade, instead of a normal promotion."
              checked={values.is_retention}
              onChange={(event) =>
                setValues({ ...values, is_retention: event.target.checked })
              }
            />
            {values.is_retention ? (
              <Field label="Retention reason" className="md:col-span-2">
                <TextAreaInput
                  required
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
            <Field label="Close status">
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
                placeholder="Select status"
                searchPlaceholder="Search status"
              />
            </Field>
            <Field
              label="End date"
              hint={
                isBulkClose ? undefined : academicYearRangeHint(recordAcademicYear)
              }
            >
              <TextInput
                type="date"
                value={values.end_date}
                onChange={(event) =>
                  setValues({ ...values, end_date: event.target.value })
                }
              />
            </Field>
            {values.status === "COMPLETED" ? (
              <>
                <Field
                  label="Graduation grade"
                  hint="The grade the student is graduating from."
                >
                  <TextInput
                    value={values.graduation_grade}
                    onChange={(event) =>
                      setValues({
                        ...values,
                        graduation_grade: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Leave year">
                  <TextInput
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

        {(dialog.mode === "create" && !values.is_legacy) ||
        dialog.mode === "transfer" ||
        dialog.mode === "promote" ||
        isBulkPromote ||
        isBulkTransfer ? (
          <CheckboxField
            className="md:col-span-2"
            label="Force capacity override"
            description="Only Super Admin can override a full class."
            checked={values.force}
            onChange={(event) =>
              setValues({ ...values, force: event.target.checked })
            }
          />
        ) : null}
      </form>
    </CrudDialog>
  );
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
