import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import {
  CheckboxField,
  Field,
  SearchableSelect,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import {
  formatDate,
  formatStatus,
  UNKNOWN_LEGACY_GRADE_NAME,
} from "../../../lib/format.js";
import {
  capitalizeWords,
  cleanPayload,
  optionalNumber,
  trimmedOrUndefined,
} from "../../../lib/form.js";
import { classStatuses } from "../api/academicApi.js";

// Mirrors CLASS_STATUS_TRANSITION_WINDOW_DAYS in class-service.ts.
const CLASS_STATUS_TRANSITION_WINDOW_DAYS = 30;

// Class attributes only (name/grade/academic year/status/capacity) - teacher
// assignment and enrollment live on the class's own detail page now, not in
// this dialog, so create and edit are both a single short form.
export function ClassDialog({ dialog, options, isSubmitting, onClose, onSubmit, user }) {
  const record = dialog.record;
  const confirm = useConfirm();
  const [values, setValues] = useState(() => ({
    name: record?.name || "",
    grade_id: record?.grade?.id || "",
    // Extra grades this class also accepts, beyond the primary one above -
    // only for a genuinely mixed-age class (e.g. a Kindergarten section
    // teaching Pre-K/K1/K2 together). See ClassAdditionalGrade.
    additional_grade_ids: (record?.additional_grades || []).map(
      (grade) => grade.id,
    ),
    academic_year_id: record?.academic_year?.id || "",
    status: record?.status || "ACTIVE",
    capacity: record?.capacity ?? "",
  }));
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const errors = hasAttemptedSubmit ? computeClassErrors(values) : {};

  // Mirrors ClassService.update()'s two-layer gate on leaving ACTIVE: a hard
  // date block first (no override), then a soft block on active
  // students/teachers (confirm to override) - see class-service.ts.
  const leavingActive =
    record?.status === "ACTIVE" && values.status !== "ACTIVE";
  const targetAcademicYear = (options?.academicYears || []).find(
    (year) => year.id === values.academic_year_id,
  );
  const daysUntilLeaveActiveWindowOpens =
    leavingActive && targetAcademicYear?.end_date
      ? Math.ceil(
          (new Date(targetAcademicYear.end_date).getTime() -
            new Date().getTime()) /
            (1000 * 60 * 60 * 24) -
            CLASS_STATUS_TRANSITION_WINDOW_DAYS,
        )
      : null;
  const leaveActiveWindowBlocked =
    daysUntilLeaveActiveWindowOpens !== null &&
    daysUntilLeaveActiveWindowOpens > 0;
  const activeStudentCount = record?.active_enrollment_count || 0;
  const activeTeacherCount =
    (record?.homeroom_teachers?.length || 0) +
    (record?.supporting_homeroom_teachers?.length || 0) +
    (record?.subject_teachers?.length || 0);

  async function submit(event) {
    event.preventDefault();
    setHasAttemptedSubmit(true);
    if (Object.keys(computeClassErrors(values)).length > 0) return;
    if (leaveActiveWindowBlocked) return;

    let confirmUnresolvedOccupants;
    if (leavingActive && (activeStudentCount > 0 || activeTeacherCount > 0)) {
      const parts = [];
      if (activeStudentCount > 0) {
        parts.push(`${activeStudentCount} active student(s)`);
      }
      if (activeTeacherCount > 0) {
        parts.push(`${activeTeacherCount} active teacher assignment(s)`);
      }
      const proceed = await confirm({
        title: "Class still has active occupants",
        description: `Moving this class to ${formatStatus(values.status)} while it still has ${parts.join(" and ")}. Promote/transfer/close the students and end the teacher assignments first, or continue anyway.`,
        confirmLabel: "Continue Anyway",
        tone: "danger",
      });
      if (!proceed) return;
      confirmUnresolvedOccupants = true;
    }

    onSubmit(
      cleanPayload({
        name: trimmedOrUndefined(values.name),
        grade_id: values.grade_id,
        additional_grade_ids: values.additional_grade_ids,
        academic_year_id: values.academic_year_id,
        status: values.status,
        capacity:
          values.capacity === "__clear__"
            ? null
            : optionalNumber(values.capacity),
        confirm_unresolved_occupants: confirmUnresolvedOccupants,
      }),
    );
  }

  // "Unknown (Legacy Import)" is a student-record fallback for a grade
  // nothing on file recorded, not a real grade any class actually teaches.
  // Whether it shows up in the Additional Grades picker below used to
  // depend entirely on its unit_id happening to match the primary grade's -
  // excluded by name here instead, so it can't slip in regardless of what
  // unit_id it ends up with.
  const realGrades = (options?.grades || []).filter(
    (grade) => grade.name !== UNKNOWN_LEGACY_GRADE_NAME,
  );

  // DATABASE_ADMIN can only create/move classes within their own unit -
  // narrow the grade picker so they can't pick one that'll be rejected.
  const gradeOptionsForRole =
    user?.role === "DATABASE_ADMIN"
      ? realGrades.filter((grade) => grade.unit_id === user?.unit_id)
      : realGrades;

  // Mirrors ClassService's rule: additional grades only ever make sense
  // within the same unit as the primary grade (a Kindergarten section
  // teaching Pre-K/K1/K2 together, all one unit) - a class spanning units
  // isn't a real scenario, so the picker only offers same-unit grades.
  const selectedPrimaryGrade = gradeOptionsForRole.find(
    (grade) => grade.id === values.grade_id,
  );
  const additionalGradeOptions = selectedPrimaryGrade
    ? gradeOptionsForRole.filter(
        (grade) =>
          grade.id !== values.grade_id &&
          grade.unit_id === selectedPrimaryGrade.unit_id,
      )
    : [];

  function handlePrimaryGradeChange(nextGradeId) {
    const nextGrade = gradeOptionsForRole.find(
      (grade) => grade.id === nextGradeId,
    );
    setValues((current) => ({
      ...current,
      grade_id: nextGradeId,
      // Drop anything that no longer fits (repeats the new primary, or sat
      // in a different unit) rather than silently submitting a stale value.
      additional_grade_ids: current.additional_grade_ids.filter(
        (id) =>
          id !== nextGradeId &&
          gradeOptionsForRole.find((grade) => grade.id === id)?.unit_id ===
            nextGrade?.unit_id,
      ),
    }));
  }

  function toggleAdditionalGrade(gradeId, checked) {
    setValues((current) => ({
      ...current,
      additional_grade_ids: checked
        ? [...current.additional_grade_ids, gradeId]
        : current.additional_grade_ids.filter((id) => id !== gradeId),
    }));
  }

  return (
    <CrudDialog
      title={dialog.mode === "create" ? "New Class" : "Edit Class"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="class-form"
            type="submit"
            disabled={isSubmitting || leaveActiveWindowBlocked}
          >
            Save
          </Button>
        </>
      }
    >
      <form
        id="class-form"
        onSubmit={submit}
        noValidate
        className="grid gap-4 md:grid-cols-2"
      >
        <Field label="Name" className="md:col-span-2" error={errors.name}>
          <TextInput
            invalid={Boolean(errors.name)}
            value={values.name}
            onChange={(event) =>
              setValues({ ...values, name: capitalizeWords(event.target.value) })
            }
          />
        </Field>
        <Field label="Grade" error={errors.grade_id}>
          <SearchableSelect
            required={hasAttemptedSubmit}
            value={values.grade_id}
            onChange={handlePrimaryGradeChange}
            options={gradeSelectOptions(gradeOptionsForRole)}
            placeholder="Select Grade"
            searchPlaceholder="Search Grades"
          />
        </Field>
        {additionalGradeOptions.length > 0 ? (
          <Field
            label="Additional Grades (Mixed-Age Class)"
            className="md:col-span-2"
            hint="Only if this class actually teaches more than one grade at once. Leave unchecked otherwise."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {additionalGradeOptions.map((grade) => (
                <CheckboxField
                  key={grade.id}
                  label={grade.name}
                  checked={values.additional_grade_ids.includes(grade.id)}
                  onChange={(event) =>
                    toggleAdditionalGrade(grade.id, event.target.checked)
                  }
                />
              ))}
            </div>
          </Field>
        ) : null}
        <Field label="Academic Year" error={errors.academic_year_id}>
          <SearchableSelect
            required={hasAttemptedSubmit}
            value={values.academic_year_id}
            onChange={(value) =>
              setValues({ ...values, academic_year_id: value })
            }
            options={academicYearSelectOptions(options?.academicYears || [])}
            placeholder="Select Year"
            searchPlaceholder="Search Years"
          />
        </Field>
        <Field label="Status">
          <SearchableSelect
            value={values.status}
            onChange={(value) => setValues({ ...values, status: value })}
            options={enumOptions(classStatuses)}
            placeholder="Select Status"
            searchPlaceholder="Search Status"
          />
        </Field>

        {leaveActiveWindowBlocked ? (
          <div className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18] md:col-span-2">
            Too early to move this class out of Active -{" "}
            {targetAcademicYear?.name} doesn't end until{" "}
            {formatDate(targetAcademicYear.end_date)}. This opens in{" "}
            {daysUntilLeaveActiveWindowOpens} day
            {daysUntilLeaveActiveWindowOpens === 1 ? "" : "s"}.
          </div>
        ) : null}

        <Field
          label="Capacity"
          hint={
            dialog.mode === "create"
              ? "Defaults to 30 if left blank."
              : undefined
          }
        >
          <TextInput
            type="number"
            min="1"
            placeholder={dialog.mode === "create" ? "30" : undefined}
            value={values.capacity}
            onChange={(event) =>
              setValues({ ...values, capacity: event.target.value })
            }
          />
        </Field>
      </form>
    </CrudDialog>
  );
}

function computeClassErrors(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = "Name is required.";
  if (!values.grade_id) errors.grade_id = "Grade is required.";
  if (!values.academic_year_id)
    errors.academic_year_id = "Academic year is required.";
  return errors;
}

function enumOptions(values) {
  return values.map((value) => ({ value, label: formatStatus(value) }));
}

function gradeSelectOptions(grades) {
  return grades.map((grade) => ({
    value: grade.id,
    label: grade.name,
    searchText: `${grade.name} ${grade.level ?? ""}`,
  }));
}

function academicYearSelectOptions(years) {
  return years.map((year) => ({
    value: year.id,
    label: year.name,
    tone:
      year.status === "ACTIVE"
        ? "green"
        : year.status === "UPCOMING"
          ? "amber"
          : "neutral",
    searchText: `${year.name} ${formatStatus(year.status)}`,
  }));
}
