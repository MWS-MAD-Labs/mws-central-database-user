import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Tabs } from "../../../components/ui/Tabs.jsx";
import { showSuccessToast } from "../../../lib/toast.js";
import { INSTRUCTION_LANGUAGES, signInGuide, signInInstructions } from "../utils/instructions.js";

// What to tell the person whose Google account was just made. Nothing is emailed: they ask Google for the code.
export function GoogleInstructionsDialog({ email, maskedRecovery, title = "Google Account Ready", onClose }) {
  const [language, setLanguage] = useState("id");
  const guide = signInGuide(email, maskedRecovery, language);
  const copyLabel = INSTRUCTION_LANGUAGES.find((item) => item.id === language).label;
  const copy = () =>
    navigator.clipboard
      ?.writeText(signInInstructions(email, maskedRecovery, language))
      .then(() => showSuccessToast("Instructions copied."));

  return (
    <CrudDialog
      title={title}
      description="Nobody has been emailed. Pass this on to the person."
      panelClassName="max-w-lg"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={copy}>
            {`Copy (${copyLabel})`}
          </Button>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Tabs label="Language" tabs={INSTRUCTION_LANGUAGES} active={language} onChange={setLanguage} />
        <div className="space-y-4 rounded-xl bg-(--mws-soft) px-4 py-4 text-sm text-(--mws-charcoal)">
          <div className="space-y-1">
            <p className="font-semibold">{guide.heading}</p>
            <p>
              {guide.account.label}: <span className="font-semibold">{guide.account.value}</span>
            </p>
            {guide.recovery ? (
              <p className="text-(--mws-muted)">
                {guide.recovery.label}: {guide.recovery.value}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-(--mws-muted)">{guide.stepsHeading}</p>
            <ol className="list-decimal space-y-1.5 pl-5">
              {guide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-(--mws-muted)">{guide.troubleHeading}</p>
            <ul className="list-disc space-y-1.5 pl-5">
              {guide.trouble.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <p className="font-semibold text-[#a43c41]">{guide.warning}</p>
        </div>
      </div>
    </CrudDialog>
  );
}
