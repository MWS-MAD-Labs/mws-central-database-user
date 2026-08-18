import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import {
  Field,
  SearchableSelect,
  TextAreaInput,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import {
  addMonthsToDateInput,
  capitalizeWords,
  cleanPayload,
  CONTRACT_DURATION_OPTIONS,
  dateInputFromIso,
  isoFromDateInput,
  optionalNumber,
  trimmedOrUndefined,
} from "../../../lib/form.js";
import { formatEducationLevel, formatStatus } from "../../../lib/format.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import {
  educationLevels,
  employeesApi,
  employeeStatuses,
  employmentTypes,
  genderOptions,
  maritalStatuses,
  religionOptions,
} from "../api/employeesApi.js";

const emptyOptions = {
  units: [],
  jobPositions: [],
  jobLevels: [],
  buildings: [],
};

// Only this domain is ever allowed (server-side: emailWithAllowedDomain()) -
// so the field only needs the local part, not the whole address.
const ALLOWED_EMAIL_DOMAIN = "millennia21.id";

// Mirrors employee-role-rules.ts's TEACHING_JOB_LEVELS/SCHOOL_UNITS - keep
// these two in sync with that file if the business rule ever changes.
const SCHOOL_UNITS = new Set(["kindergarten", "elementary", "junior high"]);
const TEACHING_JOB_LEVELS = new Set(["teacher", "se teacher"]);

// Mirrors identifier-lock.ts's IDENTIFIER_EDIT_GRACE_PERIOD_MS - once NIK,
// NPWP, BPJS, or bank account have a value, that value can only be changed
// within 1 hour of the employee record being created. Adding a value to a
// field that's still empty is never time-gated - only changing one that's
// already set is.
const SENSITIVE_FIELD_GRACE_PERIOD_MS = 60 * 60 * 1000;

