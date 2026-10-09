import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";

// What the application itself has to do, for whoever builds it.
export function SetupGuideDialog({ applicationId, onClose }) {
  return (
    <CrudDialog title="Setup Guide" description={`What ${applicationId} needs to do to connect.`} onClose={onClose}>
      <div className="space-y-4 text-sm text-(--mws-charcoal)">
        <section>
          <h3 className="font-display font-bold">1. Environment</h3>
          <p className="mt-1 text-(--mws-muted)">
            Put the four values from the connection in the application's .env: HUB_SSO_APP_ID, CENTRAL_DATA_API_BASE_URL,
            CENTRAL_DATA_API_TOKEN and CENTRAL_ORGANIZATION_ID.
          </p>
        </section>
        <section>
          <h3 className="font-display font-bold">2. Send its permissions</h3>
          <p className="mt-1 text-(--mws-muted)">
            When it starts, the application sends the permissions its code understands. Roles can only use these. "me" means the application this token was made for, so no ID is needed.
          </p>
          <pre className="mt-2 overflow-x-auto rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3 font-mono text-xs">
{`PUT {CENTRAL_DATA_API_BASE_URL}/api/internal/application-permissions/me
Authorization: Bearer {CENTRAL_DATA_API_TOKEN}

{ "permissions": [{ "key": "app.use", "description": "Open the app" }] }`}
          </pre>
          <p className="mt-2 text-(--mws-muted)">Exima and Hub already do this on boot, and a new application can copy them.</p>
        </section>
        <section>
          <h3 className="font-display font-bold">3. Deploy or run it</h3>
          <p className="mt-1 text-(--mws-muted)">
            The first call marks the connection as connected and the permissions as received. This page checks every few
            seconds, so it updates by itself.
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
