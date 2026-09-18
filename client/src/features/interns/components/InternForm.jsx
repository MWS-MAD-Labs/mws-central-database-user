import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import { ChangeReviewTable } from "../../../components/ui/ChangeReviewTable.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import {
  DateField,
  EmailField,
  Field,
  LimitedField,
  PhoneField,
  ReligionFields,
  SearchableSelect,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import {
  capitalizeWords,
  addMonthsToDateInput,
  cleanPayload,
  CONTRACT_DURATION_OPTIONS,
  dateInputFromIso,
  isBirthDateNotFuture,
  isBirthDateNotTooOld,
  isoFromDateInput,
  isWithinJoinDateFutureCap,
  isWithinReasonableFutureCeiling,
  optionalNumber,
  scrollToFirstError,
  trimmedOrUndefined,
  yearsBetweenDateInputs,
} from "../../../lib/form.js";
import { enumOptions, formatEducationLevel } from "../../../lib/format.js";
import {
  buildChangedFieldEntries,
  buildFilledFieldEntries,
  makeOptionAwareResolver,
} from "../../../lib/formDiff.js";
import { showErrorToast } from "../../../lib/toast.js";
import { useCreateFormDraft } from "../../../lib/useCreateFormDraft.js";
import { CreateDraftDialog } from "../../../components/ui/CreateDraftDialog.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import {
  educationLevels,
  genderOptions,
  internStatuses,
  religionOptions,
} from "../api/internsApi.js";

const emptyOptions = {
  units: [],
  jobPositions: [],
  buildings: [],
};

const ALLOWED_EMAIL_DOMAIN = "millennia21.id";
const EMAIL_LOCAL_MAX_LENGTH = 50 - 1 - ALLOWED_EMAIL_DOMAIN.length;
const MIN_GRADUATION_AGE_YEARS = 12;

