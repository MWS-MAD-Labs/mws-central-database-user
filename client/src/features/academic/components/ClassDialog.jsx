import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import {
  Field,
  SearchableSelect,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { formatStatus, statusTone } from "../../../lib/format.js";
import {
  capitalizeWords,
  cleanPayload,
  optionalNumber,
  trimmedOrUndefined,
} from "../../../lib/form.js";
import { classStatuses } from "../api/academicApi.js";

// Class attributes only (name/grade/academic year/status/capacity) - teacher
// assignment and enrollment live on the class's own detail page now, not in
// this dialog, so create and edit are both a single short form.
export function ClassDialog({ dialog, options, isSubmitting, onClose, onSubmit, user }) {
  const record = dialog.record;
  const [values, setValues] = useState(() => ({
    name: record?.name || "",
    grade_id: record?.grade?.id || "",
    academic_year_id: record?.academic_year?.id || "",
    status: record?.status || "ACTIVE",
    capacity: record?.capacity ?? "",
  }));
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const errors = hasAttemptedSubmit ? computeClassErrors(values) : {};

  function submit(event) {
    event.preventDefault();
    setHasAttemptedSubmit(true);
    if (Object.keys(computeClassErrors(values)).length > 0) return;
    onSubmit(
      cleanPayload({
        name: trimmedOrUndefined(values.name),
        grade_id: values.grade_id,
        academic_year_id: values.academic_year_id,
        status: values.status,
        capacity:
          values.capacity === "__clear__"
            ? null
            : optionalNumber(values.capacity),
      }),
    );
  }

  // DATABASE_ADMIN can only create/move classes within their own unit -
  // narrow the grade picker so they can't pick one that'll be rejected.
  const gradeOptionsForRole =
    user?.role === "DATABASE_ADMIN"
      ? (options?.grades || []).filter(
          (grade) => grade.unit_id === user?.unit_id,
        )
      : options?.grades || [];

  return (
    <CrudDialog
      title={dialog.mode === "create" ? "New Class" : "Edit Class"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="class-form" type="submit" disabled={isSubmitting}>
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
            onChange={(value) => setValues({ ...values, grade_id: value })}
            options={gradeSelectOptions(gradeOptionsForRole)}
            placeholder="Select Grade"
            searchPlaceholder="Search Grades"
          />
        </Field>
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
        <Field
          label="Capacity"
          hint={
            dialog.mode === "create"
              ? "Defaults to 30 if left blank. A full class must be raised here before it can take more students - there's no override."
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
    badge: formatStatus(year.status),
    tone: statusTone(year.status),
    searchText: `${year.name} ${formatStatus(year.status)}`,
  }));
}