export function EmployeeForm({
  mode,
  employee,
  options = emptyOptions,
  isSubmitting,
  onSubmit,
}) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [initialValues] = useState(() =>
    getInitialValues(mode, employee, options),
  );
  const [values, setValues] = useState(initialValues);
  // Snapshotted once (impure to read Date.now() during render) - the form
  // is a short-lived session, so "locked as of when it was opened" is fine.
  const [nowSnapshot] = useState(() => Date.now());

  const isCreate = mode === "create";
  const isDirty = JSON.stringify(values) !== JSON.stringify(initialValues);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  // Native <input type="date"> reports value="" while a segment is
  // half-typed, same as a genuinely empty field - validity.badInput is the
  // only way to tell those apart, so it's tracked separately from `values`.
  const [lastWorkingDateIncomplete, setLastWorkingDateIncomplete] =
    useState(false);
  const errors = hasAttemptedSubmit
    ? computeEmployeeErrors(values, isCreate, { lastWorkingDateIncomplete })
    : {};

  function updateValue(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function handleReset() {
    setValues(initialValues);
    setLastWorkingDateIncomplete(false);
  }

  // Suggestions only - the fields stay free text so a genuinely new
  // institution/major can still be typed in.
  const educationSuggestionsQuery = useQuery({
    queryKey: ["employees", "education-suggestions"],
    queryFn: employeesApi.getEducationSuggestions,
  });
  const institutionNameSuggestions =
    educationSuggestionsQuery.data?.institution_names || [];
  const majorSuggestions = educationSuggestionsQuery.data?.majors || [];

  async function handleSubmit(event) {
    event.preventDefault();
    setHasAttemptedSubmit(true);

    if (
      Object.keys(
        computeEmployeeErrors(values, isCreate, { lastWorkingDateIncomplete }),
      ).length > 0
    ) {
      return;
    }

    const isAlreadyDue =
      values.status !== "RESIGNED" &&
      values.last_working_date &&
      new Date(isoFromDateInput(values.last_working_date)) <= new Date();

    if (isAlreadyDue) {
      const confirmed = await confirm({
        title: "Last working date already passed",
        description:
          "Status will change to Resigned right away once this is saved.",
        confirmLabel: "Save and resign",
        tone: "danger",
      });
      if (!confirmed) return;
    }

    onSubmit(buildPayload(values));
  }

  function handleUnitChange(unitId) {
    const unit = options.units.find((option) => option.id === unitId);
    const currentLevel = options.jobLevels.find(
      (level) => level.id === values.job_level_id,
    );
    // A unit switch can make the already-picked job level invalid (e.g. was
    // Teacher under Elementary, unit changes to SHIELD) - clear it (and the
    // job position that depended on it) rather than leave a stale, now-
    // rejected combination sitting in the form.
    const levelNowInvalid =
      currentLevel &&
      isTeachingJobLevel(currentLevel.name) &&
      !isSchoolUnit(unit?.name);

    setValues((current) => ({
      ...current,
      unit_id: unitId,
      ...(levelNowInvalid ? { job_level_id: "", job_position_id: "" } : {}),
    }));
  }

  function handleJobLevelChange(jobLevelId) {
    const level = options.jobLevels.find((option) => option.id === jobLevelId);
    const currentPosition = options.jobPositions.find(
      (position) => position.id === values.job_position_id,
    );
    const positionNowInvalid =
      currentPosition &&
      level &&
      currentPosition.is_teaching_position !== level.is_teaching_role;

    setValues((current) => ({
      ...current,
      job_level_id: jobLevelId,
      ...(positionNowInvalid ? { job_position_id: "" } : {}),
    }));
  }

  function handleJoinDateChange(joinDate) {
    setValues((current) => ({
      ...current,
      join_date: joinDate,
      contract_end_date: current.contract_duration_months
        ? addMonthsToDateInput(joinDate, current.contract_duration_months)
        : current.contract_end_date,
    }));
  }

  function handleContractDurationChange(months) {
    setValues((current) => ({
      ...current,
      contract_duration_months: months,
      contract_end_date: months
        ? addMonthsToDateInput(current.join_date, months)
        : current.contract_end_date,
    }));
  }

  function handleEmploymentTypeChange(employmentType) {
    setValues((current) => ({
      ...current,
      employment_type: employmentType,
      // Duration/end date don't apply to Permanent - keep a stale end date
      // from silently surviving the switch.
      ...(employmentType === "PERMANENT"
        ? { contract_duration_months: "", contract_end_date: "" }
        : {}),
    }));
  }

  // Mirrors employee-service.ts's create()/update() unit check - a DB Admin
  // can only place an employee in their own unit. Employee reads are
  // already unit-scoped, so the selected unit (edit mode) is always the
  // admin's own unit already - no need to keep an out-of-unit value alive.
  const unitOptionsForRole =
    user?.role === "DATABASE_ADMIN"
      ? options.units.filter((unit) => unit.id === user?.unit_id)
      : options.units;

  const selectedUnit = options.units.find(
    (option) => option.id === values.unit_id,
  );
  const selectedJobLevel = options.jobLevels.find(
    (option) => option.id === values.job_level_id,
  );

  // No unit picked yet -> nothing to filter against, show every level. Once
  // a unit is picked, Teacher/SE Teacher only make sense for school units.
  const availableJobLevels = selectedUnit
    ? options.jobLevels.filter(
        (level) =>
          isSchoolUnit(selectedUnit.name) || !isTeachingJobLevel(level.name),
      )
    : options.jobLevels;

  const availableJobPositions = selectedJobLevel
    ? options.jobPositions.filter(
        (position) =>
          position.is_teaching_position === selectedJobLevel.is_teaching_role,
      )
    : options.jobPositions;

  // Past the grace period, a sensitive field that already has a value can
  // only be cleared/changed by soft-deleting and recreating the employee -
  // matches identifier-lock.ts exactly (checked against the field's value
  // at load, since that's what the backend compares against too).
  const isPastGracePeriod =
    mode === "edit" &&
    Boolean(employee?.created_at) &&
    nowSnapshot - new Date(employee.created_at).getTime() >
      SENSITIVE_FIELD_GRACE_PERIOD_MS;
  const identity = employee?.identity || {};
  const nikLocked = isPastGracePeriod && Boolean(identity.nik);
  const npwpLocked = isPastGracePeriod && Boolean(identity.npwp);
  const bankAccountLocked =
    isPastGracePeriod && Boolean(identity.bank_account_number);
  const bpjsLocked = isPastGracePeriod && Boolean(identity.bpjs_number);
  const bpjsEmploymentLocked =
    isPastGracePeriod && Boolean(identity.bpjs_employment_number);
  // NIK/NPWP/bank account/BPJS are gated by can_view_employee_pii on both
  // read and write server-side (employee-service.ts) - unlike gender/
  // religion/birth date/marital status, which stay writable by anyone with
  // can_write_data since they're required create-form fields, not PII.
  // Kept separate from the grace-period locks above so the hint text can
  // tell the two reasons apart instead of always blaming the 1-hour window.
  const canEditEmployeePii =
    user?.role === "SUPER_ADMIN" || Boolean(user?.can_view_employee_pii);

  return (
    <form onSubmit={handleSubmit} className="min-w-0 space-y-5" noValidate>
      <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
          Identity
        </h2>
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Field label="Full name" error={errors.full_name}>
            <TextInput
              invalid={Boolean(errors.full_name)}
              value={values.full_name}
              onChange={(event) =>
                updateValue("full_name", capitalizeWords(event.target.value))
              }
            />
          </Field>
          <Field label="Nick name" error={errors.nick_name}>
            <TextInput
              invalid={Boolean(errors.nick_name)}
              value={values.nick_name}
              onChange={(event) =>
                updateValue("nick_name", capitalizeWords(event.target.value))
              }
            />
          </Field>
          <Field label="Email" error={errors.email_local}>
            <div className="flex min-w-0 items-stretch">
              <TextInput
                invalid={Boolean(errors.email_local)}
                className="rounded-r-none"
                value={values.email_local}
                onChange={(event) =>
                  updateValue(
                    "email_local",
                    sanitizeEmailLocalPart(event.target.value),
                  )
                }
              />
              <span className="flex shrink-0 items-center whitespace-nowrap rounded-r-xl border border-l-0 border-[var(--mws-line)] bg-[var(--mws-soft)] px-3 text-sm text-[var(--mws-muted)]">
                @{ALLOWED_EMAIL_DOMAIN}
              </span>
            </div>
          </Field>
          <Field label="Photo URL">
            <TextInput
              type="url"
              value={values.photo_url}
              onChange={(event) => updateValue("photo_url", event.target.value)}
            />
          </Field>
          <Field label="Gender" error={errors.gender}>
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              value={values.gender}
              onChange={(value) => updateValue("gender", value)}
              options={enumOptions(genderOptions)}
              placeholder="Select gender"
              searchPlaceholder="Search gender"
            />
          </Field>
          <Field label="Religion" error={errors.religion}>
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              value={values.religion}
              onChange={(value) => updateValue("religion", value)}
              options={enumOptions(religionOptions)}
              placeholder="Select religion"
              searchPlaceholder="Search religion"
            />
          </Field>
          <Field label="Birth place" error={errors.birth_place}>
            <TextInput
              invalid={Boolean(errors.birth_place)}
              value={values.birth_place}
              onChange={(event) =>
                updateValue("birth_place", capitalizeWords(event.target.value))
              }
            />
          </Field>
          <Field label="Birth date" error={errors.birth_date}>
            <TextInput
              invalid={Boolean(errors.birth_date)}
              type="date"
              value={values.birth_date}
              onChange={(event) =>
                updateValue("birth_date", event.target.value)
              }
            />
          </Field>
        </div>
      </section>

      <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
          Employment
        </h2>
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Field
            label="Employee ID"
            error={errors.employee_id}
            hint={
              <LengthHint
                value={values.employee_id}
                max={7}
                label="digits"
                prefix="Format: 11.11.111"
              />
            }
          >
            <TextInput
              invalid={Boolean(errors.employee_id)}
              inputMode="numeric"
              maxLength={9}
              placeholder="XX.XX.XXX"
              value={values.employee_id}
              onChange={(event) =>
                updateValue("employee_id", formatEmployeeId(event.target.value))
              }
            />
          </Field>
          <Field label="Status" error={errors.status}>
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              value={values.status}
              onChange={(value) => updateValue("status", value)}
              options={enumOptions(employeeStatuses)}
              placeholder="Select status"
              searchPlaceholder="Search status"
            />
          </Field>
          <Field label="Employment type" error={errors.employment_type}>
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              value={values.employment_type}
              onChange={(value) => handleEmploymentTypeChange(value)}
              options={enumOptions(employmentTypes)}
              placeholder="Select type"
              searchPlaceholder="Search type"
            />
          </Field>
          <Field label="Unit" error={errors.unit_id}>
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              value={values.unit_id}
              onChange={handleUnitChange}
              options={namedOptions(unitOptionsForRole)}
              placeholder={
                employee?.employment?.unit
                  ? `Keep current: ${employee.employment.unit}`
                  : "Select unit"
              }
              searchPlaceholder="Search units"
            />
          </Field>
          <Field
            label="Job level"
            error={errors.job_level_id}
            hint={
              selectedUnit && !isSchoolUnit(selectedUnit.name)
                ? "Teacher / SE Teacher hidden - only valid for Kindergarten, Elementary, or Junior High."
                : undefined
            }
          >
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              value={values.job_level_id}
              onChange={handleJobLevelChange}
              options={jobLevelOptions(availableJobLevels)}
              placeholder={
                employee?.employment?.job_level
                  ? `Keep current: ${employee.employment.job_level}`
                  : "Select level"
              }
              searchPlaceholder="Search levels"
            />
          </Field>
          <Field label="Job position" error={errors.job_position_id}>
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              value={values.job_position_id}
              onChange={(value) => updateValue("job_position_id", value)}
              options={namedOptions(availableJobPositions)}
              placeholder={
                employee?.employment?.job_position
                  ? `Keep current: ${employee.employment.job_position}`
                  : selectedJobLevel
                    ? "Select position"
                    : "Pick a job level first"
              }
              searchPlaceholder="Search positions"
            />
          </Field>
          <Field label="Building" error={errors.building_id}>
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              value={values.building_id}
              onChange={(value) => updateValue("building_id", value)}
              options={namedOptions(options.buildings)}
              placeholder={
                employee?.employment?.building
                  ? `Keep current: ${employee.employment.building}`
                  : "Select building"
              }
              searchPlaceholder="Search buildings"
            />
          </Field>
          <Field label="Join date" error={errors.join_date}>
            <TextInput
              invalid={Boolean(errors.join_date)}
              type="date"
              value={values.join_date}
              onChange={(event) => handleJoinDateChange(event.target.value)}
            />
          </Field>
          {mode === "edit" ? (
            <Field
              label="Effective date"
              hint="Only matters if unit, job position, job level, building, status, or employment type changed below - backdates the mutation history entry to when this actually happened. Leave blank to use today."
            >
              <TextInput
                type="date"
                value={values.effective_date}
                onChange={(event) =>
                  updateValue("effective_date", event.target.value)
                }
              />
            </Field>
          ) : null}
          {values.employment_type && values.employment_type !== "PERMANENT" ? (
            <>
              <Field label="Contract duration">
                <SearchableSelect
                  value={values.contract_duration_months}
                  onChange={handleContractDurationChange}
                  options={CONTRACT_DURATION_OPTIONS}
                  placeholder="Set end date manually"
                  searchPlaceholder="Search durations"
                />
              </Field>
              <Field
                label="Contract end date"
                hint={
                  values.contract_duration_months
                    ? "Auto-filled from join date + duration - still editable."
                    : undefined
                }
              >
                <TextInput
                  type="date"
                  value={values.contract_end_date}
                  onChange={(event) =>
                    updateValue("contract_end_date", event.target.value)
                  }
                />
              </Field>
            </>
          ) : null}
        </div>
      </section>

      <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <h2 className="mb-1 text-base font-semibold text-[var(--mws-charcoal)]">
          Contact And Sensitive Data
        </h2>
        <p className="mb-4 text-xs text-[var(--mws-muted)]">
          NIK, NPWP, bank account, and BPJS are optional. Once one has a value,
          it can only be changed within 1 hour of this employee being created -
          after that it's locked (soft-delete and recreate the employee to fix a
          mistake).
        </p>
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Field label="Marital status" error={errors.marital_status}>
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              value={values.marital_status}
              onChange={(value) => updateValue("marital_status", value)}
              options={enumOptions(maritalStatuses)}
              placeholder="Select marital status"
              searchPlaceholder="Search marital status"
            />
          </Field>
          <Field label="Mobile phone">
            <TextInput
              inputMode="tel"
              placeholder="08xx, +628xx, or 628xx"
              value={values.mobile_phone}
              onChange={(event) =>
                updateValue("mobile_phone", event.target.value)
              }
            />
          </Field>
          <Field label="Residential address" className="md:col-span-2">
            <TextAreaInput
              value={values.residential_address}
              onChange={(event) =>
                updateValue("residential_address", event.target.value)
              }
            />
          </Field>
          <Field
            label="NIK"
            hint={
              !canEditEmployeePii ? (
                <RestrictedPiiHint />
              ) : nikLocked ? (
                <LockedHint />
              ) : (
                <LengthHint value={values.nik} max={16} label="digits" />
              )
            }
          >
            <TextInput
              inputMode="numeric"
              disabled={nikLocked || !canEditEmployeePii}
              placeholder="XXXX XXXX XXXX XXXX"
              value={values.nik}
              onChange={(event) =>
                updateValue("nik", formatNik(event.target.value))
              }
            />
          </Field>
          <Field
            label="NPWP"
            hint={
              !canEditEmployeePii ? (
                <RestrictedPiiHint />
              ) : npwpLocked ? (
                <LockedHint />
              ) : (
                <LengthHint value={values.npwp} max={15} label="digits" />
              )
            }
          >
            <TextInput
              inputMode="numeric"
              disabled={npwpLocked || !canEditEmployeePii}
              placeholder="XX.XXX.XXX.X-XXX.XXX"
              value={values.npwp}
              onChange={(event) =>
                updateValue("npwp", formatNpwp(event.target.value))
              }
            />
          </Field>
          <Field
            label="Bank account number"
            hint={
              !canEditEmployeePii ? (
                <RestrictedPiiHint />
              ) : bankAccountLocked ? (
                <LockedHint />
              ) : (
                <LengthHint
                  value={values.bank_account_number}
                  max={10}
                  label="digits, BCA"
                />
              )
            }
          >
            <TextInput
              inputMode="numeric"
              disabled={bankAccountLocked || !canEditEmployeePii}
              placeholder="XXXX XXXX XX"
              value={values.bank_account_number}
              onChange={(event) =>
                updateValue(
                  "bank_account_number",
                  formatBankAccountNumber(event.target.value),
                )
              }
            />
          </Field>
          <Field
            label="BPJS Kesehatan"
            hint={
              !canEditEmployeePii ? (
                <RestrictedPiiHint />
              ) : bpjsLocked ? (
                <LockedHint />
              ) : (
                <LengthHint
                  value={values.bpjs_number}
                  max={13}
                  label="digits"
                />
              )
            }
          >
            <TextInput
              inputMode="numeric"
              disabled={bpjsLocked || !canEditEmployeePii}
              placeholder="XXXX XXXX XXXX X"
              value={values.bpjs_number}
              onChange={(event) =>
                updateValue("bpjs_number", formatBpjsNumber(event.target.value))
              }
            />
          </Field>
          <Field
            label="BPJS Ketenagakerjaan"
            hint={
              !canEditEmployeePii ? (
                <RestrictedPiiHint />
              ) : bpjsEmploymentLocked ? (
                <LockedHint />
              ) : (
                <LengthHint
                  value={values.bpjs_employment_number}
                  max={11}
                  label="digits"
                />
              )
            }
          >
            <TextInput
              inputMode="numeric"
              disabled={bpjsEmploymentLocked || !canEditEmployeePii}
              placeholder="XXXX XXXX XXX"
              value={values.bpjs_employment_number}
              onChange={(event) =>
                updateValue(
                  "bpjs_employment_number",
                  formatBpjsEmploymentNumber(event.target.value),
                )
              }
            />
          </Field>
        </div>
      </section>

      <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <h2 className="mb-1 text-base font-semibold text-[var(--mws-charcoal)]">
          Education
        </h2>
        <p className="mb-4 text-xs text-[var(--mws-muted)]">
          Highest or most recent education only, all optional.
        </p>
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Field label="Education level">
            <SearchableSelect
              value={values.education_level}
              onChange={(value) => updateValue("education_level", value)}
              options={enumOptions(educationLevels, formatEducationLevel)}
              placeholder="Select education level"
              searchPlaceholder="Search education level"
            />
          </Field>
          <Field label="Graduation year">
            <TextInput
              type="number"
              min={1950}
              max={new Date().getFullYear()}
              placeholder="e.g. 2015"
              value={values.graduation_year}
              onChange={(event) =>
                updateValue("graduation_year", event.target.value)
              }
            />
          </Field>
          <Field label="Institution name">
            <TextInput
              list="institution-name-suggestions"
              placeholder="e.g. Universitas Indonesia"
              value={values.institution_name}
              onChange={(event) =>
                updateValue("institution_name", event.target.value)
              }
            />
            <datalist id="institution-name-suggestions">
              {institutionNameSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          <Field label="Major">
            <TextInput
              list="major-suggestions"
              placeholder="e.g. Computer Science"
              value={values.major}
              onChange={(event) => updateValue("major", event.target.value)}
            />
            <datalist id="major-suggestions">
              {majorSuggestions.map((major) => (
                <option key={major} value={major} />
              ))}
            </datalist>
          </Field>
        </div>
      </section>

      <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
          Offboarding
        </h2>
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Field
            label="Last working date"
            error={errors.last_working_date}
            hint={errors.last_working_date ? undefined : buildLastWorkingDateHint(values)}
          >
            <TextInput
              invalid={Boolean(errors.last_working_date)}
              type="date"
              max={values.contract_end_date || undefined}
              value={values.last_working_date}
              onChange={(event) => {
                updateValue("last_working_date", event.target.value);
                setLastWorkingDateIncomplete(event.target.validity.badInput);
              }}
            />
          </Field>
          <Field label="Notes" className="md:col-span-2">
            <TextAreaInput
              value={values.notes}
              onChange={(event) => updateValue("notes", event.target.value)}
            />
          </Field>
        </div>
      </section>

      <div className="flex flex-wrap justify-end gap-3">
        {!isCreate && isDirty ? (
          <Button
            type="button"
            variant="secondary"
            disabled={isSubmitting}
            onClick={handleReset}
          >
            <RotateCcw size={16} />
            Reset
          </Button>
        ) : null}
        <Button type="submit" disabled={isSubmitting}>
          <Save size={16} />
          {isSubmitting
            ? "Saving..."
            : isCreate
              ? "Create employee"
              : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function getInitialValues(mode, employee, options) {
  const identity = employee?.identity || {};
  const employment = employee?.employment || {};
  const statusInfo = employee?.status_info || {};
  const offboarding = employee?.offboarding || {};

  return {
    full_name: identity.full_name || "",
    nick_name: identity.nick_name || "",
    email_local: emailLocalPart(identity.email),
    gender: identity.gender || "",
    religion: identity.religion || "",
    birth_place: identity.birth_place || "",
    birth_date: dateInputFromIso(identity.birth_date),
    photo_url: identity.photo_url || "",
    employee_id: formatEmployeeId(employment.employee_id || ""),
    status: statusInfo.status || (mode === "create" ? "ACTIVE" : ""),
    employment_type:
      statusInfo.employment_type || (mode === "create" ? "PERMANENT" : ""),
    unit_id: findOptionByName(options.units, employment.unit)?.id || "",
    job_position_id:
      findOptionByName(options.jobPositions, employment.job_position)?.id || "",
    job_level_id:
      findOptionByName(options.jobLevels, employment.job_level)?.id || "",
    building_id:
      findOptionByName(options.buildings, employment.building)?.id || "",
    join_date: dateInputFromIso(employment.join_date),
    contract_duration_months: "",
    contract_end_date: dateInputFromIso(statusInfo.contract_end_date),
    // Edit mode only - backdates unit/job_position/job_level/building/
    // status/employment_type mutation history if this change actually took
    // effect earlier than today. Blank means "now", same as omitting it.
    effective_date: "",
    marital_status:
      identity.marital_status || (mode === "create" ? "SINGLE" : ""),
    mobile_phone: identity.mobile_phone || "",
    residential_address: identity.residential_address || "",
    nik: formatNik(identity.nik || ""),
    npwp: formatNpwp(identity.npwp || ""),
    bank_account_number: formatBankAccountNumber(
      identity.bank_account_number || "",
    ),
    bpjs_number: formatBpjsNumber(identity.bpjs_number || ""),
    bpjs_employment_number: formatBpjsEmploymentNumber(
      identity.bpjs_employment_number || "",
    ),
    education_level: identity.education_level || "",
    institution_name: identity.institution_name || "",
    major: identity.major || "",
    graduation_year: identity.graduation_year || "",
    last_working_date: dateInputFromIso(offboarding.last_working_date),
    notes: offboarding.notes || "",
  };
}

function buildPayload(values) {
  return cleanPayload({
    full_name: trimmedOrUndefined(values.full_name),
    nick_name: trimmedOrUndefined(values.nick_name),
    email: buildEmail(values.email_local),
    gender: values.gender,
    religion: values.religion,
    birth_place: trimmedOrUndefined(values.birth_place),
    birth_date: isoFromDateInput(values.birth_date),
    photo_url: trimmedOrUndefined(values.photo_url),
    employee_id: trimmedOrUndefined(formatEmployeeId(values.employee_id)),
    status: values.status,
    employment_type: values.employment_type,
    unit_id: values.unit_id,
    job_position_id: values.job_position_id,
    job_level_id: values.job_level_id,
    building_id: values.building_id,
    join_date: isoFromDateInput(values.join_date),
    contract_end_date: isoFromDateInput(values.contract_end_date),
    marital_status: values.marital_status,
    mobile_phone: trimmedOrUndefined(values.mobile_phone),
    residential_address: trimmedOrUndefined(values.residential_address),
    nik: trimmedOrUndefined(values.nik),
    npwp: trimmedOrUndefined(values.npwp),
    bank_account_number: trimmedOrUndefined(values.bank_account_number),
    bpjs_number: trimmedOrUndefined(values.bpjs_number),
    bpjs_employment_number: trimmedOrUndefined(values.bpjs_employment_number),
    education_level: values.education_level || undefined,
    institution_name: trimmedOrUndefined(values.institution_name),
    major: trimmedOrUndefined(values.major),
    graduation_year: optionalNumber(values.graduation_year),
    last_working_date: isoFromDateInput(values.last_working_date),
    notes: trimmedOrUndefined(values.notes),
    effective_date: isoFromDateInput(values.effective_date),
  });
}

function LengthHint({ value, max, label, prefix }) {
  const length = countDigits(value);
  const isComplete = length === max;

  return (
    <span className="flex flex-wrap items-center justify-between gap-2">
      <span>{prefix || `Optional - ${max} ${label} if filled`}</span>
      <span
        className={isComplete ? "text-[#476b43]" : "text-[var(--mws-muted)]"}
      >
        {length}/{max} {label}
      </span>
    </span>
  );
}

function LockedHint() {
  return (
    <span className="font-semibold text-[#a43c41]">
      Locked - past the 1-hour edit window. Soft-delete and recreate the
      employee to change this.
    </span>
  );
}

function RestrictedPiiHint() {
  return (
    <span className="font-semibold text-[#a43c41]">
      Restricted - you don't have permission to view or edit employee PII.
    </span>
  );
}

function formatEmployeeId(value) {
  const digits = digitsOnly(value, 7);
  const groups = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 7)];
  return groups.filter(Boolean).join(".");
}

function digitsOnly(value, maxLength) {
  return String(value || "")
    .replace(/\D/g, "")
    .slice(0, maxLength);
}

// Groups digits like formatEmployeeId does, but with per-gap separators
// instead of a single uniform one - NPWP's official format mixes dots and a
// dash (XX.XXX.XXX.X-XXX.XXX). Extracts digits first, so pasting an already-
// formatted value (e.g. copied straight from a tax document) never loses
// digits to a stray maxLength on the raw punctuated string.
function formatDigitGroups(value, groupSizes, separators) {
  const totalDigits = groupSizes.reduce((sum, size) => sum + size, 0);
  const digits = digitsOnly(value, totalDigits);
  let result = "";
  let position = 0;
  for (let i = 0; i < groupSizes.length; i++) {
    const group = digits.slice(position, position + groupSizes[i]);
    if (!group) break;
    if (i > 0) result += separators[i - 1];
    result += group;
    position += groupSizes[i];
  }
  return result;
}

function formatNik(value) {
  return formatDigitGroups(value, [4, 4, 4, 4], [" ", " ", " "]);
}

function formatNpwp(value) {
  return formatDigitGroups(
    value,
    [2, 3, 3, 1, 3, 3],
    [".", ".", ".", "-", "."],
  );
}

function formatBankAccountNumber(value) {
  return formatDigitGroups(value, [4, 4, 2], [" ", " "]);
}

function formatBpjsNumber(value) {
  return formatDigitGroups(value, [4, 4, 4, 1], [" ", " ", " "]);
}

function formatBpjsEmploymentNumber(value) {
  return formatDigitGroups(value, [4, 4, 3], [" ", " "]);
}

function countDigits(value) {
  return String(value || "").replace(/\D/g, "").length;
}

function emailLocalPart(email) {
  if (!email) return "";
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

// Strips anything that isn't valid in an email local-part (RFC 5322-ish,
// the practical subset) - "@" in particular, since the domain is already a
// fixed suffix next to this input and typing one there just reads as a
// second, ambiguous "@".
function sanitizeEmailLocalPart(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._%+-]/g, "");
}

