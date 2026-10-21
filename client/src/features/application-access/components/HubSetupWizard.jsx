import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { TextInput } from "../../../components/ui/FormControls.jsx";
import { TextAction } from "../../../components/ui/TextAction.jsx";
import { cn } from "../../../lib/cn.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { cleanPastedSecret, cookieNameProblem, emailsProblem, existingSecretProblem } from "../utils/hubSettings.js";
import { HubAccessSettings } from "./HubAccessSettings.jsx";
import { HubSecretTest } from "./HubSecretTest.jsx";
import { HubAddressField } from "./HubAddressField.jsx";
import {
  HubSecretShownDialog,
  ImpactList,
  SecretConfirmDialog,
  SecretsKeyWarning,
} from "./HubSecretControls.jsx";
import { SignInLinesDialog } from "./SignInLinesDialog.jsx";

const STEPS = [
  { id: "address", label: "Address" },
  { id: "secret", label: "Secret" },
  { id: "signin", label: "Sign-in" },
  { id: "review", label: "Review" },
];
// A Hub being added starts with its signing key, which is copied at the end with the rest of the .env.
const ADD_STEPS = [{ id: "key", label: "Key" }, ...STEPS];

// The two ways to make a key look the same, in the brand colour so they are easy to spot.
const KEY_ACTION = "text-(--mws-burgundy)! hover:text-(--mws-burgundy-dark)!";

// Back is the quiet text action. The way forward is the same action in the brand colour.
const FORWARD_ACTION = "text-(--mws-burgundy)! hover:text-(--mws-burgundy-dark)!";

const SIGN_IN_TITLE = { warn: "Warn", enforce: "Enforce", off: "Off" };

function signInSummary(settings) {
  if (settings.hub_access_mode === "off") return "Access in Central is not checked.";
  if (settings.hub_access_mode === "warn") return "Everyone still gets in. Whoever would be turned away is only logged.";
  const count = settings.hub_bypass_emails.length;
  const emergency = count === 0 ? "No emergency admins." : `${count} emergency ${count === 1 ? "admin" : "admins"}.`;
  return `People without access in Central are turned away. ${emergency}`;
}

