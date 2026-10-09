import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CheckboxField, Field, SearchableSelect, TextAreaInput, TextInput } from "../../../components/ui/FormControls.jsx";
import { cn } from "../../../lib/cn.js";
import { LIMITS } from "../../../lib/limits.js";
import { DEFAULT_SCOPES } from "../utils/connectionScopes.js";
import { descriptionProblem, nameProblem, slugifyApplicationId, tidyText } from "../utils/applicationId.js";
import { ENVIRONMENTS, addressProblem, environmentOfScheme, joinAddress, readAddressInput, splitAddress } from "../utils/applicationUrl.js";
import { HUB_ICON_NAMES } from "../utils/hubIcons.js";
import { AppCardPreview } from "./AppCardPreview.jsx";
import { IconPicker } from "./IconPicker.jsx";
import { NextStepsCard } from "./NextStepsCard.jsx";
import { ScopePicker } from "./ScopePicker.jsx";

const CATEGORIES = [
  { value: "reporting", label: "Reporting" },
  { value: "students", label: "Students" },
  { value: "workplace", label: "Workplace" },
  { value: "operations", label: "Operations" },
  { value: "utilities", label: "Utilities" },
];


// What the Hub card shows and where it sends people. Used to add an application and to edit it later.
// On the page layout the id is made from the name. In the dialog the id is the one the application has.
export function AppDetailsForm({ initial, idLocked = false, isHub = false, layout = "dialog", submitLabel, submitting, onSubmit, onCancel }) {
  const launch = splitAddress(initial?.launch_url);
  const logout = splitAddress(initial?.logout_url, launch.environment);
  const [values, setValues] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    // An icon the Hub does not know falls back to the default, so it is not carried over.
    icon: HUB_ICON_NAMES.includes(initial?.icon) ? initial.icon : "",
    category: initial?.category ?? "",
  });
  const [environment, setEnvironment] = useState(initial?.launch_url ? launch.environment : logout.environment);
  const [launchRest, setLaunchRest] = useState(launch.rest);
  const [logoutRest, setLogoutRest] = useState(logout.rest);
  const [attempted, setAttempted] = useState(false);
  const [scopeNames, setScopeNames] = useState(DEFAULT_SCOPES);
  const [hubChosen, setHubChosen] = useState(false);
  // What a pasted address started with, so a clash with the environment can be said out loud.
  const [pasted, setPasted] = useState({ launch: null, logout: null });
  const [notes, setNotes] = useState({ launch: null, logout: null });
  const hub = isHub || hubChosen;
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const tidyOnBlur = (key) => () => setValues((current) => ({ ...current, [key]: tidyText(current[key]) }));

  const applicationId = idLocked ? initial.application_id : hub ? "hub" : slugifyApplicationId(values.name);
  // The Hub is always called HUB.
  const nameShown = hub ? "HUB" : values.name;
  // The Hub itself has no launch address.
  const needsLaunch = !hub;

  // A pasted scheme that differs from the environment is a clash, unless the environment changed with it.
  const clash = (key) => {
    const scheme = pasted[key];
    if (!scheme || environmentOfScheme(scheme) === environment) return undefined;
    const label = ENVIRONMENTS.find((item) => item.id === environment)?.label;
    return `This address starts with ${scheme}:// but the Environment is ${label}. Change the Environment, or use a ${environment === "local" ? "http" : "https"} address.`;
  };

  const errors = {
    name: hub ? undefined : (nameProblem(values.name) ?? undefined),
    description: descriptionProblem(values.description) ?? undefined,
    launch_url: hub ? undefined : (clash("launch") ?? addressProblem(environment, launchRest, { required: needsLaunch }) ?? undefined),
    logout_url: hub ? undefined : (clash("logout") ?? addressProblem(environment, logoutRest) ?? undefined),
  };
  const valid = !Object.values(errors).some(Boolean);
  const shown = (key) => (attempted ? errors[key] : undefined);

  // Typing or pasting an address. A scheme in the text is taken off. It sets the environment when the other
  // address is empty, otherwise it is left as a clash for the person to settle.
  function typeAddress(key, setter, otherRest) {
    return (event) => {
      const next = readAddressInput(event.target.value, environment);
      setter(next.rest);
      setNotes((current) => ({ ...current, [key]: null }));
      if (!next.scheme) {
        setPasted((current) => ({ ...current, [key]: null }));
        return;
      }
      const target = environmentOfScheme(next.scheme);
      if (target === environment) {
        setPasted((current) => ({ ...current, [key]: null }));
      } else if (!otherRest.trim()) {
        setEnvironment(target);
        setPasted((current) => ({ ...current, [key]: null }));
        const label = ENVIRONMENTS.find((item) => item.id === target)?.label;
        setNotes((current) => ({ ...current, [key]: `Environment set to ${label} because the address started with ${next.scheme}://.` }));
      } else {
        setPasted((current) => ({ ...current, [key]: next.scheme }));
      }
    };
  }

  function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if (!valid) return;
    if (hub) {
      onSubmit({
        ...(idLocked ? { application_id: applicationId } : {}),
        name: "HUB",
        ...(layout === "page" ? { is_hub: true, connect: true, scope_names: scopeNames } : {}),
      });
      return;
    }
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
              value={nameShown}
              disabled={hub}
              readOnly={hub}
              maxLength={60}
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
        {layout === "page" ? (
          <CheckboxField
            label="This is the Hub itself"
            description="The Hub is not listed in the Hub, so it has no card or launch address."
            checked={hubChosen}
            onChange={(event) => setHubChosen(event.target.checked)}
          />
        ) : null}
      </Section>
      {hub ? null : (<>
      <Section title="Hub Card">
        <Field
          label="Description"
          hint={`A short line about what it is for. ${tidyText(values.description).length}/${LIMITS.APPLICATION_DESCRIPTION_MAX}`}
          error={shown("description")}
        >
          <TextAreaInput
            aria-label="Description"
            rows={2}
            maxLength={LIMITS.APPLICATION_DESCRIPTION_MAX}
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
          <Field label="Icon" hint="The picture on the Hub card.">
            <IconPicker value={values.icon} onChange={(icon) => setValues((current) => ({ ...current, icon }))} />
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
          error={shown("launch_url")}
          hint={notes.launch ?? "Where the Hub sends people, usually the sign-in address of the application."}
        >
          <AddressInput
            label="Launch URL"
            environment={environment}
            value={launchRest}
            placeholder="exima.mws.web.id/auth/sso"
            invalid={Boolean(shown("launch_url"))}
            onChange={typeAddress("launch", setLaunchRest, logoutRest)}
            onBlur={() => setLaunchRest((current) => current.trim())}
          />
        </Field>
        <Field
          label="Logout URL"
          hint={notes.logout ?? "Optional. Opened in the background so signing out of the Hub signs out of this application too."}
          error={shown("logout_url")}
        >
          <AddressInput
            label="Logout URL"
            environment={environment}
            value={logoutRest}
            placeholder="exima.mws.web.id/auth/logout"
            invalid={Boolean(shown("logout_url"))}
            onChange={typeAddress("logout", setLogoutRest, launchRest)}
            onBlur={() => setLogoutRest((current) => current.trim())}
          />
        </Field>
      </Section>
      </>)}
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
            {hub ? null : <AppCardPreview values={preview} />}
            <NextStepsCard hub={hub} />
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
