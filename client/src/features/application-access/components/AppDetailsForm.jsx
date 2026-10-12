import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CheckboxField, Field, SearchableSelect, TextAreaInput, TextInput } from "../../../components/ui/FormControls.jsx";
import { cn } from "../../../lib/cn.js";
import { LIMITS } from "../../../lib/limits.js";
import { DEFAULT_SCOPES } from "../utils/connectionScopes.js";
import { descriptionProblem, nameProblem, slugifyApplicationId, tidyText } from "../utils/applicationId.js";
import { ENVIRONMENTS, addressPlaceholder, addressProblem, environmentOfScheme, joinAddress, readAddressInput, splitAddress } from "../utils/applicationUrl.js";
import { HUB_ICON_NAMES } from "../utils/hubIcons.js";
import { AddressInput } from "./AddressInput.jsx";
import { AppCardPreview } from "./AppCardPreview.jsx";
import { IconPicker } from "./IconPicker.jsx";
import { NextStepsCard } from "./NextStepsCard.jsx";
import { HubSetupWizard } from "./HubSetupWizard.jsx";
import { ScopePicker } from "./ScopePicker.jsx";
import { emailsProblem } from "../utils/hubSettings.js";
import { nameOf, useApplicationTaxonomy } from "../hooks/useApplicationTaxonomy.js";
const STANDARD_PATHS = { launch: "/auth/sso", logout: "/auth/logout" };

const LAUNCH_MODES = [
  {
    value: "sso",
    label: "Single Sign-On",
    hint: "People sign in once in the Hub and open the application already signed in. The application connects to Central, sends its permissions and reads who has access.",
  },
  {
    value: "link",
    label: "Plain Link",
    hint: "The card just opens the address. Nothing connects to Central, so there are no permissions or token. Central still decides who sees the card.",
  },
];

