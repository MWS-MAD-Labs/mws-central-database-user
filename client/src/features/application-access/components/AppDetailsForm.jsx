import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { Field, SearchableSelect, TextAreaInput, TextInput } from "../../../components/ui/FormControls.jsx";
import { cn } from "../../../lib/cn.js";
import { DEFAULT_SCOPES } from "../utils/connectionScopes.js";
import { descriptionProblem, iconProblem, nameProblem, slugifyApplicationId, tidyText } from "../utils/applicationId.js";
import { ENVIRONMENTS, addressProblem, joinAddress, readAddressInput, splitAddress } from "../utils/applicationUrl.js";
import { AppCardPreview } from "./AppCardPreview.jsx";
import { NextStepsCard } from "./NextStepsCard.jsx";
import { ScopePicker } from "./ScopePicker.jsx";

const CATEGORIES = [
  { value: "reporting", label: "Reporting" },
  { value: "students", label: "Students" },
  { value: "workplace", label: "Workplace" },
  { value: "operations", label: "Operations" },
  { value: "utilities", label: "Utilities" },
];

const DESCRIPTION_MAX = 300;

// What the Hub card shows and where it sends people. Used to add an application and to edit it later.
// On the page layout the id is made from the name. In the dialog the id is the one the application has.
export function AppDetailsForm({ initial, idLocked = false, layout = "dialog", submitLabel, submitting, onSubmit, onCancel }) {
  const launch = splitAddress(initial?.launch_url);
  const logout = splitAddress(initial?.logout_url, launch.environment);
  const [values, setValues] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    icon: initial?.icon ?? "",
    category: initial?.category ?? "",
  });
  const [environment, setEnvironment] = useState(initial?.launch_url ? launch.environment : logout.environment);
  const [launchRest, setLaunchRest] = useState(launch.rest);
  const [logoutRest, setLogoutRest] = useState(logout.rest);
  const [attempted, setAttempted] = useState(false);
  const [scopeNames, setScopeNames] = useState(DEFAULT_SCOPES);
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const tidyOnBlur = (key) => () => setValues((current) => ({ ...current, [key]: tidyText(current[key]) }));

  const applicationId = idLocked ? initial.application_id : slugifyApplicationId(values.name);
  // The Hub itself has no launch address.
  const needsLaunch = applicationId !== "hub";

  const errors = {
    name: nameProblem(values.name) ?? undefined,
    description: descriptionProblem(values.description) ?? undefined,
    icon: iconProblem(values.icon) ?? undefined,
    launch_url: addressProblem(environment, launchRest, { required: needsLaunch }) ?? undefined,
    logout_url: addressProblem(environment, logoutRest) ?? undefined,
  };
  const valid = !Object.values(errors).some(Boolean);
  const shown = (key) => (attempted ? errors[key] : undefined);

  // Typing an address: a pasted scheme is taken off and sets the environment for both addresses.
  function typeAddress(setter) {
    return (event) => {
      const next = readAddressInput(event.target.value, environment);
      if (next.environment !== environment) setEnvironment(next.environment);
      setter(next.rest);
    };
  }

  function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if (!valid) return;
    onSubmit({
      ...(idLocked ? { application_id: applicationId } : {}),
      name: tidyText(values.name),
      description: tidyText(values.description),
      icon: values.icon.trim(),
      category: values.category,
      launch_url: joinAddress(environment, launchRest),
      logout_url: joinAddress(environment, logoutRest),
      // On the page layout the connection is made together with the application.
      ...(layout === "page" ? { connect: true, scope_names: scopeNames } : {}),
    });
  }

  const fields = (
    <div className="space-y-6">
      <Section title="Identity">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required hint="Shown on the Hub card." error={shown("name")}>
            <TextInput
              aria-label="Name"
              value={values.name}
              maxLength={80}
              autoComplete="off"
              onChange={set("name")}
              onBlur={tidyOnBlur("name")}
            />
          </Field>
          <Field
            label="Application ID"
            hint={idLocked ? "The ID cannot change." : "Made from the name and cannot be changed later."}
          >
            <TextInput aria-label="Application ID" value={applicationId} disabled readOnly />
          </Field>
        </div>
      </Section>
      <Section title="Hub Card">
        <Field
          label="Description"
          hint={`One sentence about what people use it for. ${tidyText(values.description).length}/${DESCRIPTION_MAX}`}
          error={shown("description")}
        >
          <TextAreaInput
            aria-label="Description"
            rows={2}
            value={values.description}
            autoComplete="off"
            onChange={set("description")}
            onBlur={tidyOnBlur("description")}
          />
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
          <Field
            label="Icon"
            hint="An icon name from the Hub, like AppWindow. Leave it empty for the default."
            error={shown("icon")}
          >
            <TextInput
              aria-label="Icon"
              value={values.icon}
              maxLength={40}
              autoComplete="off"
              onChange={set("icon")}
              onBlur={() => setValues((current) => ({ ...current, icon: current.icon.trim() }))}
            />
          </Field>
        </div>
      </Section>
      <Section title="Addresses">
        <Field label="Environment" hint="Sets the scheme of both addresses.">
          <div
            role="radiogroup"
            aria-label="Environment"
            className="grid w-full grid-cols-2 gap-1 rounded-xl border border-(--mws-line) bg-(--mws-soft) p-1 sm:max-w-xs"
          >
            {ENVIRONMENTS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-label={item.label}
                aria-checked={environment === item.id}
                onClick={() => setEnvironment(item.id)}
                className={cn(
                  "flex h-8 cursor-pointer items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-(--mws-burgundy)",
                  environment === item.id
                    ? "bg-white text-(--mws-burgundy) shadow-sm ring-1 ring-(--mws-line)"
                    : "text-(--mws-muted) hover:text-(--mws-charcoal)",
                )}
              >
                {item.label}
                <span className="font-mono text-[11px] font-normal opacity-70">{item.scheme.replace("://", "")}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field
          label="Launch URL"
          required={needsLaunch}
          hint="Where the Hub sends people, usually the sign-in address of the application."
          error={shown("launch_url")}
        >
          <AddressInput
            label="Launch URL"
            environment={environment}
            value={launchRest}
            placeholder="exima.mws.web.id/auth/sso"
            invalid={Boolean(shown("launch_url"))}
            onChange={typeAddress(setLaunchRest)}
            onBlur={() => setLaunchRest((current) => current.trim())}
          />
        </Field>
        <Field
          label="Logout URL"
          hint="Optional. Opened in the background so signing out of the Hub signs out of this application too."
          error={shown("logout_url")}
        >
          <AddressInput
            label="Logout URL"
            environment={environment}
            value={logoutRest}
            placeholder="exima.mws.web.id/auth/logout"
            invalid={Boolean(shown("logout_url"))}
            onChange={typeAddress(setLogoutRest)}
            onBlur={() => setLogoutRest((current) => current.trim())}
          />
        </Field>
      </Section>
      {layout === "page" ? (
        <Section title="Data Access">
          <p className="text-xs leading-5 text-(--mws-muted)">
            Pick what the application may read from Central. You get its token and .env values as soon as you add it.
          </p>
          <ScopePicker value={scopeNames} onChange={setScopeNames} />
        </Section>
      ) : null}
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

  const preview = { ...values, launch_url: joinAddress(environment, launchRest) };

  if (layout === "page") {
    return (
      <form onSubmit={submit} noValidate>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5">{fields}</section>
          <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start">
            <AppCardPreview values={preview} />
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

// The scheme sits in front of the box, so only the host and path are typed.
function AddressInput({ label, environment, value, placeholder, invalid, onChange, onBlur }) {
  const scheme = ENVIRONMENTS.find((item) => item.id === environment)?.scheme;
  return (
    <div
      className={cn(
        "flex w-full min-w-0 items-stretch overflow-hidden rounded-xl border bg-white transition focus-within:border-(--mws-burgundy) focus-within:ring-2 focus-within:ring-[#7E15181A]",
        invalid ? "border-[#c75f64]" : "border-(--mws-line)",
      )}
    >
      <span className="flex shrink-0 items-center border-r border-(--mws-line) bg-(--mws-soft) px-3 font-mono text-xs text-(--mws-muted)">
        {scheme}
      </span>
      <input
        aria-label={label}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="off"
        inputMode="url"
        className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-(--mws-charcoal) outline-none placeholder:text-[#a8999b]"
        onChange={onChange}
        onBlur={onBlur}
      />
    </div>
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
