import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";

const STEPS = [
  {
    title: "1. Retire",
    text: "Stops the application without deleting anything. Its token is revoked, it disappears from the Hub and nobody has access to it. Roles, groups and permissions stay.",
  },
  {
    title: "2. Restore, if you change your mind",
    text: "Turns it back on. The old token stays revoked, so you create a new connection and copy the new .env values. You also show it in the Hub again by hand.",
  },
  {
    title: "3. Delete",
    text: "Removes it for good, with its roles, groups, permissions and any access people still had. A retired application can be deleted right away. An application nobody uses can be deleted without retiring it first.",
  },
];

// How an application is taken out of use, in the order it is done.
export function RemovalGuideDialog({ onClose }) {
  return (
    <CrudDialog title="How Removing Works" description="Stop first, delete after." onClose={onClose} panelClassName="max-w-lg">
      <div className="space-y-4 text-sm text-(--mws-charcoal)">
        {STEPS.map((step) => (
          <section key={step.title}>
            <h3 className="font-display font-bold">{step.title}</h3>
            <p className="mt-1 text-(--mws-muted)">{step.text}</p>
          </section>
        ))}
        <section>
          <h3 className="font-display font-bold">The Hub itself</h3>
          <p className="mt-1 text-(--mws-muted)">
            It cannot be retired or deleted. Removing it would lock everyone out of the Hub.
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
