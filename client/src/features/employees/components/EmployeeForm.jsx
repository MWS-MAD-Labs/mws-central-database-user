import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Camera,
  GraduationCap,
  RotateCcw,
  Save,
  UserRound,
} from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import { FormActionBar } from "../../../components/ui/FormActionBar.jsx";
import { ChangeReviewTable } from "../../../components/ui/ChangeReviewTable.jsx";
import { PhotoCropDialog } from "../../../components/photo/PhotoCropDialog.jsx";
import {
  CheckboxField,
  DateField,
  EmailField,
  Field,
  LengthHint,
  LimitedField,
  PhoneField,
  ReligionFields,
  SearchableSelect,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import {
  addMonthsToDateInput,
  capitalizeWords,
  cleanPayload,
  CONTRACT_DURATION_OPTIONS,
  dateInputFromIso,
  digitsOnly,
  formatBankAccountNumber,
  formatBpjsEmploymentNumber,
  formatBpjsNumber,
  buildFixFieldsTooltip,
  formatEmployeeId,
  formatKpjNumber,
  formatNik,
  formatNpwp,
  isBirthDateNotFuture,
  isBirthDateNotTooOld,
  isoFromDateInput,
  isWithinJoinDateFutureCap,
  isWithinReasonableFutureCeiling,
  optionalNumber,
  scrollToFirstError,
  trimmedOrUndefined,
  visibleErrors,
  yearsBetweenDateInputs,
} from "../../../lib/form.js";
import {
  enumOptions,
  formatEducationLevel,
  maskSensitiveValue,
} from "../../../lib/format.js";
import {
  buildChangedFieldEntries,
  buildFilledFieldEntries,
  makeOptionAwareResolver,
} from "../../../lib/formDiff.js";
import {
  MAX_PHOTO_SIZE_BYTES,
  validateFileSize,
} from "../../../lib/fileSize.js";
import { showErrorToast } from "../../../lib/toast.js";
import { useCreateFormDraft } from "../../../lib/useCreateFormDraft.js";
import { CreateDraftDialog } from "../../../components/ui/CreateDraftDialog.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { useAcademicUnits } from "../../master-data/hooks/useAcademicUnits.js";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { masterDataApi } from "../../master-data/api/masterDataApi.js";
import { RequestIdentifierChangeDialog } from "../../change-requests/components/RequestIdentifierChangeDialog.jsx";
import { rememberReveal } from "../../../lib/piiRevealMemory.js";

const employeePiiScope = (employeeId) => `employee:${employeeId}`;
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

const ALLOWED_EMAIL_DOMAIN = "millennia21.id";
const EMAIL_LOCAL_MAX_LENGTH = 50 - 1 - ALLOWED_EMAIL_DOMAIN.length;

const SPECIAL_EDUCATION_POSITION_NAME = "special education teacher";
const SPECIAL_EDUCATION_LEVEL_NAME = "se teacher";

const SENSITIVE_FIELD_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

const LOCKED_FIELD_LABELS = {
  nik: "NIK",
  npwp: "NPWP",
  bank_account_number: "Bank Account Number",
  bpjs_number: "BPJS Kesehatan",
  bpjs_employment_number: "BPJS Ketenagakerjaan",
  kpj_number: "KPJ Number",
};

const LOCKED_FIELD_FORMATTERS = {
  nik: formatNik,
  npwp: formatNpwp,
  bank_account_number: formatBankAccountNumber,
  bpjs_number: formatBpjsNumber,
  bpjs_employment_number: formatBpjsEmploymentNumber,
  kpj_number: formatKpjNumber,
};

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
  const [nowSnapshot] = useState(() => Date.now());
  const [requestChangeField, setRequestChangeField] = useState(null);
  const requestChangeFor = (field) =>
    mode === "edit" && employee?.id
      ? () => setRequestChangeField(field)
      : undefined;
  const [sensitiveFieldsRevealed, setSensitiveFieldsRevealed] = useState(
    () =>
      mode !== "edit" ||
      Boolean(employee?.identity?.is_self) ||
      "gender" in (employee?.identity ?? {}),
  );
  const revealSensitiveFieldsMutation = useMutation({
    mutationFn: () => employeesApi.recordSensitiveFieldsAccess(employee.id),
    onSuccess: () => {
      rememberReveal(employeePiiScope(employee.id));
      setSensitiveFieldsRevealed(true);
    },
    onError: (error) =>
      showErrorToast(error, "Could not reveal sensitive fields."),
  });
  async function handleRevealSensitiveFields() {
    const confirmed = await confirm({
      title: "View sensitive fields",
      description: `View and edit ${employee?.identity?.full_name || "this employee"}'s gender, religion, birth details, and PII (NIK/NPWP/bank account/BPJS)? This access is logged.`,
      confirmLabel: "View",
    });
    if (confirmed) {
      revealSensitiveFieldsMutation.mutate();
    }
  }

  const isCreate = mode === "create";
  const isDirty = JSON.stringify(values) !== JSON.stringify(initialValues);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [lastWorkingDateIncomplete, setLastWorkingDateIncomplete] =
    useState(false);
  const allErrors = useMemo(
    () =>
      computeEmployeeErrors(values, isCreate, { lastWorkingDateIncomplete }),
    [values, isCreate, lastWorkingDateIncomplete],
  );
  // Drives the floating Save button's disabled/tooltip state - a field
  // with a value that fails a rule shows its error live (see
  // visibleErrors below), a blank required field still waits for a
  // real submit attempt.
  const missingRequiredCount = Object.keys(allErrors).length;
  const errors = visibleErrors(allErrors, values, {
    isCreate,
    hasAttemptedSubmit,
  });
  const draft = useCreateFormDraft({
    entity: "employee",
    values,
    initialValues,
    enabled: isCreate,
  });
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

  function togglePcMentorUnit(unitId) {
    setValues((current) => ({
      ...current,
      pc_mentor_unit_ids: current.pc_mentor_unit_ids.includes(unitId)
        ? current.pc_mentor_unit_ids.filter((id) => id !== unitId)
        : [...current.pc_mentor_unit_ids, unitId],
    }));
  }

  function toggleAllPcMentorUnits(checked) {
    setValues((current) => ({
      ...current,
      pc_mentor_unit_ids: checked ? academicUnits.map((unit) => unit.id) : [],
    }));
  }

  function handleReset() {
    setValues(initialValues);
    setLastWorkingDateIncomplete(false);
    draft.clearDraft();
  }

  const { academicUnits } = useAcademicUnits();
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

    const computedErrors = computeEmployeeErrors(values, isCreate, {
      lastWorkingDateIncomplete,
    });

    if (Object.keys(computedErrors).length > 0) {
      showErrorToast("Please fix the highlighted fields before saving.");
      scrollToFirstError(computedErrors);
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

    const isContractAlreadyExpired =
      !isAlreadyDue &&
      values.status !== "RESIGNED" &&
      values.contract_end_date &&
      new Date(isoFromDateInput(values.contract_end_date)) <= new Date();

    const expiryWarning = isContractAlreadyExpired ? (
      <>
        <strong>Contract end date already passed.</strong>
        <br />
        Status will change to <strong>Resigned</strong> right away once this is
        saved.
      </>
    ) : null;
    const fieldWarnings = {
      ...(isContractAlreadyExpired
        ? {
            contract_end_date: "Passed date will set status to Resigned.",
          }
        : {}),
      ...(isAlreadyDue
        ? {
            last_working_date: "Passed date will set status to Resigned.",
          }
        : {}),
    };

    const lockingFields = getIdentityLockWarnings(values, identity, mode);
    const lockWarning =
      lockingFields.length > 0 ? (
        <>
          <strong>
            {lockingFields.length > 1
              ? "Sensitive fields will be locked."
              : "This sensitive field will be locked."}
          </strong>
          <br />
          Editable only within 1 day of being set, then locked for good.
        </>
      ) : null;
    const lockFieldWarnings = Object.fromEntries(
      lockingFields.map((field) => [field, "Will be locked after saving."]),
    );
    const reviewWarning =
      expiryWarning || lockWarning ? (
        <>
          {expiryWarning}
          {expiryWarning && lockWarning ? <br /> : null}
          {lockWarning}
        </>
      ) : null;
    const reviewFieldWarnings = { ...fieldWarnings, ...lockFieldWarnings };

    const resolveValue = makeOptionAwareResolver(
      options,
      EMPLOYEE_ID_FIELD_OPTION_KEYS,
      EMPLOYEE_FIELD_FORMATTERS,
    );

    if (isCreate) {
      const fields = buildFilledFieldEntries(values, {
        labels: EMPLOYEE_DIFF_LABELS,
        resolveValue,
        excludeKeys: EMPLOYEE_DIFF_EXCLUDED_KEYS,
        sections: EMPLOYEE_FIELD_SECTIONS,
      });
      const confirmed = await confirm({
        title: "Review before creating",
        description: (
          <ChangeReviewTable
            changes={fields}
            mode="create"
            warning={reviewWarning}
            fieldWarnings={reviewFieldWarnings}
          />
        ),
        confirmLabel: isContractAlreadyExpired
          ? "Create and resign"
          : lockingFields.length > 0
            ? "Save anyway"
            : "Create employee",
        wide: true,
      });
      if (!confirmed) return;
    } else {
      const changes = buildChangedFieldEntries(initialValues, values, {
        labels: EMPLOYEE_DIFF_LABELS,
        resolveValue,
        excludeKeys: EMPLOYEE_DIFF_EXCLUDED_KEYS,
        sections: EMPLOYEE_FIELD_SECTIONS,
      });
      if (changes.length > 0 || reviewWarning) {
        const confirmed = await confirm({
          title: "Review changes before saving",
          description: (
            <ChangeReviewTable
              changes={changes}
              warning={reviewWarning}
              fieldWarnings={reviewFieldWarnings}
            />
          ),
          confirmLabel: expiryWarning
            ? "Save and resign"
            : lockingFields.length > 0
              ? "Save anyway"
              : "Save changes",
          wide: true,
        });
        if (!confirmed) return;
      }
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
    const currentPosition = options.jobPositions.find(
      (position) => position.id === values.job_position_id,
    );
    const levelNowInvalid =
      currentLevel && !isJobLevelCompatibleWithUnit(currentLevel, unit);
    const positionNowInvalid =
      currentPosition &&
      !isJobPositionCompatibleWithUnit(currentPosition, unit);

    setValues((current) => ({
      ...current,
      unit_id: unitId,
      ...(levelNowInvalid
        ? { job_level_id: "", job_position_id: "" }
        : positionNowInvalid
          ? { job_position_id: "" }
          : {}),
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
      ...(employmentType === "PERMANENT"
        ? { contract_duration_months: "", contract_end_date: "" }
        : {}),
    }));
  }

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

  const availableJobLevels = selectedUnit
    ? options.jobLevels.filter((level) =>
        isJobLevelCompatibleWithUnit(level, selectedUnit),
      )
    : [];

  const availableJobPositions =
    selectedJobLevel && selectedUnit
      ? options.jobPositions.filter(
          (position) =>
            isJobPositionCompatibleWithLevel(position, selectedJobLevel) &&
            isJobPositionCompatibleWithUnit(position, selectedUnit),
        )
      : [];

  const identity = employee?.identity || {};
  function isFieldPastGracePeriod(setAt) {
    if (mode !== "edit") return false;
    // An identifier-change approver bypasses the lock entirely, server-side too.
    if (user?.is_identifier_change_approver) return false;
    const anchor = setAt || employee?.created_at;
    if (!anchor) return false;
    return (
      nowSnapshot - new Date(anchor).getTime() > SENSITIVE_FIELD_GRACE_PERIOD_MS
    );
  }
  const nikLocked =
    isFieldPastGracePeriod(identity.nik_set_at) && Boolean(identity.nik);
  const npwpLocked =
    isFieldPastGracePeriod(identity.npwp_set_at) && Boolean(identity.npwp);
  const bankAccountLocked =
    isFieldPastGracePeriod(identity.bank_account_number_set_at) &&
    Boolean(identity.bank_account_number);
  const bpjsLocked =
    isFieldPastGracePeriod(identity.bpjs_number_set_at) &&
    Boolean(identity.bpjs_number);
  const bpjsEmploymentLocked =
    isFieldPastGracePeriod(identity.bpjs_employment_number_set_at) &&
    Boolean(identity.bpjs_employment_number);
  const kpjLocked =
    isFieldPastGracePeriod(identity.kpj_number_set_at) &&
    Boolean(identity.kpj_number);
  const canEditEmployeePii =
    user?.role === "SUPER_ADMIN" || Boolean(user?.can_view_employee_pii);

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="min-w-0 space-y-5 pb-20"
        noValidate
      >
        <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <h2 className="mb-4 text-base font-semibold text-(--mws-charcoal)">
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
                  className="absolute -bottom-1 -right-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-(--mws-burgundy) text-white shadow-sm hover:bg-(--mws-burgundy-dark)"
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
              <div className="text-sm text-(--mws-muted)">
                <p className="font-semibold text-(--mws-charcoal)">Photo</p>
                <p>Add one after creating the employee.</p>
              </div>
            </div>
          ) : null}
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <LimitedField
              label="Full Name"
              field="full_name"
              max={50}
              required
              transform={capitalizeWords}
              values={values}
              errors={errors}
              updateValue={updateValue}
            />
            <LimitedField
              label="Nick Name"
              field="nick_name"
              max={25}
              required
              transform={capitalizeWords}
              values={values}
              errors={errors}
              updateValue={updateValue}
            />
            <EmailField
              domain={ALLOWED_EMAIL_DOMAIN}
              max={EMAIL_LOCAL_MAX_LENGTH}
              sanitize={sanitizeEmailLocalPart}
              values={values}
              errors={errors}
              updateValue={updateValue}
            />
            {!isCreate ? (
              <Field
                label="Photo URL"
                hint="Legacy field for a manually-linked photo (e.g. Google Drive). New photos should go through the upload/crop control on the detail page instead."
              >
                <TextInput
                  type="url"
                  value={values.photo_url}
                  maxLength={500}
                  onChange={(event) =>
                    updateValue("photo_url", event.target.value)
                  }
                />
              </Field>
            ) : null}
            {!sensitiveFieldsRevealed ? (
              <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-(--mws-line) bg-(--mws-soft) p-3 md:col-span-2">
                <p className="text-sm text-(--mws-muted)">
                  Gender, religion, birth details, and PII (NIK/NPWP/bank
                  account/BPJS) are hidden by default.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={revealSensitiveFieldsMutation.isPending}
                  onClick={handleRevealSensitiveFields}
                >
                  Show Sensitive Fields
                </Button>
              </div>
            ) : null}
            <Field label="Gender" name="gender" error={errors.gender} required>
              {sensitiveFieldsRevealed ? (
                <SearchableSelect
                  required={isCreate && hasAttemptedSubmit}
                  value={values.gender}
                  onChange={(value) => updateValue("gender", value)}
                  options={enumOptions(genderOptions)}
                  placeholder="Select Gender"
                  searchPlaceholder="Search Gender"
                />
              ) : (
                <SensitiveFieldPlaceholder />
              )}
            </Field>
            {sensitiveFieldsRevealed ? (
              <ReligionFields
                values={values}
                errors={errors}
                setValues={setValues}
                religionOptions={religionOptions}
                required={isCreate && hasAttemptedSubmit}
              />
            ) : (
              <Field label="Religion" name="religion" required>
                <SensitiveFieldPlaceholder />
              </Field>
            )}
            {sensitiveFieldsRevealed ? (
              <LimitedField
                label="Birth Place"
                field="birth_place"
                max={25}
                required
                transform={capitalizeWords}
                values={values}
                errors={errors}
                updateValue={updateValue}
              />
            ) : (
              <Field label="Birth Place" name="birth_place" required>
                <SensitiveFieldPlaceholder />
              </Field>
            )}
            <Field
              label="Birth Date"
              name="birth_date"
              error={errors.birth_date}
              required
            >
              {sensitiveFieldsRevealed ? (
                <DateField
                  invalid={Boolean(errors.birth_date)}
                  value={values.birth_date}
                  onChange={(event) =>
                    updateValue("birth_date", event.target.value)
                  }
                />
              ) : (
                <SensitiveFieldPlaceholder />
              )}
            </Field>
          </div>
        </section>

        <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <h2 className="mb-4 text-base font-semibold text-(--mws-charcoal)">
            Employment
          </h2>
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <CheckboxField
              className="md:col-span-2"
              label="PC Activity mentor eligible"
              description="Allow this employee to be assigned as a PC Activity room mentor. This is independent of teaching role."
              checked={values.is_pc_mentor_eligible}
              onChange={(event) =>
                updateValue("is_pc_mentor_eligible", event.target.checked)
              }
            />
            {values.is_pc_mentor_eligible ? (
              <Field
                className="md:col-span-2"
                label="PC Mentor Units"
                name="pc_mentor_unit_ids"
                error={errors.pc_mentor_unit_ids}
                required
                hint="Select at least one unit this employee can be assigned to mentor in."
              >
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <CheckboxField
                    checked={
                      academicUnits.length > 0 &&
                      academicUnits.every((unit) =>
                        values.pc_mentor_unit_ids.includes(unit.id),
                      )
                    }
                    label="All Units"
                    onChange={(event) => toggleAllPcMentorUnits(event.target.checked)}
                  />
                  {academicUnits.map((unit) => (
                    <CheckboxField
                      key={unit.id}
                      checked={values.pc_mentor_unit_ids.includes(unit.id)}
                      label={unit.name}
                      onChange={() => togglePcMentorUnit(unit.id)}
                    />
                  ))}
                </div>
              </Field>
            ) : null}
            <Field
              label="Employee ID"
              name="employee_id"
              error={errors.employee_id}
              required
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
                  updateValue(
                    "employee_id",
                    formatEmployeeId(event.target.value),
                  )
                }
              />
            </Field>
            <Field label="Status" name="status" error={errors.status} required>
              <SearchableSelect
                required={isCreate && hasAttemptedSubmit}
                value={values.status}
                onChange={(value) => updateValue("status", value)}
                options={enumOptions(employeeStatuses)}
                placeholder="Select Status"
                searchPlaceholder="Search Status"
              />
            </Field>
            <Field
              label="Employment Type"
              name="employment_type"
              error={errors.employment_type}
              required
            >
              <SearchableSelect
                required={isCreate && hasAttemptedSubmit}
                value={values.employment_type}
                onChange={(value) => handleEmploymentTypeChange(value)}
                options={enumOptions(employmentTypes)}
                placeholder="Select Type"
                searchPlaceholder="Search Type"
              />
            </Field>
            <Field label="Unit" name="unit_id" error={errors.unit_id} required>
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
              name="job_level_id"
              error={errors.job_level_id}
              required
              hint={
                !selectedUnit
                  ? "Select Unit first."
                  : availableJobLevels.length < options.jobLevels.length
                    ? "Some job levels are hidden - not valid for this unit."
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
              name="job_position_id"
              error={errors.job_position_id}
              required
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
            <Field
              label="Building"
              name="building_id"
              error={errors.building_id}
              required
            >
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
            <Field
              label="Join Date"
              name="join_date"
              error={errors.join_date}
              required
            >
              <DateField
                invalid={Boolean(errors.join_date)}
                value={values.join_date}
                onChange={(event) => handleJoinDateChange(event.target.value)}
              />
            </Field>
            {mode === "edit" ? (
              <Field
                label="Effective Date"
                hint="Backdates the change below if it actually happened earlier. Leave blank to use today."
              >
                <DateField
                  value={values.effective_date}
                  onChange={(event) =>
                    updateValue("effective_date", event.target.value)
                  }
                />
              </Field>
            ) : null}
            {values.employment_type &&
            values.employment_type !== "PERMANENT" ? (
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
                  name="contract_end_date"
                  error={errors.contract_end_date}
                  required
                  hint={
                    errors.contract_end_date
                      ? undefined
                      : values.contract_duration_months
                        ? "Auto-filled from join date + duration"
                        : undefined
                  }
                >
                  <DateField
                    invalid={Boolean(errors.contract_end_date)}
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

        <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <h2 className="mb-1 text-base font-semibold text-(--mws-charcoal)">
            Contact And Sensitive Data
          </h2>
          <p className="mb-4 text-xs text-(--mws-muted)">
            NIK, NPWP, bank account, and BPJS are optional. Once set, they can
            only be changed within a day of creating this employee. After that,
            fixing a mistake means recreating the employee.
          </p>
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <Field
              label="Marital Status"
              name="marital_status"
              error={errors.marital_status}
              required
            >
              {sensitiveFieldsRevealed ? (
                <SearchableSelect
                  required={isCreate && hasAttemptedSubmit}
                  value={values.marital_status}
                  onChange={(value) => updateValue("marital_status", value)}
                  options={enumOptions(maritalStatuses)}
                  placeholder="Select Marital Status"
                  searchPlaceholder="Search Marital Status"
                />
              ) : (
                <SensitiveFieldPlaceholder />
              )}
            </Field>
            <PhoneField
              values={values}
              errors={errors}
              updateValue={updateValue}
            />
            <LimitedField
              label="Residential Address"
              field="residential_address"
              max={200}
              as="textarea"
              className="md:col-span-2"
              values={values}
              errors={errors}
              updateValue={updateValue}
            />
            <Field
              label="NIK"
              hint={
                !sensitiveFieldsRevealed ? undefined : !canEditEmployeePii ? (
                  <RestrictedPiiHint />
                ) : nikLocked ? (
                  <LockedHint onRequestChange={requestChangeFor("nik")} />
                ) : (
                  <LengthHint value={values.nik} max={16} label="digits" />
                )
              }
            >
              {sensitiveFieldsRevealed ? (
                <TextInput
                  inputMode="numeric"
                  disabled={nikLocked || !canEditEmployeePii}
                  placeholder="XXXX XXXX XXXX XXXX"
                  value={values.nik}
                  onChange={(event) =>
                    updateValue("nik", formatNik(event.target.value))
                  }
                />
              ) : (
                <SensitiveFieldPlaceholder />
              )}
            </Field>
            <Field
              label="NPWP"
              hint={
                !sensitiveFieldsRevealed ? undefined : !canEditEmployeePii ? (
                  <RestrictedPiiHint />
                ) : npwpLocked ? (
                  <LockedHint onRequestChange={requestChangeFor("npwp")} />
                ) : (
                  <LengthHint value={values.npwp} max={15} label="digits" />
                )
              }
            >
              {sensitiveFieldsRevealed ? (
                <TextInput
                  inputMode="numeric"
                  disabled={npwpLocked || !canEditEmployeePii}
                  placeholder="XX.XXX.XXX.X-XXX.XXX"
                  value={values.npwp}
                  onChange={(event) =>
                    updateValue("npwp", formatNpwp(event.target.value))
                  }
                />
              ) : (
                <SensitiveFieldPlaceholder />
              )}
            </Field>
            <Field
              label="Bank Account Number"
              hint={
                !sensitiveFieldsRevealed ? undefined : !canEditEmployeePii ? (
                  <RestrictedPiiHint />
                ) : bankAccountLocked ? (
                  <LockedHint
                    onRequestChange={requestChangeFor("bank_account_number")}
                  />
                ) : (
                  <LengthHint
                    value={values.bank_account_number}
                    max={10}
                    label="digits, BCA"
                  />
                )
              }
            >
              {sensitiveFieldsRevealed ? (
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
              ) : (
                <SensitiveFieldPlaceholder />
              )}
            </Field>
            <Field
              label="BPJS Kesehatan"
              hint={
                !sensitiveFieldsRevealed ? undefined : !canEditEmployeePii ? (
                  <RestrictedPiiHint />
                ) : bpjsLocked ? (
                  <LockedHint
                    onRequestChange={requestChangeFor("bpjs_number")}
                  />
                ) : (
                  <LengthHint
                    value={values.bpjs_number}
                    max={13}
                    label="digits"
                  />
                )
              }
            >
              {sensitiveFieldsRevealed ? (
                <TextInput
                  inputMode="numeric"
                  disabled={bpjsLocked || !canEditEmployeePii}
                  placeholder="XXXX XXXX XXXX X"
                  value={values.bpjs_number}
                  onChange={(event) =>
                    updateValue(
                      "bpjs_number",
                      formatBpjsNumber(event.target.value),
                    )
                  }
                />
              ) : (
                <SensitiveFieldPlaceholder />
              )}
            </Field>
            <Field
              label={
                values.is_kpj_number
                  ? "KPJ Number (Legacy)"
                  : "BPJS Ketenagakerjaan"
              }
              hint={
                !sensitiveFieldsRevealed ? undefined : !canEditEmployeePii ? (
                  <RestrictedPiiHint />
                ) : values.is_kpj_number ? (
                  kpjLocked ? (
                    <LockedHint
                      onRequestChange={requestChangeFor("kpj_number")}
                    />
                  ) : (
                    <LengthHint
                      value={values.kpj_number}
                      max={11}
                      label="letters/digits"
                      count={countAlphanumeric}
                    />
                  )
                ) : bpjsEmploymentLocked ? (
                  <LockedHint
                    onRequestChange={requestChangeFor("bpjs_employment_number")}
                  />
                ) : (
                  <LengthHint
                    value={values.bpjs_employment_number}
                    max={11}
                    label="digits"
                  />
                )
              }
            >
              {sensitiveFieldsRevealed ? (
                <TextInput
                  inputMode={values.is_kpj_number ? "text" : "numeric"}
                  disabled={
                    (values.is_kpj_number ? kpjLocked : bpjsEmploymentLocked) ||
                    !canEditEmployeePii
                  }
                  placeholder={
                    values.is_kpj_number ? "XXXXXXXXXXX" : "XXXX XXXX XXX"
                  }
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
              ) : (
                <SensitiveFieldPlaceholder />
              )}
            </Field>
            {sensitiveFieldsRevealed &&
            canEditEmployeePii &&
            !bpjsEmploymentLocked &&
            !kpjLocked ? (
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

        <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <h2 className="mb-1 text-base font-semibold text-(--mws-charcoal)">
            Education
          </h2>
          <p className="mb-4 text-xs text-(--mws-muted)">
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
              hint="Pick from the list or type a new one. New entries are added to Master Data > Education automatically."
            >
              <SearchableSelect
                creatable
                value={values.institution_name}
                onChange={(value) =>
                  updateValue("institution_name", capitalizeWords(value))
                }
                options={namedOptions(
                  institutionNameSuggestions.map((name) => ({
                    id: name,
                    name,
                  })),
                )}
                placeholder="e.g. Universitas Indonesia"
                searchPlaceholder="Search Institutions"
              />
            </Field>
            <Field
              label="Major"
              hint="Pick from the list or type a new one. New entries are added to Master Data > Education automatically."
            >
              <SearchableSelect
                creatable
                value={values.major}
                onChange={(value) =>
                  updateValue("major", capitalizeWords(value))
                }
                options={namedOptions(
                  majorSuggestions.map((name) => ({ id: name, name })),
                )}
                placeholder="e.g. Computer Science"
                searchPlaceholder="Search Majors"
              />
            </Field>
          </div>
        </section>

        <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <h2 className="mb-4 text-base font-semibold text-(--mws-charcoal)">
            Offboarding
          </h2>
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <Field
              label="Last Working Date"
              name="last_working_date"
              error={errors.last_working_date}
              required={values.status === "RESIGNED"}
              hint={
                errors.last_working_date
                  ? undefined
                  : buildLastWorkingDateHint(values)
              }
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
            <LimitedField
              label="Notes"
              field="notes"
              max={500}
              as="textarea"
              className="md:col-span-2"
              values={values}
              errors={errors}
              updateValue={updateValue}
            />
          </div>
        </section>

        <FormActionBar>
          {isCreate && isDirty ? (
            <Button type="button" variant="secondary" onClick={handleReset}>
              Reset form
            </Button>
          ) : null}
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
          <Button
            type="submit"
            loading={isSubmitting}
            disabled={
              isSubmitting ||
              missingRequiredCount > 0 ||
              (!isCreate && !isDirty)
            }
            title={
              buildFixFieldsTooltip(allErrors) ||
              (!isCreate && !isDirty ? "No changes to save yet." : undefined)
            }
          >
            <Save size={16} />
            {isCreate ? "Create employee" : "Save changes"}
          </Button>
        </FormActionBar>
      </form>
      <CreateDraftDialog
        entityLabel="employee"
        draft={isCreate && !draft.draftHandled ? draft.savedDraft : null}
        onContinue={() => {
          setValues(draft.savedDraft.values);
          draft.markDraftHandled();
        }}
        onStartFresh={() => {
          draft.clearDraft();
        }}
      />
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
      {requestChangeField ? (
        <RequestIdentifierChangeDialog
          entityType="Employee"
          entityId={employee.id}
          fieldName={requestChangeField}
          fieldLabel={LOCKED_FIELD_LABELS[requestChangeField]}
          currentValue={identity[requestChangeField]}
          formatValue={LOCKED_FIELD_FORMATTERS[requestChangeField]}
          onClose={() => setRequestChangeField(null)}
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
    religion_other: identity.religion_other || "",
    birth_place: identity.birth_place || "",
    birth_date: dateInputFromIso(identity.birth_date),
    photo_url: identity.photo_url || "",
    employee_id: formatEmployeeId(employment.employee_id || ""),
    status: statusInfo.status || (mode === "create" ? "ACTIVE" : ""),
    employment_type:
      statusInfo.employment_type || (mode === "create" ? "PROBATION" : ""),
    is_pc_mentor_eligible: Boolean(employment.is_pc_mentor_eligible),
    pc_mentor_unit_ids: (employment.pc_mentor_units || []).map(
      (unit) => unit.id,
    ),
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
    religion_other:
      values.religion === "OTHER"
        ? trimmedOrUndefined(values.religion_other)
        : null,
    birth_place: trimmedOrUndefined(values.birth_place),
    birth_date: isoFromDateInput(values.birth_date),
    photo_url: trimmedOrUndefined(values.photo_url),
    employee_id: trimmedOrUndefined(formatEmployeeId(values.employee_id)),
    status: values.status,
    employment_type: values.employment_type,
    is_pc_mentor_eligible: Boolean(values.is_pc_mentor_eligible),
    pc_mentor_unit_ids: values.is_pc_mentor_eligible
      ? values.pc_mentor_unit_ids
      : [],
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

function LockedHint({ onRequestChange }) {
  return (
    <span className="font-semibold text-[#a43c41]">
      Locked. Past the 1-day edit window.{" "}
      {onRequestChange ? (
        <button
          type="button"
          onClick={onRequestChange}
          className="underline underline-offset-2 hover:text-(--mws-burgundy)"
        >
          Request change
        </button>
      ) : null}
    </span>
  );
}

function RestrictedPiiHint() {
  return (
    <span className="font-semibold text-[#a43c41]">
      Restricted. You don't have permission to view or edit employee PII.
    </span>
  );
}

function SensitiveFieldPlaceholder() {
  return (
    <div className="flex h-10 items-center rounded-xl border border-dashed border-(--mws-line) bg-(--mws-soft) px-3 text-sm text-(--mws-muted)">
      Hidden
    </div>
  );
}

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

function countAlphanumeric(value) {
  return String(value || "").replace(/[^a-zA-Z0-9]/g, "").length;
}

function emailLocalPart(email) {
  if (!email) return "";
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

function sanitizeEmailLocalPart(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._%+-]/g, "");
}

function buildEmail(localPart) {
  const trimmed = trimmedOrUndefined(localPart);
  return trimmed ? `${trimmed}@${ALLOWED_EMAIL_DOMAIN}` : undefined;
}

function isJobLevelCompatibleWithUnit(level, unit) {
  if (!level || !unit) return false;
  const unitIds = level.units || [];
  return unitIds.length === 0 || unitIds.some((u) => u.id === unit.id);
}

function isJobPositionCompatibleWithLevel(position, level) {
  if (!position || !level) return false;
  if (position.is_teaching_position !== level.is_teaching_role) return false;
  const isSePosition =
    String(position.name || "")
      .trim()
      .toLowerCase() === SPECIAL_EDUCATION_POSITION_NAME;
  const isSeLevel =
    String(level.name || "")
      .trim()
      .toLowerCase() === SPECIAL_EDUCATION_LEVEL_NAME;
  return isSePosition === isSeLevel;
}

function isJobPositionCompatibleWithUnit(position, unit) {
  if (!position || !unit) return false;
  const unitIds = position.units || [];
  return unitIds.length === 0 || unitIds.some((u) => u.id === unit.id);
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

// Which options list (from the `options` prop) resolves each *_id field's
// display name in the pre-save change review dialog - see formDiff.js.
const EMPLOYEE_ID_FIELD_OPTION_KEYS = {
  unit_id: "units",
  job_position_id: "jobPositions",
  job_level_id: "jobLevels",
  building_id: "buildings",
  pc_mentor_unit_ids: "units",
};

// Fields whose own display formatter beats the review dialog's generic
// enum-label guesser (e.g. education_level's "SMA/SMK", not "Sma Smk"), plus
// the PII fields that must stay masked here exactly like everywhere else
// the app shows them (EmployeeDetailPage's reveal gate, audit log snapshots).
const EMPLOYEE_FIELD_FORMATTERS = {
  email_local: buildEmail,
  education_level: formatEducationLevel,
  nik: maskSensitiveValue,
  npwp: maskSensitiveValue,
  bank_account_number: maskSensitiveValue,
  bpjs_number: maskSensitiveValue,
  bpjs_employment_number: maskSensitiveValue,
  kpj_number: maskSensitiveValue,
};

// contract_duration_months is a scratch input that only computes
// contract_end_date locally - buildPayload() never sends it, so showing it
// here would claim a field was saved that never was. is_kpj_number isn't
// itself saved either, but it does decide whether kpj_number or
// bpjs_employment_number gets sent, so it's kept (with a plain-language
// label) rather than hidden.
const EMPLOYEE_DIFF_EXCLUDED_KEYS = ["contract_duration_months"];

const EMPLOYEE_DIFF_LABELS = {
  ...REQUIRED_FIELD_LABELS,
  photo_url: "Photo URL",
  is_kpj_number: "Uses KPJ number",
  is_pc_mentor_eligible: "PC mentor eligible",
  pc_mentor_unit_ids: "PC mentor units",
};

// Groups the review dialog's fields, in display order - see
// ChangeReviewTable's groupBySection. Sensitive gets its own group (and a
// lock badge) rather than sitting mixed in with ordinary employment fields.
const EMPLOYEE_FIELD_SECTIONS = {
  full_name: "Identity",
  nick_name: "Identity",
  email_local: "Identity",
  gender: "Identity",
  religion: "Identity",
  religion_other: "Identity",
  birth_place: "Identity",
  birth_date: "Identity",
  photo_url: "Identity",
  mobile_phone: "Identity",
  residential_address: "Identity",
  marital_status: "Identity",

  employee_id: "Employment",
  status: "Employment",
  employment_type: "Employment",
  unit_id: "Employment",
  job_position_id: "Employment",
  job_level_id: "Employment",
  building_id: "Employment",
  join_date: "Employment",
  contract_end_date: "Employment",
  effective_date: "Employment",
  is_pc_mentor_eligible: "Employment",
  pc_mentor_unit_ids: "Employment",

  nik: "Sensitive",
  npwp: "Sensitive",
  bank_account_number: "Sensitive",
  bpjs_number: "Sensitive",
  bpjs_employment_number: "Sensitive",
  kpj_number: "Sensitive",
  is_kpj_number: "Sensitive",

  education_level: "Education",
  institution_name: "Education",
  major: "Education",
  graduation_year: "Education",

  last_working_date: "Offboarding",
  notes: "Offboarding",
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
  if (values.religion === "OTHER" && !values.religion_other) {
    errors.religion_other = "Religion (Please Specify) is required.";
  }
  if (values.is_pc_mentor_eligible && values.pc_mentor_unit_ids.length === 0) {
    errors.pc_mentor_unit_ids =
      "Select at least one unit for PC mentor eligibility.";
  }
  if (
    values.employment_type &&
    values.employment_type !== "PERMANENT" &&
    !values.contract_end_date
  ) {
    errors.contract_end_date =
      "Contract end date is required for non-permanent employment types.";
  }

  if (values.birth_date && !isBirthDateNotFuture(values.birth_date)) {
    errors.birth_date = "Birth date cannot be in the future.";
  } else if (values.birth_date && !isBirthDateNotTooOld(values.birth_date)) {
    errors.birth_date = "Birth date is too far in the past to be valid.";
  } else if (
    values.birth_date &&
    values.join_date &&
    yearsBetweenDateInputs(values.birth_date, values.join_date) < 18
  ) {
    errors.birth_date =
      "Employee must be at least 18 years old on their join date.";
  }

  if (values.join_date && !isWithinJoinDateFutureCap(values.join_date)) {
    errors.join_date = "Join date can't be more than 90 days in the future.";
  }

  if (
    values.contract_end_date &&
    !isWithinReasonableFutureCeiling(values.contract_end_date)
  ) {
    errors.contract_end_date =
      "Contract end date is too far in the future to be valid.";
  } else if (
    values.contract_end_date &&
    values.join_date &&
    new Date(values.contract_end_date) <= new Date(values.join_date)
  ) {
    errors.contract_end_date = "Contract end date must be after the join date.";
  }

  if (lastWorkingDateIncomplete) {
    errors.last_working_date = "Last working date is incomplete.";
  } else if (values.status === "RESIGNED" && !values.last_working_date) {
    errors.last_working_date =
      "Last working date is required when status is Resigned.";
  }
  return errors;
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
    badge: level.is_teaching_role ? (
      <GraduationCap size={12} aria-label="Teaching role" />
    ) : null,
    tone: level.is_teaching_role ? "green" : null,
    searchText: `${level.name} ${level.is_teaching_role ? "Teaching" : ""}`,
  }));
}
