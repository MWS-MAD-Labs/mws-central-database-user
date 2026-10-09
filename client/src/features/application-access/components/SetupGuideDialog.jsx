import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";

// What the application itself has to do, for whoever builds it.
export function SetupGuideDialog({ applicationId, isHub = false, onClose }) {
  // The Hub reads other names than the applications, and its address already ends in /api/internal.
  const base = isHub ? "CENTRAL_API_BASE_URL" : "CENTRAL_DATA_API_BASE_URL";
  const token = isHub ? "CENTRAL_API_TOKEN" : "CENTRAL_DATA_API_TOKEN";
  const path = isHub ? "/application-permissions/me" : "/api/internal/application-permissions/me";
  return (
    <CrudDialog title="Setup Guide" description={`What ${applicationId} needs to do to connect.`} onClose={onClose}>
      <div className="space-y-4 text-sm text-(--mws-charcoal)">
        <section>
          <h3 className="font-display font-bold">1. Environment</h3>
          <p className="mt-1 text-(--mws-muted)">
            {isHub
              ? "Put the lines from the connection in the Hub's .env: CENTRAL_API_BASE_URL, CENTRAL_API_TOKEN and the three HUB_CENTRAL_ACCESS settings."
              : "Put the four values from the connection in the application's .env: HUB_SSO_APP_ID, CENTRAL_DATA_API_BASE_URL, CENTRAL_DATA_API_TOKEN and CENTRAL_ORGANIZATION_ID."}
          </p>
        </section>
        <section>
          <h3 className="font-display font-bold">2. Send its permissions</h3>
          <p className="mt-1 text-(--mws-muted)">
            When it starts, the application sends the permissions its code understands. Roles can only use these. "me" means the application this token was made for, so no ID is needed.
          </p>
          <pre className="mt-2 overflow-x-auto rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3 font-mono text-xs">
{`PUT {${base}}${path}
Authorization: Bearer {${token}}

{ "permissions": [{ "key": "app.use", "description": "Open the app" }] }`}
          </pre>
          <p className="mt-2 text-(--mws-muted)">Exima and Hub already do this on boot, and a new application can copy them.</p>
        </section>
        <section>
          <h3 className="font-display font-bold">Test The Connection</h3>
          <p className="mt-1 text-(--mws-muted)">
            No application running yet? Run this in a terminal where the .env values are loaded. It sends one permission and
            marks the connection and the permissions as received.
          </p>
          <pre className="mt-2 overflow-x-auto rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3 font-mono text-xs">
{`curl -X PUT "$${base}${path}" \\
  -H "Authorization: Bearer $${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"permissions":[{"key":"app.use","description":"Open the app"}]}'`}
          </pre>
          <p className="mt-2 text-(--mws-muted)">
            On your machine the base URL is the local Central, for example http://localhost:3000. In production it is the
            production Central.
          </p>
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
