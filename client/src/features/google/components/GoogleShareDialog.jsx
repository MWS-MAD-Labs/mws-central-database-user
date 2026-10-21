import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, TextAreaInput, TextInput } from "../../../components/ui/FormControls.jsx";
import { Tabs } from "../../../components/ui/Tabs.jsx";
import { TextAction } from "../../../components/ui/TextAction.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { googleAccountApi } from "../api/googleAccountApi.js";
import { INSTRUCTION_LANGUAGES, signInMessage } from "../utils/instructions.js";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The first sign-in details of a new account: the temporary password, shown once, and a message ready to paste into
// WhatsApp (editable first) or to be mailed by the server. The password is not kept anywhere once this closes.
export function GoogleShareDialog({ resource, id, name, email, password, defaultTo = "", title = "Share Sign-in Details", onClose }) {
  const confirm = useConfirm();
  const [language, setLanguage] = useState("id");
  const [message, setMessage] = useState(() => signInMessage({ name, email, password, language: "id" }));
  const [revealed, setRevealed] = useState(false);
  const [to, setTo] = useState(defaultTo);
  const [mailing, setMailing] = useState(false);
  const [shared, setShared] = useState(false);

  const statusQuery = useQuery({ queryKey: ["google-account", resource, id], queryFn: () => googleAccountApi.status(resource, id) });
  const emailEnabled = statusQuery.data?.email_enabled !== false;
  const toProblem = to.trim() && !EMAIL_SHAPE.test(to.trim()) ? "Enter a full email address." : null;

  const send = useMutation({
    mutationFn: () => googleAccountApi.sendSignIn(resource, id, { to: to.trim(), language, password }),
    onSuccess: () => {
      setShared(true);
      setMailing(false);
      showSuccessToast("Email sent.");
    },
    onError: (error) => showErrorToast(error, "The email was not sent."),
  });

  function changeLanguage(next) {
    setLanguage(next);
    setMessage(signInMessage({ name, email, password, language: next }));
  }

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

  return (
    <CrudDialog
      title={title}
      description="The password is shown once and is not kept. The person must change it at their first sign in."
      panelClassName="max-w-xl"
      onClose={done}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => setMailing((open) => !open)} disabled={!emailEnabled} title={emailEnabled ? undefined : "Email is not set up on this server."}>
            Send Email
          </Button>
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
              {revealed ? password : "•".repeat(password.length)}
            </code>
          </div>
          <TextAction onClick={() => setRevealed((value) => !value)}>{revealed ? "Hide" : "Show"}</TextAction>
        </div>
        <Tabs label="Language" tabs={INSTRUCTION_LANGUAGES} active={language} onChange={changeLanguage} />
        <Field label="Message" hint="You can edit this before copying. The email sent by the server has the same words.">
          <TextAreaInput aria-label="Message" rows={13} value={message} onChange={(event) => setMessage(event.target.value)} />
        </Field>
        {mailing ? (
          <Field label="Send To" hint="Usually the recovery email. Central does not keep it, so type it again." error={toProblem ?? undefined}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <TextInput aria-label="Send to" type="email" value={to} invalid={Boolean(toProblem)} onChange={(event) => setTo(event.target.value)} />
              </div>
              <Button type="button" loading={send.isPending} disabled={!to.trim() || Boolean(toProblem)} onClick={() => send.mutate()}>
                Send
              </Button>
            </div>
          </Field>
        ) : null}
      </div>
    </CrudDialog>
  );
}
