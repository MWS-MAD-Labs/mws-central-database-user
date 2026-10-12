import { Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { TextAction } from "../../../components/ui/TextAction.jsx";
import { cn } from "../../../lib/cn.js";
import { copyText } from "../utils/copyText.js";
import { STANDARD_ENVIRONMENTS, connectionKeys, guideRows, startingEnvironment, syncScript } from "../utils/setupGuide.js";

const GENERIC_KEYS = [
  { key: "HUB_SSO_APP_ID", secret: false },
  { key: "CENTRAL_DATA_API_BASE_URL", secret: false },
  { key: "CENTRAL_DATA_API_TOKEN", secret: true },
  { key: "CENTRAL_ORGANIZATION_ID", secret: false },
];

function Code({ children }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3 font-mono text-xs">{children}</pre>
  );
}

function Step({ number, title, children }) {
  return (
    <section>
      <h3 className="font-display font-bold">
        {number}. {title}
      </h3>
      {children}
    </section>
  );
}

// What the application itself has to do, for whoever builds it, in the order it is done. Names come from the .env
// the application reads.
export function SetupGuideDialog({
  applicationId,
  isHub = false,
  envKeys,
  environment = "development",
  centralUrl = "",
  hubAddress = null,
  organizationId = null,
  onClose,
}) {
  const keys = envKeys?.length ? envKeys : GENERIC_KEYS;
  const { base, token, short, path } = connectionKeys(keys);
  const [selected, setSelected] = useState(startingEnvironment(environment));
  const rows = guideRows({ keys, applicationId, selected, environment, centralUrl, hubAddress, organizationId });
  const script = syncScript(keys);

  const checkCall = `curl -i "$${base}${short ? "/application-permissions/me" : "/api/internal/application-permissions/me"}" \\
  -H "Authorization: Bearer $${token}"`;

  const job = (steps) => `  send-permissions:
    needs: deploy
    runs-on: ubuntu-latest
    # the staging branch uses the staging environment, main uses production
    environment: \${{ github.ref_name == 'main' && 'production' || 'staging' }}
    steps:
      - uses: actions/checkout@v4
${steps}`;
  const workflow = isHub
    ? job(`      - uses: oven-sh/setup-bun@v2
      - name: Send the Hub's permissions to Central
        working-directory: backend
        env:
          CENTRAL_API_BASE_URL: \${{ vars.${base} }}
          CENTRAL_API_TOKEN: \${{ secrets.${token} }}
        run: |
          bun install --frozen-lockfile
          bun run permissions:sync --retries 5 --wait 20`)
    : job(`      - name: Send the permissions to Central
        env:
          ${base}: \${{ vars.${base} }}
          ${token}: \${{ secrets.${token} }}
        run: node scripts/sync-permissions.mjs`);

  return (
    <CrudDialog title="Setup Guide" description={`What ${applicationId} needs to do to connect, in order.`} onClose={onClose}>
      <div className="space-y-5 text-sm text-(--mws-charcoal)">
        <Step number={1} title="Put the lines in the .env">
          <p className="mt-1 text-(--mws-muted)">
            Copy the block from the connection into the .env of the application: {keys.map((item) => item.key).join(", ")}. Take
            out any older variables for the same thing with other names, because an application can read an older name first and
            never use the new token. Then restart it.
          </p>
        </Step>

        <Step number={2} title="Check the connection">
          <p className="mt-1 text-(--mws-muted)">
            One call that proves the address and the token are right. In a terminal where the .env values are loaded:
          </p>
          <Code>{checkCall}</Code>
          <p className="mt-2 text-(--mws-muted)">
            A 200 means Central knows the token, and the Connect step on this page turns to Connected by itself within a few
            seconds. A 401 means the token or the address is not the one from the connection. Your local Central is usually
            http://localhost:3000.
          </p>
        </Step>

        <Step number={3} title="Send its permissions">
          <p className="mt-1 text-(--mws-muted)">
            Roles can only use permissions the application has sent, so this is what lets you make roles. What to do:
          </p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-(--mws-muted)">
            {isHub ? (
              <>
                <li>The Hub keeps its permissions in its code and already has the script.</li>
                <li>
                  Run <span className="font-mono">bun run permissions:sync</span> in its backend folder (and{" "}
                  <span className="font-mono">bun run permissions:check</span> to compare without changing anything).
                </li>
                <li>The deploy workflow runs the same command, see step 4.</li>
              </>
            ) : (
              <>
                <li>
                  List the permissions of your code in a <span className="font-mono">permissions.json</span> file in the
                  repository:{" "}
                  <span className="font-mono">{`{ "permissions": [{ "key": "app.use", "description": "Open the app" }] }`}</span>
                </li>
                <li>
                  Keep the script below as <span className="font-mono">scripts/sync-permissions.mjs</span>. It sends the file and
                  tries again while Central is starting.
                </li>
                <li>
                  Run it with <span className="font-mono">node scripts/sync-permissions.mjs</span>. Add it to{" "}
                  <span className="font-mono">predev</span> too, so every dev start sends the permissions the way a deploy does.
                </li>
              </>
            )}
          </ol>
          {isHub ? null : (
            <>
              <Code>{script}</Code>
              <TextAction className="mt-2" icon={Copy} onClick={() => copyText(script)}>
                Copy Script
              </TextAction>
              <p className="mt-2 text-(--mws-muted)">
                The call it makes is <span className="font-mono">PUT {`{${base}}${path}`}</span> with the token as a Bearer
                header. "me" means the application the token was made for, so no ID is needed. If you take a permission out,
                Central asks you to confirm once: add <span className="font-mono">"confirm_removals": true</span> to the file for
                that run.
              </p>
            </>
          )}
          <p className="mt-2 text-(--mws-muted)">When it has run, the Permissions step on this page is done and you can add the roles.</p>
        </Step>

        <Step number={4} title="Staging and production, with GitHub Actions">
          <p className="mt-1 text-(--mws-muted)">
            Staging and production each have their own Central, so each has its own connection: its own token, its own
            Organization ID and its own Hub secret. Make the connection in each Central, and in the GitHub repository open
            Settings, then Environments, and make two: <span className="font-mono">staging</span> and{" "}
            <span className="font-mono">production</span>. Inside each, add the names below with the values of that environment.
            The names are the same, only the values differ.
          </p>
          <div
            role="radiogroup"
            aria-label="Environment"
            className="mt-3 grid w-full max-w-xs grid-cols-2 gap-1 rounded-xl border border-(--mws-line) bg-(--mws-soft) p-1"
          >
            {STANDARD_ENVIRONMENTS.map((item) => (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={selected === item}
                onClick={() => setSelected(item)}
                className={cn(
                  "flex h-8 cursor-pointer items-center justify-center rounded-lg text-sm font-semibold capitalize transition-colors focus-visible:outline-2 focus-visible:outline-(--mws-burgundy)",
                  selected === item
                    ? "bg-white text-(--mws-burgundy) shadow-sm ring-1 ring-(--mws-line)"
                    : "text-(--mws-muted) hover:text-(--mws-charcoal)",
                )}
              >
                {item}
              </button>
            ))}
          </div>
          {selected !== environment ? (
            <p role="note" className="mt-2 text-xs text-(--mws-muted)">
              You are looking at the {environment} Central, so the values below for {selected} are not known here. Open this
              application in the {selected} Central, make the connection there, and copy them from its block.
            </p>
          ) : null}
          <div className="mt-2 overflow-x-auto rounded-xl border border-(--mws-line)">
            <table className="w-full text-left text-xs">
              <thead className="bg-(--mws-soft) text-(--mws-muted)">
                <tr>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Add it as</th>
                  <th className="px-3 py-2 font-semibold">Used by</th>
                  <th className="px-3 py-2 font-semibold">Value for {selected}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-t border-(--mws-line) align-top">
                    <td className="px-3 py-2 font-mono">{row.key}</td>
                    <td className="px-3 py-2 font-semibold">{row.kind}</td>
                    <td className="px-3 py-2 text-(--mws-muted)">{row.usedBy}</td>
                    <td className="px-3 py-2">
                      {row.value ? (
                        <span className="font-mono break-all">{row.value}</span>
                      ) : (
                        <span className="text-(--mws-muted)">{row.source}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-(--mws-muted)">
            Secrets are hidden once saved, so keep the values in a safe place too. The names marked "Sync job and app" are the two
            the pipeline needs. The rest are read by the application where it runs, so they go into the environment on the server
            as well.
          </p>
          <h4 className="mt-3 font-display font-bold">Send the permissions on every deploy</h4>
          <p className="mt-1 text-(--mws-muted)">
            Add this job to the deploy workflow. It runs after the deploy job and after Central itself is deployed in that
            environment, and uses the staging environment on the staging branch and production on main. Change{" "}
            <span className="font-mono">deploy</span> if your deploy job has another name.
          </p>
          <Code>{workflow}</Code>
          <TextAction className="mt-2" icon={Copy} onClick={() => copyText(workflow)}>
            Copy Job
          </TextAction>
          <p className="mt-2 text-(--mws-muted)">It fails the deploy if Central says no.</p>
        </Step>

        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </CrudDialog>
  );
}
