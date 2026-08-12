import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, TextInput } from "../../../components/ui/FormControls.jsx";
import {
  cleanPayload,
  optionalNumber,
  trimmedOrUndefined,
} from "../../../lib/form.js";

export function GradeDialog({ dialog, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    name: dialog.record?.name || "",
    level: dialog.record?.level ?? "",
  }));

  function submit(event) {
    event.preventDefault();
    onSubmit(
      cleanPayload({
        name: trimmedOrUndefined(values.name),
        level: optionalNumber(values.level),
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
        className="grid gap-4 md:grid-cols-2"
      >
        <Field label="Name">
          <TextInput
            required
            value={values.name}
            onChange={(event) =>
              setValues({ ...values, name: event.target.value })
            }
          />
        </Field>
        <Field label="Level">
          <TextInput
            required
            type="number"
            value={values.level}
            onChange={(event) =>
              setValues({ ...values, level: event.target.value })
            }
          />
        </Field>
      </form>
    </CrudDialog>
  );
}
