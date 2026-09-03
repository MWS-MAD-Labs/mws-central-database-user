import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, TextInput } from "../../../components/ui/FormControls.jsx";
import {
  capitalizeWords,
  cleanPayload,
  optionalNumber,
  trimmedOrUndefined,
} from "../../../lib/form.js";

function computeGradeErrors(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = "Name is required.";
  if (!values.level) errors.level = "Level is required.";
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
          <Button form="grade-form" type="submit" disabled={isSubmitting}>
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
        <Field label="Name" error={errors.name}>
          <TextInput
            invalid={Boolean(errors.name)}
            value={values.name}
            onChange={(event) =>
              setValues({ ...values, name: capitalizeWords(event.target.value) })
            }
          />
        </Field>
        <Field label="Level" error={errors.level}>
          <TextInput
            invalid={Boolean(errors.level)}
            type="number"
            value={values.level}
            onChange={(event) =>
              setValues({ ...values, level: event.target.value })
            }
          />
        </Field>
        <Field
          label="Typical Age"
          hint="Used for the age-vs-grade sanity check on student registration. Leave blank to skip the check for this grade."
        >
          <TextInput
            type="number"
            value={values.typical_age}
            onChange={(event) =>
              setValues({ ...values, typical_age: event.target.value })
            }
          />
        </Field>
      </form>
    </CrudDialog>
  );
}
