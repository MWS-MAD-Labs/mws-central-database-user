import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { TextInput } from "../../../components/ui/FormControls.jsx";
import { TextAction } from "../../../components/ui/TextAction.jsx";
import { cn } from "../../../lib/cn.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { emailsProblem, existingSecretProblem } from "../utils/hubSettings.js";
import { HubAccessSettings } from "./HubAccessSettings.jsx";
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

const DEFAULT_SETTINGS = { hub_access_mode: "warn", hub_bypass_emails: [] };

// The pieces of the Hub that depend on each other, one after the other. While the Hub is being added the choices are
// handed up to the form (`onChange`) and sent with Add Application. On a Hub that exists each step saves as it goes.
export function HubSetupWizard({
  mode,
  applicationId,
  hub,
  settings,
  adminEmail = "",
  submitting = false,
  onChange,
  onClose,
}) {
  const managing = mode === "manage";
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [address, setAddress] = useState(hub?.base_url ?? "");
  const [addressBad, setAddressBad] = useState(false);
  const [signIn, setSignIn] = useState(
    settings ?? {
      ...DEFAULT_SETTINGS,
      hub_bypass_emails: adminEmail ? [adminEmail] : [],
    },
  );
  const [secretChoice, setSecretChoice] = useState("new");
  const [existingValue, setExistingValue] = useState("");
  const [dialog, setDialog] = useState(null);
  // A secret Central just made. It is shown once, then it is gone.
  const [shownSecret, setShownSecret] = useState(null);

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
      address,
      settings: signIn,
      secret:
        secretChoice === "existing" && existingValue.trim()
          ? existingValue.trim()
          : undefined,
    });
  }, [managing, onChange, address, signIn, secretChoice, existingValue]);

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
      setStep(1);
    },
    onError: (error) =>
      showErrorToast(error, "Could not save the Hub address."),
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
      setStep(3);
    },
    onError: (error) =>
      showErrorToast(error, "Could not save the sign-in settings."),
  });

  const addressOk = Boolean(address) && !addressBad;
  const secretOk = managing
    ? secretSet
    : keyReady &&
      (secretChoice === "new" ||
        (existingValue.trim() !== "" && !existingSecretProblem(existingValue)));
  const signInProblem = emailsProblem(signIn.hub_bypass_emails);
  const addressChanged = managing && address !== (hub?.base_url ?? "");
  const signInChanged =
    managing && JSON.stringify(signIn) !== JSON.stringify(settings);
  const ready = [addressOk, secretOk, !signInProblem];

  function next() {
    if (step === 0 && addressChanged) return addressMutation.mutate();
    if (step === 2 && signInChanged) return signInMutation.mutate();
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  return (
    <section className="space-y-5 rounded-2xl border border-(--mws-line) bg-white p-5">
      <ol
        className="flex flex-wrap items-center gap-2"
        aria-label="Hub setup steps"
      >
        {STEPS.map((item, index) => {
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
              {index < STEPS.length - 1 ? (
                <span
                  className="mx-1 h-px w-5 bg-(--mws-line)"
                  aria-hidden="true"
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      {step === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-(--mws-muted)">
            The address people open the Hub at. Every application gets it in its
            .env, so set it first.
          </p>
          <HubAddressField
            value={address}
            onChange={(next, bad) => {
              setAddress(next);
              setAddressBad(Boolean(bad));
            }}
            showError
          />
        </div>
      ) : null}

      {step === 1 ? (
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
                    icon={RotateCw}
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
                    Use the Hub's current secret
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
                  "Make a new secret",
                  "Central makes it when the Hub is added.",
                ],
                [
                  "existing",
                  "Use the secret the Hub runs with now",
                  "Paste it, and nothing that uses it has to change.",
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
                <div>
                  <TextInput
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
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-3">
          <p className="text-sm text-(--mws-muted)">
            How strictly the Hub checks who may sign in. These go into the Hub's
            .env.
          </p>
          <HubAccessSettings value={signIn} onChange={setSignIn} />
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-(--mws-muted)">Address</dt>
            <dd className="font-mono text-xs text-(--mws-charcoal)">
              {address}
            </dd>
            <dt className="text-(--mws-muted)">Secret</dt>
            <dd>
              {managing
                ? secretSet
                  ? "Generated"
                  : "Not generated yet"
                : secretChoice === "existing"
                  ? "The one the Hub runs with now"
                  : "A new one, made when the Hub is added"}
            </dd>
            <dt className="text-(--mws-muted)">Sign-in</dt>
            <dd className="capitalize">
              {signIn.hub_access_mode}
              {signIn.hub_access_mode === "enforce"
                ? `, ${signIn.hub_bypass_emails.length} emergency`
                : ""}
            </dd>
          </dl>
          {managing ? (
            <>
              <ImpactList applicationId={applicationId} />
              <div>
                <TextAction icon={Copy} onClick={() => setDialog("lines")}>
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
          icon={ArrowLeft}
          disabled={step === 0}
          onClick={() => setStep((current) => Math.max(current - 1, 0))}
        >
          Back
        </TextAction>
        <div className="flex gap-2">
          {managing && step === STEPS.length - 1 ? (
            <Button type="button" onClick={onClose}>
              Done
            </Button>
          ) : null}
          {!managing && step === STEPS.length - 1 ? (
            <Button type="submit" data-hub-add="true" loading={submitting}>
              Add Application
            </Button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <Button
              type="button"
              loading={addressMutation.isPending || signInMutation.isPending}
              disabled={!ready[step]}
              onClick={next}
            >
              {(step === 0 && addressChanged) || (step === 2 && signInChanged)
                ? "Save and Continue"
                : "Continue"}
            </Button>
          ) : null}
        </div>
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
