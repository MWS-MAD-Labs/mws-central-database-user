import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, TextAreaInput, TextInput } from "../../../components/ui/FormControls.jsx";
import { Tabs } from "../../../components/ui/Tabs.jsx";
import { TextAction } from "../../../components/ui/TextAction.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { emailProblem, sanitizeEmail } from "../../../lib/form.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { googleAccountApi } from "../api/googleAccountApi.js";
import { CooldownButton } from "./CooldownButton.jsx";
import { INSTRUCTION_LANGUAGES, recoveryEmailProblem, signInMessage } from "../utils/instructions.js";

const MASK = "•".repeat(16);

// The first sign-in details of a new account: the temporary password, shown once, and a message ready to paste into
// WhatsApp (editable first) or to be mailed by the server. The password is not kept anywhere once this closes.
export function GoogleShareDialog({ resource, id, name, email, password, title = "Share Sign-in Details", onClose }) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [language, setLanguage] = useState("id");
  const [message, setMessage] = useState(() => signInMessage({ name, email, password, language: "id" }));
  const [revealed, setRevealed] = useState(false);
  // "recovery": the recovery email Google holds, which the server reads. "other": an address typed here.
  const [target, setTarget] = useState(null);
  const [typed, setTyped] = useState("");
  const [adding, setAdding] = useState(false);
  const [shared, setShared] = useState(false);

  const statusKey = ["google-account", resource, id];
  const statusQuery = useQuery({ queryKey: statusKey, queryFn: () => googleAccountApi.status(resource, id) });
  const hintKey = ["google-recovery-hint", resource, id];
  const hintQuery = useQuery({ queryKey: hintKey, queryFn: () => googleAccountApi.recoveryHint(resource, id), retry: false, staleTime: 0 });
  const emailEnabled = statusQuery.data?.email_enabled !== false;
  const hint = hintQuery.data?.hint ?? null;
  const hasRecovery = Boolean(hint);
  const sendTo = target ?? (hasRecovery ? "recovery" : "other");
  const typedProblem = typed.trim() ? recoveryEmailProblem(typed, email, emailProblem) : null;
  const canAddRecovery = statusQuery.data?.can?.create !== false;

  const send = useMutation({
    mutationFn: () =>
      googleAccountApi.sendSignIn(resource, id, {
        language,
        password,
        ...(sendTo === "other" ? { to: typed.trim() } : {}),
      }),
    onSuccess: () => {
      setShared(true);
      queryClient.invalidateQueries({ queryKey: statusKey });
      showSuccessToast("Email sent.");
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: statusKey });
      showErrorToast(error, "The email was not sent.");
    },
  });

  const addRecovery = useMutation({
    mutationFn: () => googleAccountApi.changeRecoveryEmail(resource, id, typed.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hintKey });
      setAdding(false);
      setTyped("");
      setTarget("recovery");
      showSuccessToast("Recovery email added.");
    },
    onError: (error) => showErrorToast(error, "Recovery email was not added."),
  });

  function changeLanguage(next) {
    setLanguage(next);
    setMessage(signInMessage({ name, email, password, language: next }));
  }

  // While the password is hidden the message shows dots in its place and cannot be edited, so the password is not on
  // the screen anywhere. Copying always takes the real text.
  const shown = revealed ? message : message.split(password).join(MASK);

  const copy = () =>
    navigator.clipboard?.writeText(message).then(() => {
      setShared(true);
      showSuccessToast("Message copied.");
    });

  async function done() {
    if (!shared) {
      const leave = await confirm({
        title: "Close Without Sharing",
        description: "The password is not shown again. Copy the message or send the email first, or make a new temporary password later.",
        confirmLabel: "Close Anyway",
      });
      if (!leave) return;
    }
    onClose();
  }

  const sendDisabled = !emailEnabled || (sendTo === "recovery" ? !hasRecovery : !typed.trim() || Boolean(typedProblem));

  return (
    <CrudDialog
      title={title}
      description="The password is shown once and is not kept. The person must change it at their first sign in."
      panelClassName="max-w-xl"
      onClose={done}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={copy}>
            Copy Message
          </Button>
          <Button type="button" onClick={done}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-(--mws-soft) px-4 py-3 text-sm">
          <div className="min-w-0">
            <p className="text-(--mws-muted)">Temporary password</p>
            <code className="block select-all break-all text-base font-semibold tracking-wider text-(--mws-charcoal)" data-testid="google-temporary-password">
              {revealed ? password : MASK}
            </code>
          </div>
          <TextAction onClick={() => setRevealed((value) => !value)}>{revealed ? "Hide" : "Show"}</TextAction>
        </div>
        <Tabs label="Language" tabs={INSTRUCTION_LANGUAGES} active={language} onChange={changeLanguage} />
        <Field label="Message" hint={revealed ? "You can edit this before copying. The email sent by the server has the same words." : "Press Show to edit the message."}>
          <TextAreaInput aria-label="Message" rows={13} value={shown} readOnly={!revealed} onChange={(event) => setMessage(event.target.value)} />
        </Field>

        <div className="space-y-2 rounded-xl border border-(--mws-line) px-4 py-3 text-sm">
          <p className="font-semibold text-(--mws-charcoal)">Send By Email</p>
          {hintQuery.isPending ? (
            <p className="text-(--mws-muted)">Reading the recovery email from Google...</p>
          ) : hasRecovery && sendTo === "recovery" ? (
            <p className="text-(--mws-charcoal)">
              To the recovery email <span className="font-semibold">{hint}</span>.{" "}
              <TextAction onClick={() => setTarget("other")}>Use Another Address</TextAction>
            </p>
          ) : (
            <div className="space-y-2">
              {!hasRecovery ? (
                <p className="text-(--mws-muted)">
                  This account has no recovery email.{" "}
                  {canAddRecovery && !adding ? <TextAction onClick={() => setAdding(true)}>Add Recovery Email</TextAction> : null}
                </p>
              ) : (
                <TextAction onClick={() => setTarget("recovery")}>{`Use the recovery email ${hint}`}</TextAction>
              )}
              <Field
                label={adding ? "Recovery Email" : "Send To"}
                error={typed.trim() ? typedProblem ?? undefined : undefined}
                hint={adding ? "Google sends the reset code here too. It goes to Google only." : undefined}
              >
                <TextInput
                  aria-label={adding ? "Recovery email" : "Send to"}
                  type="email"
                  maxLength={100}
                  value={typed}
                  invalid={Boolean(typed.trim() && typedProblem)}
                  placeholder="name@gmail.com"
                  onChange={(event) => setTyped(sanitizeEmail(event.target.value))}
                />
              </Field>
              {adding ? (
                <Button type="button" variant="secondary" loading={addRecovery.isPending} disabled={!typed.trim() || Boolean(typedProblem)} onClick={() => addRecovery.mutate()}>
                  Add
                </Button>
              ) : null}
            </div>
          )}
          {!adding ? (
            <div className="flex justify-end">
              <CooldownButton
                until={statusQuery.data?.email_available_at}
                total={statusQuery.data?.cooldowns?.email}
                waitText="to send again"
                type="button"
                variant="secondary"
                loading={send.isPending}
                disabled={sendDisabled}
                title={emailEnabled ? undefined : "Email is not set up on this server."}
                onClick={() => send.mutate()}
              >
                Send Email
              </CooldownButton>
            </div>
          ) : null}
        </div>
      </div>
    </CrudDialog>
  );
}
