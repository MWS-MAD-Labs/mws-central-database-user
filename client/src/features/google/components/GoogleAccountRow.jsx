import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, UserPlus } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, TextInput } from "../../../components/ui/FormControls.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { emailProblem, sanitizeEmail } from "../../../lib/form.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { googleAccountApi } from "../api/googleAccountApi.js";

const BADGES = {
  ACTIVE: { tone: "green", label: "Linked" },
  PENDING: { tone: "amber", label: "Being made" },
  FAILED: { tone: "red", label: "Failed" },
  NONE: { tone: "neutral", label: "Not created" },
};

// The Google account of a person: whether it exists, and for a Super Admin the two things that can be done to it.
export function GoogleAccountRow({ resource, id, canManage }) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState(null);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [password, setPassword] = useState(null);
  const queryKey = ["google-account", resource, id];
  // Needed for the person to get in: Google sends the reset code there.
  const recoveryProblem = !recoveryEmail.trim()
    ? "Recovery email is required."
    : emailProblem(recoveryEmail) || (recoveryEmail.trim().toLowerCase().endsWith("@millennia21.id") ? "Use a personal address, not an organization address." : null);
  const statusQuery = useQuery({ queryKey, queryFn: () => googleAccountApi.status(resource, id) });
  const status = statusQuery.data;

  const provision = useMutation({
    mutationFn: () => googleAccountApi.provision(resource, id, { recovery_email: recoveryEmail.trim() }),
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

  function closeResult() {
    setPassword(null);
    setDialog(null);
  }

  if (!status) return null;
  const badge = BADGES[status.status] ?? BADGES.NONE;

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
        {status.status === "FAILED" && status.last_error ? (
          <span className="w-full text-xs text-[#a43c41]">{status.last_error}</span>
        ) : null}
      </div>
      {canManage ? (
        <div className="flex gap-1">
          {status.linked ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Reset Google password"
              title="Reset Google password"
              onClick={() => setDialog("confirm")}
            >
              <KeyRound size={15} />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Create Google account"
              title="Create Google account"
              onClick={() => setDialog("create")}
            >
              <UserPlus size={15} />
            </Button>
          )}
        </div>
      ) : null}

      {dialog === "create" ? (
        <CrudDialog
          title="Create Google Account"
          description="The account uses the email of this person. Nobody knows its password: they set it with Forgot password."
          panelClassName="max-w-lg"
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="button" loading={provision.isPending} disabled={Boolean(recoveryProblem)} onClick={() => provision.mutate()}>
                Create
              </Button>
            </>
          }
        >
          <Field
            label="Recovery Email"
            required
            error={recoveryEmail.trim() ? recoveryProblem || undefined : undefined}
            hint="A personal address. Google sends the reset code there. It is not kept here."
          >
            <TextInput
              type="email"
              value={recoveryEmail}
              invalid={Boolean(recoveryEmail.trim() && recoveryProblem)}
              placeholder="name@gmail.com"
              onChange={(event) => setRecoveryEmail(sanitizeEmail(event.target.value))}
            />
          </Field>
        </CrudDialog>
      ) : null}

      {dialog === "confirm" ? (
        <CrudDialog
          title="Reset Google Password"
          description="A new temporary password is made and shown once. The person must change it at their next sign in."
          panelClassName="max-w-lg"
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="button" loading={reset.isPending} onClick={() => reset.mutate()}>
                Reset
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
