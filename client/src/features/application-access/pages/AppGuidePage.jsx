import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Copy } from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation, useParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { TextAction } from "../../../components/ui/TextAction.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { GithubEnvironmentCard } from "../components/guide/GithubEnvironmentCard.jsx";
import { copyText } from "../utils/copyText.js";
import { STANDARD_ENVIRONMENTS, connectionKeys, githubEnvironmentOf, guideRows, rotationSteps, syncScript } from "../utils/setupGuide.js";

const GENERIC_KEYS = [
  { key: "HUB_SSO_APP_ID", secret: false },
  { key: "CENTRAL_DATA_API_BASE_URL", secret: false },
  { key: "CENTRAL_DATA_API_TOKEN", secret: true },
  { key: "CENTRAL_ORGANIZATION_ID", secret: false },
];

const SECTIONS = [
  { id: "first-setup", label: "First setup" },
  { id: "github", label: "Staging and production" },
  { id: "rotate", label: "When you rotate" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

function Code({ children }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3 font-mono text-xs">{children}</pre>
  );
}

function Section({ id, title, intro, children }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 space-y-4 rounded-2xl border border-(--mws-line) bg-white p-5 md:p-6">
      <div>
        <h2 id={`${id}-title`} className="font-display text-lg font-bold text-(--mws-charcoal)">
          {title}
        </h2>
        {intro ? <p className="mt-1 max-w-3xl text-sm leading-6 text-(--mws-muted)">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Steps({ items }) {
  return (
    <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-6 text-(--mws-muted)">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ol>
  );
}

function SubHeading({ children }) {
  return <h3 className="font-display text-sm font-bold text-(--mws-charcoal)">{children}</h3>;
}

// What the application has to do, in order, on one page: the first setup, how staging and production are kept apart in
// GitHub, what to do again after a rotation, and what to check when nothing arrives. Names come from the .env the
// application reads, and values are filled in only for the Central being looked at.
export function AppGuidePage() {
  const { applicationId } = useParams();
  const { hash } = useLocation();
  const { user } = useAuth();
  const setupQuery = useQuery({
    queryKey: ["application-access", "setup", applicationId],
    queryFn: () => applicationAccessApi.getSetup(applicationId),
    enabled: user?.role === "SUPER_ADMIN",
  });

  // A link with #rotate or #github lands on that part.
  useEffect(() => {
    if (!hash || !setupQuery.data) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash, setupQuery.data]);

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="min-w-0">
        <PageHeader title="Setup Guide" />
        <PanelMessage>Only Super Admin can manage application access.</PanelMessage>
      </div>
    );
  }
  if (setupQuery.isLoading) return <PanelMessage>Loading the guide…</PanelMessage>;
  if (setupQuery.isError || !setupQuery.data) return <PanelMessage tone="error">This application could not be found.</PanelMessage>;

  const setup = setupQuery.data;
  const isHub = setup.is_hub;
  const keys = setup.env_keys?.length ? setup.env_keys : GENERIC_KEYS;
  const { base, token, short, path } = connectionKeys(keys);
  const environment = setup.environment ?? "development";
  const script = syncScript(keys);
  const steps = rotationSteps({ keys, environment });
  const github = githubEnvironmentOf(environment);

  const rowsOf = (selected) =>
    guideRows({
      keys,
      applicationId,
      selected,
      environment,
      centralUrl: setup.central_url,
      hubAddress: setup.hub_address,
      organizationId: setup.organization_id,
    });

  const checkCall = `curl -i "$${base}${short ? "/application-permissions/me" : "/api/internal/application-permissions/me"}" \\
  -H "Authorization: Bearer $${token}"`;

  const job = (inner) => `  send-permissions:
    needs: deploy
    runs-on: ubuntu-latest
    # the staging branch uses the staging environment, main uses production
    environment: \${{ github.ref_name == 'main' && 'production' || 'staging' }}
    steps:
      - uses: actions/checkout@v4
${inner}`;
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
    <div className="min-w-0 space-y-5">
      <PageHeader
        title="Setup Guide"
        description={`What ${setup.application.name} needs, in the order it is done. Use it for the first setup and again after a rotation.`}
        actions={
          <Button asChild variant="secondary">
            <Link to={`/application-access/apps/${applicationId}/setup`}>
              <ArrowLeft size={16} />
              Back To Setup
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Parts of the guide" className="lg:sticky lg:top-24 lg:self-start">
          <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="block rounded-lg px-3 py-1.5 text-sm font-medium text-(--mws-muted) hover:bg-(--mws-soft) hover:text-(--mws-charcoal)"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          <Section id="first-setup" title="First setup" intro="Three things, one after the other. The page for this application turns each step green by itself.">
            <div className="space-y-5">
              <div>
                <SubHeading>1. Put the lines in the .env</SubHeading>
                <p className="mt-1 text-sm leading-6 text-(--mws-muted)">
                  Copy the block from the connection into the .env of the application: {keys.map((item) => item.key).join(", ")}. Take
                  out any older variables for the same thing with other names, because an application can read an older name first and
                  never use the new token. Then restart it.
                </p>
              </div>
              <div>
                <SubHeading>2. Check the connection</SubHeading>
                <p className="mt-1 text-sm leading-6 text-(--mws-muted)">
                  One call that proves the address and the token are right. In a terminal where the .env values are loaded:
                </p>
                <Code>{checkCall}</Code>
                <p className="mt-2 text-sm leading-6 text-(--mws-muted)">
                  A 200 means Central knows the token, and the Connect step turns to Connected by itself within a few seconds. A 401 means
                  the token or the address is not the one from the connection. Your local Central is usually http://localhost:3000.
                </p>
              </div>
              <div>
                <SubHeading>3. Send its permissions</SubHeading>
                <p className="mt-1 text-sm leading-6 text-(--mws-muted)">
                  Roles can only use permissions the application has sent, so this is what lets you make roles. What to do:
                </p>
                {isHub ? (
                  <Steps
                    items={[
                      "The Hub keeps its permissions in its code and already has the script.",
                      "Run bun run permissions:sync in its backend folder, and bun run permissions:check to compare without changing anything.",
                      "The deploy workflow runs the same command, see Staging and production.",
                    ]}
                  />
                ) : (
                  <>
                    <Steps
                      items={[
                        'List the permissions of your code in a permissions.json file in the repository: { "permissions": [{ "key": "app.use", "description": "Open the app" }] }',
                        "Keep the script below as scripts/sync-permissions.mjs. It sends the file and tries again while Central is starting.",
                        "Run it with node scripts/sync-permissions.mjs. Add it to predev too, so every dev start sends the permissions the way a deploy does.",
                      ]}
                    />
                    <Code>{script}</Code>
                    <TextAction className="mt-2" icon={Copy} onClick={() => copyText(script)}>
                      Copy Script
                    </TextAction>
                    <p className="mt-2 text-sm leading-6 text-(--mws-muted)">
                      The call it makes is PUT {`{${base}}${path}`} with the token as a Bearer header. "me" means the application the token
                      was made for. If you take a permission out, Central asks you to confirm once: add "confirm_removals": true to the
                      file for that run.
                    </p>
                  </>
                )}
                <p className="mt-2 text-sm leading-6 text-(--mws-muted)">When it has run, the Permissions step is done and you can add the roles.</p>
              </div>
            </div>
          </Section>

          <Section
            id="github"
            title="Staging and production, with GitHub"
            intro="Staging and production each have their own Central, so each has its own connection: its own token, Organization ID and Hub secret. Keep them apart with two GitHub environments."
          >
            <div role="note" className="rounded-xl border border-[#d8b45b] bg-[#fff8e8] p-4 text-sm leading-6 text-[#745716]">
              <p className="font-semibold">Not on the Repository secrets page.</p>
              <p className="mt-1">
                Settings, Secrets and variables, Actions, Repository secrets is shared by every branch, so a token put there would be used by
                both staging and production. Use it only for values that are really the same in both, like a webhook. The token, the
                Central address and the Hub secret go inside an environment, where the same name can hold a different value.
              </p>
            </div>
            <div className="grid gap-5 2xl:grid-cols-2">
              {STANDARD_ENVIRONMENTS.map((name) => (
                <GithubEnvironmentCard key={name} name={name} here={name === github} rows={rowsOf(name)} />
              ))}
            </div>
            <div>
              <SubHeading>Send the permissions on every deploy</SubHeading>
              <p className="mt-1 text-sm leading-6 text-(--mws-muted)">
                Add this job to the deploy workflow. It runs after the deploy job and after Central itself is deployed in that environment.
                The staging branch uses the staging environment and main uses production, so each takes the values of its own Central.
                Change deploy if your deploy job has another name. The names marked "Sync job and app" are the two this job needs. The rest are
                read by the application where it runs, so they go into the environment on the server too.
              </p>
              <Code>{workflow}</Code>
              <TextAction className="mt-2" icon={Copy} onClick={() => copyText(workflow)}>
                Copy Job
              </TextAction>
              <p className="mt-2 text-sm text-(--mws-muted)">It fails the deploy if Central says no.</p>
            </div>
          </Section>

          <Section
            id="rotate"
            title="When you rotate"
            intro="A rotation gives a new value that the application does not have yet. Until it is put in every place the old one lives, something stops working. These are the places, in order."
          >
            <div className="space-y-5">
              <div>
                <SubHeading>Rotate the token of this application</SubHeading>
                <Steps items={steps.token} />
              </div>
              {isHub ? null : (
                <div>
                  <SubHeading>Rotate the Hub secret of this application</SubHeading>
                  <Steps items={steps.appSecret} />
                </div>
              )}
              <div>
                <SubHeading>Rotate the Hub's master secret</SubHeading>
                <Steps items={steps.master} />
              </div>
            </div>
          </Section>

          <Section id="troubleshooting" title="Troubleshooting">
            <dl className="space-y-4 text-sm leading-6">
              {[
                [
                  "Still nothing after 10 minutes",
                  `The token of the connection has not been used. Check that the .env has ${keys.map((item) => item.key).join(", ")}, that no older variable with another name is read first, that the application was restarted, and that the block was made for this application (its ID is ${applicationId}).`,
                ],
                ["The check in step 2 answers 401", "The token or the address is not the one from the connection. Make a new token with Rotate Token and copy the block again."],
                ["Permissions do not show up", "The script has to run with the same .env, and Central has to be reachable from where it runs. Run it by hand and read the answer: a 4xx says what to fix."],
                ["The Hub or the application refuses the other", "After a Hub secret rotation both sides need the new HUB_INTERNAL_SECRET. An old version is refused about a minute after the rotation."],
              ].map(([question, answer]) => (
                <div key={question}>
                  <dt className="font-semibold text-(--mws-charcoal)">{question}</dt>
                  <dd className="mt-0.5 text-(--mws-muted)">{answer}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}