function buildEmail(localPart) {
  const trimmed = trimmedOrUndefined(localPart);
  return trimmed ? `${trimmed}@${ALLOWED_EMAIL_DOMAIN}` : undefined;
}

function isSchoolUnit(unitName) {
  return SCHOOL_UNITS.has(
    String(unitName || "")
      .trim()
      .toLowerCase(),
  );
}

function isTeachingJobLevel(levelName) {
  return TEACHING_JOB_LEVELS.has(
    String(levelName || "")
      .trim()
      .toLowerCase(),
  );
}

function findOptionByName(options, name) {
  if (!name) return null;
  return options.find((option) => option.name === name) || null;
}

function namedOptions(options) {
  return options.map((option) => ({
    value: option.id,
    label: option.name,
  }));
}

// Only checked once the admin has tried to submit - shows the label in red
// plus a message under it, and skips the browser's native "please fill out
// this field" tooltip entirely (native `required` is never set on these).
const REQUIRED_FIELD_LABELS = {
  full_name: "Full name",
  nick_name: "Nick name",
  email_local: "Email",
  gender: "Gender",
  religion: "Religion",
  birth_place: "Birth place",
  birth_date: "Birth date",
  employee_id: "Employee ID",
  status: "Status",
  employment_type: "Employment type",
  unit_id: "Unit",
  job_level_id: "Job level",
  job_position_id: "Job position",
  building_id: "Building",
  join_date: "Join date",
  marital_status: "Marital status",
};

