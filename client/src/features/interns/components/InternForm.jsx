import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import {
  DateField,
  Field,
  LengthHint,
  SearchableSelect,
  TextAreaInput,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import {
  capitalizeWords,
  cleanPayload,
  dateInputFromIso,
  isBirthDateNotFuture,
  isBirthDateNotTooOld,
  isoFromDateInput,
  isWithinJoinDateFutureCap,
  isWithinReasonableFutureCeiling,
  optionalNumber,
  phoneDigitsOnly,
  scrollToFirstError,
  textLength,
  trimmedOrUndefined,
  yearsBetweenDateInputs,
} from "../../../lib/form.js";
import { formatEducationLevel, formatStatus } from "../../../lib/format.js";
import { showErrorToast } from "../../../lib/toast.js";
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

// Only this domain is ever allowed (server-side: emailWithAllowedDomain()) -
// so the field only needs the local part, not the whole address.
const ALLOWED_EMAIL_DOMAIN = "millennia21.id";
// emailWithAllowedDomain() caps the whole address at 50 chars - minus the
// "@" and the domain itself leaves this much room for the local part.
const EMAIL_LOCAL_MAX_LENGTH = 50 - 1 - ALLOWED_EMAIL_DOMAIN.length;
// Same sanity floor as intern-validation.ts's MIN_GRADUATION_AGE_YEARS.
const MIN_GRADUATION_AGE_YEARS = 12;

export function InternForm({
  mode,
  intern,
  options = emptyOptions,
  isSubmitting,
  onSubmit,
}) {
  const { user } = useAuth();
  const [initialValues] = useState(() =>
    getInitialValues(mode, intern, options),
  );
  const [values, setValues] = useState(initialValues);

  const isCreate = mode === "create";
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  // Edit mode shows errors right away (not gated on a submit attempt) - see
  // the same reasoning in EmployeeForm.jsx.
  const errors =
    hasAttemptedSubmit || !isCreate
      ? computeInternErrors(values, isCreate)
      : {};

  function updateValue(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
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

    onSubmit(buildPayload(values));
  }

  // Mirrors intern-service.ts's create()/update() unit check - a DB Admin
  // can only place an intern in their own unit.
  const unitOptionsForRole =
    user?.role === "DATABASE_ADMIN"
      ? options.units.filter((unit) => unit.id === user?.unit_id)
      : options.units;

  return (
    <form onSubmit={handleSubmit} className="min-w-0 space-y-5" noValidate>
      <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
          Identity
        </h2>
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Field
            label="Full Name"
            name="full_name"
            error={errors.full_name}
            hint={
              <LengthHint
                value={values.full_name}
                max={50}
                label="characters"
                count={textLength}
                prefix="Required, up to 50 characters"
              />
            }
          >
            <TextInput
              invalid={Boolean(errors.full_name)}
              value={values.full_name}
              maxLength={50}
              onChange={(event) =>
                updateValue("full_name", capitalizeWords(event.target.value))
              }
            />
          </Field>
          <Field
            label="Nick Name"
            name="nick_name"
            error={errors.nick_name}
            hint={
              <LengthHint
                value={values.nick_name}
                max={25}
                label="characters"
                count={textLength}
                prefix="Required, up to 25 characters"
              />
            }
          >
            <TextInput
              invalid={Boolean(errors.nick_name)}
              value={values.nick_name}
              maxLength={25}
              onChange={(event) =>
                updateValue("nick_name", capitalizeWords(event.target.value))
              }
            />
          </Field>
          <Field
            label="Email"
            name="email_local"
            error={errors.email_local}
            hint={
              <LengthHint
                value={values.email_local}
                max={EMAIL_LOCAL_MAX_LENGTH}
                label="characters"
                count={textLength}
                prefix={`Required, up to ${EMAIL_LOCAL_MAX_LENGTH} characters before @${ALLOWED_EMAIL_DOMAIN}`}
              />
            }
          >
            <div className="flex min-w-0 items-stretch">
              <TextInput
                invalid={Boolean(errors.email_local)}
                className="rounded-r-none"
                value={values.email_local}
                maxLength={EMAIL_LOCAL_MAX_LENGTH}
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
          <Field label="Religion" name="religion" error={errors.religion}>
            <SearchableSelect
              required={isCreate && hasAttemptedSubmit}
              value={values.religion}
              onChange={(value) =>
                setValues((current) => ({
                  ...current,
                  religion: value,
                  religion_other:
                    value === "OTHER" ? current.religion_other : "",
                }))
              }
              options={enumOptions(religionOptions)}
              placeholder="Select Religion"
              searchPlaceholder="Search Religion"
            />
          </Field>
          {values.religion === "OTHER" ? (
            <Field
              label="Religion (Please Specify)"
              name="religion_other"
              error={errors.religion_other}
              hint={<LengthHint value={values.religion_other} max={50} label="characters" count={textLength} />}
            >
              <TextInput
                invalid={Boolean(errors.religion_other)}
                value={values.religion_other}
                maxLength={50}
                onChange={(event) =>
                  updateValue("religion_other", event.target.value)
                }
                placeholder="e.g. Sikh"
              />
            </Field>
          ) : null}
          <Field
            label="Birth Place"
            name="birth_place"
            error={errors.birth_place}
            hint={<LengthHint value={values.birth_place} max={25} label="characters" count={textLength} />}
          >
            <TextInput
              invalid={Boolean(errors.birth_place)}
              value={values.birth_place}
              maxLength={25}
              onChange={(event) =>
                updateValue("birth_place", capitalizeWords(event.target.value))
              }
            />
          </Field>
          <Field label="Birth Date" name="birth_date" error={errors.birth_date}>
            <DateField
              invalid={Boolean(errors.birth_date)}
              value={values.birth_date}
              onChange={(event) =>
                updateValue("birth_date", event.target.value)
              }
            />
          </Field>
          <Field label="Mobile Phone">
            <TextInput
              inputMode="tel"
              placeholder="e.g. 081234567890"
              value={values.mobile_phone}
              // indonesianPhone() (server) accepts 10-15 digits after
              // normalization - +1 for an optional leading "+".
              maxLength={16}
              onChange={(event) =>
                updateValue("mobile_phone", phoneDigitsOnly(event.target.value))
              }
            />
          </Field>
          <Field
            label="Residential Address"
            className="md:col-span-2"
            hint={<LengthHint value={values.residential_address} max={255} label="characters" count={textLength} />}
          >
            <TextAreaInput
              rows={2}
              value={values.residential_address}
              maxLength={255}
              onChange={(event) =>
                updateValue("residential_address", event.target.value)
              }
            />
          </Field>
        </div>
      </section>

      <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
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
              onChange={(event) => updateValue("join_date", event.target.value)}
            />
          </Field>
          <Field label="End Date" name="end_date" error={errors.end_date}>
            <DateField
              invalid={Boolean(errors.end_date)}
              value={values.end_date}
              onChange={(event) => updateValue("end_date", event.target.value)}
            />
          </Field>
          <Field
            label="Notes"
            className="md:col-span-2"
            hint={<LengthHint value={values.notes} max={500} label="characters" count={textLength} />}
          >
            <TextAreaInput
              rows={2}
              value={values.notes}
              maxLength={500}
              onChange={(event) => updateValue("notes", event.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
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
          <Field
            label="Institution"
            hint={<LengthHint value={values.institution_name} max={150} label="characters" count={textLength} />}
          >
            <TextInput
              value={values.institution_name}
              maxLength={150}
              onChange={(event) =>
                updateValue("institution_name", event.target.value)
              }
            />
          </Field>
          <Field
            label="Major"
            hint={<LengthHint value={values.major} max={100} label="characters" count={textLength} />}
          >
            <TextInput
              value={values.major}
              maxLength={100}
              onChange={(event) => updateValue("major", event.target.value)}
            />
          </Field>
        </div>
      </section>

      <div className="flex flex-wrap justify-end gap-3">
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

function enumOptions(values, formatter = formatStatus) {
  return values.map((value) => ({ value, label: formatter(value) }));
}

function masterOptions(items) {
  return items.map((item) => ({ value: item.id, label: item.name }));
}

function findOptionByName(options, name) {
  if (!name) return null;
  return options.find((option) => option.name === name) || null;
}

// birth_place/birth_date deliberately not required - unlike Student/
// Employee, HR doesn't collect these for interns.
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
