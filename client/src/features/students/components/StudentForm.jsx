import { useEffect, useMemo, useState } from "react";
import { Camera, RotateCcw, Save, UserRound } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import {
  CheckboxField,
  DateField,
  Field,
  SearchableSelect,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { PhotoCropDialog } from "../../../components/photo/PhotoCropDialog.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import {
  capitalizeWords,
  cleanPayload,
  dateInputFromIso,
  isBirthDateNotFuture,
  isBirthDateNotTooOld,
  isoFromDateInput,
  scrollToFirstError,
  trimmedOrUndefined,
} from "../../../lib/form.js";
import { formatStatus } from "../../../lib/format.js";
import {
  MAX_PHOTO_SIZE_BYTES,
  validateFileSize,
} from "../../../lib/fileSize.js";
import { showErrorToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import {
  genderOptions,
  religionOptions,
  studentEntryTypes,
  terminalStudentStatuses,
} from "../api/studentsApi.js";
import { formatEntryType } from "../format.js";

const emptyOptions = {
  grades: [],
  academicYears: [],
};

// Only this domain is ever allowed (server-side: emailWithAllowedDomain()) -
// so the field only needs the local part, not the whole address.
const ALLOWED_EMAIL_DOMAIN = "millennia21.id";

// Mirrors identifier-lock.ts's IDENTIFIER_EDIT_GRACE_PERIOD_MS - once NISN
// has a value, it can only be changed within 1 day of the student record
// being created. Adding a value to a still-empty NISN is never time-gated.
const SENSITIVE_FIELD_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

export function StudentForm({
  mode,
  student,
  options = emptyOptions,
  isSubmitting,
  onSubmit,
}) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [initialValues] = useState(() =>
    getInitialValues(mode, student, options),
  );
  const [values, setValues] = useState(initialValues);
  // Snapshotted once (impure to read Date.now() during render) - the form
  // is a short-lived session, so "locked as of when it was opened" is fine.
  const [nowSnapshot] = useState(() => Date.now());

  const isCreate = mode === "create";
  const isDirty = JSON.stringify(values) !== JSON.stringify(initialValues);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  // Edit mode shows errors right away (not gated on a submit attempt) - see
  // the same reasoning in EmployeeForm.jsx.
  const errors =
    hasAttemptedSubmit || !isCreate
      ? computeStudentErrors(values, isCreate)
      : {};

  // Create mode only - there's no student id yet to upload against (the
  // photo endpoint is POST /students/:id/photo), so the crop happens here
  // and the actual upload is chained by StudentCreatePage once create()
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

  function handleReset() {
    setValues(initialValues);
  }

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
  // This form never sends `status` (see buildPayload below), so these
  // fields only ever take effect on a student who's already Graduated -
  // student-service.ts's update() silently clears them back to null
  // otherwise. The real way to graduate a student is the class's Close
  // action, which sets status and these fields together.
  const isGraduated = student?.status === "GRADUATED";
  // Once a real completed enrollment is on file, that record is the source
  // of truth - editing these fields directly would let them drift from it
  // with no way to trace which class the value actually came from. Fix a
  // mistake by reactivating the enrollment and closing it again with the
  // right values instead. Only legacy-imported graduates (no enrollment
  // history at all) fall back to editing these directly.
  const hasCompletedEnrollment = Boolean(
    student?.academic?.has_completed_enrollment,
  );
  // Same posture as graduation_grade/leave_year above - once any real
  // enrollment exists (active or not), it's the source of truth for
  // current_grade too. Fix a mistake via Promote/Transfer/re-enroll on the
  // class record, not by editing this directly. Backend enforces this too
  // (student-service.ts's update()); this just surfaces it before submit
  // instead of after a rejected save. Uses has_active_enrollment_history,
  // not has_class_history - the latter counts every enrollment ever
  // created including rolled-back ones, which would leave this stuck
  // locked even after the only enrollment was undone.
  const hasActiveEnrollmentHistory = Boolean(
    student?.academic?.has_active_enrollment_history,
  );
  const currentGradeLocked = mode === "edit" && hasActiveEnrollmentHistory;
  const graduationFieldsLocked =
    hasActiveClass || !isGraduated || hasCompletedEnrollment;
  // Create-mode counterpart to the above - a legacy record entered directly
  // with a terminal status (no enrollment history in central to derive it
  // from). Only Graduated actually needs graduation_grade/leave_year/sn -
  // see StudentValidation.CREATE's refine.
  const isLegacyGraduateCreate =
    isCreate && values.is_legacy && values.status === "GRADUATED";

  function updateValue(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function updateCheckbox(field, checked) {
    setValues((current) => ({ ...current, [field]: checked }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setHasAttemptedSubmit(true);

    const computedErrors = computeStudentErrors(values, isCreate);
    if (Object.keys(computedErrors).length > 0) {
      showErrorToast("Please fix the highlighted fields before saving.");
      scrollToFirstError(computedErrors);
      return;
    }

    // Warn before a value that's about to lock in - matches
    // identifier-lock.ts: once NISN has a value, it's only editable within
    // 1 day of the student's creation (immediately locked if that window's
    // already passed on an existing record).
    const nisnBeingSet =
      values.nisn && values.nisn !== (student?.academic?.nisn || "");
    if (nisnBeingSet) {
      const confirmed = await confirm({
        title: "This will lock a sensitive field",
        description: (
          <>
            <p>
              {isPastGracePeriod
                ? "Already past the 1-day edit window, so this locks immediately after saving:"
                : "Editable only within 1 day of this student being created, then locked for good:"}
            </p>
            <ul className="mt-2 list-disc space-y-0.5 pl-5 font-medium text-[var(--mws-charcoal)]">
              <li>NISN</li>
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
                <p className="font-semibold text-[var(--mws-charcoal)]">
                  Photo
                </p>
                <p>Add one after creating the student.</p>
              </div>
            </div>
          ) : null}
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <Field label="Full Name" name="full_name" error={errors.full_name}>
              <TextInput
                invalid={Boolean(errors.full_name)}
                value={values.full_name}
                onChange={(event) =>
                  updateValue("full_name", capitalizeWords(event.target.value))
                }
              />
            </Field>
            <Field label="Nick Name" name="nick_name" error={errors.nick_name}>
              <TextInput
                invalid={Boolean(errors.nick_name)}
                value={values.nick_name}
                onChange={(event) =>
                  updateValue("nick_name", capitalizeWords(event.target.value))
                }
              />
            </Field>
            <Field label="Email" name="email_local" error={errors.email_local}>
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
                    // Clear the detail if they switch away from Other -
                    // a leftover note from a previous selection shouldn't
                    // silently survive under a different religion.
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
              >
                <TextInput
                  invalid={Boolean(errors.religion_other)}
                  value={values.religion_other}
                  onChange={(event) =>
                    updateValue("religion_other", event.target.value)
                  }
                  placeholder="e.g. Sikh"
                />
              </Field>
            ) : null}
            <Field label="Birth Place" name="birth_place" error={errors.birth_place}>
              <TextInput
                invalid={Boolean(errors.birth_place)}
                value={values.birth_place}
                onChange={(event) =>
                  updateValue(
                    "birth_place",
                    capitalizeWords(event.target.value),
                  )
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
                name="legacy_nis"
                error={errors.legacy_nis}
                hint={
                  values.is_legacy
                    ? "Enter the exact historical NIS. If it matches the standard 7-digit format, it will automatically become the official NIS."
                    : "Generated after save from academic year, join grade, and entry type."
                }
              >
                <div className="space-y-3">
                  <CheckboxField
                    label="Historical Data (Input Legacy NIS Manually)"
                    checked={values.is_legacy}
                    onChange={(event) => {
                      const isChecked = event.target.checked;
                      updateCheckbox("is_legacy", isChecked);
                      if (!isChecked) updateValue("legacy_nis", "");
                    }}
                  />

                  {values.is_legacy ? (
                    <TextInput
                      invalid={Boolean(errors.legacy_nis)}
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
            {isCreate && values.is_legacy ? (
              <Field
                label="Status"
                hint="Only for a record already at a terminal status when migrated, e.g. a graduate who never had an enrollment in central. Leave unset to create as Registered like normal."
              >
                <SearchableSelect
                  value={values.status}
                  onChange={(value) =>
                    setValues((current) => ({
                      ...current,
                      status: value,
                      // Clear graduation fields if switching away from
                      // Graduated - a leftover value shouldn't silently
                      // survive under a different status.
                      graduation_grade:
                        value === "GRADUATED" ? current.graduation_grade : "",
                      leave_year:
                        value === "GRADUATED" ? current.leave_year : "",
                      sn: value === "GRADUATED" ? current.sn : false,
                    }))
                  }
                  options={[
                    { value: "", label: "Not set (create as Registered)" },
                    ...enumOptions(terminalStudentStatuses),
                  ]}
                  placeholder="Select Status (optional)"
                  searchPlaceholder="Search Status"
                />
              </Field>
            ) : null}
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
              label="Entry Type"
              name="entry_type"
              error={errors.entry_type}
              hint={
                errors.entry_type
                  ? undefined
                  : entryTypeLocked
                    ? "NIS is already assigned, so this is locked to keep them matching."
                    : isCreate
                      ? undefined
                      : "Safe to correct for legacy imports. Only affects a future NIS reissue."
              }
            >
              <SearchableSelect
                required={hasAttemptedSubmit}
                disabled={entryTypeLocked}
                value={values.entry_type}
                onChange={(value) => updateValue("entry_type", value)}
                options={entryTypeOptions(studentEntryTypes)}
                placeholder="Select Entry Type"
                searchPlaceholder="Search Entry Type"
              />
            </Field>
            <Field
              label="Current Grade"
              name="current_grade_id"
              error={errors.current_grade_id}
              hint={
                errors.current_grade_id
                  ? undefined
                  : currentGradeLocked
                    ? "Derived from this student's enrollment history, so it's locked here. Use Enroll, Promote, or Transfer on their class record to change it."
                    : undefined
              }
            >
              <SearchableSelect
                required={isCreate && hasAttemptedSubmit}
                disabled={currentGradeLocked}
                value={values.current_grade_id}
                onChange={(value) => updateValue("current_grade_id", value)}
                options={gradeOptions(currentGradeOptionsForRole)}
                placeholder="Select Current Grade"
                searchPlaceholder="Search Grades"
              />
            </Field>
            <Field
              label="Join Academic Year"
              name="join_academic_year_id"
              error={errors.join_academic_year_id}
            >
              <SearchableSelect
                required={isCreate && hasAttemptedSubmit}
                value={values.join_academic_year_id}
                onChange={(value) =>
                  updateValue("join_academic_year_id", value)
                }
                options={academicYearOptions(options.academicYears)}
                placeholder="Select Join Year"
                searchPlaceholder="Search Years"
              />
            </Field>
            <Field label="Join Grade" name="join_grade_id" error={errors.join_grade_id}>
              <SearchableSelect
                required={isCreate && hasAttemptedSubmit}
                value={values.join_grade_id}
                onChange={(value) => updateValue("join_grade_id", value)}
                options={gradeOptions(options.grades)}
                placeholder="Select Join Grade"
                searchPlaceholder="Search Grades"
              />
            </Field>
            <Field label="Previous School" className="md:col-span-2">
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
                  label="Graduation Grade"
                  hint={
                    hasActiveClass
                      ? "Filled in automatically from their current class when graduated. This won't override it."
                      : hasCompletedEnrollment
                        ? "This student has a real completed enrollment on file, so it's locked. Fix a mistake by reactivating that enrollment and closing it again with the right values."
                        : !isGraduated
                          ? "Only takes effect once this student is graduated. Use the class's Close action (status Graduated), which sets this automatically."
                          : undefined
                  }
                >
                  <SearchableSelect
                    disabled={graduationFieldsLocked}
                    value={values.graduation_grade}
                    onChange={(value) => updateValue("graduation_grade", value)}
                    options={gradeNameOptions(options.grades)}
                    placeholder="Select Grade"
                    searchPlaceholder="Search Grades"
                  />
                </Field>
                <Field
                  label="Leave Year"
                  hint={
                    hasActiveClass
                      ? "Filled in automatically from their current class's academic year when graduated. This won't override it."
                      : hasCompletedEnrollment
                        ? "This student has a real completed enrollment on file, so it's locked. Fix a mistake by reactivating that enrollment and closing it again with the right values."
                        : !isGraduated
                          ? "Only takes effect once this student is graduated. Use the class's Close action (status Graduated), which sets this automatically."
                          : undefined
                  }
                >
                  <SearchableSelect
                    disabled={graduationFieldsLocked}
                    value={values.leave_year}
                    onChange={(value) => updateValue("leave_year", value)}
                    options={academicYearNameOptions(options.academicYears)}
                    placeholder="Select Year"
                    searchPlaceholder="Search Years"
                  />
                </Field>
                {/* Unlike Graduation Grade/Leave Year above, sn isn't
                    server-derived from anything (see student-service.ts's
                    update() - it's just passed through as-is), so it's
                    never locked by graduationFieldsLocked. */}
                <CheckboxField
                  label="SN"
                  checked={values.sn}
                  onChange={(event) => updateCheckbox("sn", event.target.checked)}
                />
              </>
            ) : isLegacyGraduateCreate ? (
              <>
                <Field
                  label="Graduation Grade"
                  name="graduation_grade"
                  error={errors.graduation_grade}
                  hint="Required for a legacy graduate created directly, since there's no enrollment history in central to derive it from."
                >
                  <SearchableSelect
                    invalid={Boolean(errors.graduation_grade)}
                    value={values.graduation_grade}
                    onChange={(value) => updateValue("graduation_grade", value)}
                    options={gradeNameOptions(options.grades)}
                    placeholder="Select Grade"
                    searchPlaceholder="Search Grades"
                  />
                </Field>
                <Field
                  label="Leave Year"
                  name="leave_year"
                  error={errors.leave_year}
                  hint="Required for a legacy graduate created directly, since there's no enrollment history in central to derive it from."
                >
                  <SearchableSelect
                    invalid={Boolean(errors.leave_year)}
                    value={values.leave_year}
                    onChange={(value) => updateValue("leave_year", value)}
                    options={academicYearNameOptions(options.academicYears)}
                    placeholder="Select Year"
                    searchPlaceholder="Search Years"
                  />
                </Field>
                <CheckboxField
                  label="SN"
                  checked={values.sn}
                  onChange={(event) => updateCheckbox("sn", event.target.checked)}
                />
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
              label="Pickup/Drop"
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
              label="PSB Guide"
              checked={values.psb_guide}
              onChange={(event) =>
                updateCheckbox("psb_guide", event.target.checked)
              }
            />
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
                ? "Create student"
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

function getInitialValues(mode, student, options) {
  const identity = student?.identity || {};
  const academic = student?.academic || {};

  return {
    full_name: identity.full_name || "",
    nick_name: identity.nick_name || "",
    email_local: emailLocalPart(identity.email),
    gender: identity.gender || "",
    religion: identity.religion || "",
    religion_other: identity.religion_other || "",
    birth_place: identity.birth_place || "",
    birth_date: dateInputFromIso(identity.birth_date),
    is_legacy: false,
    // Only meaningful in create mode when is_legacy is checked - see
    // isLegacyGraduateCreate.
    status: "",
    legacy_nis: academic.legacy_nis || "",
    nis: academic.nis || "",
    nisn: academic.nisn || "",
    entry_type: academic.entry_type || "PSB",
    current_grade_id:
      findOptionByName(options.grades, academic.current_grade)?.id || "",
    join_academic_year_id: academic.join_academic_year_id || "",
    join_grade_id:
      findOptionByName(options.grades, academic.join_grade)?.id || "",
    previous_school: academic.previous_school || "",
    graduation_grade: academic.graduation_grade || "",
    leave_year: academic.leave_year || "",
    sn: Boolean(academic.sn),
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
    // Explicit null (not just omitted) when not Other, so switching away
    // actually clears a previously-saved detail instead of leaving it
    // stranded server-side - cleanPayload only drops undefined/"", null
    // survives.
    religion_other:
      values.religion === "OTHER"
        ? trimmedOrUndefined(values.religion_other)
        : null,
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
    // Not editable from this form - Active/Inactive is managed from the
    // student detail page's Deactivate/Reactivate button, and
    // Transferred/Withdrawn/Graduated only ever happen via the class's
    // Close action (see EnrollmentDialog.jsx). Both keep the real
    // enrollment record in sync in ways a plain status field here never
    // could - see student-service.ts's update() for why status changes
    // through this generic path are now this restricted.
    current_grade_id: values.current_grade_id,
    join_academic_year_id: values.join_academic_year_id,
    join_grade_id: values.join_grade_id,
    // Only sent for a legacy record entered directly at a terminal status -
    // see isLegacyGraduateCreate. Every other flow relies on the defaults
    // and dedicated actions described above.
    status: values.is_legacy && values.status ? values.status : undefined,
    previous_school: trimmedOrUndefined(values.previous_school),
    graduation_grade: trimmedOrUndefined(values.graduation_grade),
    leave_year: trimmedOrUndefined(values.leave_year),
    sn: values.sn,
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
      <span>{prefix || `Optional, ${max} ${label} if filled`}</span>
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
      Locked, past the 1-day edit window. Soft-delete and recreate the student
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

function enumOptions(values) {
  return values.map((value) => ({ value, label: formatStatus(value) }));
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
  current_grade_id: "Current grade",
  join_academic_year_id: "Join academic year",
  join_grade_id: "Join grade",
};

function computeStudentErrors(values, isCreate) {
  const errors = {};
  if (isCreate) {
    for (const [field, label] of Object.entries(REQUIRED_FIELD_LABELS)) {
      if (!values[field]) {
        errors[field] = `${label} is required.`;
      }
    }
  }
  // religion_other only makes sense (and is only ever sent) when religion
  // is "OTHER" - it used to sit in the blanket REQUIRED_FIELD_LABELS loop
  // above, which silently blocked every student creation whose religion
  // wasn't "Other" (same bug as EmployeeForm.jsx's computeEmployeeErrors).
  if (values.religion === "OTHER" && !values.religion_other) {
    errors.religion_other = "Religion (Please Specify) is required.";
  }
  if (values.birth_date && !isBirthDateNotFuture(values.birth_date)) {
    errors.birth_date = "Birth date cannot be in the future.";
  } else if (values.birth_date && !isBirthDateNotTooOld(values.birth_date)) {
    errors.birth_date = "Birth date is too far in the past to be valid.";
  }
  if (!values.entry_type) {
    errors.entry_type = "Entry type is required.";
  }
  if (values.is_legacy && !values.legacy_nis) {
    errors.legacy_nis =
      "Legacy NIS is required when historical data is checked.";
  }
  if (isCreate && values.is_legacy && values.status === "GRADUATED") {
    if (!values.graduation_grade) {
      errors.graduation_grade =
        "Graduation grade is required for a legacy graduate.";
    }
    if (!values.leave_year) {
      errors.leave_year = "Leave year is required for a legacy graduate.";
    }
  }
  return errors;
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
    tone:
      year.status === "ACTIVE"
        ? "green"
        : year.status === "UPCOMING"
          ? "amber"
          : "neutral",
    searchText: `${year.name} ${formatStatus(year.status)}`,
  }));
}