function computeEmployeeErrors(
  values,
  isCreate,
  { lastWorkingDateIncomplete } = {},
) {
  const errors = {};
  if (isCreate) {
    for (const [field, label] of Object.entries(REQUIRED_FIELD_LABELS)) {
      if (!values[field]) {
        errors[field] = `${label} is required.`;
      }
    }
  }
  if (lastWorkingDateIncomplete) {
    errors.last_working_date = "Last working date is incomplete.";
  } else if (values.status === "RESIGNED" && !values.last_working_date) {
    errors.last_working_date =
      "Last working date is required when status is Resigned.";
  }
  return errors;
}

function enumOptions(values, format = formatStatus) {
  return values.map((value) => ({ value, label: format(value) }));
}

function buildLastWorkingDateHint(values) {
  const parts = [];
  if (values.status === "RESIGNED") {
    parts.push("Required when status is Resigned.");
  }
  parts.push("Status changes to Resigned automatically once this date passes.");
  if (values.contract_end_date) {
    parts.push("Can't be after the contract end date.");
  }
  return parts.join(" ");
}

function jobLevelOptions(levels) {
  return levels.map((level) => ({
    value: level.id,
    label: level.name,
    badge: level.is_teaching_role ? "Teaching" : null,
    tone: level.is_teaching_role ? "green" : "neutral",
    searchText: `${level.name} ${level.is_teaching_role ? "Teaching" : ""}`,
  }));
}
