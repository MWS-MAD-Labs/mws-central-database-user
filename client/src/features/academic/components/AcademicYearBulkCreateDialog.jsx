import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, TextInput } from "../../../components/ui/FormControls.jsx";
import { cleanPayload, optionalNumber } from "../../../lib/form.js";

// Mirrors AcademicYearValidation.BULK_CREATE on the backend.
const MAX_RANGE_YEARS = 50;

// "2020/2021" through "2025/2026" - one academic year per start year in the
// inclusive range, same generation the backend does.
function computeYearNames(startYear, endYear) {
  if (!startYear || !endYear || endYear <= startYear) return [];
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
  if (!startYear) errors.start_year = "Start year is required.";
  if (!endYear) errors.end_year = "End year is required.";
  if (startYear && endYear && endYear <= startYear) {
    errors.end_year =
      "Needs at least 2 years - use New Year instead for just one.";
  }
  if (startYear && endYear && endYear - startYear >= MAX_RANGE_YEARS) {
    errors.end_year = `Can't create ${MAX_RANGE_YEARS} or more academic years in one request.`;
  }
  return errors;
}

// Bulk-generates a run of academic years (e.g. 2020/2021 through 2025/2026)
// in one request instead of the New Year dialog's one-at-a-time flow. Only
// the year range is entered here - dates (July 1 - June 30) and status
// (Completed/Active/Upcoming, judged against today) are resolved
// automatically per year on the backend, same as every dev seed script in
// this repo already does. See AcademicYearService.bulkCreate.
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
          <Button form="academic-year-bulk-form" type="submit" disabled={isSubmitting}>
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
          <TextInput
            invalid={Boolean(errors.start_year)}
            type="number"
            value={values.start_year}
            onChange={(event) =>
              setValues({ ...values, start_year: event.target.value })
            }
          />
        </Field>
        <Field label="End Year" error={errors.end_year}>
          <TextInput
            invalid={Boolean(errors.end_year)}
            type="number"
            value={values.end_year}
            onChange={(event) =>
              setValues({ ...values, end_year: event.target.value })
            }
          />
        </Field>

        <div className="rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-3 text-sm sm:col-span-2">
          {yearNames.length > 0 ? (
            <>
              <p className="font-semibold text-[var(--mws-charcoal)]">
                Will create {yearNames.length} academic year
                {yearNames.length === 1 ? "" : "s"}:
              </p>
              <p className="mt-1 text-[var(--mws-muted)]">
                {yearNames.join(", ")}
              </p>
              {alreadyExisting.length > 0 ? (
                <p className="mt-2 text-[#805b18]">
                  Already exist, will be skipped: {alreadyExisting.join(", ")}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-[var(--mws-muted)]">
              Enter a start and end year to preview what gets created.
            </p>
          )}
        </div>

        {existingActiveYear ? (
          <p className="text-xs text-[var(--mws-muted)] sm:col-span-2">
            {existingActiveYear.name} is already Active, so none of these will
            be either - they'll land as Completed or Upcoming based on today.
          </p>
        ) : null}

        <p className="text-xs text-[var(--mws-muted)] sm:col-span-2">
          Dates: July 1 to June 30. Status (Completed/Active/Upcoming) is set
          automatically based on today.
        </p>
      </form>
    </CrudDialog>
  );
}
