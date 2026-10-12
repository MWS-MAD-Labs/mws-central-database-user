import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";

const GENERIC_KEYS = [
  { key: "HUB_SSO_APP_ID", secret: false },
  { key: "CENTRAL_DATA_API_BASE_URL", secret: false },
  { key: "CENTRAL_DATA_API_TOKEN", secret: true },
  { key: "CENTRAL_ORGANIZATION_ID", secret: false },
];

function Code({ children }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3 font-mono text-xs">
      {children}
    </pre>
  );
}

// What the application itself has to do, for whoever builds it. Names come from the .env the application reads.
export function SetupGuideDialog({ applicationId, isHub = false, envKeys, onClose }) {
  const keys = envKeys?.length ? envKeys : GENERIC_KEYS;
  const base = keys.find((item) => item.key.endsWith("_BASE_URL"))?.key ?? "CENTRAL_DATA_API_BASE_URL";
  const token = keys.find((item) => item.secret)?.key ?? "CENTRAL_DATA_API_TOKEN";
  // An address that already ends in /api/internal takes the short path.
  const short = base === "CENTRAL_API_BASE_URL";
  const path = short ? "/application-permissions/me" : "/api/internal/application-permissions/me";
  return (
    <CrudDialog title="Setup Guide" description={`What ${applicationId} needs to do to connect.`} onClose={onClose}>
      <div className="space-y-4 text-sm text-(--mws-charcoal)">
        <section>
          <h3 className="font-display font-bold">1. Environment</h3>
          <p className="mt-1 text-(--mws-muted)">
            Put the lines from the connection in the application's .env: {keys.map((item) => item.key).join(", ")}.
          </p>
        </section>
        <section>
          <h3 className="font-display font-bold">2. Send its permissions</h3>
          <p className="mt-1 text-(--mws-muted)">
            The application sends the permissions its code understands. Roles can only use these. "me" means the application this token was made for, so no ID is needed.
          </p>
          <Code>
{`PUT {${base}}${path}
Authorization: Bearer {${token}}

{ "permissions": [{ "key": "app.use", "description": "Open the app" }] }`}
          </Code>
        </section>
        <section>
          <h3 className="font-display font-bold">3. Run it on your machine</h3>
          <p className="mt-1 text-(--mws-muted)">
            {isHub
              ? "There is no pipeline on a local machine, so the sync is run by hand. In the Hub's backend folder:"
              : "There is no pipeline on a local machine, so the sync has to be run by hand, or the application sends it when it starts (Exima does). A terminal with the .env values loaded can send one permission to test it:"}
          </p>
          <Code>
            {isHub
              ? `bun run permissions:sync    # sends the permissions
bun run permissions:check   # compares, changes nothing`
              : `curl -X PUT "$${base}${path}" \\
  -H "Authorization: Bearer $${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"permissions":[{"key":"app.use","description":"Open the app"}]}'`}
          </Code>
          <p className="mt-2 text-(--mws-muted)">
            The base URL is your local Central, for example http://localhost:3000.
          </p>
        </section>
        <section>
          <h3 className="font-display font-bold">4. Production</h3>
          <p className="mt-1 text-(--mws-muted)">
            Put the same lines in the deploy environment, with the address of the production Central. The sync belongs in the deploy pipeline,
            after Central itself is deployed, so every release sends its permissions without anyone remembering to.
            {isHub ? " The Hub's pipeline already runs bun run permissions:sync." : ""}
          </p>
          {isHub ? null : (
            <p className="mt-2 text-(--mws-muted)">
              No pipeline step yet? Add one that runs the same request as above and retries while Central is starting.
            </p>
          )}
        </section>
        <p className="text-(--mws-muted)">
          The first call marks the connection as connected and the permissions as received. The setup page checks every few seconds, so it updates by itself.
        </p>
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </CrudDialog>
  );
}
