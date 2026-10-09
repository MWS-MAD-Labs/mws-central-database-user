import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { emailsProblem } from "../utils/hubSettings.js";
import { HubAccessSettings } from "./HubAccessSettings.jsx";

// The Hub's sign-in settings on its setup page. They are written into its .env, so after saving the .env
// is made again by rotating the token.
export function HubSettingsCard({ settings, applicationId, onSaved }) {
  const [value, setValue] = useState(settings);
  const changed = JSON.stringify(value) !== JSON.stringify(settings);
  const problem = emailsProblem(value.hub_bypass_emails);
  const mutation = useMutation({
    mutationFn: () => applicationAccessApi.updateEnvSettings(applicationId, value),
    onSuccess: () => {
      onSaved();
      showSuccessToast("Saved. Rotate the token to get the .env lines with these settings.");
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
      <div className="flex justify-end">
        <Button type="button" loading={mutation.isPending} disabled={!changed || Boolean(problem)} onClick={() => mutation.mutate()}>
          Save Settings
        </Button>
      </div>
    </section>
  );
}
