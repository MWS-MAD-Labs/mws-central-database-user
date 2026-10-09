import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, NumberInput, TextInput } from "../../../components/ui/FormControls.jsx";
import { LIMITS } from "../../../lib/limits.js";
import {
  capitalizeWords,
  cleanPayload,
  optionalNumber,
  trimmedOrUndefined,
} from "../../../lib/form.js";

function computeGradeErrors(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = "Name is required.";
  if (values.name.length > LIMITS.GRADE_NAME_MAX) errors.name = `Name can have up to ${LIMITS.GRADE_NAME_MAX} characters.`;
  const level = optionalNumber(values.level);
  if (values.level === "" || values.level === "-") errors.level = "Level is required.";
  else if (level < LIMITS.GRADE_LEVEL_MIN || level > LIMITS.GRADE_LEVEL_MAX) {
    errors.level = `Use a level from ${LIMITS.GRADE_LEVEL_MIN} to ${LIMITS.GRADE_LEVEL_MAX}.`;
  }
  const age = optionalNumber(values.typical_age);
  if (values.typical_age !== "" && (age < LIMITS.GRADE_AGE_MIN || age > LIMITS.GRADE_AGE_MAX)) {
    errors.typical_age = `Use an age from ${LIMITS.GRADE_AGE_MIN} to ${LIMITS.GRADE_AGE_MAX}.`;
  }
  return errors;
}

export function GradeDialog({ dialog, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    name: dialog.record?.name || "",
    level: dialog.record?.level ?? "",
    typical_age: dialog.record?.typical_age ?? "",
  }));
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const errors = hasAttemptedSubmit ? computeGradeErrors(values) : {};

  function submit(event) {
    event.preventDefault();
    setHasAttemptedSubmit(true);
    if (Object.keys(computeGradeErrors(values)).length > 0) return;
    onSubmit(
      cleanPayload({
        name: trimmedOrUndefined(values.name),
        level: optionalNumber(values.level),
        typical_age: optionalNumber(values.typical_age),
      }),
    );
  }

  return (
    <CrudDialog
      title={dialog.mode === "create" ? "New Grade" : "Edit Grade"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="grade-form" type="submit" loading={isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="grade-form"
        onSubmit={submit}
        noValidate
        className="grid gap-4 md:grid-cols-2"
      >
        <Field
          label="Name"
          error={errors.name}
          hint={`${values.name.length}/${LIMITS.GRADE_NAME_MAX}`}
        >
          <TextInput
            invalid={Boolean(errors.name)}
            maxLength={LIMITS.GRADE_NAME_MAX}
            value={values.name}
            onChange={(event) =>
              setValues({ ...values, name: capitalizeWords(event.target.value) })
            }
          />
        </Field>
        <Field
          label="Level"
          error={errors.level}
          hint={`${LIMITS.GRADE_LEVEL_MIN} to ${LIMITS.GRADE_LEVEL_MAX}`}
        >
          <NumberInput
            invalid={Boolean(errors.level)}
            min={LIMITS.GRADE_LEVEL_MIN}
            max={LIMITS.GRADE_LEVEL_MAX}
            value={values.level}
            onChange={(level) => setValues({ ...values, level })}
          />
        </Field>
        <Field
          label="Typical Age"
          error={errors.typical_age}
          hint="Used for the age-vs-grade sanity check on student registration. Leave blank to skip the check for this grade."
        >
          <NumberInput
            invalid={Boolean(errors.typical_age)}
            min={LIMITS.GRADE_AGE_MIN}
            max={LIMITS.GRADE_AGE_MAX}
            value={values.typical_age}
            onChange={(typical_age) => setValues({ ...values, typical_age })}
          />
        </Field>
      </form>
    </CrudDialog>
  );
}