export function InternForm({
  mode,
  intern,
  options = emptyOptions,
  isSubmitting,
  onSubmit,
}) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [initialValues] = useState(() =>
    getInitialValues(mode, intern, options),
  );
  const [values, setValues] = useState(initialValues);

  const isCreate = mode === "create";
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const errors =
    hasAttemptedSubmit || !isCreate
      ? computeInternErrors(values, isCreate)
      : {};
  const draft = useCreateFormDraft({ entity: "intern", values, enabled: isCreate });
  const isDirty = JSON.stringify(values) !== JSON.stringify(initialValues);

  function updateValue(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function handleReset() {
    setValues(initialValues);
    draft.clearDraft();
  }

  function handleJoinDateChange(joinDate) {
    setValues((current) => ({
      ...current,
      join_date: joinDate,
      end_date: current.contract_duration_months
        ? addMonthsToDateInput(joinDate, current.contract_duration_months)
        : current.end_date,
    }));
  }

  function handleDurationChange(months) {
    setValues((current) => ({
      ...current,
      contract_duration_months: months,
      end_date: months
        ? addMonthsToDateInput(current.join_date, months)
        : current.end_date,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setHasAttemptedSubmit(true);

    const computedErrors = computeInternErrors(values, isCreate);
    if (Object.keys(computedErrors).length > 0) {
      showErrorToast("Please fix the highlighted fields before saving.");
      scrollToFirstError(computedErrors);
      return;
    }

    const resolveValue = makeOptionAwareResolver(
      options,
      INTERN_ID_FIELD_OPTION_KEYS,
      INTERN_FIELD_FORMATTERS,
    );

    const internshipAlreadyEnded =
      values.status === "ACTIVE" &&
      values.end_date &&
      new Date(isoFromDateInput(values.end_date)) <= new Date();

    const reviewWarning = internshipAlreadyEnded ? (
      <>
        <strong>Contract end date already passed.</strong>
        <br />
        Status will change to <strong>Completed</strong> right away once this is saved.
      </>
    ) : null;
    const fieldWarnings = internshipAlreadyEnded
      ? { end_date: "Passed date will set status to Completed." }
      : {};

    if (isCreate) {
      const fields = buildFilledFieldEntries(values, {
        labels: REQUIRED_FIELD_LABELS,
        resolveValue,
        sections: INTERN_FIELD_SECTIONS,
        excludeKeys: ["contract_duration_months"],
      });
      const confirmed = await confirm({
        title: "Review before creating",
          description: (
            <ChangeReviewTable
              changes={fields}
              mode="create"
              warning={reviewWarning}
              fieldWarnings={fieldWarnings}
            />
          ),
          confirmLabel: internshipAlreadyEnded ? "Create as completed" : "Create intern",
        wide: true,
      });
      if (!confirmed) return;
    } else {
      const changes = buildChangedFieldEntries(initialValues, values, {
        labels: REQUIRED_FIELD_LABELS,
        resolveValue,
          sections: INTERN_FIELD_SECTIONS,
          excludeKeys: ["contract_duration_months"],
      });
      if (changes.length > 0) {
        const confirmed = await confirm({
          title: "Review changes before saving",
          description: (
            <ChangeReviewTable
              changes={changes}
              warning={reviewWarning}
              fieldWarnings={fieldWarnings}
            />
          ),
          confirmLabel: internshipAlreadyEnded ? "Save as completed" : "Save changes",
          wide: true,
        });
        if (!confirmed) return;
      }
    }

    onSubmit(buildPayload(values));
  }

  const unitOptionsForRole =
    user?.role === "DATABASE_ADMIN"
      ? options.units.filter((unit) => unit.id === user?.unit_id)
      : options.units;

  return (
    <>
    <form onSubmit={handleSubmit} className="min-w-0 space-y-5" noValidate>
      <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <h2 className="mb-4 text-base font-semibold text-(--mws-charcoal)">
          Identity
        </h2>
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
          <Field label="Gender" name="gender" error={errors.gender}>
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              value={values.gender}
              onChange={(value) => updateValue("gender", value)}
              options={enumOptions(genderOptions)}
              placeholder="Select Gender"
              searchPlaceholder="Search Gender"
            />
          </Field>
          <ReligionFields
            values={values}
            errors={errors}
            setValues={setValues}
            religionOptions={religionOptions}
            required={isCreate && hasAttemptedSubmit}
          />
          <LimitedField
            label="Birth Place"
            field="birth_place"
            max={25}
            transform={capitalizeWords}
            values={values}
            errors={errors}
            updateValue={updateValue}
          />
          <Field label="Birth Date" name="birth_date" error={errors.birth_date}>
            <DateField
              invalid={Boolean(errors.birth_date)}
              value={values.birth_date}
              onChange={(event) =>
                updateValue("birth_date", event.target.value)
              }
            />
          </Field>
          <PhoneField values={values} errors={errors} updateValue={updateValue} />
          <LimitedField
            label="Residential Address"
            field="residential_address"
            max={255}
            as="textarea"
            className="md:col-span-2"
            rows={2}
            values={values}
            errors={errors}
            updateValue={updateValue}
          />
        </div>
      </section>

      <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <h2 className="mb-4 text-base font-semibold text-(--mws-charcoal)">
          Internship
        </h2>
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Field label="Unit" name="unit_id" error={errors.unit_id}>
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              value={values.unit_id}
              onChange={(value) => updateValue("unit_id", value)}
              options={masterOptions(unitOptionsForRole)}
              placeholder="Select Unit"
              searchPlaceholder="Search Unit"
            />
          </Field>
          <Field label="Job Position" name="job_position_id" error={errors.job_position_id}>
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              value={values.job_position_id}
              onChange={(value) => updateValue("job_position_id", value)}
              options={masterOptions(options.jobPositions)}
              placeholder="Select Job Position"
              searchPlaceholder="Search Job Position"
            />
          </Field>
          <Field label="Building" name="building_id" error={errors.building_id}>
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              value={values.building_id}
              onChange={(value) => updateValue("building_id", value)}
              options={masterOptions(options.buildings)}
              placeholder="Select Building"
              searchPlaceholder="Search Building"
            />
          </Field>
          {!isCreate ? (
            <Field label="Status">
              <SearchableSelect
                value={values.status}
                onChange={(value) => updateValue("status", value)}
                options={enumOptions(internStatuses)}
                placeholder="Select Status"
                searchPlaceholder="Search Status"
              />
            </Field>
          ) : null}
          <Field label="Join Date" name="join_date" error={errors.join_date}>
            <DateField
              invalid={Boolean(errors.join_date)}
              value={values.join_date}
              onChange={(event) => handleJoinDateChange(event.target.value)}
            />
          </Field>
          <Field label="Contract Duration">
            <SearchableSelect
              value={values.contract_duration_months}
              onChange={handleDurationChange}
              options={CONTRACT_DURATION_OPTIONS}
              placeholder="Set end date manually"
              searchPlaceholder="Search Durations"
            />
          </Field>
          <Field
            label="Contract End Date"
            name="end_date"
            error={errors.end_date}
            hint={
              errors.end_date
                ? undefined
                : values.contract_duration_months
                  ? "Auto-filled from join date + duration"
                  : undefined
            }
          >
            <DateField
              invalid={Boolean(errors.end_date)}
              value={values.end_date}
              onChange={(event) => updateValue("end_date", event.target.value)}
            />
          </Field>
          <LimitedField
            label="Notes"
            field="notes"
            max={500}
            as="textarea"
            className="md:col-span-2"
            rows={2}
            values={values}
            errors={errors}
            updateValue={updateValue}
          />
        </div>
      </section>

      <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <h2 className="mb-4 text-base font-semibold text-(--mws-charcoal)">
          Education
        </h2>
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
          <Field label="Graduation Year" name="graduation_year" error={errors.graduation_year}>
            <TextInput
              inputMode="numeric"
              invalid={Boolean(errors.graduation_year)}
              value={values.graduation_year}
              onChange={(event) =>
                updateValue(
                  "graduation_year",
                  event.target.value.replace(/\D/g, "").slice(0, 4),
                )
              }
              placeholder="Expected or actual"
            />
          </Field>
          <LimitedField
            label="Institution"
            field="institution_name"
            max={150}
            values={values}
            errors={errors}
            updateValue={updateValue}
          />
          <LimitedField
            label="Major"
            field="major"
            max={100}
            values={values}
            errors={errors}
            updateValue={updateValue}
          />
        </div>
      </section>

      <div className="flex flex-wrap justify-end gap-3">
        {isCreate && isDirty ? (
          <Button type="button" variant="secondary" onClick={handleReset}>
            Reset form
          </Button>
        ) : null}
        <Button type="submit" disabled={isSubmitting}>
          <Save size={16} />
          {isSubmitting
            ? "Saving..."
            : isCreate
              ? "Create intern"
              : "Save changes"}
        </Button>
      </div>
    </form>
    <CreateDraftDialog
      entityLabel="intern"
      draft={isCreate && !draft.draftHandled ? draft.savedDraft : null}
      onContinue={() => {
        setValues(draft.savedDraft.values);
        draft.markDraftHandled();
      }}
      onStartFresh={() => {
        draft.clearDraft();
      }}
    />
    </>
  );
}

function getInitialValues(mode, intern, options) {
  const identity = intern?.identity || {};
  const employment = intern?.employment || {};

  return {
    full_name: identity.full_name || "",
    nick_name: identity.nick_name || "",
    email_local: emailLocalPart(identity.email),
    gender: identity.gender || "",
    religion: identity.religion || "",
    religion_other: identity.religion_other || "",
    birth_place: identity.birth_place || "",
    birth_date: dateInputFromIso(identity.birth_date),
    mobile_phone: identity.mobile_phone || "",
    residential_address: identity.residential_address || "",

    unit_id: intern?.unit_id || "",
    job_position_id:
      findOptionByName(options.jobPositions, employment.job_position)?.id || "",
    building_id:
      findOptionByName(options.buildings, employment.building)?.id || "",
    status: intern?.status || "ACTIVE",
    join_date: dateInputFromIso(employment.join_date),
    end_date: dateInputFromIso(employment.end_date),
    contract_duration_months: "",
    notes: intern?.notes || "",

    education_level: identity.education_level || "",
    institution_name: identity.institution_name || "",
    major: identity.major || "",
    graduation_year: identity.graduation_year
      ? String(identity.graduation_year)
      : "",
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
    mobile_phone: trimmedOrUndefined(values.mobile_phone),
    residential_address: trimmedOrUndefined(values.residential_address),

    unit_id: values.unit_id,
    job_position_id: values.job_position_id,
    building_id: values.building_id,
    status: values.status,
    join_date: isoFromDateInput(values.join_date),
    end_date: isoFromDateInput(values.end_date),
    notes: trimmedOrUndefined(values.notes),

    education_level: values.education_level || undefined,
    institution_name: trimmedOrUndefined(values.institution_name),
    major: trimmedOrUndefined(values.major),
    graduation_year: optionalNumber(values.graduation_year),
  });
}

function emailLocalPart(email) {
  if (!email) return "";
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

function buildEmail(localPart) {
  const trimmed = trimmedOrUndefined(localPart);
  return trimmed ? `${trimmed}@${ALLOWED_EMAIL_DOMAIN}` : undefined;
}

function sanitizeEmailLocalPart(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._%+-]/g, "");
}

function masterOptions(items) {
  return items.map((item) => ({ value: item.id, label: item.name }));
}

function findOptionByName(options, name) {
  if (!name) return null;
  return options.find((option) => option.name === name) || null;
}

const REQUIRED_FIELD_LABELS = {
  full_name: "Full name",
  nick_name: "Nick name",
  email_local: "Email",
  gender: "Gender",
  religion: "Religion",
  religion_other: "Religion (Please Specify)",
  unit_id: "Unit",
  job_position_id: "Job position",
  building_id: "Building",
  join_date: "Join date",
  end_date: "End date",
};

// Which options list (from the `options` prop) resolves each *_id field's
// display name in the pre-save change review dialog - see formDiff.js.
const INTERN_ID_FIELD_OPTION_KEYS = {
  unit_id: "units",
  job_position_id: "jobPositions",
  building_id: "buildings",
};

// Fields whose own display formatter beats the review dialog's generic
// enum-label guesser (e.g. education_level's "SMA/SMK", not "Sma Smk").
const INTERN_FIELD_FORMATTERS = {
  email_local: buildEmail,
  education_level: formatEducationLevel,
};

// Groups the review dialog's fields, in display order - see
// ChangeReviewTable's groupBySection.
const INTERN_FIELD_SECTIONS = {
  full_name: "Identity",
  nick_name: "Identity",
  email_local: "Identity",
  gender: "Identity",
  religion: "Identity",
  religion_other: "Identity",
  birth_place: "Identity",
  birth_date: "Identity",
  mobile_phone: "Identity",
  residential_address: "Identity",

  unit_id: "Internship",
  job_position_id: "Internship",
  building_id: "Internship",
  status: "Internship",
  join_date: "Internship",
  end_date: "Internship",
  notes: "Internship",

  education_level: "Education",
  institution_name: "Education",
  major: "Education",
  graduation_year: "Education",
};

function computeInternErrors(values, isCreate) {
  const errors = {};
  if (isCreate) {
    for (const [field, label] of Object.entries(REQUIRED_FIELD_LABELS)) {
      if (field === "religion_other" && values.religion !== "OTHER") continue;
      if (!values[field]) {
        errors[field] = `${label} is required.`;
      }
    }
  }
  if (
    values.join_date &&
    values.end_date &&
    new Date(values.end_date) <= new Date(values.join_date)
  ) {
    errors.end_date = "End date must be after join date.";
  }

  if (values.birth_date && !isBirthDateNotFuture(values.birth_date)) {
    errors.birth_date = "Birth date cannot be in the future.";
  } else if (values.birth_date && !isBirthDateNotTooOld(values.birth_date)) {
    errors.birth_date = "Birth date is too far in the past to be valid.";
  } else if (
    values.birth_date &&
    values.join_date &&
    yearsBetweenDateInputs(values.birth_date, values.join_date) < 15
  ) {
    errors.birth_date =
      "Intern must be at least 15 years old on their join date.";
  }

  if (values.join_date && !isWithinJoinDateFutureCap(values.join_date)) {
    errors.join_date = "Join date can't be more than 90 days in the future.";
  }

  if (
    !errors.end_date &&
    values.end_date &&
    !isWithinReasonableFutureCeiling(values.end_date)
  ) {
    errors.end_date = "End date is too far in the future to be valid.";
  }

  if (values.graduation_year && values.graduation_year.length !== 4) {
    errors.graduation_year = "Graduation year must be a 4-digit year.";
  } else if (
    values.graduation_year &&
    values.birth_date &&
    Number(values.graduation_year) - new Date(values.birth_date).getFullYear() <
      MIN_GRADUATION_AGE_YEARS
  ) {
    errors.graduation_year =
      "Graduation year implies graduating at an implausibly young age.";
  }
  return errors;
}
