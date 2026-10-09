import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { AppCardPreview } from "./AppCardPreview.jsx";
import { NextStepsCard } from "./NextStepsCard.jsx";
import { Field, SearchableSelect, TextAreaInput, TextInput } from "../../../components/ui/FormControls.jsx";

// Lowercase, spaces become underscores, anything else odd is dropped.
const cleanId = (value) => value.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
const ID_PATTERN = /^[a-z][a-z0-9_-]*$/;
const URL_PATTERN = /^https?:\/\/\S+$/i;

const CATEGORIES = [
  { value: "reporting", label: "Reporting" },
  { value: "students", label: "Students" },
  { value: "workplace", label: "Workplace" },
  { value: "operations", label: "Operations" },
  { value: "utilities", label: "Utilities" },
];

const EMPTY = { application_id: "", name: "", description: "", icon: "", category: "", launch_url: "", logout_url: "" };

// What the Hub card shows and where it sends people. Used to add an application and to edit it later.
export function AppDetailsForm({ initial, idLocked = false, layout = "dialog", submitLabel, submitting, onSubmit, onCancel }) {
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

  const fields = (
    <div className="space-y-6">
      <Section title="Identity">
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
      </Section>
      <Section title="Hub Card">
        <Field label="Description" hint="One sentence about what people use it for.">
          <TextAreaInput aria-label="Description" rows={2} value={values.description} onChange={set("description")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" hint="Where the Hub groups the card.">
            <SearchableSelect
              value={values.category || "utilities"}
              onChange={(value) => setValues((current) => ({ ...current, category: value }))}
              options={CATEGORIES}
              placeholder="Select a category"
            />
          </Field>
          <Field label="Icon" hint="An icon name from the Hub, like AppWindow. Leave it empty for the default.">
            <TextInput aria-label="Icon" value={values.icon} onChange={set("icon")} />
          </Field>
        </div>
      </Section>
      <Section title="Addresses">
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
      </Section>
    </div>
  );

  const buttons = (
    <div className="flex gap-2">
      <Button type="button" variant="secondary" className={layout === "page" ? "flex-1" : undefined} onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" className={layout === "page" ? "flex-1" : undefined} loading={submitting}>
        {submitLabel}
      </Button>
    </div>
  );

  if (layout === "page") {
    return (
      <form onSubmit={submit} noValidate>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5">{fields}</section>
          <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start">
            <AppCardPreview values={values} />
            <NextStepsCard />
            {buttons}
          </aside>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {fields}
      {buttons}
    </form>
  );
}

function Section({ title, children }) {
  return (
    <fieldset className="min-w-0 space-y-4 border-t border-(--mws-line) pt-5 first:border-t-0 first:pt-0">
      <legend className="float-left mb-4 w-full font-display text-sm font-bold text-(--mws-charcoal)">{title}</legend>
      <div className="clear-both space-y-4">{children}</div>
    </fieldset>
  );
}

function stripNulls(initial = {}) {
  return Object.fromEntries(Object.entries(initial).map(([key, value]) => [key, value ?? ""]));
}
