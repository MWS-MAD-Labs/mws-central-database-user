import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Copy } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { TextAction } from "../../../components/ui/TextAction.jsx";
import { cn } from "../../../lib/cn.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { GithubEnvironmentCard, ServerEnvCard } from "../components/guide/GithubEnvironmentCard.jsx";
import { GuideNav } from "../components/guide/GuideNav.jsx";
import { Code, DoneWhen, Paragraph, Steps, SubHeading } from "../components/guide/GuidePieces.jsx";
import { copyText } from "../utils/copyText.js";
import {
  GITHUB_MODES,
  STANDARD_ENVIRONMENTS,
  checkCommand,
  connectionKeys,
  githubEnvironmentOf,
  guideRows,
  ownerMessage,
  rotationSteps,
  syncScript,
  workflowJob,
} from "../utils/setupGuide.js";
import { canManageApplications } from "../utils/canManageApplications.js";

const GENERIC_KEYS = [
  { key: "HUB_SSO_APP_ID", secret: false },
  { key: "CENTRAL_API_BASE_URL", secret: false },
  { key: "CENTRAL_API_TOKEN", secret: true },
  { key: "CENTRAL_ORGANIZATION_ID", secret: false },
];

const GUIDE_PARTS = [
  { id: "start", label: "Before you start" },
  { id: "local", label: "On your machine" },
  { id: "permissions", label: "Send the permissions" },
  { id: "deploy", label: "Staging and production" },
  { id: "rotate", label: "When you rotate" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

// What the application has to do, from the first line of its .env to a deploy that works, one part at a time. Names come
// from the .env the application reads, and values are filled in only for the Central being looked at.
export function AppGuidePage() {
  const { applicationId } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const setupQuery = useQuery({
    queryKey: ["application-access", "setup", applicationId],
    queryFn: () => applicationAccessApi.getSetup(applicationId),
    enabled: canManageApplications(user),
  });

  if (!canManageApplications(user)) {
    return (
      <div className="min-w-0">
        <PageHeader title="Setup Guide" />
        <PanelMessage>Only a protected Super Admin can manage application access.</PanelMessage>
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
  const github = githubEnvironmentOf(environment);
  const part = GUIDE_PARTS.some((item) => item.id === params.get("part")) ? params.get("part") : "start";
  const mode = GITHUB_MODES.some((item) => item.id === params.get("github")) ? params.get("github") : "environments";
  const index = GUIDE_PARTS.findIndex((item) => item.id === part);

  const hrefFor = (id, extra = {}) => {
    const next = new URLSearchParams();
    next.set("part", id);
    if (params.get("github")) next.set("github", params.get("github"));
    Object.entries(extra).forEach(([key, value]) => next.set(key, value));
    return `?${next.toString()}`;
  };

  const context = { setup, isHub, keys, base, token, short, path, environment, github, mode, applicationId };
  const body = {
    start: <StartPart {...context} />,
    local: <LocalPart {...context} />,
    permissions: <PermissionsPart {...context} />,
    deploy: <DeployPart {...context} hrefFor={hrefFor} />,
    rotate: <RotatePart {...context} />,
    troubleshooting: <TroubleshootingPart {...context} />,
  }[part];

  const previous = GUIDE_PARTS[index - 1];
  const next = GUIDE_PARTS[index + 1];
  const pager = (
    <div className="flex items-center justify-between gap-3 border-t border-(--mws-line) pt-4">
      {previous ? (
        <Button asChild variant="secondary" size="icon" aria-label="Back" title="Back">
          <Link to={hrefFor(previous.id)}><ArrowLeft size={14} /></Link>
        </Button>
      ) : (
        <span />
      )}
      {next ? (
        <Button asChild size="sm">
          <Link to={hrefFor(next.id)}>
            Next: {next.label}
          </Link>
        </Button>
      ) : (
        <Button asChild size="icon" aria-label="Back To Setup" title="Back To Setup">
          <Link to={`/application-access/apps/${applicationId}/setup`}></Link>
        </Button>
      )}
    </div>
  );

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title="Setup Guide"
        description={`What ${setup.application.name} needs, from its first line of .env to a deploy that works. Use it again after a rotation.`}
        actions={
          <Button asChild variant="secondary" size="icon" aria-label="Back To Setup" title="Back To Setup">
            <Link to={`/application-access/apps/${applicationId}/setup`}><ArrowLeft size={16} /></Link>
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-6">
        <GuideNav parts={GUIDE_PARTS} current={part} hrefFor={hrefFor} />
        <article aria-label={GUIDE_PARTS[index].label} className="min-w-0 space-y-5 rounded-2xl border border-(--mws-line) bg-white p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-(--mws-muted)">
                Part {index + 1} of {GUIDE_PARTS.length}
              </p>
              <h2 className="font-display text-xl font-bold text-(--mws-charcoal)">{GUIDE_PARTS[index].label}</h2>
            </div>
          </div>
          {body}
          {pager}
        </article>
      </div>
    </div>
  );
}

function StartPart({ setup, isHub }) {
  return (
    <div className="space-y-5">
      <Paragraph>
        This guide takes {setup.application.name} from nothing to a working connection with Central, in the order things are done. Each
        part ends with what you should see before you go on, so you always know where you are.
      </Paragraph>
      <div>
        <SubHeading>What you need</SubHeading>
        <Steps
          items={[
            "A protected Super Admin account. A regular Super Admin cannot open this.",
            "The connection of this application, made on the setup page. Its block of .env lines is shown once, so keep it open or copied.",
            isHub
              ? "The Hub's code on your machine, since it already has the permission script."
              : "The code of the application on your machine, so you can edit its .env and add one script.",
            "For staging and production only: access to the GitHub repository and the server of the application. Without admin rights there is still a way, see Staging and production.",
          ]}
        />
      </div>
      <div>
        <SubHeading>The parts</SubHeading>
        <Steps
          items={[
            "On your machine: the .env, and one call that proves the connection.",
            "Send the permissions: so roles can be made.",
            "Staging and production: GitHub and the server.",
            "When you rotate: what to do again afterwards.",
            "Troubleshooting: when nothing arrives.",
          ]}
        />
      </div>
      <DoneWhen>you have the connection block at hand and the code of the application open. Start with the next part.</DoneWhen>
    </div>
  );
}

function LocalPart({ setup, keys, base, token, short, environment }) {
  const checkCall = `curl -i "$${base}${short ? "/application-permissions/me" : "/api/internal/application-permissions/me"}" \\
  -H "Authorization: Bearer $${token}"`;
  return (
    <div className="space-y-5">
      <Paragraph>This is where you try everything first. Nothing here touches staging or production.</Paragraph>
      <div>
        <SubHeading>1. Put the lines in the .env</SubHeading>
        <Steps
          items={[
            `Copy the block from the connection into the .env the application loads when you run it on your machine: ${keys.map((item) => item.key).join(", ")}.`,
            environment === "development"
              ? `The Central address in it is the one you are using now${setup.central_url ? `, ${setup.central_url}` : ""}. Keep it for local work.`
              : "If you run the application against a Central on your machine, make the connection in that Central and copy its block instead.",
            setup.hub_address
              ? `The Hub address in the block is ${setup.hub_address}. For local work it should be the page you open the Hub at, usually http://localhost:5175. Its backend on 4001 sits behind it.`
              : "If the block has no Hub lines, the Hub has no address yet. Set it in the Hub setup first.",
            "Take out any older variables for the same thing with other names. An application can read an older name first and never use the new token.",
            "Restart the application so it reads the file.",
          ]}
        />
      </div>
      <div>
        <SubHeading>2. Check the connection</SubHeading>
        <Paragraph>One call that proves the address and the token are right. In a terminal where the .env values are loaded:</Paragraph>
        <Code>{checkCall}</Code>
        <Paragraph>
          A 200 means Central knows the token. A 401 means the token or the address is not the one from the connection. Your local Central
          is usually http://localhost:3000.
        </Paragraph>
      </div>
      <DoneWhen>
        the call answers 200 and the Connect step on the setup page turns to Connected by itself within a few seconds. If it does not, open
        Troubleshooting.
      </DoneWhen>
    </div>
  );
}

function PermissionsPart({ isHub, keys, base, path }) {
  const script = syncScript(keys);
  return (
    <div className="space-y-5">
      <Paragraph>Roles can only use permissions the application has sent, so this is what lets you make roles.</Paragraph>
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
          <TextAction icon={Copy} onClick={() => copyText(script)}>
            Copy Script
          </TextAction>
          <Paragraph>
            The call it makes is PUT {`{${base}}${path}`} with the token as a Bearer header. "me" means the application the token was made
            for. If you take a permission out, Central asks you to confirm once: add "confirm_removals": true to the file for that run.
          </Paragraph>
        </>
      )}
      <DoneWhen>the script prints that the permissions were sent, the Permissions step on the setup page is done, and you can add the first role.</DoneWhen>
    </div>
  );
}

function DeployPart({ setup, isHub, keys, environment, github, mode, applicationId, hrefFor }) {
  const rowsOf = (selected) =>
    guideRows({
      keys,
      applicationId,
      selected,
      environment,
      centralUrl: setup.central_url,
      hubAddress: setup.hub_address,
      organizationId: setup.organization_id,
      mode: mode === "owner" ? "prefixed" : mode,
    });
  const job = workflowJob({ keys, isHub, mode });
  const checkBase = rowsOf(github ?? "staging").find((row) => row.target === "github" && row.key === connectionKeys(keys).base)?.value;
  const checkText = checkCommand({ keys, baseValue: checkBase });
  const message = ownerMessage({
    applicationName: setup.application.name,
    keys,
    isHub,
    environment,
    centralUrl: setup.central_url,
    hubAddress: setup.hub_address,
    organizationId: setup.organization_id,
    applicationId,
  });
  return (
    <div className="space-y-5">
      <Paragraph>
        Staging and production each have their own Central, so each has its own connection: its own token, Organization ID and Hub secret.
        Make the connection in each Central first. Then keep the two apart in GitHub. How depends on what you are allowed to change:
      </Paragraph>
      <div role="radiogroup" aria-label="What you can change in GitHub" className="grid gap-2 md:grid-cols-3">
        {GITHUB_MODES.map((item) => (
          <Link
            key={item.id}
            to={hrefFor("deploy", { github: item.id })}
            role="radio"
            aria-checked={mode === item.id}
            className={cn(
              "flex flex-col gap-0.5 rounded-xl border p-3 text-left transition-colors",
              mode === item.id ? "border-(--mws-burgundy) bg-[#7E15180D]" : "border-(--mws-line) bg-white hover:border-(--mws-burgundy)",
            )}
          >
            <span className="text-sm font-semibold text-(--mws-charcoal)">{item.label}</span>
            <span className="text-xs leading-5 text-(--mws-muted)">{item.text}</span>
          </Link>
        ))}
      </div>

      {mode === "environments" ? (
        <div role="note" className="rounded-xl border border-[#d8b45b] bg-[#fff8e8] p-4 text-sm leading-6 text-[#745716]">
          <p className="font-semibold">Not on the Repository secrets page.</p>
          <p className="mt-1">
            Repository secrets are shared by every branch, so a token put there would be used by both staging and production. Use them only
            for values that are really the same in both. The token, the Central address and the Hub secret go inside an environment.
          </p>
        </div>
      ) : null}
      {mode === "prefixed" ? (
        <div role="note" className="rounded-xl border border-[#d8b45b] bg-[#fff8e8] p-4 text-sm leading-6 text-[#745716]">
          <p className="font-semibold">Without Environments, the name keeps them apart.</p>
          <p className="mt-1">
            Every name gets STAGING_ or PRODUCTION_ in front, and the job picks by branch. Anyone who can write to the repository can use these
            secrets in a workflow, which is the same for any repository secret. The server and the application keep reading the plain names.
          </p>
        </div>
      ) : null}

      {mode === "owner" ? (
        <div className="space-y-3">
          <SubHeading>Send this to the repository owner</SubHeading>
          <Paragraph>
            Copy the message and send it. It says what to add and where, and the job to put in the workflow. The tokens are not in it: send
            them to the owner privately once you have them. Meanwhile you can finish On your machine and Send the permissions.
          </Paragraph>
          <Code>{message}</Code>
          <TextAction icon={Copy} onClick={() => copyText(message)}>
            Copy Message
          </TextAction>
        </div>
      ) : (
        <>
          <Paragraph>
            Only three names are set in GitHub: the address of Central, the token and the Organization ID. The deploy job reads these and
            nothing else. Every other line of the block is for the server and is not set in GitHub.
          </Paragraph>
          <div className="grid gap-5 2xl:grid-cols-2">
            {STANDARD_ENVIRONMENTS.map((name) => (
              <GithubEnvironmentCard key={name} name={name} here={name === github} rows={rowsOf(name)} mode={mode} />
            ))}
          </div>
          <ServerEnvCard rows={rowsOf(github ?? "staging")} environment={github ?? "staging"} />
          <div>
            <SubHeading>Send the permissions on every deploy</SubHeading>
            <div role="note" className="mb-3 rounded-xl border border-[#d8b45b] bg-[#fff8e8] p-4 text-sm leading-6 text-[#745716]">
              <p className="font-semibold">Does the repository already have a job that sends the permissions?</p>
              <p className="mt-1">
                Replace it with the job below, or make it read exactly the names in the table above. A job that reads other names finds
                them empty and fails with "not set".
                {mode === "environments"
                  ? " With Environments the job has an environment: line and reads the plain names."
                  : " Without Environments the job has no environment: line and reads the names with STAGING_ or PRODUCTION_ in front."}
              </p>
            </div>
            <Paragraph>
              Add this job to the deploy workflow. It runs after the deploy job and after Central itself is deployed in that environment.
              {mode === "environments"
                ? " The staging branch uses the staging environment and main uses production, so each takes the values of its own Central."
                : " The main branch reads the PRODUCTION_ names and every other branch reads the STAGING_ names. A missing production value is an error, it never falls back to staging."}{" "}
              Change deploy if your deploy job has another name. If the job stops, the message names the value that is missing.
            </Paragraph>
            <Paragraph>
              To stop a deploy when Central refuses the list, run this job before the deploy job instead: remove needs: deploy here and add
              this job to the needs of the deploy job.
            </Paragraph>
            <Code>{job}</Code>
            <TextAction className="mt-2" icon={Copy} onClick={() => copyText(job)}>
              Copy Job
            </TextAction>
            <Paragraph>It fails the deploy if Central says no.</Paragraph>
          </div>
          <div>
            <SubHeading>Check The Values</SubHeading>
            <Paragraph>
              Before the first deploy, run this on your machine with the token of that Central. It only reads. A list in the answer means the
              address and the token are right.
            </Paragraph>
            <Code>{checkText}</Code>
            <TextAction className="mt-2" icon={Copy} onClick={() => copyText(checkText)}>
              Copy Command
            </TextAction>
          </div>
        </>
      )}
      <DoneWhen>
        a deploy of the staging branch ends with the send-permissions job green, and the setup page in the staging Central shows Connected.
        Then do the same for production.
      </DoneWhen>
    </div>
  );
}

function RotatePart({ keys, environment, isHub }) {
  const steps = rotationSteps({ keys, environment });
  return (
    <div className="space-y-5">
      <Paragraph>
        A rotation gives a new value that the application does not have yet. Until it is put in every place the old one lives, something
        stops working. These are the places, in order.
      </Paragraph>
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
      <DoneWhen>the application runs with the new value in every place, and the setup page shows Connected again.</DoneWhen>
    </div>
  );
}

function TroubleshootingPart({ keys, applicationId }) {
  const names = keys.map((item) => item.key).join(", ");
  return (
    <dl className="space-y-4 text-sm leading-6">
      {[
        [
          "Still nothing after 10 minutes",
          `The token of the connection has not been used. Check that the .env has ${names}, that no older variable with another name is read first, that the application was restarted, and that the block was made for this application (its ID is ${applicationId}).`,
        ],
        ["The check answers 401", "The token or the address is not the one from the connection. Make a new token with Rotate Token and copy the block again."],
        ["Permissions do not show up", "The script has to run with the same .env, and Central has to be reachable from where it runs. Run it by hand and read the answer: a 4xx says what to fix."],
        ["The deploy job cannot see a secret", "With Environments the job needs the environment: line. Without them the names need the STAGING_ or PRODUCTION_ in front. A secret added after the run started is not seen by that run."],
        ["The Hub or the application refuses the other", "After a Hub secret rotation both sides need the new HUB_INTERNAL_SECRET. An old version is refused about a minute after the rotation."],
      ].map(([question, answer]) => (
        <div key={question}>
          <dt className="font-semibold text-(--mws-charcoal)">{question}</dt>
          <dd className="mt-0.5 text-(--mws-muted)">{answer}</dd>
        </div>
      ))}
    </dl>
  );
}
