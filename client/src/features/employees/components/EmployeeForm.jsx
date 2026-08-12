import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import {
  Field,
  SearchableSelect,
  SelectInput,
  TextAreaInput,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import {
  capitalizeWords,
  cleanPayload,
  dateInputFromIso,
  isoFromDateInput,
  trimmedOrUndefined,
} from "../../../lib/form.js";
import { formatStatus } from "../../../lib/format.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import {
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

const CONTRACT_DURATION_OPTIONS = [
  { value: "3", label: "3 months" },
  { value: "6", label: "6 months" },
  { value: "12", label: "1 year" },
  { value: "24", label: "2 years" },
  { value: "36", label: "3 years" },
  { value: "48", label: "4 years" },
  { value: "60", label: "5 years" },
];

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
  const [values, setValues] = useState(() =>
    getInitialValues(mode, employee, options),
  );
  // Snapshotted once (impure to read Date.now() during render) - the form
  // is a short-lived session, so "locked as of when it was opened" is fine.
  const [nowSnapshot] = useState(() => Date.now());

  const isCreate = mode === "create";

  function updateValue(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
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
    <form onSubmit={handleSubmit} className="min-w-0 space-y-5">
      <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
          Identity
        </h2>
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Field label="Full name">
            <TextInput
              required={isCreate}
              value={values.full_name}
              onChange={(event) =>
                updateValue("full_name", capitalizeWords(event.target.value))
              }
            />
          </Field>
          <Field label="Nick name">
            <TextInput
              required={isCreate}
              value={values.nick_name}
              onChange={(event) =>
                updateValue("nick_name", capitalizeWords(event.target.value))
              }
            />
          </Field>
          <Field label="Email">
            <div className="flex min-w-0 items-stretch">
              <TextInput
                required={isCreate}
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
          <Field label="Gender">
            <SearchableSelect
              required={isCreate}
              value={values.gender}
              onChange={(value) => updateValue("gender", value)}
              options={enumOptions(genderOptions)}
              placeholder="Select gender"
              searchPlaceholder="Search gender"
            />
          </Field>
          <Field label="Religion">
            <SearchableSelect
              required={isCreate}
              value={values.religion}
              onChange={(value) => updateValue("religion", value)}
              options={enumOptions(religionOptions)}
              placeholder="Select religion"
              searchPlaceholder="Search religion"
            />
          </Field>
          <Field label="Birth place">
            <TextInput
              required={isCreate}
              value={values.birth_place}
              onChange={(event) =>
                updateValue("birth_place", capitalizeWords(event.target.value))
              }
            />
          </Field>
          <Field label="Birth date">
            <TextInput
              required={isCreate}
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
              required={isCreate}
              inputMode="numeric"
              maxLength={9}
              placeholder="11.11.111"
              value={values.employee_id}
              onChange={(event) =>
                updateValue("employee_id", formatEmployeeId(event.target.value))
              }
            />
          </Field>
          <Field label="Status">
            <SearchableSelect
              required={isCreate}
              value={values.status}
              onChange={(value) => updateValue("status", value)}
              options={enumOptions(employeeStatuses)}
              placeholder="Select status"
              searchPlaceholder="Search status"
            />
          </Field>
          <Field label="Employment type">
            <SearchableSelect
              required={isCreate}
              value={values.employment_type}
              onChange={(value) => handleEmploymentTypeChange(value)}
              options={enumOptions(employmentTypes)}
              placeholder="Select type"
              searchPlaceholder="Search type"
            />
          </Field>
          <Field label="Unit">
            <SearchableSelect
              required={isCreate}
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
            hint={
              selectedUnit && !isSchoolUnit(selectedUnit.name)
                ? "Teacher / SE Teacher hidden - only valid for Kindergarten, Elementary, or Junior High."
                : undefined
            }
          >
            <SearchableSelect
              required={isCreate}
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
          <Field label="Job position">
            <SearchableSelect
              required={isCreate}
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
          <Field label="Building">
            <SearchableSelect
              required={isCreate}
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
          <Field label="Join date">
            <TextInput
              required={isCreate}
              type="date"
              value={values.join_date}
              onChange={(event) => handleJoinDateChange(event.target.value)}
            />
          </Field>
          {values.employment_type && values.employment_type !== "PERMANENT" ? (
            <>
              <Field label="Contract duration">
                <SelectInput
                  value={values.contract_duration_months}
                  onChange={(event) =>
                    handleContractDurationChange(event.target.value)
                  }
                >
                  <option value="">Set end date manually</option>
                  {CONTRACT_DURATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectInput>
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
          <Field label="Marital status">
            <SearchableSelect
              required={isCreate}
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
              maxLength={16}
              disabled={nikLocked || !canEditEmployeePii}
              placeholder="16 digit NIK"
              value={values.nik}
              onChange={(event) =>
                updateValue("nik", digitsOnly(event.target.value, 16))
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
              maxLength={15}
              disabled={npwpLocked || !canEditEmployeePii}
              placeholder="15 digit NPWP"
              value={values.npwp}
              onChange={(event) =>
                updateValue("npwp", digitsOnly(event.target.value, 15))
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
              maxLength={10}
              disabled={bankAccountLocked || !canEditEmployeePii}
              placeholder="10 digit BCA account"
              value={values.bank_account_number}
              onChange={(event) =>
                updateValue(
                  "bank_account_number",
                  digitsOnly(event.target.value, 10),
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
              maxLength={13}
              disabled={bpjsLocked || !canEditEmployeePii}
              placeholder="13 digit BPJS Kesehatan"
              value={values.bpjs_number}
              onChange={(event) =>
                updateValue("bpjs_number", digitsOnly(event.target.value, 13))
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
              maxLength={11}
              disabled={bpjsEmploymentLocked || !canEditEmployeePii}
              placeholder="11 digit BPJS Ketenagakerjaan"
              value={values.bpjs_employment_number}
              onChange={(event) =>
                updateValue(
                  "bpjs_employment_number",
                  digitsOnly(event.target.value, 11),
                )
              }
            />
          </Field>
        </div>
      </section>

      <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
          Offboarding
        </h2>
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Field label="Resignation date">
            <TextInput
              required={values.status === "RESIGNED"}
              type="date"
              value={values.resignation_date}
              onChange={(event) =>
                updateValue("resignation_date", event.target.value)
              }
            />
          </Field>
          <Field label="Last working date">
            <TextInput
              type="date"
              value={values.last_working_date}
              onChange={(event) =>
                updateValue("last_working_date", event.target.value)
              }
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

      <div className="flex flex-wrap justify-end">
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
    marital_status:
      identity.marital_status || (mode === "create" ? "SINGLE" : ""),
    mobile_phone: identity.mobile_phone || "",
    residential_address: identity.residential_address || "",
    nik: identity.nik || "",
    npwp: identity.npwp || "",
    bank_account_number: identity.bank_account_number || "",
    bpjs_number: identity.bpjs_number || "",
    bpjs_employment_number: identity.bpjs_employment_number || "",
    resignation_date: dateInputFromIso(offboarding.resignation_date),
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
    resignation_date: isoFromDateInput(values.resignation_date),
    last_working_date: isoFromDateInput(values.last_working_date),
    notes: trimmedOrUndefined(values.notes),
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

// Date <input> gives/wants "YYYY-MM-DD" - construct at noon local time so a
// timezone offset can never roll the date over to the previous/next day.
function addMonthsToDateInput(dateInput, months) {
  if (!dateInput) return "";
  const date = new Date(`${dateInput}T12:00:00`);
  date.setMonth(date.getMonth() + Number(months));
  return date.toISOString().slice(0, 10);
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

function enumOptions(values) {
  return values.map((value) => ({ value, label: formatStatus(value) }));
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
