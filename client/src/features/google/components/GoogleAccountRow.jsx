import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, KeyRound, Link2, Mail, MessageSquareText, Pause, Play, RefreshCw, UserPlus } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, TextInput } from "../../../components/ui/FormControls.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { emailProblem, sanitizeEmail, textLength } from "../../../lib/form.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { googleAccountApi } from "../api/googleAccountApi.js";
import { recoveryEmailProblem, recoveryHint } from "../utils/instructions.js";
import { GoogleInstructionsDialog } from "./GoogleInstructionsDialog.jsx";

const BADGES = {
  ACTIVE: { tone: "green", label: "Linked" },
  PENDING: { tone: "amber", label: "Being made" },
  FAILED: { tone: "red", label: "Failed" },
  NONE: { tone: "neutral", label: "Not created" },
  SUSPENDED: { tone: "amber", label: "Suspended" },
  MISSING: { tone: "red", label: "Not in Google" },
  IN_GOOGLE: { tone: "amber", label: "In Google" },
};

// How the badge reads for a person with no link, by what the lookup in Google came back with.
const LOOKUP_BADGES = {
  found: BADGES.IN_GOOGLE,
  simulated: { tone: "neutral", label: "Not Checked" },
  blocked: { tone: "neutral", label: "Not Checked" },
  failed: { tone: "neutral", label: "Not Checked" },
  admin: { tone: "neutral", label: "Workspace Admin" },
};

function lookupLine(lookup) {
  if (!lookup) return null;
  if (lookup.state === "found") return "Not linked to this person yet.";
  if (lookup.state === "absent") return "No Google account for this email yet.";
  return lookup.message ? `${lookup.message}.` : null;
}

const formatDay = (value) =>
  new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// Google keeps a deleted account for 20 days. Counts down from the day it reports.
function restoreNote(status) {
  if (!status.restorable_until) return "Can be restored for about 20 days.";
  const left = Math.ceil((new Date(status.restorable_until).getTime() - Date.now()) / 86_400_000);
  if (left <= 0) return "The restore period ends today.";
  return `Can be restored for ${left} more ${left === 1 ? "day" : "days"}, until ${formatDay(status.restorable_until)}.`;
}

// The password line of an account that is linked: whether the person has set their own yet.
function passwordNote(status) {
  if (status.status !== "ACTIVE") return null;
  if (status.password_state === "SET") {
    return { text: status.last_login_at ? `Signed in, last on ${formatDay(status.last_login_at)}` : "Password set", tone: "muted" };
  }
  if (status.password_state === "OVERDUE") {
    return { text: "Password not set yet. Send the sign-in instructions again, or reset the password.", tone: "warn" };
  }
  if (status.password_state === "PENDING") return { text: "Waiting for the first sign-in", tone: "muted" };
  return null;
}

