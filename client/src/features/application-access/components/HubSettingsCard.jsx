import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { TextAction } from "../../../components/ui/TextAction.jsx";
import { HubSetupWizard } from "./HubSetupWizard.jsx";
import { SignInLinesDialog } from "./SignInLinesDialog.jsx";

const MODE_LABEL = { warn: "Warn", enforce: "Enforce", off: "Off" };

// The Hub's address, its shared secret and how it checks sign-in, on its setup page. What an application needs from the
// Hub comes from here, so the steps depend on each other and sit in one wizard.
export function HubSettingsCard({ settings, hub, applicationId }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState(false);
  const complete = Boolean(hub?.base_url) && Boolean(hub?.secret_set);

  if (open) {
    return <HubSetupWizard mode="manage" applicationId={applicationId} hub={hub} settings={settings} onClose={() => setOpen(false)} />;
  }

  return (
    <section className="space-y-4 rounded-2xl border border-(--mws-line) bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-(--mws-charcoal)">Hub Sign-in</h2>
          <p className="text-sm text-(--mws-muted)">The Hub's address, the secret it shares with the applications, and how strictly it checks who may sign in.</p>
        </div>
        {complete ? (
          <TextAction onClick={() => setOpen(true)}>
            Open Setup Wizard
          </TextAction>
        ) : (
          <Button type="button" onClick={() => setOpen(true)}>
            Finish Setup
          </Button>
        )}
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-(--mws-muted)">Address</dt>
        <dd className={hub?.base_url ? "font-mono text-xs text-(--mws-charcoal)" : "text-sm italic text-(--mws-muted)"}>{hub?.base_url || "Not set"}</dd>
        <dt className="text-(--mws-muted)">Secret</dt>
        <dd className={hub?.secret_set ? "text-sm font-medium text-(--mws-charcoal)" : "text-sm italic text-(--mws-muted)"}>
          {hub?.secret_set ? "Generated" : "Not generated yet"}
        </dd>
        <dt className="text-(--mws-muted)">Sign-in</dt>
        <dd>
          {MODE_LABEL[settings.hub_access_mode]}
        </dd>
        <dt className="text-(--mws-muted)">Emergency Admins</dt>
        <dd>{settings.hub_bypass_emails.length === 0 ? "None" : settings.hub_bypass_emails.length}</dd>
      </dl>
      <div className="flex justify-end">
        <TextAction onClick={() => setLines(true)}>
          Copy Sign-in Lines
        </TextAction>
      </div>
      {lines ? <SignInLinesDialog applicationId={applicationId} settings={settings} onClose={() => setLines(false)} /> : null}
    </section>
  );
}
