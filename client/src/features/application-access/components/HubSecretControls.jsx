import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, TextInput } from "../../../components/ui/FormControls.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { copyText } from "../utils/copyText.js";

// The secret the Hub shares with the applications. It is made here, kept encrypted, and shown only when asked for.
export function HubSecretControls({ applicationId, secretSet }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [showing, setShowing] = useState(false);
  const [existing, setExisting] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["application-access", "setup", applicationId] });

  const make = useMutation({
    mutationFn: (secret) => applicationAccessApi.setHubSecret(applicationId, secret),
    onSuccess: () => {
      refresh();
      setExisting(false);
      showSuccessToast("Hub secret saved.");
    },
    onError: (error) => showErrorToast(error, "Could not save the Hub secret."),
  });

  async function rotate() {
    const confirmed = await confirm({
      title: "Rotate Hub Secret",
      description: "Every application that uses the Hub secret has to get the new value in its .env, and so does the Hub. Until then they cannot call each other.",
      confirmLabel: "Rotate",
      tone: "danger",
    });
    if (confirmed) make.mutate(undefined);
  }

  return (
    <Field label="Hub Secret" hint="Shared by the Hub and every application so they can call each other. It goes into each .env for you.">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={secretSet ? "green" : "amber"}>{secretSet ? "Generated" : "Not generated yet"}</StatusBadge>
        {secretSet ? (
          <>
            <Button type="button" size="sm" variant="secondary" onClick={() => setShowing(true)}>
              Show Secret
            </Button>
            <Button type="button" size="sm" variant="secondary" loading={make.isPending} onClick={rotate}>
              Rotate Secret
            </Button>
          </>
        ) : (
          <>
            <Button type="button" size="sm" loading={make.isPending} onClick={() => make.mutate(undefined)}>
              Generate Secret
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setExisting(true)}>
              Use The Hub's Current One
            </Button>
          </>
        )}
      </div>
      {showing ? <ShowSecretDialog applicationId={applicationId} onClose={() => setShowing(false)} /> : null}
      {existing ? (
        <ExistingSecretDialog saving={make.isPending} onSave={(value) => make.mutate(value)} onClose={() => setExisting(false)} />
      ) : null}
    </Field>
  );
}

function ShowSecretDialog({ applicationId, onClose }) {
  const [secret, setSecret] = useState(null);
  const reveal = useMutation({
    mutationFn: () => applicationAccessApi.revealHubSecret(applicationId),
    onSuccess: setSecret,
    onError: (error) => showErrorToast(error, "Could not read the Hub secret."),
  });
  return (
    <CrudDialog title="Hub Secret" description="Put it as HUB_INTERNAL_SECRET in the .env of the Hub and of each application. Looking at it is written to the audit log." onClose={onClose}>
      <div className="space-y-4">
        <pre className="overflow-x-auto rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3 font-mono text-xs break-all whitespace-pre-wrap text-(--mws-charcoal)">
          {secret ? `HUB_INTERNAL_SECRET="${secret}"` : "Hidden. Press Reveal to read it."}
        </pre>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          {secret ? (
            <Button type="button" onClick={() => copyText(`HUB_INTERNAL_SECRET="${secret}"`)}>
              Copy Line
            </Button>
          ) : (
            <Button type="button" loading={reveal.isPending} onClick={() => reveal.mutate()}>
              Reveal
            </Button>
          )}
        </div>
      </div>
    </CrudDialog>
  );
}

function ExistingSecretDialog({ saving, onSave, onClose }) {
  const [value, setValue] = useState("");
  const clean = value.trim();
  const problem = clean && (clean.length < 16 ? "At least 16 characters." : /\s/.test(clean) ? "No spaces." : null);
  return (
    <CrudDialog title="Use The Hub's Current Secret" description="Paste the HUB_INTERNAL_SECRET the Hub runs with now, so nothing that uses it has to change." onClose={onClose}>
      <div className="space-y-4">
        <Field label="Secret" error={problem || undefined}>
          <TextInput aria-label="Existing Hub secret" type="password" autoComplete="off" value={value} invalid={Boolean(problem)} onChange={(event) => setValue(event.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" loading={saving} disabled={!clean || Boolean(problem)} onClick={() => onSave(clean)}>
            Save
          </Button>
        </div>
      </div>
    </CrudDialog>
  );
}
