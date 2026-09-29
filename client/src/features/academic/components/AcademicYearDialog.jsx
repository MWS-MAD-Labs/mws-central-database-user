import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import {
  CheckboxField,
  DateField,
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
import { formatDate, formatStatus } from "../../../lib/format.js";
import { academicYearStatuses } from "../api/academicApi.js";
import { parseAcademicYearStartYear } from "../utils/Pattern.js";

const STATUS_TRANSITION_WINDOW_DAYS = 30;

function computeDefaultEndDate(startDateInput) {
  if (!startDateInput) return "";
  const start = new Date(`${startDateInput}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return "";
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

function computeDefaultStartDate(startYear) {
  return startYear ? `${startYear}-07-01` : "";
}

export function AcademicYearDialog({
  dialog,
  suggestedStartYear,
  isSubmitting,
  onClose,
  onSubmit,
}) {
  const existingStartYear = parseAcademicYearStartYear(dialog.record?.name);
  const [values, setValues] = useState(() => {
    const initialStartYear =
      dialog.mode === "create"
        ? (suggestedStartYear ?? new Date().getFullYear())
        : (existingStartYear ?? new Date().getFullYear());
    const initialStartDate =
      dialog.mode === "create"
        ? computeDefaultStartDate(initialStartYear)
        : dateInputFromIso(dialog.record?.start_date);
    return {
      startYear: String(initialStartYear),
      start_date: initialStartDate,
      end_date:
        dialog.mode === "create"
          ? computeDefaultEndDate(initialStartDate)
          : dateInputFromIso(dialog.record?.end_date),
      status: dialog.record?.status || "UPCOMING",
      activateClasses: false,
    };
  });
  const [startDateTouched, setStartDateTouched] = useState(() =>
    Boolean(dateInputFromIso(dialog.record?.start_date)),
  );
  const [endDateTouched, setEndDateTouched] = useState(() =>
    Boolean(dateInputFromIso(dialog.record?.end_date)),
  );
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

  const existingStatus = dialog.record?.status;
  const daysUntilActivationOpens =
    existingStatus === "UPCOMING" &&
    values.status === "ACTIVE" &&
    values.start_date
      ? Math.ceil(
          (new Date(`${values.start_date}T00:00:00.000Z`).getTime() -
            new Date().getTime()) /
            (1000 * 60 * 60 * 24) -
            STATUS_TRANSITION_WINDOW_DAYS,
        )
      : null;
  const activationBlocked =
    daysUntilActivationOpens !== null && daysUntilActivationOpens > 0;

  const daysUntilCompletionOpens =
    existingStatus === "ACTIVE" &&
    values.status === "COMPLETED" &&
    values.end_date
      ? Math.ceil(
          (new Date(`${values.end_date}T00:00:00.000Z`).getTime() -
            new Date().getTime()) /
            (1000 * 60 * 60 * 24) -
            STATUS_TRANSITION_WINDOW_DAYS,
        )
      : null;
  const completionBlocked =
    daysUntilCompletionOpens !== null && daysUntilCompletionOpens > 0;

  const daysUntilLeavingActiveOpens =
    existingStatus === "ACTIVE" &&
    values.status === "UPCOMING" &&
    values.end_date
      ? Math.ceil(
          (new Date(`${values.end_date}T00:00:00.000Z`).getTime() -
            new Date().getTime()) /
            (1000 * 60 * 60 * 24) -
            STATUS_TRANSITION_WINDOW_DAYS,
        )
      : null;
  const leavingActiveBlocked =
    daysUntilLeavingActiveOpens !== null && daysUntilLeavingActiveOpens > 0;

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
            disabled={
              activationBlocked ||
              completionBlocked ||
              leavingActiveBlocked
            }
            loading={isSubmitting}
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
          label="Start Year"
          className="md:col-span-2"
          error={errors.startYear}
          hint={
            errors.startYear
              ? undefined
              : isLegacyName
                ? `Current name "${dialog.record?.name}" doesn't follow the YYYY/YYYY format. Saving will rename it to ${computedName || "..."}.`
                : `Academic year name will be: ${computedName || "..."}`
          }
        >
          <TextInput
            invalid={Boolean(errors.startYear)}
            type="number"
            value={values.startYear}
            onChange={(event) => {
              const nextStartYear = event.target.value;
              setValues((current) => {
                if (startDateTouched) {
                  return { ...current, startYear: nextStartYear };
                }
                const nextStartDate = computeDefaultStartDate(
                  optionalNumber(nextStartYear),
                );
                return {
                  ...current,
                  startYear: nextStartYear,
                  start_date: nextStartDate,
                  end_date: endDateTouched
                    ? current.end_date
                    : computeDefaultEndDate(nextStartDate),
                };
              });
            }}
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
          label="Start Date"
          error={errors.start_date}
          hint={
            errors.start_date
              ? undefined
              : startDateMismatch
                ? `Should fall within ${startYearNumber} to match ${computedName}.`
                : undefined
          }
        >
          <DateField
            invalid={Boolean(errors.start_date)}
            value={values.start_date}
            onChange={(event) => {
              const nextStartDate = event.target.value;
              setStartDateTouched(true);
              setValues((current) => ({
                ...current,
                start_date: nextStartDate,
                end_date: endDateTouched
                  ? current.end_date
                  : computeDefaultEndDate(nextStartDate),
              }));
            }}
          />
        </Field>
        <Field
          label="End Date"
          hint={
            endDateMismatch
              ? `Should fall within ${startYearNumber + 1} to match ${computedName}.`
              : "Defaults to a year after Start Date."
          }
        >
          <DateField
            value={values.end_date}
            onChange={(event) => {
              setEndDateTouched(true);
              setValues({ ...values, end_date: event.target.value });
            }}
          />
        </Field>
        <Field label="Status" className="md:col-span-2">
          <SearchableSelect
            value={values.status}
            onChange={(value) => setValues({ ...values, status: value })}
            options={enumOptions(academicYearStatuses)}
            placeholder="Select Status"
            searchPlaceholder="Search Status"
          />
        </Field>
        {activationBlocked ? (
          <div className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18] md:col-span-2">
            Too early to activate - this year doesn't start until{" "}
            {formatDate(values.start_date)}. Activation opens in{" "}
            {daysUntilActivationOpens} day
            {daysUntilActivationOpens === 1 ? "" : "s"}.
          </div>
        ) : null}
        {completionBlocked ? (
          <div className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18] md:col-span-2">
            Too early to mark Completed - this year doesn't end until{" "}
            {formatDate(values.end_date)}. Completion opens in{" "}
            {daysUntilCompletionOpens} day
            {daysUntilCompletionOpens === 1 ? "" : "s"}.
          </div>
        ) : null}
        {leavingActiveBlocked ? (
          <div className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18] md:col-span-2">
            Too early to move out of Active - this year doesn't end until{" "}
            {formatDate(values.end_date)}. This opens in{" "}
            {daysUntilLeavingActiveOpens} day
            {daysUntilLeavingActiveOpens === 1 ? "" : "s"}.
          </div>
        ) : null}
        {values.status === "ACTIVE" ? (
          <CheckboxField
            className="md:col-span-2"
            label="Also Activate This Year's Classes"
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
