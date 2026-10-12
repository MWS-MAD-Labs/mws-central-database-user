import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { copyText } from "../utils/copyText.js";
import { signInEnvLines } from "../utils/hubSettings.js";

// Shows the three sign-in lines before they are copied, so it is clear what goes into the Hub's .env.
export function SignInLinesDialog({ applicationId, settings, onClose }) {
  const lines = signInEnvLines(applicationId, settings);
  async function copy() {
    await copyText(lines);
    onClose();
  }
  return (
    <CrudDialog title="Sign-in Lines" description="Put these three lines in the Hub's .env, then restart the Hub." onClose={onClose}>
      <div className="space-y-4">
        <pre className="overflow-x-auto rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3 font-mono text-xs break-all whitespace-pre-wrap text-(--mws-charcoal)">
          {lines}
        </pre>
        <p className="text-xs text-(--mws-muted)">The token does not change, so the other lines in the .env stay as they are.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="button" onClick={copy}>
            Copy Lines
          </Button>
        </div>
      </div>
    </CrudDialog>
  );
}
