import { useEffect, useMemo, useState } from "react";
import { Camera, RotateCcw, Save, UserRound } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import { ChangeReviewTable } from "../../../components/ui/ChangeReviewTable.jsx";
import {
  CheckboxField,
  DateField,
  EmailField,
  Field,
  LengthHint,
  LimitedField,
  ReligionFields,
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
  textLength,
  trimmedOrUndefined,
} from "../../../lib/form.js";
import { enumOptions, formatStatus, UNKNOWN_LEGACY_GRADE_NAME } from "../../../lib/format.js";
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

const ALLOWED_EMAIL_DOMAIN = "millennia21.id";
const EMAIL_LOCAL_MAX_LENGTH = 50 - 1 - ALLOWED_EMAIL_DOMAIN.length;

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
  const [nowSnapshot] = useState(() => Date.now());

  const isCreate = mode === "create";
  const isDirty = JSON.stringify(values) !== JSON.stringify(initialValues);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const errors =
    hasAttemptedSubmit || !isCreate
      ? computeStudentErrors(values, isCreate)
      : {};
  const draft = useCreateFormDraft({ entity: "student", values, enabled: isCreate });

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
    draft.clearDraft();
  }

  function excludeUnknownLegacyGrade(grades, selectedId) {
    return grades.filter(
      (grade) =>
        grade.name !== UNKNOWN_LEGACY_GRADE_NAME || grade.id === selectedId,
    );
  }

  const currentGradeOptionsForRole = excludeUnknownLegacyGrade(
    user?.role === "DATABASE_ADMIN"
      ? options.grades.filter(
          (grade) =>
            grade.unit_id === user?.unit_id ||
            grade.id === values.current_grade_id,
        )
      : options.grades,
    values.current_grade_id,
  );
  const joinGradeOptions = excludeUnknownLegacyGrade(
    options.grades,
    values.join_grade_id,
  );

  const isPastGracePeriod =
    mode === "edit" &&
    Boolean(student?.created_at) &&
    nowSnapshot - new Date(student.created_at).getTime() >
      SENSITIVE_FIELD_GRACE_PERIOD_MS;
  const nisnLocked = isPastGracePeriod && Boolean(student?.academic?.nisn);

  const entryTypeLocked = mode === "edit" && Boolean(student?.academic?.nis);

  const hasActiveClass = Boolean(student?.academic?.current_class);
  const isGraduated = student?.status === "GRADUATED";
  const hasCompletedEnrollment = Boolean(
    student?.academic?.has_completed_enrollment,
  );
  const hasActiveEnrollmentHistory = Boolean(
    student?.academic?.has_active_enrollment_history,
  );
  const currentGradeLocked = mode === "edit" && hasActiveEnrollmentHistory;
  const graduationFieldsLocked =
    hasActiveClass || !isGraduated || hasCompletedEnrollment;
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

    const nisnBeingSet =
      values.nisn && values.nisn !== (student?.academic?.nisn || "");
    const lockWarning = nisnBeingSet ? (
      <>
        <strong>NISN will be locked after saving.</strong>
        <br />
        {isPastGracePeriod
          ? "The 1-day edit window has passed, so it will lock immediately."
          : "It can only be edited within 1 day of this student being created."}
      </>
    ) : null;
    const lockFieldWarnings = nisnBeingSet
      ? { nisn: "Will be locked after saving." }
      : {};

    const resolveValue = makeOptionAwareResolver(
      options,
      STUDENT_ID_FIELD_OPTION_KEYS,
      STUDENT_FIELD_FORMATTERS,
    );

    if (isCreate) {
      const fields = buildFilledFieldEntries(values, {
        labels: STUDENT_DIFF_LABELS,
        resolveValue,
        excludeKeys: STUDENT_DIFF_EXCLUDED_KEYS,
        sections: STUDENT_FIELD_SECTIONS,
      });
      const confirmed = await confirm({
        title: "Review before creating",
        description: (
          <ChangeReviewTable
            changes={fields}
            mode="create"
            warning={lockWarning}
            fieldWarnings={lockFieldWarnings}
          />
        ),
        confirmLabel: nisnBeingSet ? "Create and lock NISN" : "Create student",
        wide: true,
      });
      if (!confirmed) return;
    } else {
      const changes = buildChangedFieldEntries(initialValues, values, {
        labels: STUDENT_DIFF_LABELS,
        resolveValue,
        excludeKeys: STUDENT_DIFF_EXCLUDED_KEYS,
        sections: STUDENT_FIELD_SECTIONS,
      });
      if (changes.length > 0 || lockWarning) {
        const confirmed = await confirm({
          title: "Review changes before saving",
          description: (
            <ChangeReviewTable
              changes={changes}
              warning={lockWarning}
              fieldWarnings={lockFieldWarnings}
            />
          ),
          confirmLabel: nisnBeingSet ? "Save and lock NISN" : "Save changes",
          wide: true,
        });
        if (!confirmed) return;
      }
    }

    onSubmit(buildPayload(values), pendingPhotoBlob);
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="min-w-0 space-y-5" noValidate>
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
                <p className="font-semibold text-(--mws-charcoal)">
                  Photo
                </p>
                <p>Add one after creating the student.</p>
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
              required
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
          </div>
        </section>

        <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <h2 className="mb-4 text-base font-semibold text-(--mws-charcoal)">
            Academic Record
          </h2>
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            {isCreate ? (
              <Field
                label="NIS"
                name="legacy_nis"
                error={errors.legacy_nis}
                hint={
                  values.is_legacy ? (
                    <LengthHint
                      value={values.legacy_nis}
                      max={50}
                      label="characters"
                      count={textLength}
                      prefix="Enter the exact historical NIS. If it matches the standard 7-digit format, it will automatically become the official NIS."
                    />
                  ) : (
                    "Generated after save from academic year, join grade, and entry type."
                  )
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
                      maxLength={50}
                      onChange={(event) =>
                        updateValue("legacy_nis", event.target.value)
                      }
                    />
                  ) : (
                    <div className="flex h-11 items-center rounded-xl border border-(--mws-line) bg-(--mws-soft) px-3 text-sm font-semibold text-(--mws-muted)">
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
                options={gradeOptions(joinGradeOptions)}
                placeholder="Select Join Grade"
                searchPlaceholder="Search Grades"
              />
            </Field>
            <LimitedField
              label="Previous School"
              field="previous_school"
              max={100}
              className="md:col-span-2"
              values={values}
              errors={errors}
              updateValue={updateValue}
            />
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

        <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <h2 className="mb-4 text-base font-semibold text-(--mws-charcoal)">
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
          {isCreate && isDirty ? (
            <Button type="button" variant="secondary" onClick={handleReset}>
              <RotateCcw size={16} />
              Reset form
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
      <CreateDraftDialog
        entityLabel="student"
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
    religion_other:
      values.religion === "OTHER"
        ? trimmedOrUndefined(values.religion_other)
        : null,
    birth_place: trimmedOrUndefined(values.birth_place),
    birth_date: isoFromDateInput(values.birth_date),
    legacy_nis: values.is_legacy
      ? trimmedOrUndefined(values.legacy_nis)
      : undefined,
    nisn: trimmedOrUndefined(values.nisn),
    entry_type: values.entry_type,
    current_grade_id: values.current_grade_id,
    join_academic_year_id: values.join_academic_year_id,
    join_grade_id: values.join_grade_id,
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

// Which options list (from the `options` prop) resolves each *_id field's
// display name in the pre-save change review dialog - see formDiff.js.
const STUDENT_ID_FIELD_OPTION_KEYS = {
  current_grade_id: "grades",
  join_grade_id: "grades",
  join_academic_year_id: "academicYears",
};

// Fields whose own display formatter beats the review dialog's generic
// enum-label guesser (e.g. entry_type's "Pre-K", not "Pre K").
const STUDENT_FIELD_FORMATTERS = {
  email_local: buildEmail,
  entry_type: formatEntryType,
};

// nis is read-only here (server-generated, never sent by buildPayload) so
// it can never actually differ, but excluding it keeps that explicit rather
// than relying on it happening to never change. is_legacy isn't saved
// either, but it does decide whether legacy_nis/status get sent, so it's
// kept with a plain-language label instead of hidden.
const STUDENT_DIFF_EXCLUDED_KEYS = ["nis"];

const STUDENT_DIFF_LABELS = {
  ...REQUIRED_FIELD_LABELS,
  is_legacy: "Historical (legacy) record",
};

// Groups the review dialog's fields, in display order - see
// ChangeReviewTable's groupBySection.
const STUDENT_FIELD_SECTIONS = {
  full_name: "Identity",
  nick_name: "Identity",
  email_local: "Identity",
  gender: "Identity",
  religion: "Identity",
  religion_other: "Identity",
  birth_place: "Identity",
  birth_date: "Identity",

  is_legacy: "Academic",
  status: "Academic",
  legacy_nis: "Academic",
  nisn: "Academic",
  entry_type: "Academic",
  current_grade_id: "Academic",
  join_academic_year_id: "Academic",
  join_grade_id: "Academic",
  previous_school: "Academic",
  graduation_grade: "Academic",
  leave_year: "Academic",

  sn: "Services",
  pickup_drop_service: "Services",
  catering_service: "Services",
  psb_guide: "Services",
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
