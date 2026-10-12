import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { emailsProblem } from "../utils/hubSettings.js";
import { HubAccessSettings } from "./HubAccessSettings.jsx";
import { SignInLinesDialog } from "./SignInLinesDialog.jsx";

// The Hub's sign-in settings on its setup page. They are written into its .env, so after saving the three
// lines are copied again. The token stays as it is.
export function HubSettingsCard({ settings, applicationId, onSaved }) {
  const [value, setValue] = useState(settings);
  const [showing, setShowing] = useState(false);
  const changed = JSON.stringify(value) !== JSON.stringify(settings);
  const problem = emailsProblem(value.hub_bypass_emails);
  const mutation = useMutation({
    mutationFn: () => applicationAccessApi.updateEnvSettings(applicationId, value),
    onSuccess: () => {
      onSaved();
      showSuccessToast("Saved. Copy the sign-in lines into the Hub's .env and restart it.");
    },
    onError: (error) => showErrorToast(error, "Could not save the sign-in settings."),
  });

  return (
    <section className="space-y-4 rounded-2xl border border-(--mws-line) bg-white p-5">
      <div>
        <h2 className="font-display text-base font-bold text-(--mws-charcoal)">Hub Sign-in</h2>
        <p className="text-sm text-(--mws-muted)">How strictly the Hub checks who may sign in. These go into the Hub's .env.</p>
      </div>
      <HubAccessSettings value={value} onChange={setValue} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={changed}
          title={changed ? "Save the settings first" : "The three sign-in lines for the Hub's .env. Restart the Hub after changing them."}
          onClick={() => setShowing(true)}
        >
          Copy Sign-in Lines
        </Button>
        <Button type="button" size="sm" loading={mutation.isPending} disabled={!changed || Boolean(problem)} onClick={() => mutation.mutate()}>
          Save Settings
        </Button>
      </div>
      {showing ? <SignInLinesDialog applicationId={applicationId} settings={settings} onClose={() => setShowing(false)} /> : null}
    </section>
  );
}
