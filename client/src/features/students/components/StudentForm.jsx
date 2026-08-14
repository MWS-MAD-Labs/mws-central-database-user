import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import {
  CheckboxField,
  Field,
  SearchableSelect,
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
  genderOptions,
  religionOptions,
  studentEntryTypes,
  studentStatuses,
} from "../api/studentsApi.js";

const emptyOptions = {
  grades: [],
  academicYears: [],
};

// Only this domain is ever allowed (server-side: emailWithAllowedDomain()) -
// so the field only needs the local part, not the whole address.
const ALLOWED_EMAIL_DOMAIN = "millennia21.id";

// Mirrors identifier-lock.ts's IDENTIFIER_EDIT_GRACE_PERIOD_MS - once NISN
// has a value, it can only be changed within 1 hour of the student record
// being created. Adding a value to a still-empty NISN is never time-gated.
const SENSITIVE_FIELD_GRACE_PERIOD_MS = 60 * 60 * 1000;

export function StudentForm({
  mode,
  student,
  options = emptyOptions,
  isSubmitting,
  onSubmit,
}) {
  const { user } = useAuth();
  const [values, setValues] = useState(() =>
    getInitialValues(mode, student, options),
  );
  // Snapshotted once (impure to read Date.now() during render) - the form
  // is a short-lived session, so "locked as of when it was opened" is fine.
  const [nowSnapshot] = useState(() => Date.now());

  const isCreate = mode === "create";

  // Mirrors student-service.ts's create()/update() unit check - only the
  // current grade must be within the DB Admin's own unit. Join grade is
  // left unfiltered since a student can legitimately join in one unit
  // (e.g. Elementary) and now sit in another (e.g. Junior High). Always
  // keep the already-selected grade in the list so editing a record from
  // outside the admin's unit (reads aren't unit-scoped) doesn't blank out
  // the field - the update itself will still be rejected server-side.
  const currentGradeOptionsForRole =
    user?.role === "DATABASE_ADMIN"
      ? options.grades.filter(
          (grade) =>
            grade.unit_id === user?.unit_id ||
            grade.id === values.current_grade_id,
        )
      : options.grades;

  // Past the grace period, an NISN that already has a value can only be
  // cleared/changed by soft-deleting and recreating the student - matches
  // identifier-lock.ts exactly (checked against the value at load, since
  // that's what the backend compares against too).
  const isPastGracePeriod =
    mode === "edit" &&
    Boolean(student?.created_at) &&
    nowSnapshot - new Date(student.created_at).getTime() >
      SENSITIVE_FIELD_GRACE_PERIOD_MS;
  const nisnLocked = isPastGracePeriod && Boolean(student?.academic?.nisn);

  // Entry type only feeds a future NIS reissue - once a real NIS exists,
  // changing it would silently desync the entry-type digit already baked
  // into that NIS, with no way to reconcile it. Backend enforces this too.
  const entryTypeLocked = mode === "edit" && Boolean(student?.academic?.nis);

  // Graduating a student with a real active enrollment derives
  // graduation_grade/leave_year from that enrollment server-side (see
  // student-service.ts's update()) rather than trusting these fields, so
  // editing them here wouldn't actually change anything once saved.
  const hasActiveClass = Boolean(student?.academic?.current_class);

  function updateValue(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function updateCheckbox(field, checked) {
    setValues((current) => ({ ...current, [field]: checked }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit(buildPayload(values));
  }

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
          Academic Record
        </h2>
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          {isCreate ? (
            <Field
              label="NIS"
              hint={
                values.is_legacy
                  ? "Enter the exact historical NIS. If it matches the standard 7-digit format, it will automatically become the official NIS."
                  : "Generated after save from academic year, join grade, and entry type."
              }
            >
              <div className="space-y-3">
                <CheckboxField
                  label="Historical data (Input legacy NIS manually)"
                  checked={values.is_legacy}
                  onChange={(event) => {
                    const isChecked = event.target.checked;
                    updateCheckbox("is_legacy", isChecked);
                    if (!isChecked) updateValue("legacy_nis", "");
                  }}
                />

                {values.is_legacy ? (
                  <TextInput
                    required
                    placeholder="e.g. 1234567 or old format"
                    value={values.legacy_nis}
                    onChange={(event) =>
                      updateValue("legacy_nis", event.target.value)
                    }
                  />
                ) : (
                  <div className="flex h-11 items-center rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] px-3 text-sm font-semibold text-[var(--mws-muted)]">
                    Auto-generated
                  </div>
                )}
              </div>
            </Field>
          ) : (
            <Field
              label="NIS"
              hint="Managed by backend and locked after creation."
            >
              <TextInput
                value={values.nis || values.legacy_nis || "-"}
                disabled
              />
            </Field>
          )}
          <Field
            label="NISN"
            hint={
              nisnLocked ? (
                <LockedHint />
              ) : (
                <LengthHint value={values.nisn} max={10} label="digits" />
              )
            }
          >
            <TextInput
              inputMode="numeric"
              maxLength={10}
              disabled={nisnLocked}
              value={values.nisn}
              onChange={(event) =>
                updateValue("nisn", digitsOnly(event.target.value, 10))
              }
            />
          </Field>
          <Field
            label="Entry type"
            hint={
              entryTypeLocked
                ? "Locked - NIS already assigned, changing this would no longer match it."
                : isCreate
                  ? undefined
                  : "Only affects a future NIS reissue - safe to correct for legacy imports."
            }
          >
            <SearchableSelect
              required
              disabled={entryTypeLocked}
              value={values.entry_type}
              onChange={(value) => updateValue("entry_type", value)}
              options={entryTypeOptions(studentEntryTypes)}
              placeholder="Select entry type"
              searchPlaceholder="Search entry type"
            />
          </Field>
          <Field label="Status">
            <SearchableSelect
              disabled={isCreate}
              value={values.status}
              onChange={(value) => updateValue("status", value)}
              options={
                isCreate
                  ? enumOptions(studentStatuses)
                  : [
                      { value: "", label: "Backend default" },
                      ...enumOptions(studentStatuses),
                    ]
              }
              placeholder="Select status"
              searchPlaceholder="Search status"
            />
          </Field>
          <Field label="Current grade">
            <SearchableSelect
              required={isCreate}
              value={values.current_grade_id}
              onChange={(value) => updateValue("current_grade_id", value)}
              options={gradeOptions(currentGradeOptionsForRole)}
              placeholder="Select current grade"
              searchPlaceholder="Search grades"
            />
          </Field>
          <Field label="Join academic year">
            <SearchableSelect
              required={isCreate}
              value={values.join_academic_year_id}
              onChange={(value) => updateValue("join_academic_year_id", value)}
              options={academicYearOptions(options.academicYears)}
              placeholder="Select join year"
              searchPlaceholder="Search years"
            />
          </Field>
          <Field label="Join grade">
            <SearchableSelect
              required={isCreate}
              value={values.join_grade_id}
              onChange={(value) => updateValue("join_grade_id", value)}
              options={gradeOptions(options.grades)}
              placeholder="Select join grade"
              searchPlaceholder="Search grades"
            />
          </Field>
          <Field label="Previous school" className="md:col-span-2">
            <TextInput
              value={values.previous_school}
              onChange={(event) =>
                updateValue("previous_school", event.target.value)
              }
            />
          </Field>
          {!isCreate ? (
            <>
              <Field
                label="Graduation grade"
                hint={
                  hasActiveClass
                    ? "Filled in automatically from their current class when graduated - this won't override it."
                    : undefined
                }
              >
                <SearchableSelect
                  disabled={hasActiveClass}
                  value={values.graduation_grade}
                  onChange={(value) => updateValue("graduation_grade", value)}
                  options={gradeNameOptions(options.grades)}
                  placeholder="Select grade"
                  searchPlaceholder="Search grades"
                />
              </Field>
              <Field
                label="Leave year"
                hint={
                  hasActiveClass
                    ? "Filled in automatically from their current class's academic year when graduated - this won't override it."
                    : undefined
                }
              >
                <SearchableSelect
                  disabled={hasActiveClass}
                  value={values.leave_year}
                  onChange={(value) => updateValue("leave_year", value)}
                  options={academicYearNameOptions(options.academicYears)}
                  placeholder="Select year"
                  searchPlaceholder="Search years"
                />
              </Field>
              <Field label="SN">
                <TextInput
                  value={values.sn}
                  onChange={(event) => updateValue("sn", event.target.value)}
                />
              </Field>
            </>
          ) : null}
        </div>
      </section>

      <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
          Services
        </h2>
        <div className="grid min-w-0 gap-3 md:grid-cols-3">
          <CheckboxField
            label="Pickup/drop"
            checked={values.pickup_drop_service}
            onChange={(event) =>
              updateCheckbox("pickup_drop_service", event.target.checked)
            }
          />
          <CheckboxField
            label="Catering"
            checked={values.catering_service}
            onChange={(event) =>
              updateCheckbox("catering_service", event.target.checked)
            }
          />
          <CheckboxField
            label="PSB guide"
            checked={values.psb_guide}
            onChange={(event) =>
              updateCheckbox("psb_guide", event.target.checked)
            }
          />
        </div>
      </section>

      <div className="flex flex-wrap justify-end">
        <Button type="submit" disabled={isSubmitting}>
          <Save size={16} />
          {isSubmitting
            ? "Saving..."
            : isCreate
              ? "Create student"
              : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function getInitialValues(mode, student, options) {
  const identity = student?.identity || {};
  const academic = student?.academic || {};

  return {
    full_name: identity.full_name || "",
    nick_name: identity.nick_name || "",
    email_local: emailLocalPart(identity.email),
    gender: identity.gender || "",
    religion: identity.religion || "",
    birth_place: identity.birth_place || "",
    birth_date: dateInputFromIso(identity.birth_date),
    is_legacy: false,
    legacy_nis: academic.legacy_nis || "",
    nis: academic.nis || "",
    nisn: academic.nisn || "",
    entry_type: academic.entry_type || "PSB",
    status: student?.status || (mode === "create" ? "REGISTERED" : ""),
    current_grade_id:
      findOptionByName(options.grades, academic.current_grade)?.id || "",
    join_academic_year_id: academic.join_academic_year_id || "",
    join_grade_id:
      findOptionByName(options.grades, academic.join_grade)?.id || "",
    previous_school: academic.previous_school || "",
    graduation_grade: academic.graduation_grade || "",
    leave_year: academic.leave_year || "",
    sn: academic.sn || "",
    pickup_drop_service: Boolean(academic.pickup_drop_service),
    catering_service: Boolean(academic.catering_service),
    psb_guide: Boolean(academic.psb_guide),
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
    // Not editable from this form anymore - identity.photo_url in the
    // detail response is now a computed value (presigned MinIO URL or the
    // legacy string, see resolveStudentPhotoUrl in student-photo-service.ts),
    // not the raw stored value, so round-tripping it back here would
    // overwrite the legacy column with a temporary URL. Managed from the
    // student detail page's own upload/remove controls instead.
    legacy_nis: values.is_legacy
      ? trimmedOrUndefined(values.legacy_nis)
      : undefined,
    nisn: trimmedOrUndefined(values.nisn),
    entry_type: values.entry_type,
    status: values.status,
    current_grade_id: values.current_grade_id,
    join_academic_year_id: values.join_academic_year_id,
    join_grade_id: values.join_grade_id,
    previous_school: trimmedOrUndefined(values.previous_school),
    graduation_grade: trimmedOrUndefined(values.graduation_grade),
    leave_year: trimmedOrUndefined(values.leave_year),
    sn: trimmedOrUndefined(values.sn),
    pickup_drop_service: values.pickup_drop_service,
    catering_service: values.catering_service,
    psb_guide: values.psb_guide,
  });
}

function findOptionByName(options, name) {
  if (!name) return null;
  return options.find((option) => option.name === name) || null;
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
      Locked - past the 1-hour edit window. Soft-delete and recreate the student
      to change this.
    </span>
  );
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

function buildEmail(localPart) {
  const trimmed = trimmedOrUndefined(localPart);
  return trimmed ? `${trimmed}@${ALLOWED_EMAIL_DOMAIN}` : undefined;
}

// Strips anything that isn't valid in an email local-part (RFC 5322-ish,
// the practical subset) - "@" in particular, since the domain is already a
// fixed suffix next to this input and typing one there just reads as a
// second, ambiguous "@".
function sanitizeEmailLocalPart(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._%+-]/g, "");
}

// formatStatus() title-cases everything (PSB -> "Psb"), which is wrong for
// an acronym - special-case it, fall through to formatStatus for the rest
// (PRE_K -> "Pre K", TRANSFER -> "Transfer").
function formatEntryType(entryType) {
  return entryType === "PSB" ? "PSB" : formatStatus(entryType);
}

function enumOptions(values) {
  return values.map((value) => ({ value, label: formatStatus(value) }));
}

function entryTypeOptions(values) {
  return values.map((value) => ({ value, label: formatEntryType(value) }));
}

function gradeOptions(grades) {
  return grades.map((grade) => ({
    value: grade.id,
    label: grade.name,
    searchText: `${grade.name} ${grade.level ?? ""}`,
  }));
}

// graduation_grade is a free-text string on the student record (not an FK),
// so this picks from the same grades list but hands back the name, not the id.
function gradeNameOptions(grades) {
  return grades.map((grade) => ({
    value: grade.name,
    label: grade.name,
    searchText: `${grade.name} ${grade.level ?? ""}`,
  }));
}

function academicYearOptions(years) {
  return years.map((year) => ({
    value: year.id,
    label: year.name,
    badge: formatStatus(year.status),
    tone:
      year.status === "ACTIVE"
        ? "green"
        : year.status === "UPCOMING"
          ? "amber"
          : "neutral",
    searchText: `${year.name} ${formatStatus(year.status)}`,
  }));
}

// leave_year is a free-text string on the student record (not an FK), so
// this picks from the same academic years list but hands back the name.
function academicYearNameOptions(years) {
  return years.map((year) => ({
    value: year.name,
    label: year.name,
    badge: formatStatus(year.status),
    tone:
      year.status === "ACTIVE"
        ? "green"
        : year.status === "UPCOMING"
          ? "amber"
          : "neutral",
    searchText: `${year.name} ${formatStatus(year.status)}`,
  }));
}
