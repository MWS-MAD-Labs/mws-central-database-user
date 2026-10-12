import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, TextInput } from "../../../components/ui/FormControls.jsx";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { existingSecretProblem } from "../utils/hubSettings.js";
import { ConnectDialog } from "./ConnectDialog.jsx";

// Used when the key that keeps the secret encrypted is missing from Central's .env.
export function SecretsKeyWarning() {
  return (
    <div role="note" className="rounded-xl border border-[#d8b45b] bg-[#fff8e8] p-3 text-sm text-[#745716]">
      <p className="font-semibold">Central cannot keep a secret yet.</p>
      <p className="mt-1">
        Add APP_SECRETS_KEY to the .env of Central and restart it. Make the line with <code className="font-mono">bun run secrets:key</code> in the server folder.
      </p>
    </div>
  );
}

const IMPACT_SHOWN = 8;

// The applications a change to the secret reaches, from what is set up now. A long list shows the first few,
// the rest open on request inside a box that scrolls.
export function ImpactList({ applicationId }) {
  const [all, setAll] = useState(false);
  const query = useQuery({
    queryKey: ["application-access", "hub-secret-impact", applicationId],
    queryFn: () => applicationAccessApi.hubSecretImpact(applicationId),
    enabled: Boolean(applicationId),
  });
  if (!applicationId) return <p className="text-sm text-(--mws-muted)">No application signs in through the Hub yet.</p>;
  if (query.isLoading) return <p className="text-sm text-(--mws-muted)">Looking up the applications…</p>;
  const apps = query.data ?? [];
  if (apps.length === 0) return <p className="text-sm text-(--mws-muted)">No application signs in through the Hub yet.</p>;
  const shown = all ? apps : apps.slice(0, IMPACT_SHOWN);
  const hidden = apps.length - shown.length;
  return (
    <div>
      <p className="text-sm font-semibold text-(--mws-charcoal)">
        {apps.length} {apps.length === 1 ? "application takes" : "applications take"} this into their .env
      </p>
      <ul className={`mt-1.5 flex flex-wrap gap-1.5 ${all ? "max-h-40 overflow-y-auto pr-1" : ""}`}>
        {shown.map((app) => (
          <li key={app.application_id} className="rounded-full border border-(--mws-line) bg-(--mws-soft) px-2.5 py-0.5 text-xs text-(--mws-charcoal)">
            {app.name}
          </li>
        ))}
      </ul>
      {apps.some((app) => app.mode === "shared") ? (
        <p className="mt-1.5 text-xs text-(--mws-muted)">
          {apps.filter((app) => app.mode === "shared").length} of them still use the Hub's own secret. The others have a secret of their own, made from it.
        </p>
      ) : null}
      {apps.length > IMPACT_SHOWN ? (
        <button type="button" onClick={() => setAll((current) => !current)} className="mt-1.5 cursor-pointer text-xs font-medium text-(--mws-burgundy) hover:underline">
          {all ? "Show fewer" : `Show all ${apps.length} (${hidden} more)`}
        </button>
      ) : null}
    </div>
  );
}

const COPY = {
  generate: {
    title: "Generate Hub Secret",
    text: "This makes the secret that the Hub and the applications below share. It goes into each of their .env files. Nothing that is running changes until the new value is put there.",
    action: "Generate",
  },
  existing: {
    title: "Use The Hub's Current Secret",
    text: "Open the .env of the Hub and copy the value of HUB_INTERNAL_SECRET. Paste it here and it is kept as the shared one, so nothing that already uses it has to change. It goes into the .env of the applications below from now on.",
    action: "Use This Secret",
  },
  rotate: {
    title: "Rotate Hub Secret",
    text: "The old secret stops working for new .env blocks. The Hub and every application below must get the new value, and until then they cannot call each other.",
    action: "Rotate",
  },
};

// Asks before the shared secret is made, pasted or replaced, and says whom it reaches.
export function SecretConfirmDialog({ kind, applicationId, saving, onConfirm, onClose }) {
  const copy = COPY[kind];
  const [value, setValue] = useState("");
  const problem = kind === "existing" ? existingSecretProblem(value) : null;
  const blocked = kind === "existing" && (!value.trim() || Boolean(problem));
  return (
    <CrudDialog title={copy.title} description={copy.text} onClose={onClose}>
      <div className="space-y-4">
        {kind === "existing" ? (
          <Field label="Secret" error={problem || undefined}>
            <TextInput aria-label="Existing Hub secret" type="password" autoComplete="off" value={value} invalid={Boolean(problem)} onChange={(event) => setValue(event.target.value)} />
          </Field>
        ) : null}
        <ImpactList applicationId={applicationId} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant={kind === "rotate" ? "danger" : undefined} loading={saving} disabled={blocked} onClick={() => onConfirm(kind === "existing" ? value.trim() : undefined)}>
            {copy.action}
          </Button>
        </div>
      </div>
    </CrudDialog>
  );
}

// A secret Central made, shown this once like a token. Only the line is copied, never read out loud.
export function HubSecretShownDialog({ secret, onClose, applicationName = null, nextSteps = null }) {
  const own = Boolean(applicationName);
  return (
    <ConnectDialog
      title={own ? "Hub Secret For This Application" : "Hub Secret"}
      description={
        own
          ? `Put this line in the .env of ${applicationName} and deploy it. Until then it still uses the old value.`
          : "Put this line in the .env of the Hub. The applications get it in their own .env when their token is made or rotated."
      }
      onceLabel="Secret Shown Once"
      nextSteps={nextSteps}
      connection={{
        env: [
          {
            key: "HUB_INTERNAL_SECRET",
            value: secret,
            secret: true,
            group: 0,
            line: `HUB_INTERNAL_SECRET="${secret}"`,
            heading: own
              ? "From the Hub, for this application only. Changes when this application's Hub secret is rotated, or when the Hub secret is."
              : "The Hub's master secret. Never copy it into another application. Changes only when it is rotated here.",
          },
        ],
      }}
      onClose={onClose}
    />
  );
}
