import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Camera, RotateCcw, Save, UserRound } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import { PhotoCropDialog } from "../../../components/photo/PhotoCropDialog.jsx";
import {
  CheckboxField,
  DateField,
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
  phoneDigitsOnly,
  trimmedOrUndefined,
} from "../../../lib/form.js";
import { formatEducationLevel, formatStatus } from "../../../lib/format.js";
import { MAX_PHOTO_SIZE_BYTES, validateFileSize } from "../../../lib/fileSize.js";
import { showErrorToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { masterDataApi } from "../../master-data/api/masterDataApi.js";
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

// Mirrors employee-role-rules.ts's TEACHING_JOB_LEVELS/SCHOOL_UNITS/
// SPECIAL_EDUCATION_*_NAME - keep these in sync with that file if the
// business rule ever changes.
const SCHOOL_UNITS = new Set(["kindergarten", "elementary", "junior high"]);
const TEACHING_JOB_LEVELS = new Set(["teacher", "se teacher"]);
const SPECIAL_EDUCATION_POSITION_NAME = "special education teacher";
const SPECIAL_EDUCATION_LEVEL_NAME = "se teacher";

// Mirrors identifier-lock.ts's IDENTIFIER_EDIT_GRACE_PERIOD_MS - once NIK,
// NPWP, BPJS, or bank account have a value, that value can only be changed
// within 1 day of the employee record being created. Adding a value to a
// field that's still empty is never time-gated - only changing one that's
// already set is.
const SENSITIVE_FIELD_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

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
  // DateField reports value="" while a date is half-typed, same as a
  // genuinely empty field - the synthetic validity.badInput it emits is the
  // only way to tell those apart, so it's tracked separately from `values`.
  const [lastWorkingDateIncomplete, setLastWorkingDateIncomplete] =
    useState(false);
  const errors = hasAttemptedSubmit
    ? computeEmployeeErrors(values, isCreate, { lastWorkingDateIncomplete })
    : {};
  // Create mode only - there's no employee id yet to upload against (the
  // photo endpoint is POST /employees/:id/photo), so the crop happens here
  // and the actual upload is chained by EmployeeCreatePage once create()
  // returns an id. Edit mode manages photos from the detail page instead,
  // where uploading immediately makes sense.
  const [pendingPhotoFile, setPendingPhotoFile] = useState(null);
  const [pendingPhotoBlob, setPendingPhotoBlob] = useState(null);
  const pendingPhotoPreviewUrl = useMemo(
    () => (pendingPhotoBlob ? URL.createObjectURL(pendingPhotoBlob) : null),
    [pendingPhotoBlob],
  );
  useEffect(() => {
    return () => {
      if (pendingPhotoPreviewUrl) URL.revokeObjectURL(pendingPhotoPreviewUrl);
    };
  }, [pendingPhotoPreviewUrl]);

  function updateValue(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function handleReset() {
    setValues(initialValues);
    setLastWorkingDateIncomplete(false);
  }

  // Suggestions only - the fields stay free text so a genuinely new
  // institution/major can still be typed in. Merges the canonical master
  // data list (admin-curated, see Master Data > Institutions/Majors) with
  // whatever's already on other employees, so a value someone typed before
  // it was added to master data still shows up.
  const educationSuggestionsQuery = useQuery({
    queryKey: ["employees", "education-suggestions"],
    queryFn: employeesApi.getEducationSuggestions,
  });
  const masterInstitutionsQuery = useQuery({
    queryKey: ["master-data", "institutions"],
    queryFn: () => masterDataApi.institutions({ size: 100 }),
  });
  const masterMajorsQuery = useQuery({
    queryKey: ["master-data", "majors"],
    queryFn: () => masterDataApi.majors({ size: 100 }),
  });
  const institutionNameSuggestions = mergeSuggestions(
    masterInstitutionsQuery.data?.data,
    educationSuggestionsQuery.data?.institution_names,
  );
  const majorSuggestions = mergeSuggestions(
    masterMajorsQuery.data?.data,
    educationSuggestionsQuery.data?.majors,
  );

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

    // Warn before a value that's about to lock in - matches
    // identifier-lock.ts: once one of these has a value, it's only editable
    // within 1 day of the employee's creation (immediately locked if that
    // window's already passed on an existing record).
    const lockingFields = getIdentityLockWarnings(values, identity, mode);
    if (lockingFields.length > 0) {
      const confirmed = await confirm({
        title:
          lockingFields.length > 1
            ? "This will lock these sensitive fields"
            : "This will lock a sensitive field",
        description: (
          <>
            <p>
              {isPastGracePeriod
                ? "Locks immediately after saving - already past the 1-day edit window:"
                : "Editable only within 1 day of this employee being created, then locked for good:"}
            </p>
            <ul className="mt-2 list-disc space-y-0.5 pl-5 font-medium text-[var(--mws-charcoal)]">
              {lockingFields.map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
          </>
        ),
        confirmLabel: "Save anyway",
        tone: "danger",
      });
      if (!confirmed) return;
    }

    onSubmit(buildPayload(values), pendingPhotoBlob);
  }

  function handlePhotoFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const sizeError = validateFileSize(file, MAX_PHOTO_SIZE_BYTES);
    if (sizeError) {
      showErrorToast(sizeError);
      return;
    }
    setPendingPhotoFile(file);
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
      !isJobPositionCompatibleWithLevel(currentPosition, level);

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

  // Cascading, in order: Unit -> Job Level -> Job Position. Each stays
  // empty until its prerequisite is picked, instead of showing every
  // option up front - picking Job Level before Unit (or Job Position
  // before Job Level) isn't a valid combination to build toward anyway.
  const availableJobLevels = selectedUnit
    ? options.jobLevels.filter(
        (level) =>
          isSchoolUnit(selectedUnit.name) || !isTeachingJobLevel(level.name),
      )
    : [];

  const availableJobPositions = selectedJobLevel
    ? options.jobPositions.filter((position) =>
        isJobPositionCompatibleWithLevel(position, selectedJobLevel),
      )
    : [];

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
  const kpjLocked = isPastGracePeriod && Boolean(identity.kpj_number);
  // NIK/NPWP/bank account/BPJS are gated by can_view_employee_pii on both
  // read and write server-side (employee-service.ts) - unlike gender/
  // religion/birth date/marital status, which stay writable by anyone with
  // can_write_employee_data since they're required create-form fields, not PII.
  // Kept separate from the grace-period locks above so the hint text can
  // tell the two reasons apart instead of always blaming the 1-day window.
  const canEditEmployeePii =
    user?.role === "SUPER_ADMIN" || Boolean(user?.can_view_employee_pii);

  return (
    <>
    <form onSubmit={handleSubmit} className="min-w-0 space-y-5" noValidate>
      <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
          Identity
        </h2>
        {isCreate ? (
          <div className="mb-4 flex items-center gap-4">
            <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
              {pendingPhotoPreviewUrl ? (
                <img
                  src={pendingPhotoPreviewUrl}
                  alt="Selected photo preview"
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                <UserRound size={26} />
              )}
              <label
                className="absolute -bottom-1 -right-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-[var(--mws-burgundy)] text-white shadow-sm hover:bg-[var(--mws-burgundy-dark)]"
                aria-label="Add Photo"
              >
                <Camera size={12} />
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handlePhotoFileChange}
                />
              </label>
            </div>
            <div className="text-sm text-[var(--mws-muted)]">
              <p className="font-semibold text-[var(--mws-charcoal)]">Photo</p>
              <p>Optional - crop and upload happens right after this employee is created.</p>
            </div>
          </div>
        ) : null}
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Field label="Full Name" error={errors.full_name}>
            <TextInput
              invalid={Boolean(errors.full_name)}
              value={values.full_name}
              onChange={(event) =>
                updateValue("full_name", capitalizeWords(event.target.value))
              }
            />
          </Field>
          <Field label="Nick Name" error={errors.nick_name}>
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
          {!isCreate ? (
            <Field
              label="Photo URL"
              hint="Legacy field for a manually-linked photo (e.g. Google Drive) - new photos should go through the upload/crop control on the detail page instead."
            >
              <TextInput
                type="url"
                value={values.photo_url}
                onChange={(event) => updateValue("photo_url", event.target.value)}
              />
            </Field>
          ) : null}
          <Field label="Gender" error={errors.gender}>
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              value={values.gender}
              onChange={(value) => updateValue("gender", value)}
              options={enumOptions(genderOptions)}
              placeholder="Select Gender"
              searchPlaceholder="Search Gender"
            />
          </Field>
          <Field label="Religion" error={errors.religion}>
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              value={values.religion}
              onChange={(value) => updateValue("religion", value)}
              options={enumOptions(religionOptions)}
              placeholder="Select Religion"
              searchPlaceholder="Search Religion"
            />
          </Field>
          <Field label="Birth Place" error={errors.birth_place}>
            <TextInput
              invalid={Boolean(errors.birth_place)}
              value={values.birth_place}
              onChange={(event) =>
                updateValue("birth_place", capitalizeWords(event.target.value))
              }
            />
          </Field>
          <Field label="Birth Date" error={errors.birth_date}>
            <DateField
              invalid={Boolean(errors.birth_date)}
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
              placeholder="Select Status"
              searchPlaceholder="Search Status"
            />
          </Field>
          <Field label="Employment Type" error={errors.employment_type}>
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              value={values.employment_type}
              onChange={(value) => handleEmploymentTypeChange(value)}
              options={enumOptions(employmentTypes)}
              placeholder="Select Type"
              searchPlaceholder="Search Type"
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
              searchPlaceholder="Search Units"
            />
          </Field>
          <Field
            label="Job Level"
            error={errors.job_level_id}
            hint={
              !selectedUnit
                ? "Select Unit first."
                : !isSchoolUnit(selectedUnit.name)
                  ? "Teacher / SE Teacher hidden - only valid for Kindergarten, Elementary, or Junior High."
                  : undefined
            }
          >
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              disabled={!selectedUnit}
              value={values.job_level_id}
              onChange={handleJobLevelChange}
              options={jobLevelOptions(availableJobLevels)}
              placeholder={
                !selectedUnit
                  ? "Select unit first"
                  : employee?.employment?.job_level
                    ? `Keep current: ${employee.employment.job_level}`
                    : "Select level"
              }
              searchPlaceholder="Search Levels"
            />
          </Field>
          <Field
            label="Job Position"
            error={errors.job_position_id}
            hint={!selectedJobLevel ? "Select Job Level first." : undefined}
          >
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              disabled={!selectedJobLevel}
              value={values.job_position_id}
              onChange={(value) => updateValue("job_position_id", value)}
              options={namedOptions(availableJobPositions)}
              placeholder={
                !selectedJobLevel
                  ? "Select job level first"
                  : employee?.employment?.job_position
                    ? `Keep current: ${employee.employment.job_position}`
                    : "Select position"
              }
              searchPlaceholder="Search Positions"
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
              searchPlaceholder="Search Buildings"
            />
          </Field>
          <Field label="Join Date" error={errors.join_date}>
            <DateField
              invalid={Boolean(errors.join_date)}
              value={values.join_date}
              onChange={(event) => handleJoinDateChange(event.target.value)}
            />
          </Field>
          {mode === "edit" ? (
            <Field
              label="Effective Date"
              hint="Only matters if unit, job position, job level, building, status, or employment type changed below - backdates the mutation history entry to when this actually happened. Leave blank to use today."
            >
              <DateField
                value={values.effective_date}
                onChange={(event) =>
                  updateValue("effective_date", event.target.value)
                }
              />
            </Field>
          ) : null}
          {values.employment_type && values.employment_type !== "PERMANENT" ? (
            <>
              <Field label="Contract Duration">
                <SearchableSelect
                  value={values.contract_duration_months}
                  onChange={handleContractDurationChange}
                  options={CONTRACT_DURATION_OPTIONS}
                  placeholder="Set end date manually"
                  searchPlaceholder="Search Durations"
                />
              </Field>
              <Field
                label="Contract End Date"
                hint={
                  values.contract_duration_months
                    ? "Auto-filled from join date + duration - still editable."
                    : undefined
                }
              >
                <DateField
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
          it can only be changed within 1 day of this employee being created -
          after that it's locked (soft-delete and recreate the employee to fix a
          mistake).
        </p>
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Field label="Marital Status" error={errors.marital_status}>
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              value={values.marital_status}
              onChange={(value) => updateValue("marital_status", value)}
              options={enumOptions(maritalStatuses)}
              placeholder="Select Marital Status"
              searchPlaceholder="Search Marital Status"
            />
          </Field>
          <Field label="Mobile Phone">
            <TextInput
              inputMode="tel"
              placeholder="08xx, +628xx, or 628xx"
              value={values.mobile_phone}
              onChange={(event) =>
                updateValue("mobile_phone", phoneDigitsOnly(event.target.value))
              }
            />
          </Field>
          <Field label="Residential Address" className="md:col-span-2">
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
            label="Bank Account Number"
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
            label={values.is_kpj_number ? "KPJ Number (Legacy)" : "BPJS Ketenagakerjaan"}
            hint={
              !canEditEmployeePii ? (
                <RestrictedPiiHint />
              ) : values.is_kpj_number ? (
                kpjLocked ? (
                  <LockedHint />
                ) : (
                  <LengthHint
                    value={values.kpj_number}
                    max={11}
                    label="letters/digits"
                    count={countAlphanumeric}
                  />
                )
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
              inputMode={values.is_kpj_number ? "text" : "numeric"}
              disabled={
                (values.is_kpj_number ? kpjLocked : bpjsEmploymentLocked) ||
                !canEditEmployeePii
              }
              placeholder={values.is_kpj_number ? "XXXXXXXXXXX" : "XXXX XXXX XXX"}
              value={
                values.is_kpj_number
                  ? values.kpj_number
                  : values.bpjs_employment_number
              }
              onChange={(event) =>
                updateValue(
                  values.is_kpj_number
                    ? "kpj_number"
                    : "bpjs_employment_number",
                  values.is_kpj_number
                    ? formatKpjNumber(event.target.value)
                    : formatBpjsEmploymentNumber(event.target.value),
                )
              }
            />
          </Field>
          {canEditEmployeePii && !bpjsEmploymentLocked && !kpjLocked ? (
            <CheckboxField
              className="md:col-span-2"
              label="This is a legacy KPJ number"
              description="The old BPJS Ketenagakerjaan format (Kartu Peserta Jamsostek)."
              checked={values.is_kpj_number}
              onChange={(event) =>
                updateValue("is_kpj_number", event.target.checked)
              }
            />
          ) : null}
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
          <Field label="Education Level">
            <SearchableSelect
              value={values.education_level}
              onChange={(value) => updateValue("education_level", value)}
              options={enumOptions(educationLevels, formatEducationLevel)}
              placeholder="Select Education Level"
              searchPlaceholder="Search Education Level"
            />
          </Field>
          <Field label="Graduation Year">
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
          <Field
            label="Institution Name"
            hint="Pick from the list, or type a new one - it's added to Master Data > Education automatically once saved."
          >
            <SearchableSelect
              creatable
              value={values.institution_name}
              onChange={(value) =>
                updateValue("institution_name", capitalizeWords(value))
              }
              options={namedOptions(
                institutionNameSuggestions.map((name) => ({ id: name, name })),
              )}
              placeholder="e.g. Universitas Indonesia"
              searchPlaceholder="Search Institutions"
            />
          </Field>
          <Field
            label="Major"
            hint="Pick from the list, or type a new one - it's added to Master Data > Education automatically once saved."
          >
            <SearchableSelect
              creatable
              value={values.major}
              onChange={(value) => updateValue("major", capitalizeWords(value))}
              options={namedOptions(
                majorSuggestions.map((name) => ({ id: name, name })),
              )}
              placeholder="e.g. Computer Science"
              searchPlaceholder="Search Majors"
            />
          </Field>
        </div>
      </section>

      <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
          Offboarding
        </h2>
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Field
            label="Last Working Date"
            error={errors.last_working_date}
            hint={errors.last_working_date ? undefined : buildLastWorkingDateHint(values)}
          >
            <DateField
              invalid={Boolean(errors.last_working_date)}
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
    {pendingPhotoFile ? (
      <PhotoCropDialog
        file={pendingPhotoFile}
        onCancel={() => setPendingPhotoFile(null)}
        onCropped={(blob) => {
          setPendingPhotoFile(null);
          setPendingPhotoBlob(blob);
        }}
      />
    ) : null}
    </>
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
    kpj_number: formatKpjNumber(identity.kpj_number || ""),
    // Pre-checks the box when the employee already has a legacy KPJ number
    // on file, so editing an existing legacy-format employee doesn't
    // silently switch them back to "BPJS Ketenagakerjaan" mode.
    is_kpj_number: Boolean(identity.kpj_number),
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
    // Only one of these two is ever submitted, based on the checkbox - the
    // other stays untouched server-side (omitted, not cleared - matches how
    // every other locked identifier field in this form already behaves,
    // there's no "clear" path short of soft-delete + recreate).
    bpjs_employment_number: values.is_kpj_number
      ? undefined
      : trimmedOrUndefined(values.bpjs_employment_number),
    kpj_number: values.is_kpj_number
      ? trimmedOrUndefined(values.kpj_number)
      : undefined,
    education_level: values.education_level || undefined,
    institution_name: trimmedOrUndefined(values.institution_name),
    major: trimmedOrUndefined(values.major),
    graduation_year: optionalNumber(values.graduation_year),
    last_working_date: isoFromDateInput(values.last_working_date),
    notes: trimmedOrUndefined(values.notes),
    effective_date: isoFromDateInput(values.effective_date),
  });
}

function LengthHint({ value, max, label, prefix, count = countDigits }) {
  const length = count(value);
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
      Locked - past the 1-day edit window. Soft-delete and recreate the
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

// Which locked identity fields are about to get a value that will start
// (or restart) the 1-day edit lock - compares the digit-stripped form since
// `values.*` carries display formatting (spaces/dots/dashes) that
// `identity.*` (raw from the server) never has. In create mode, any value
// entered counts - there's nothing to compare against yet.
function getIdentityLockWarnings(values, identity, mode) {
  const checks = [
    { label: "NIK", current: values.nik, original: identity.nik },
    { label: "NPWP", current: values.npwp, original: identity.npwp },
    {
      label: "Bank Account Number",
      current: values.bank_account_number,
      original: identity.bank_account_number,
    },
    {
      label: "BPJS Kesehatan",
      current: values.bpjs_number,
      original: identity.bpjs_number,
    },
    values.is_kpj_number
      ? {
          label: "KPJ Number",
          current: values.kpj_number,
          original: identity.kpj_number,
          raw: true,
        }
      : {
          label: "BPJS Ketenagakerjaan",
          current: values.bpjs_employment_number,
          original: identity.bpjs_employment_number,
        },
  ];

  return checks
    .filter(({ current, original, raw }) => {
      const normalizedCurrent = raw
        ? String(current || "").trim()
        : digitsOnly(current, Infinity);
      if (!normalizedCurrent) return false;
      if (mode === "create") return true;
      const normalizedOriginal = raw
        ? String(original || "").trim()
        : digitsOnly(original, Infinity);
      return normalizedCurrent !== normalizedOriginal;
    })
    .map(({ label }) => label);
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

// No official punctuated format like NIK/NPWP - KPJ numbers mix letters
// into the digits, so this just uppercases and caps the length rather than
// grouping into digit-only chunks like formatDigitGroups does.
function formatKpjNumber(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 11);
}

function countDigits(value) {
  return String(value || "").replace(/\D/g, "").length;
}

function countAlphanumeric(value) {
  return String(value || "").replace(/[^a-zA-Z0-9]/g, "").length;
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

// Mirrors employee-role-rules.ts's assertJobPositionJobLevelCompatible -
// the general teaching/non-teaching match, plus "Special Education
// Teacher" only pairing with "SE Teacher" and nothing else.
function isJobPositionCompatibleWithLevel(position, level) {
  if (!position || !level) return false;
  if (position.is_teaching_position !== level.is_teaching_role) return false;
  const isSePosition =
    String(position.name || "").trim().toLowerCase() ===
    SPECIAL_EDUCATION_POSITION_NAME;
  const isSeLevel =
    String(level.name || "").trim().toLowerCase() ===
    SPECIAL_EDUCATION_LEVEL_NAME;
  return isSePosition === isSeLevel;
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

function mergeSuggestions(masterDataItems, employeeDerivedNames) {
  const names = [
    ...(masterDataItems || []).map((item) => item.name),
    ...(employeeDerivedNames || []),
  ];
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
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
