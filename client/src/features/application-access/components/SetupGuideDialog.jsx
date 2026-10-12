import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { TextAction } from "../../../components/ui/TextAction.jsx";
import { Copy } from "lucide-react";
import { copyText } from "../utils/copyText.js";

const GENERIC_KEYS = [
  { key: "HUB_SSO_APP_ID", secret: false },
  { key: "CENTRAL_DATA_API_BASE_URL", secret: false },
  { key: "CENTRAL_DATA_API_TOKEN", secret: true },
  { key: "CENTRAL_ORGANIZATION_ID", secret: false },
];

// Where the value of a line comes from, in words, for the table of GitHub settings.
function valueOf(key, shortPath) {
  if (key === "HUB_SSO_APP_ID") return "The ID of this application, as on this page.";
  if (key.endsWith("_BASE_URL") && key.startsWith("CENTRAL")) {
    return shortPath ? "The address of the production Central, ending in /api/internal." : "The address of the production Central.";
  }
  if (key.endsWith("_TOKEN")) return "The token of this connection. It is shown once, when the connection is made or rotated.";
  if (key.endsWith("ORGANIZATION_ID")) return "The Organization ID of this application, copied from the connection.";
  if (key === "HUB_BASE_URL") return "The address of the Hub in production.";
  if (key === "HUB_SSO_JWKS_URL") return "The Hub address followed by /.well-known/jwks.json.";
  if (key === "HUB_INTERNAL_SECRET") return "The Hub secret of this application, from the connection block.";
  if (key.startsWith("HUB_CENTRAL_ACCESS")) return "The Hub sign-in setting, from the Sign-in Lines.";
  return "From the connection block.";
}

function Code({ children }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3 font-mono text-xs">{children}</pre>
  );
}

// What the application itself has to do, for whoever builds it. Names come from the .env the application reads.
export function SetupGuideDialog({ applicationId, isHub = false, envKeys, onClose }) {
  const keys = envKeys?.length ? envKeys : GENERIC_KEYS;
  const base = keys.find((item) => item.key.endsWith("_BASE_URL") && item.key.startsWith("CENTRAL"))?.key ?? "CENTRAL_DATA_API_BASE_URL";
  const token = keys.find((item) => item.secret && item.key.endsWith("_TOKEN"))?.key ?? "CENTRAL_DATA_API_TOKEN";
  // An address that already ends in /api/internal takes the short path.
  const short = base === "CENTRAL_API_BASE_URL";
  const path = short ? "/application-permissions/me" : "/api/internal/application-permissions/me";
  const secrets = keys.filter((item) => item.secret);
  const variables = keys.filter((item) => !item.secret);

  const workflow = isHub
    ? `      - name: Send the Hub's permissions to Central
        working-directory: backend
        env:
          CENTRAL_API_BASE_URL: \${{ vars.${base} }}
          CENTRAL_API_TOKEN: \${{ secrets.${token} }}
        run: bun run permissions:sync --retries 5 --wait 20`
    : `      - name: Send the permissions to Central
        env:
          CENTRAL_BASE_URL: \${{ vars.${base} }}
          CENTRAL_TOKEN: \${{ secrets.${token} }}
        run: |
          curl --fail-with-body --retry 5 --retry-delay 20 --retry-all-errors \\
            -X PUT "$CENTRAL_BASE_URL${path}" \\
            -H "Authorization: Bearer $CENTRAL_TOKEN" \\
            -H "Content-Type: application/json" \\
            -d @permissions.json`;

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
          <p className="mt-2 text-(--mws-muted)">The base URL is your local Central, for example http://localhost:3000.</p>
        </section>
        <section>
          <h3 className="font-display font-bold">4. Production, with GitHub Actions</h3>
          <p className="mt-1 text-(--mws-muted)">
            In the GitHub repository of the application open Settings, then Secrets and variables, then Actions. Add these on the Secrets tab and the Variables tab, with the production values.
          </p>
          <div className="mt-2 overflow-x-auto rounded-xl border border-(--mws-line)">
            <table className="w-full text-left text-xs">
              <thead className="bg-(--mws-soft) text-(--mws-muted)">
                <tr>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Add it as</th>
                  <th className="px-3 py-2 font-semibold">Value</th>
                </tr>
              </thead>
              <tbody>
                {[...secrets.map((item) => ({ ...item, kind: "Secret" })), ...variables.map((item) => ({ ...item, kind: "Variable" }))].map((item) => (
                  <tr key={item.key} className="border-t border-(--mws-line)">
                    <td className="px-3 py-2 font-mono">{item.key}</td>
                    <td className="px-3 py-2 font-semibold">{item.kind}</td>
                    <td className="px-3 py-2 text-(--mws-muted)">{valueOf(item.key, short)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-(--mws-muted)">
            Secrets are hidden once saved, so keep the values in a safe place too. The same names go into the production environment the application runs in.
          </p>
          <h4 className="mt-3 font-display font-bold">Send the permissions on every deploy</h4>
          <p className="mt-1 text-(--mws-muted)">
            {isHub
              ? "Add this step to the deploy workflow, after Central itself is deployed. The Hub already has the sync script."
              : "Add this step to the deploy workflow, after Central itself is deployed. Keep the permissions of your code in a permissions.json file in the repository, in the same shape as the body above, so the step has something to send."}
          </p>
          <Code>{workflow}</Code>
          <TextAction className="mt-2" icon={Copy} onClick={() => copyText(workflow)}>
            Copy Step
          </TextAction>
          <p className="mt-2 text-(--mws-muted)">It tries again for a few minutes while Central is still starting, and fails the deploy if Central says no.</p>
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