// What the Hub card shows and where it sends people. Used to add an application and to edit it later.
// On the page layout the id is made from the name. In the dialog the id is the one the application has.
export function AppDetailsForm({ initial, idLocked = false, isHub = false, layout = "dialog", hubExists = false, adminEmail = "", submitLabel, submitting, onSubmit, onCancel }) {
  const launch = splitAddress(initial?.launch_url);
  const logout = splitAddress(initial?.logout_url, launch.environment);
  const [values, setValues] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    // An icon the Hub does not know falls back to the default, so it is not carried over.
    icon: HUB_ICON_NAMES.includes(initial?.icon) ? initial.icon : "",
    category: initial?.category ?? "",
    scope: initial?.scope ?? "",
  });
  const [environment, setEnvironment] = useState(initial?.launch_url ? launch.environment : logout.environment);
  const [launchRest, setLaunchRest] = useState(launch.rest);
  const [logoutRest, setLogoutRest] = useState(logout.rest);
  const [attempted, setAttempted] = useState(false);
  const [launchMode, setLaunchMode] = useState(initial?.launch_mode ?? "sso");
  const [usesHub, setUsesHub] = useState(initial?.uses_hub ?? true);
  // Every application signs in at /auth/sso and signs out at /auth/logout, so only the address is asked for.
  // An application that differs, or an address kept by hand, keeps its own paths.
  const startsStandard =
    !initial?.launch_url ||
    (launch.rest.endsWith(STANDARD_PATHS.launch) &&
      logout.rest === launch.rest.slice(0, -STANDARD_PATHS.launch.length) + STANDARD_PATHS.logout);
  const [customPaths, setCustomPaths] = useState(!startsStandard);
  const [hostRest, setHostRest] = useState(startsStandard && initial?.launch_url ? launch.rest.slice(0, -STANDARD_PATHS.launch.length) : "");
  const [scopeNames, setScopeNames] = useState(DEFAULT_SCOPES);
  // What the Hub wizard has gathered while the Hub is being added.
  const [hubWizard, setHubWizard] = useState({ step: 0, address: "", settings: null, secret: undefined });
  const [hubChosen, setHubChosen] = useState(false);
  // What a pasted address started with, so a clash with the environment can be said out loud.
  const [pasted, setPasted] = useState({ launch: null, logout: null });
  const [notes, setNotes] = useState({ launch: null, logout: null });
  const taxonomy = useApplicationTaxonomy();
  // A value that is no longer in the list (a removed one) shows as none.
  const categoryOptions = [{ value: "", label: "No category" }, ...taxonomy.categories.map((item) => ({ value: item.key, label: item.name }))];
  const scopeOptions = [{ value: "", label: "No scope" }, ...taxonomy.scopes.map((item) => ({ value: item.key, label: item.name }))];
  const hub = isHub || hubChosen;
  // Safe to start with: people still get in, and the one setting it up always does.
  const hubSettingsProblem = layout === "page" && hubChosen && hubWizard.settings ? emailsProblem(hubWizard.settings.hub_bypass_emails) : null;
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const tidyOnBlur = (key) => () => setValues((current) => ({ ...current, [key]: tidyText(current[key]) }));

  const applicationId = idLocked ? initial.application_id : hub ? "hub" : slugifyApplicationId(values.name);
  // The Hub is always called HUB.
  const nameShown = hub ? "HUB" : values.name;
  // The Hub itself has no launch address.
  const needsLaunch = !hub;
  // The one address field stands in for both URLs while the paths are the standard ones.
  const simplePaths = launchMode === "sso" && !customPaths;
  const host = hostRest.trim();
  const effectiveLaunch = simplePaths ? (host ? host + STANDARD_PATHS.launch : "") : launchRest;
  const effectiveLogout = simplePaths ? (host ? host + STANDARD_PATHS.logout : "") : launchMode === "link" ? "" : logoutRest;

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
    launch_url: hub ? undefined : (clash("launch") ?? addressProblem(environment, effectiveLaunch, { required: needsLaunch }) ?? undefined),
    logout_url: hub ? undefined : (clash("logout") ?? addressProblem(environment, effectiveLogout) ?? undefined),
  };
  const valid = !Object.values(errors).some(Boolean) && !hubSettingsProblem;
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

  function switchToCustomPaths() {
    setLaunchRest(host ? host + STANDARD_PATHS.launch : "");
    setLogoutRest(host ? host + STANDARD_PATHS.logout : "");
    setCustomPaths(true);
  }

  function switchToStandardPaths() {
    setHostRest(launchRest.split(/[/?#]/)[0]);
    setCustomPaths(false);
  }

  // A pasted sign-in or sign-out address is cut back to the address itself.
  const setHost = (value) => setHostRest(value.replace(/\/auth\/(sso|logout)\/?$/, ""));

  function submit(event) {
    event.preventDefault();
    // Adding the Hub is done from the last step of its wizard, not by an Enter key on an earlier one.
    if (layout === "page" && hubChosen && event.nativeEvent?.submitter?.dataset?.hubAdd !== "true") return;
    setAttempted(true);
    if (!valid) return;
    if (hub) {
      onSubmit({
        ...(idLocked ? { application_id: applicationId } : {}),
        name: "HUB",
        ...(layout === "page"
          ? {
              is_hub: true,
              connect: true,
              scope_names: scopeNames,
              ...(hubWizard.settings ? { env_settings: hubWizard.settings } : {}),
              ...(hubWizard.address ? { hub_base_url: hubWizard.address } : {}),
              ...(hubWizard.secret ? { hub_secret: hubWizard.secret } : {}),
            }
          : {}),
      });
      return;
    }
    onSubmit({
      ...(idLocked ? { application_id: applicationId } : {}),
      name: tidyText(values.name),
      description: tidyText(values.description),
      icon: values.icon.trim(),
      category: values.category,
      scope: values.scope,
      launch_url: joinAddress(environment, effectiveLaunch),
      logout_url: joinAddress(environment, effectiveLogout),
      launch_mode: launchMode,
      uses_hub: launchMode === "sso" ? usesHub : true,
      // On the page layout the connection is made together with the application, unless it is a plain link.
      ...(layout === "page" && launchMode === "sso" ? { connect: true, scope_names: scopeNames } : {}),
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
        {/* Gone once the wizard moves past step 1, so a stray click cannot throw the steps away. */}
        {layout === "page" && !hubExists && !(hubChosen && hubWizard.step > 0) ? (
          <CheckboxField
            label="This is the Hub itself"
            description="The Hub is not listed in the Hub, so it has no card or launch address. It cannot be retired, deleted or renamed, and there can only be one."
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
        <Field
          label="How It Opens"
          hint={LAUNCH_MODES.find((item) => item.value === launchMode)?.hint}
        >
          <SearchableSelect value={launchMode} onChange={setLaunchMode} options={LAUNCH_MODES} placeholder="Select how it opens" />
        </Field>
        {launchMode === "sso" ? (
          <CheckboxField
            label="Signs in through the Hub"
            description="Its .env gets the Hub address and the secret the Hub shares. Turn it off for an application that does not use the Hub's sign-in."
            checked={usesHub}
            onChange={(event) => setUsesHub(event.target.checked)}
          />
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Scope" hint="The product space it belongs to, like Safespace. Optional.">
            <SearchableSelect
              value={values.scope}
              onChange={(value) => setValues((current) => ({ ...current, scope: value }))}
              options={scopeOptions}
              placeholder="No scope"
            />
          </Field>
          <Field label="Category" hint="The kind of tool. The Hub groups its cards by it.">
            <SearchableSelect
              value={values.category}
              onChange={(value) => setValues((current) => ({ ...current, category: value }))}
              options={categoryOptions}
              placeholder="No category"
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
        {simplePaths ? (
          <Field
            label="Application Address"
            required={needsLaunch}
            error={shown("launch_url")}
            hint={
              notes.launch ??
              `Where the application runs${environment === "local" ? ", like localhost:3000" : ""}. The Hub opens ${STANDARD_PATHS.launch} and signs out through ${STANDARD_PATHS.logout}.`
            }
          >
            <AddressInput
              label="Application Address"
              environment={environment}
              value={hostRest}
              placeholder={addressPlaceholder(environment, "")}
              invalid={Boolean(shown("launch_url"))}
              onChange={typeAddress("launch", setHost, "")}
              onBlur={() => setHostRest((current) => current.trim())}
            />
          </Field>
        ) : (
          <>
            <Field
              label={launchMode === "link" ? "Address" : "Launch URL"}
              required={needsLaunch}
              error={shown("launch_url")}
              hint={notes.launch ?? (launchMode === "link" ? "Where the card sends people." : environment === "local" ? "Where the Hub sends people. Use localhost and the port the application runs on." : "Where the Hub sends people, usually the sign-in address of the application.")}
            >
              <AddressInput
                label="Launch URL"
                environment={environment}
                value={launchRest}
                placeholder={addressPlaceholder(environment, "/auth/sso")}
                invalid={Boolean(shown("launch_url"))}
                onChange={typeAddress("launch", setLaunchRest, logoutRest)}
                onBlur={() => setLaunchRest((current) => current.trim())}
              />
            </Field>
            {launchMode === "link" ? null : (
              <Field
                label="Logout URL"
                hint={notes.logout ?? "Optional. Opened in the background so signing out of the Hub signs out of this application too."}
                error={shown("logout_url")}
              >
                <AddressInput
                  label="Logout URL"
                  environment={environment}
                  value={logoutRest}
                  placeholder={addressPlaceholder(environment, "/auth/logout")}
                  invalid={Boolean(shown("logout_url"))}
                  onChange={typeAddress("logout", setLogoutRest, launchRest)}
                  onBlur={() => setLogoutRest((current) => current.trim())}
                />
              </Field>
            )}
          </>
        )}
        {launchMode === "sso" ? (
          <button
            type="button"
            onClick={simplePaths ? switchToCustomPaths : switchToStandardPaths}
            className="cursor-pointer text-xs font-medium text-(--mws-burgundy) hover:underline"
          >
            {simplePaths ? "This application uses different paths" : "Use the standard paths again"}
          </button>
        ) : null}
      </Section>
      </>)}
      {layout === "page" && hubChosen ? (
        <HubSetupWizard mode="create" adminEmail={adminEmail.endsWith(`@${LIMITS.EMAIL_DOMAIN}`) ? adminEmail : ""} submitting={submitting} onChange={setHubWizard} />
      ) : null}
      {layout === "page" && launchMode === "sso" && !hubChosen ? (
        <Section title="Data Access">
          <p className="text-xs leading-5 text-(--mws-muted)">
            Pick what the application may read from Central. You get its token and .env values as soon as you add it.
          </p>
          <ScopePicker value={scopeNames} onChange={setScopeNames} />
        </Section>
      ) : null}
    </div>
  );

  // Editing: Save waits for something to change.
  const snapshot = JSON.stringify({ values, environment, effectiveLaunch, effectiveLogout, launchMode, usesHub });
  const [baseline] = useState(snapshot);
  const unchanged = Boolean(initial) && snapshot === baseline;

  const buttons = (
    <div className="flex gap-2">
      <Button type="button" variant="secondary" className={layout === "page" ? "flex-1" : undefined} onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" className={layout === "page" ? "flex-1" : undefined} loading={submitting} disabled={unchanged}>
        {submitLabel}
      </Button>
    </div>
  );

  const preview = {
    ...values,
    launch_url: joinAddress(environment, effectiveLaunch),
    category_name: nameOf(taxonomy.categories, values.category),
    scope_name: nameOf(taxonomy.scopes, values.scope),
  };

  if (layout === "page") {
    return (
      <form onSubmit={submit} noValidate>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5">{fields}</section>
          <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start">
            {hub ? null : <AppCardPreview values={preview} />}
            <NextStepsCard hub={hub} />
            {hubChosen ? null : buttons}
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
function Section({ title, children }) {
  return (
    <fieldset className="min-w-0 space-y-4 border-t border-(--mws-line) pt-5 first:border-t-0 first:pt-0">
      <legend className="float-left mb-4 w-full font-display text-sm font-bold text-(--mws-charcoal)">{title}</legend>
      <div className="clear-both space-y-4">{children}</div>
    </fieldset>
  );
}