function ReviewRow({ label, children }) {
  return (
    <div className="grid gap-1 px-4 py-3 text-sm text-(--mws-charcoal) sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="text-(--mws-muted)">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

const DEFAULT_SETTINGS = { hub_access_mode: "warn", hub_bypass_emails: [], hub_access_cookie_name: "hub_at" };

// The pieces of the Hub that depend on each other, one after the other. While the Hub is being added the choices are
// handed up to the form (`onChange`) and sent with Add Application. On a Hub that exists each step saves as it goes.
export function HubSetupWizard({
  mode,
  applicationId,
  hub,
  settings,
  adminEmail = "",
  suggestedAddress = "",
  submitting = false,
  onChange,
  onClose,
}) {
  const managing = mode === "manage";
  const queryClient = useQueryClient();
  const steps = managing ? STEPS : ADD_STEPS;
  const [step, setStep] = useState(0);
  const stepId = steps[step].id;
  const [address, setAddress] = useState(hub?.base_url ?? suggestedAddress);
  const [addressBad, setAddressBad] = useState(false);
  const [signIn, setSignIn] = useState(
    settings ?? {
      ...DEFAULT_SETTINGS,
      hub_bypass_emails: adminEmail ? [adminEmail] : [],
    },
  );
  const [secretChoice, setSecretChoice] = useState("new");
  const [existingValue, setExistingValue] = useState("");
  const [secretVerified, setSecretVerified] = useState(false);
  const [dialog, setDialog] = useState(null);
  // A secret Central just made. It is shown once, then it is gone.
  const [shownSecret, setShownSecret] = useState(null);
  // The key Central made for the Hub. Only its name and thumbprint are kept here, the private key is shown once.
  const [keyChoice, setKeyChoice] = useState(null);
  const [signing, setSigning] = useState(null);
  // The key lines wait here until the Hub is added, then they come with the rest of the .env. They are never sent.
  const [keyEnv, setKeyEnv] = useState(null);

  const statusQuery = useQuery({
    queryKey: ["application-access", "secrets-status"],
    queryFn: () => applicationAccessApi.secretsStatus(),
    enabled: !managing,
  });
  const keyReady = managing
    ? hub?.key_ready !== false
    : statusQuery.data?.key_ready !== false;
  const secretSet = managing ? Boolean(hub?.secret_set) : true;

  useEffect(() => {
    if (managing) return;
    onChange?.({
      step,
      address,
      signing: keyChoice === "made" ? signing : null,
      keyEnv: keyChoice === "made" ? keyEnv : null,
      settings: signIn,
      secret:
        secretChoice === "existing" && existingValue.trim()
          ? cleanPastedSecret(existingValue)
          : undefined,
    });
  }, [managing, onChange, step, address, signing, keyEnv, keyChoice, signIn, secretChoice, existingValue]);

  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: ["application-access", "setup", applicationId],
    });
    queryClient.invalidateQueries({
      queryKey: ["application-access", "hub-secret-impact", applicationId],
    });
  };
  const addressMutation = useMutation({
    mutationFn: () =>
      applicationAccessApi.setHubAddress(applicationId, address),
    onSuccess: () => {
      refresh();
      setStep((current) => current + 1);
    },
    onError: (error) =>
      showErrorToast(error, "Could not save the Hub address."),
  });
  const keyMutation = useMutation({
    mutationFn: () => applicationAccessApi.makeHubSigningKey(),
    onSuccess: (result) => {
      setSigning({ kid: result.kid, thumbprint: result.thumbprint });
      setKeyChoice("made");
      setKeyEnv(result.env);
    },
    onError: (error) => showErrorToast(error, "Could not make the signing key."),
  });
  const secretMutation = useMutation({
    mutationFn: (secret) =>
      applicationAccessApi.setHubSecret(applicationId, secret),
    onSuccess: (result) => {
      refresh();
      setDialog(null);
      if (result.secret) setShownSecret(result.secret);
      else showSuccessToast("Hub secret saved.");
    },
    onError: (error) => showErrorToast(error, "Could not save the Hub secret."),
  });
  const signInMutation = useMutation({
    mutationFn: () =>
      applicationAccessApi.updateEnvSettings(applicationId, signIn),
    onSuccess: () => {
      refresh();
      setStep((current) => current + 1);
    },
    onError: (error) =>
      showErrorToast(error, "Could not save the sign-in settings."),
  });

  const addressOk = Boolean(address) && !addressBad;
  const secretOk = managing
    ? secretSet
    : keyReady &&
      (secretChoice === "new" ||
        (existingValue.trim() !== "" && !existingSecretProblem(existingValue) && secretVerified));
  const signInProblem = emailsProblem(signIn.hub_bypass_emails) ?? cookieNameProblem(signIn.hub_access_cookie_name);
  const addressChanged = managing && address !== (hub?.base_url ?? "");
  const signInChanged =
    managing && JSON.stringify(signIn) !== JSON.stringify(settings);
  const ready = { key: keyChoice !== null, address: addressOk, secret: secretOk, signin: !signInProblem, review: true };

  function next() {
    if (stepId === "address" && addressChanged) return addressMutation.mutate();
    if (stepId === "signin" && signInChanged) return signInMutation.mutate();
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  return (
    <section className="space-y-5 rounded-2xl border border-(--mws-line) bg-white p-5">
      <ol
        className="flex flex-wrap items-center gap-2"
        aria-label="Hub setup steps"
      >
        {steps.map((item, index) => {
          const done = index < step;
          return (
            <li
              key={item.id}
              aria-current={index === step ? "step" : undefined}
              className="flex items-center gap-2"
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs font-bold",
                  index === step
                    ? "bg-(--mws-burgundy) text-white"
                    : done
                      ? "bg-[#476b43] text-white"
                      : "bg-(--mws-soft) text-(--mws-muted)",
                )}
              >
                {done ? <Check size={13} aria-hidden="true" /> : index + 1}
              </span>
              <span
                className={cn(
                  "text-sm",
                  index === step
                    ? "font-semibold text-(--mws-charcoal)"
                    : "text-(--mws-muted)",
                )}
              >
                {item.label}
              </span>
              {index < steps.length - 1 ? (
                <span
                  className="mx-1 h-px w-5 bg-(--mws-line)"
                  aria-hidden="true"
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      {stepId === "key" ? (
        <div className="space-y-3">
          <p className="text-sm text-(--mws-muted)">
            The key the Hub signs everybody in with. Central shows it once and keeps only its name and fingerprint.
          </p>
          {keyChoice === "made" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-(--mws-line) bg-(--mws-soft) px-4 py-3">
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-(--mws-charcoal)">
                <Check size={16} className="shrink-0 text-[#476b43]" aria-hidden="true" />
                Key Made
                <span className="truncate font-mono text-xs text-(--mws-muted)">{signing?.kid}</span>
              </span>
              <TextAction className={KEY_ACTION} disabled={keyMutation.isPending} onClick={() => keyMutation.mutate()}>
                Make Another Key
              </TextAction>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-(--mws-line) bg-(--mws-soft) px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-medium text-(--mws-charcoal)">
                <KeyRound size={16} className="shrink-0 text-(--mws-muted)" aria-hidden="true" />
                {keyChoice === "own" ? "Using the Hub's own key" : "No key yet"}
              </span>
              {keyChoice === "own" ? (
                <TextAction onClick={() => setKeyChoice(null)}>Make One Instead</TextAction>
              ) : (
                <TextAction className={KEY_ACTION} loading={keyMutation.isPending} onClick={() => keyMutation.mutate()}>
                  Make Signing Key
                </TextAction>
              )}
            </div>
          )}
          {keyChoice === "own" ? (
            <p className="text-xs text-(--mws-muted)">
              The Hub already has HUB_SSO_PRIVATE_KEY in its .env. The address check will only say that the Hub has a key.
            </p>
          ) : null}
          {keyChoice === "made" ? (
            <p className="text-xs text-(--mws-muted)">
              The key lines come with the rest of the .env at the end, so there is one copy and one restart.
            </p>
          ) : null}
          {keyChoice === null ? (
            <TextAction onClick={() => setKeyChoice("own")}>I Already Have A Key</TextAction>
          ) : null}
        </div>
      ) : null}

      {stepId === "address" ? (
        <div className="space-y-3">
          <p className="text-sm text-(--mws-muted)">
            The address people open the Hub at. Every application gets it in its
            .env, so set it first.
          </p>
          {managing ? null : (
            <div role="note" className="rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3 text-sm text-(--mws-muted)">
              <p className="font-semibold text-(--mws-charcoal)">Before You Check The Address</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>The Hub is deployed and running.</li>
                <li>You use the address people open the Hub at, over https.</li>
              </ul>
            </div>
          )}
          <HubAddressField
            value={address}
            suggestedAddress={suggestedAddress}
            keyMadeHere={keyChoice === "made"}
            cookieName={signIn.hub_access_cookie_name}
            onChange={(next, bad) => {
              setAddress(next);
              setAddressBad(Boolean(bad));
            }}
            showError
          />
        </div>
      ) : null}

      {stepId === "secret" ? (
        <div className="space-y-4">
          <p className="text-sm text-(--mws-muted)">
            One secret shared by the Hub and the applications that sign in
            through it. It is one value for all of them, so it is made once
            here.
          </p>
          {keyReady ? null : <SecretsKeyWarning />}
          {managing ? (
            <>
              {secretSet ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-(--mws-line) bg-(--mws-soft) px-4 py-3">
                  <span className="flex items-center gap-2 text-sm font-medium text-(--mws-charcoal)">
                    <Check
                      size={16}
                      className="text-[#476b43]"
                      aria-hidden="true"
                    />
                    Secret Generated
                  </span>
                  <TextAction
                    disabled={!keyReady}
                    onClick={() => setDialog("rotate")}
                  >
                    Rotate Secret
                  </TextAction>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-4">
                  <Button
                    type="button"
                    disabled={!keyReady}
                    onClick={() => setDialog("generate")}
                  >
                    Generate Secret
                  </Button>
                  <TextAction
                    disabled={!keyReady}
                    onClick={() => setDialog("existing")}
                  >
                    Use The Hub's Current Secret
                  </TextAction>
                </div>
              )}
              <ImpactList applicationId={applicationId} />
            </>
          ) : (
            <div
              role="radiogroup"
              aria-label="Hub secret"
              className="space-y-2"
            >
              {[
                [
                  "new",
                  "Make A New Secret",
                  "Central makes a random one when you add the Hub and shows it once. Put it in the Hub's .env as HUB_INTERNAL_SECRET. Choose this for a new Hub, or when no application uses a secret yet.",
                ],
                [
                  "existing",
                  "Use The Hub's Current Secret",
                  "Open the .env of the Hub, copy the value of HUB_INTERNAL_SECRET and paste it below. Applications that already use it keep working, and nothing in their .env changes. Choose this when the Hub and its applications already run.",
                ],
              ].map(([id, title, text]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={secretChoice === id}
                  onClick={() => setSecretChoice(id)}
                  className={cn(
                    "flex w-full cursor-pointer flex-col gap-0.5 rounded-xl border p-3 text-left",
                    secretChoice === id
                      ? "border-(--mws-burgundy) bg-[#7E15180D]"
                      : "border-(--mws-line) bg-white hover:border-(--mws-burgundy)",
                  )}
                >
                  <span className="text-sm font-semibold text-(--mws-charcoal)">
                    {title}
                  </span>
                  <span className="text-xs text-(--mws-muted)">{text}</span>
                </button>
              ))}
              {secretChoice === "existing" ? (
                <div className="space-y-1.5">
                  <label htmlFor="existing-hub-secret" className="block text-sm font-semibold text-(--mws-charcoal)">
                    HUB_INTERNAL_SECRET From The Hub's .env
                  </label>
                  <p className="text-xs text-(--mws-muted)">At least 16 characters.</p>
                  <TextInput
                    id="existing-hub-secret"
                    aria-label="Existing Hub secret"
                    type="password"
                    autoComplete="off"
                    value={existingValue}
                    invalid={Boolean(existingSecretProblem(existingValue))}
                    onChange={(event) => setExistingValue(event.target.value)}
                  />
                  {existingSecretProblem(existingValue) ? (
                    <p className="mt-1 text-xs text-[#a43c41]">
                      {existingSecretProblem(existingValue)}
                    </p>
                  ) : null}
                  <HubSecretTest
                    secret={existingValue}
                    address={address}
                    disabled={!existingValue.trim() || Boolean(existingSecretProblem(existingValue))}
                    onReady={setSecretVerified}
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {stepId === "signin" ? (
        <div className="space-y-3">
          <p className="text-sm text-(--mws-muted)">
            How strictly the Hub checks who may sign in. These go into the Hub's
            .env.
          </p>
          <HubAccessSettings value={signIn} onChange={setSignIn} />
        </div>
      ) : null}

      {stepId === "review" ? (
        <div className="space-y-4">
          <dl className="divide-y divide-(--mws-line) rounded-xl border border-(--mws-line) bg-white">
            {managing ? null : (
              <ReviewRow label="Signing Key">
                {keyChoice === "made" ? (
                  <>
                    Made here
                    <span className="mt-0.5 block break-all font-mono text-xs text-(--mws-muted)">{signing?.kid}</span>
                  </>
                ) : (
                  "The Hub keeps the key it already has"
                )}
              </ReviewRow>
            )}
            <ReviewRow label="Address">
              <span className="break-all font-mono text-xs">{address}</span>
            </ReviewRow>
            <ReviewRow label="Secret">
              {managing
                ? secretSet
                  ? "Made"
                  : "Not made yet"
                : secretChoice === "existing"
                  ? "The one the Hub runs with now"
                  : "Central makes a new one when you add the Hub"}
            </ReviewRow>
            <ReviewRow label="Sign-in">
              <span className="font-semibold">{SIGN_IN_TITLE[signIn.hub_access_mode]}</span>
              <span className="mt-0.5 block text-xs text-(--mws-muted)">{signInSummary(signIn)}</span>
            </ReviewRow>
          </dl>
          {managing ? null : (
            <p className="text-xs text-(--mws-muted)">
              When you add the Hub, one block of lines appears, once. Copy all of it into the Hub's .env and restart the
              Hub.
            </p>
          )}
          {managing ? (
            <>
              <ImpactList applicationId={applicationId} />
              <div>
                <TextAction onClick={() => setDialog("lines")}>
                  Copy Sign-in Lines
                </TextAction>
              </div>
              <p className="text-xs text-(--mws-muted)">
                Put the sign-in lines in the Hub's .env, then restart the Hub.
                The secret is in the Hub's block when its token is made or
                rotated.
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-(--mws-line) pt-4">
        <TextAction
          className={step === 0 ? "invisible" : undefined}
          disabled={step === 0}
          onClick={() => setStep((current) => Math.max(current - 1, 0))}
        >
          Back
        </TextAction>
        {managing && step === steps.length - 1 ? (
          <TextAction className={FORWARD_ACTION} onClick={onClose}>
            Done
          </TextAction>
        ) : null}
        {!managing && step === steps.length - 1 ? (
          <TextAction type="submit" data-hub-add="true" className={FORWARD_ACTION} loading={submitting}>
            Add Application
          </TextAction>
        ) : null}
        {step < steps.length - 1 ? (
          <TextAction
            className={FORWARD_ACTION}
            loading={addressMutation.isPending || signInMutation.isPending}
            disabled={!ready[stepId]}
            onClick={next}
          >
            {(stepId === "address" && addressChanged) || (stepId === "signin" && signInChanged)
              ? "Save and Continue"
              : "Continue"}
          </TextAction>
        ) : null}
      </div>

      {shownSecret ? (
        <HubSecretShownDialog
          secret={shownSecret}
          onClose={() => setShownSecret(null)}
        />
      ) : null}
      {dialog === "lines" ? (
        <SignInLinesDialog
          applicationId={applicationId}
          settings={settings}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "generate" || dialog === "existing" || dialog === "rotate" ? (
        <SecretConfirmDialog
          kind={dialog}
          applicationId={applicationId}
          saving={secretMutation.isPending}
          onConfirm={(secret) => secretMutation.mutate(secret)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </section>
  );
}