// The Google account of a person: whether it exists, and for a Super Admin the two things that can be done to it.
export function GoogleAccountRow({ resource, id, email }) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState(null);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [password, setPassword] = useState(null);
  const queryKey = ["google-account", resource, id];
  // Needed for the person to get in: Google sends the reset code there.
  const recoveryProblem = !recoveryEmail.trim()
    ? "Recovery email is required."
    : recoveryEmailProblem(recoveryEmail, email, emailProblem);
  const domain = (email || "").split("@")[1] || "";
  const statusQuery = useQuery({ queryKey, queryFn: () => googleAccountApi.status(resource, id) });
  const status = statusQuery.data;

  const refresh = useMutation({
    mutationFn: () => googleAccountApi.status(resource, id, { refresh: true }),
    onSuccess: (result) => queryClient.setQueryData(queryKey, result),
    onError: (error) => showErrorToast(error, "Could not check Google."),
  });

  const provision = useMutation({
    mutationFn: (payload) => googleAccountApi.provision(resource, id, payload),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey });
      setDialog(null);
      setRecoveryEmail("");
      if (result.status === "ACTIVE") showSuccessToast(result.outcome === "linked" ? "Linked to the existing Google account." : "Google account created.");
      else showErrorToast(new Error(result.message), "Google account was not created.");
    },
    onError: (error) => showErrorToast(error, "Google account was not created."),
  });

  const reset = useMutation({
    mutationFn: () => googleAccountApi.resetPassword(resource, id),
    onSuccess: (result) => {
      setDialog("result");
      setPassword(result.password);
    },
    onError: (error) => showErrorToast(error, "Password was not reset."),
  });

  // Read from Google only while one of the two dialogs that show it is open.
  const recoveryQuery = useQuery({
    queryKey: ["google-recovery-email", resource, id],
    queryFn: () => googleAccountApi.recoveryEmail(resource, id),
    enabled: Boolean(status?.can?.manage) && (dialog === "instructions" || dialog === "recovery"),
    staleTime: 0,
    gcTime: 0,
  });
  const currentRecovery = recoveryQuery.data?.recovery_email ?? "";

  const changeRecovery = useMutation({
    mutationFn: () => googleAccountApi.changeRecoveryEmail(resource, id, recoveryEmail.trim()),
    onSuccess: () => {
      setDialog(null);
      setRecoveryEmail("");
      showSuccessToast("Recovery email changed.");
    },
    onError: (error) => showErrorToast(error, "Recovery email was not changed."),
  });

  // For a person with no link: look again, and say what came back, since the answer often stays the same.
  const recheck = useMutation({
    mutationFn: () => googleAccountApi.status(resource, id),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
      const state = result.lookup?.state;
      if (state === "found") showSuccessToast("Checked. The account is in Google.");
      else if (state === "absent") showSuccessToast("Checked. No Google account for this email yet.");
      else showErrorToast(new Error(result.lookup?.message || "Could not check Google."), "Google was not checked.");
    },
    onError: (error) => showErrorToast(error, "Could not check Google."),
  });

  const restore = useMutation({
    mutationFn: () => googleAccountApi.restore(resource, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setDialog(null);
      showSuccessToast("Google account restored.");
    },
    onError: (error) => showErrorToast(error, "Google account was not restored."),
  });

  const suspend = useMutation({
    mutationFn: (suspended) => googleAccountApi.setSuspended(resource, id, suspended),
    onSuccess: (_, suspended) => {
      queryClient.invalidateQueries({ queryKey });
      setDialog(null);
      showSuccessToast(suspended ? "Google account suspended." : "Google account unsuspended.");
    },
    onError: (error) => showErrorToast(error, "Could not change the Google account."),
  });

  function closeResult() {
    setPassword(null);
    setDialog(null);
  }

  if (!status) return null;
  const deleted = status.status === "MISSING" && Boolean(status.last_error?.startsWith("Deleted"));
  const can = status.can ?? {};
  // For a person with no link: what Central could find out about the email in Google. Not asking is not "not there".
  const lookup = status.linked ? null : (status.lookup ?? { state: status.in_google ? "found" : "absent", message: null });
  const lookupState = lookup?.state ?? null;
  // The account is deleted or gone in Google, so there is nothing to change until it is restored.
  const gone = status.status === "MISSING";
  const badge = deleted
    ? { tone: "red", label: "Deleted in Google" }
    : lookupState && lookupState !== "absent"
      ? (LOOKUP_BADGES[lookupState] ?? BADGES.NONE)
      : (BADGES[status.status] ?? BADGES.NONE);
  const lookupNote = lookupLine(lookup);
  // These answers do not depend on asking again, so the button is off instead of doing nothing.
  const noNewAnswer = lookupState === "blocked" || lookupState === "simulated" || lookupState === "admin";
  const locked = Boolean(status.locked);
  const note = passwordNote(status);
  const overdue = status.password_state === "OVERDUE" && status.status === "ACTIVE";

  return (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid="google-account-row">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-(--mws-muted)">
        <span>Google account</span>
        <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
        {status.mode === "simulated" ? (
          <span className="text-xs" title="This environment does not talk to the real Google Workspace">
            Simulated
          </span>
        ) : null}
        {overdue ? <StatusBadge tone="amber">Password not set</StatusBadge> : null}
        {lookupNote ? <span className="w-full text-xs">{lookupNote}</span> : null}
        {status.status === "FAILED" && status.last_error ? (
          <span className="w-full text-xs text-[#a43c41]">{status.last_error}</span>
        ) : null}
        {status.status === "SUSPENDED" && status.last_error?.startsWith("Suspended in Google after") ? (
          <span className="w-full text-xs text-[#8a6419]">Locked because the person left ({status.last_error.replace("Suspended in Google after ", "")}).</span>
        ) : null}
        {locked && status.status === "ACTIVE" ? (
          <span className="w-full text-xs text-[#8a6419]">The person has left, but the Google account is still active. Suspend it.</span>
        ) : null}
        {deleted ? (
          <span className="w-full text-xs text-[#a43c41]">
            {restoreNote(status)} {can.manage ? "Use Restore, then check again." : "Ask a Super Admin to restore it."}
          </span>
        ) : null}
        {note ? (
          <span className={`w-full text-xs ${note.tone === "warn" ? "text-[#8a6419]" : ""}`} data-testid="google-password-note">
            {note.text}
          </span>
        ) : null}
      </div>
      {can.create || can.manage || can.takeover ? (
        <div className="flex gap-1">
          {can.create && status.linked && email && !locked ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Sign-in instructions"
              title="Sign-in instructions"
              onClick={() => setDialog("instructions")}
            >
              <MessageSquareText size={15} />
            </Button>
          ) : null}
          {can.manage && deleted ? (
            <Button type="button" variant="ghost" size="icon" aria-label="Restore Google account" title="Restore Google account" onClick={() => setDialog("restore")}>
              <ArchiveRestore size={15} />
            </Button>
          ) : null}
          {can.manage && status.status === "ACTIVE" ? (
            <Button type="button" variant="ghost" size="icon" aria-label="Suspend Google account" title="Suspend Google account" onClick={() => setDialog("suspend")}>
              <Pause size={15} />
            </Button>
          ) : null}
          {can.manage && status.status === "SUSPENDED" && !locked ? (
            <Button type="button" variant="ghost" size="icon" aria-label="Unsuspend Google account" title="Unsuspend Google account" onClick={() => setDialog("unsuspend")}>
              <Play size={15} />
            </Button>
          ) : null}
          {can.manage && status.linked ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Check Google again"
              title="Check Google again"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              <RefreshCw size={15} />
            </Button>
          ) : null}
          {can.takeover && status.linked && !locked ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Change recovery email"
              title={gone ? "Restore the account first." : "Change recovery email"}
              disabled={gone}
              onClick={() => {
                setRecoveryEmail("");
                setDialog("recovery");
              }}
            >
              <Mail size={15} />
            </Button>
          ) : null}
          {can.takeover && status.linked && !locked ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Make temporary password"
              title={gone ? "Restore the account first." : "Make temporary password"}
              disabled={gone}
              onClick={() => setDialog("confirm")}
            >
              <KeyRound size={15} />
            </Button>
          ) : null}
          {can.create && !status.linked ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Check Google"
              title={noNewAnswer ? `Asking again would not change anything. ${lookup.message ?? ""}`.trim() : "Check Google"}
              disabled={noNewAnswer || recheck.isPending}
              onClick={() => recheck.mutate()}
            >
              <RefreshCw size={15} />
            </Button>
          ) : null}
          {can.create && !status.linked && !locked && lookupState === "found" ? (
            <Button type="button" variant="ghost" size="icon" aria-label="Link Google account" title="Link Google account" onClick={() => setDialog("link")}>
              <Link2 size={15} />
            </Button>
          ) : null}
          {can.create && !status.linked && !locked && (lookupState === "absent" || lookupState === "simulated" || lookupState === "blocked") ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Create Google account"
              title={lookupState === "blocked" ? (lookup.message ?? "Not available here") : "Create Google account"}
              disabled={lookupState === "blocked"}
              onClick={() => setDialog("create")}
            >
              <UserPlus size={15} />
            </Button>
          ) : null}
        </div>
      ) : null}

      {dialog === "create" ? (
        <CrudDialog
          title="Create Google Account"
          description="The account uses the email of this person. Nobody knows its password: they set it with Forgot password. The recovery email is only needed to make a new account, not to look for one."
          panelClassName="max-w-lg"
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                loading={provision.isPending}
                disabled={Boolean(recoveryProblem)}
                onClick={() => provision.mutate({ recovery_email: recoveryEmail.trim() })}
              >
                Create
              </Button>
            </>
          }
        >
          <Field
            label="Recovery Email"
            required
            counter={{ value: recoveryEmail, max: 100, count: textLength }}
            error={recoveryEmail.trim() ? recoveryProblem || undefined : undefined}
            hint={recoveryHint(recoveryEmail, recoveryProblem, domain)}
          >
            <TextInput
              type="email"
              maxLength={100}
              value={recoveryEmail}
              invalid={Boolean(recoveryEmail.trim() && recoveryProblem)}
              placeholder="name@gmail.com"
              onChange={(event) => setRecoveryEmail(sanitizeEmail(event.target.value))}
            />
          </Field>
        </CrudDialog>
      ) : null}

      {dialog === "link" ? (
        <CrudDialog
          title="Link Google Account"
          description="This email already has an account in Google. Linking connects it to this person and changes nothing in Google."
          panelClassName="max-w-lg"
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="button" loading={provision.isPending} onClick={() => provision.mutate({})}>
                Link
              </Button>
            </>
          }
        >
          <p className="text-sm text-(--mws-muted)">{email}</p>
        </CrudDialog>
      ) : null}

      {dialog === "instructions" ? (
        <GoogleInstructionsDialog
          title="Sign-in Instructions"
          email={email}
          maskedRecovery={currentRecovery}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog === "recovery" ? (
        <CrudDialog
          title="Change Recovery Email"
          description="Google sends the reset code here. The address goes to Google only and is not kept in Central."
          panelClassName="max-w-lg"
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="button" loading={changeRecovery.isPending} disabled={Boolean(recoveryProblem)} onClick={() => changeRecovery.mutate()}>
                Change
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-(--mws-muted)">
              {recoveryQuery.isPending ? "Reading from Google..." : currentRecovery ? `Now: ${currentRecovery}` : "No recovery email is set."}
            </p>
            <Field
              label="New Recovery Email"
              required
              counter={{ value: recoveryEmail, max: 100, count: textLength }}
              error={recoveryEmail.trim() ? recoveryProblem || undefined : undefined}
              hint={recoveryHint(recoveryEmail, recoveryProblem, domain)}
            >
              <TextInput
                type="email"
                maxLength={100}
                value={recoveryEmail}
                invalid={Boolean(recoveryEmail.trim() && recoveryProblem)}
                placeholder="name@gmail.com"
                onChange={(event) => setRecoveryEmail(sanitizeEmail(event.target.value))}
              />
            </Field>
          </div>
        </CrudDialog>
      ) : null}

      {dialog === "restore" ? (
        <CrudDialog
          title="Restore Google Account"
          description="Brings back this person's own account with its mail and files, as they were when it was deleted."
          panelClassName="max-w-lg"
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="button" loading={restore.isPending} onClick={() => restore.mutate()}>
                Restore
              </Button>
            </>
          }
        >
          <p className="text-sm text-(--mws-muted)">{restoreNote(status)}</p>
        </CrudDialog>
      ) : null}

      {dialog === "suspend" || dialog === "unsuspend" ? (
        <CrudDialog
          title={dialog === "suspend" ? "Suspend Google Account" : "Unsuspend Google Account"}
          description={
            dialog === "suspend"
              ? "The person cannot sign in to Google until it is unsuspended. Nothing is deleted."
              : "The person can sign in to Google again."
          }
          panelClassName="max-w-lg"
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="button" loading={suspend.isPending} onClick={() => suspend.mutate(dialog === "suspend")}>
                {dialog === "suspend" ? "Suspend" : "Unsuspend"}
              </Button>
            </>
          }
        >
          <p className="text-sm text-(--mws-muted)">{email}</p>
        </CrudDialog>
      ) : null}

      {dialog === "confirm" ? (
        <CrudDialog
          title="Make Temporary Password"
          description="A temporary password is made and shown once. The person must change it at their next sign in."
          panelClassName="max-w-lg"
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="button" loading={reset.isPending} onClick={() => reset.mutate()}>
                Make
              </Button>
            </>
          }
        >
          <p className="text-sm text-(--mws-muted)">The current password stops working straight away.</p>
        </CrudDialog>
      ) : null}

      {dialog === "result" && password ? (
        <CrudDialog
          title="Temporary Password"
          description="Shown once. Copy it now and hand it over safely."
          panelClassName="max-w-md"
          onClose={closeResult}
          footer={
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigator.clipboard?.writeText(password).then(() => showSuccessToast("Copied."))}
              >
                Copy
              </Button>
              <Button type="button" onClick={closeResult}>
                Close
              </Button>
            </>
          }
        >
          <code className="block select-all break-all rounded-xl bg-(--mws-soft) px-4 py-3 text-center text-lg font-semibold tracking-wider">
            {password}
          </code>
        </CrudDialog>
      ) : null}
    </div>
  );
}
