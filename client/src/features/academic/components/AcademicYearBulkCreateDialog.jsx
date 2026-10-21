import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, NumberInput } from "../../../components/ui/FormControls.jsx";
import { cleanPayload, optionalNumber } from "../../../lib/form.js";
import { LIMITS } from "../../../lib/limits.js";
import { isValidYear, yearProblem } from "../utils/yearRange.js";

const MAX_RANGE_YEARS = 50;

function computeYearNames(startYear, endYear) {
  if (!isValidYear(String(startYear ?? "")) || !isValidYear(String(endYear ?? "")) || endYear <= startYear) return [];
  const names = [];
  for (let year = startYear; year <= endYear; year++) {
    names.push(`${year}/${year + 1}`);
  }
  return names;
}

function computeErrors(values) {
  const errors = {};
  const startYear = optionalNumber(values.start_year);
  const endYear = optionalNumber(values.end_year);
  const startProblem = yearProblem(values.start_year, "Start year");
  const endProblem = yearProblem(values.end_year, "End year");
  if (startProblem) errors.start_year = startProblem;
  if (endProblem) errors.end_year = endProblem;
  if (!startProblem && !endProblem && endYear <= startYear) {
    errors.end_year =
      "Needs at least 2 years. Use New Year instead for just one.";
  }
  if (!startProblem && !endProblem && endYear - startYear >= MAX_RANGE_YEARS) {
    errors.end_year = `Can't create ${MAX_RANGE_YEARS} or more academic years in one request.`;
  }
  return errors;
}

export function AcademicYearBulkCreateDialog({
  suggestedStartYear,
  existingYears,
  isSubmitting,
  onClose,
  onSubmit,
}) {
  const [values, setValues] = useState(() => ({
    start_year: String(suggestedStartYear ?? new Date().getFullYear()),
    end_year: "",
  }));
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const errors = hasAttemptedSubmit ? computeErrors(values) : {};

  const startYear = optionalNumber(values.start_year);
  const endYear = optionalNumber(values.end_year);
  const yearNames = computeYearNames(startYear, endYear);

  const existingNames = new Set((existingYears || []).map((year) => year.name));
  const alreadyExisting = yearNames.filter((name) => existingNames.has(name));
  const existingActiveYear = (existingYears || []).find(
    (year) => year.status === "ACTIVE",
  );

  function submit(event) {
    event.preventDefault();
    setHasAttemptedSubmit(true);
    if (Object.keys(computeErrors(values)).length > 0) return;

    onSubmit(
      cleanPayload({
        start_year: startYear,
        end_year: endYear,
      }),
    );
  }

  return (
    <CrudDialog
      title="Bulk Create Academic Years"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="academic-year-bulk-form" type="submit" loading={isSubmitting}>
            Create {yearNames.length > 0 ? `${yearNames.length} Year(s)` : ""}
          </Button>
        </>
      }
    >
      <form
        id="academic-year-bulk-form"
        onSubmit={submit}
        noValidate
        className="grid gap-4 sm:grid-cols-2"
      >
        <Field label="Start Year" error={errors.start_year}>
          <NumberInput
            invalid={Boolean(errors.start_year)}
            min={LIMITS.ACADEMIC_YEAR_MIN}
            max={LIMITS.ACADEMIC_YEAR_MAX}
            value={values.start_year}
            onChange={(start_year) => setValues({ ...values, start_year })}
          />
        </Field>
        <Field label="End Year" error={errors.end_year}>
          <NumberInput
            invalid={Boolean(errors.end_year)}
            min={LIMITS.ACADEMIC_YEAR_MIN}
            max={LIMITS.ACADEMIC_YEAR_MAX}
            value={values.end_year}
            onChange={(end_year) => setValues({ ...values, end_year })}
          />
        </Field>

        <div className="rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3 text-sm sm:col-span-2">
          {yearNames.length > 0 ? (
            <>
              <p className="font-semibold text-(--mws-charcoal)">
                Will create {yearNames.length} academic year
                {yearNames.length === 1 ? "" : "s"}:
              </p>
              <p className="mt-1 text-(--mws-muted)">
                {yearNames.join(", ")}
              </p>
              {alreadyExisting.length > 0 ? (
                <p className="mt-2 text-[#805b18]">
                  Already exist, will be skipped: {alreadyExisting.join(", ")}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-(--mws-muted)">
              Enter a start and end year to preview what gets created.
            </p>
          )}
        </div>

        {existingActiveYear ? (
          <p className="text-xs text-(--mws-muted) sm:col-span-2">
            {existingActiveYear.name} is already Active, so none of these will
            be either. They'll land as Completed or Upcoming based on today.
          </p>
        ) : null}

        <p className="text-xs text-(--mws-muted) sm:col-span-2">
          Dates: July 1 to June 30. Status (Completed/Active/Upcoming) is set
          automatically based on today.
        </p>
      </form>
    </CrudDialog>
  );
}
