import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { showSuccessToast } from "../../../lib/toast.js";
import { signInInstructions } from "../utils/instructions.js";

// What to tell the person whose Google account was just made. Nothing is emailed: they ask Google for the code.
export function GoogleInstructionsDialog({ email, maskedRecovery, title = "Google Account Ready", onClose }) {
  const text = signInInstructions(email, maskedRecovery);
  return (
    <CrudDialog
      title={title}
      description="Nobody has been emailed. Pass this on to the person."
      panelClassName="max-w-lg"
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigator.clipboard?.writeText(text).then(() => showSuccessToast("Instructions copied."))}
          >
            Copy instructions
          </Button>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <pre className="whitespace-pre-wrap rounded-xl bg-(--mws-soft) px-4 py-3 font-sans text-sm text-(--mws-charcoal)">
        {text}
      </pre>
    </CrudDialog>
  );
}
