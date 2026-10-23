import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { HUB_REMOVAL_NOTE, REMOVAL_STEPS } from "../utils/removalGuide.js";

// How an application is taken out of use, in the order it is done.
export function RemovalGuideDialog({ onClose }) {
  return (
    <CrudDialog title="How Removing Works" description="Stop first, delete after." onClose={onClose} panelClassName="max-w-lg">
      <div className="space-y-4 text-sm text-(--mws-charcoal)">
        {REMOVAL_STEPS.map((step) => (
          <section key={step.title}>
            <h3 className="font-display font-bold">{step.title}</h3>
            <p className="mt-1 text-(--mws-muted)">{step.text}</p>
          </section>
        ))}
        <section>
          <h3 className="font-display font-bold">The Hub itself</h3>
          <p className="mt-1 text-(--mws-muted)">
            {HUB_REMOVAL_NOTE}
          </p>
        </section>
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </CrudDialog>
  );
}
