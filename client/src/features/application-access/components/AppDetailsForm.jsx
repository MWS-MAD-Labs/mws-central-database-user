import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { Field, TextAreaInput, TextInput } from "../../../components/ui/FormControls.jsx";

// Lowercase, spaces become underscores, anything else odd is dropped.
const cleanId = (value) => value.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
const ID_PATTERN = /^[a-z][a-z0-9_-]*$/;
const URL_PATTERN = /^https?:\/\/\S+$/i;

const EMPTY = { application_id: "", name: "", description: "", icon: "", category: "", launch_url: "", logout_url: "" };

// What the Hub card shows and where it sends people. Used to add an application and to edit it later.
export function AppDetailsForm({ initial, idLocked = false, submitLabel, submitting, onSubmit, onCancel }) {
  const [values, setValues] = useState({ ...EMPTY, ...stripNulls(initial) });
  const [attempted, setAttempted] = useState(false);
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));

  const errors = {
    application_id: ID_PATTERN.test(values.application_id.trim())
      ? undefined
      : "Use lowercase letters, numbers, hyphens or underscores, starting with a letter.",
    name: values.name.trim() ? undefined : "Name is required.",
    launch_url: URL_PATTERN.test(values.launch_url.trim()) ? undefined : "Start with http:// or https://.",
    logout_url: !values.logout_url.trim() || URL_PATTERN.test(values.logout_url.trim()) ? undefined : "Start with http:// or https://.",
  };
  const valid = !Object.values(errors).some(Boolean);
  const shown = (key) => (attempted ? errors[key] : undefined);

  function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if (!valid) return;
    onSubmit({
      application_id: values.application_id.trim(),
      name: values.name.trim(),
      description: values.description.trim(),
      icon: values.icon.trim(),
      category: values.category.trim(),
      launch_url: values.launch_url.trim(),
      logout_url: values.logout_url.trim(),
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Application ID"
          required
          hint={idLocked ? "The ID cannot change." : "Lowercase, starting with a letter. Spaces become underscores. For example exima."}
          error={shown("application_id")}
        >
          <TextInput
            aria-label="Application ID"
            value={values.application_id}
            disabled={idLocked}
            onChange={(event) => setValues((current) => ({ ...current, application_id: cleanId(event.target.value) }))}
          />
        </Field>
        <Field label="Name" required hint="Shown on the Hub card." error={shown("name")}>
          <TextInput aria-label="Name" value={values.name} onChange={set("name")} />
        </Field>
      </div>
      <Field label="Description" hint="One sentence about what people use it for.">
        <TextAreaInput aria-label="Description" rows={2} value={values.description} onChange={set("description")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" hint="For example Finance or Learning.">
          <TextInput aria-label="Category" value={values.category} onChange={set("category")} />
        </Field>
        <Field label="Icon" hint="An icon name from the Hub, like AppWindow. Leave it empty for the default.">
          <TextInput aria-label="Icon" value={values.icon} onChange={set("icon")} />
        </Field>
      </div>
      <Field
        label="Launch URL"
        required
        hint="Where the Hub sends people, usually the sign-in address of the application."
        error={shown("launch_url")}
      >
        <TextInput aria-label="Launch URL" placeholder="https://exima.mws.web.id/auth/sso" value={values.launch_url} onChange={set("launch_url")} />
      </Field>
      <Field
        label="Logout URL"
        hint="Optional. Opened in the background so signing out of the Hub signs out of this application too."
        error={shown("logout_url")}
      >
        <TextInput aria-label="Logout URL" placeholder="https://exima.mws.web.id/auth/logout" value={values.logout_url} onChange={set("logout_url")} />
      </Field>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function stripNulls(initial = {}) {
  return Object.fromEntries(Object.entries(initial).map(([key, value]) => [key, value ?? ""]));
}
