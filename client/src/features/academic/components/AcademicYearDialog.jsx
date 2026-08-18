import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import {
  CheckboxField,
  Field,
  SearchableSelect,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import {
  cleanPayload,
  dateInputFromIso,
  isoFromDateInput,
  optionalNumber,
} from "../../../lib/form.js";
import { formatStatus } from "../../../lib/format.js";
import { academicYearStatuses } from "../api/academicApi.js";
import { parseAcademicYearStartYear } from "../utils/Pattern.js";

export function AcademicYearDialog({
  dialog,
  suggestedStartYear,
  isSubmitting,
  onClose,
  onSubmit,
}) {
  const existingStartYear = parseAcademicYearStartYear(dialog.record?.name);
  const [values, setValues] = useState(() => ({
    startYear:
      dialog.mode === "create"
        ? String(suggestedStartYear ?? new Date().getFullYear())
        : String(existingStartYear ?? new Date().getFullYear()),
    start_date: dateInputFromIso(dialog.record?.start_date),
    end_date: dateInputFromIso(dialog.record?.end_date),
    status: dialog.record?.status || "UPCOMING",
    activateClasses: false,
  }));
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const errors = hasAttemptedSubmit ? computeAcademicYearErrors(values) : {};

  const startYearNumber = optionalNumber(values.startYear);
  const computedName = startYearNumber
    ? `${startYearNumber}/${startYearNumber + 1}`
    : "";
  const isLegacyName = dialog.mode === "edit" && existingStartYear === null;

  const currentYear = new Date().getFullYear();
  const activeYearTooFar =
    values.status === "ACTIVE" &&
    startYearNumber &&
    Math.abs(currentYear - startYearNumber) > 1;

  const startDateYear = values.start_date
    ? Number(values.start_date.slice(0, 4))
    : null;
  const endDateYear = values.end_date
    ? Number(values.end_date.slice(0, 4))
    : null;
  const startDateMismatch =
    startYearNumber &&
    startDateYear !== null &&
    startDateYear !== startYearNumber;
  const endDateMismatch =
    startYearNumber &&
    endDateYear !== null &&
    endDateYear !== startYearNumber + 1;

  function submit(event) {
    event.preventDefault();
    setHasAttemptedSubmit(true);
    if (Object.keys(computeAcademicYearErrors(values)).length > 0) return;
    onSubmit(
      cleanPayload({
        name: computedName || undefined,
        start_date: isoFromDateInput(values.start_date),
        end_date: isoFromDateInput(values.end_date),
        status: values.status,
        activate_classes:
          values.status === "ACTIVE" ? values.activateClasses : undefined,
      }),
    );
  }

  return (
    <CrudDialog
      title={
        dialog.mode === "create" ? "New Academic Year" : "Edit Academic Year"
      }
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="academic-year-form"
            type="submit"
            disabled={isSubmitting}
          >
            Save
          </Button>
        </>
      }
    >
      <form
        id="academic-year-form"
        onSubmit={submit}
        noValidate
        className="grid gap-4 md:grid-cols-2"
      >
        <Field
          label="Start year"
          className="md:col-span-2"
          error={errors.startYear}
          hint={
            errors.startYear
              ? undefined
              : isLegacyName
                ? `Current name "${dialog.record?.name}" doesn't follow the YYYY/YYYY format - saving will rename it to ${computedName || "..."}.`
                : `Academic year name will be: ${computedName || "..."}`
          }
        >
          <TextInput
            invalid={Boolean(errors.startYear)}
            type="number"
            value={values.startYear}
            onChange={(event) =>
              setValues({ ...values, startYear: event.target.value })
            }
          />
        </Field>
        {activeYearTooFar ? (
          <p className="rounded-lg bg-[#fff0f1] px-3 py-2 text-xs font-semibold text-[#a43c41] md:col-span-2">
            {computedName} doesn't look like the current academic year (today is{" "}
            {currentYear}). Marking it ACTIVE will likely be rejected - use
            UPCOMING or COMPLETED instead.
          </p>
        ) : null}
        <Field
          label="Start date"
          error={errors.start_date}
          hint={
            errors.start_date
              ? undefined
              : startDateMismatch
                ? `Should fall within ${startYearNumber} to match ${computedName}.`
                : undefined
          }
        >
          <TextInput
            invalid={Boolean(errors.start_date)}
            type="date"
            value={values.start_date}
            onChange={(event) =>
              setValues({ ...values, start_date: event.target.value })
            }
          />
        </Field>
        <Field
          label="End date"
          hint={
            endDateMismatch
              ? `Should fall within ${startYearNumber + 1} to match ${computedName}.`
              : undefined
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
        <Field label="Status" className="md:col-span-2">
          <SearchableSelect
            value={values.status}
            onChange={(value) => setValues({ ...values, status: value })}
            options={enumOptions(academicYearStatuses)}
            placeholder="Select status"
            searchPlaceholder="Search status"
          />
        </Field>
        {values.status === "ACTIVE" ? (
          <CheckboxField
            className="md:col-span-2"
            label="Also activate this year's classes"
            description="Bulk-activates every currently Inactive class in this year. Classes you've deliberately left inactive elsewhere are untouched otherwise."
            checked={values.activateClasses}
            onChange={(event) =>
              setValues({ ...values, activateClasses: event.target.checked })
            }
          />
        ) : null}
      </form>
    </CrudDialog>
  );
}

function enumOptions(values) {
  return values.map((value) => ({ value, label: formatStatus(value) }));
}

function computeAcademicYearErrors(values) {
  const errors = {};
  if (!values.startYear) errors.startYear = "Start year is required.";
  if (!values.start_date) errors.start_date = "Start date is required.";
  return errors;
}
