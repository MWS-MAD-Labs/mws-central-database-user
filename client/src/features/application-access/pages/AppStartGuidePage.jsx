import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { GuideNav } from "../components/guide/GuideNav.jsx";
import { Code, DoneWhen, Paragraph, Steps, SubHeading } from "../components/guide/GuidePieces.jsx";
import { canManageApplications } from "../utils/canManageApplications.js";

const PARTS = [
  { id: "how", label: "How it fits" },
  { id: "hub", label: "Add the Hub first" },
  { id: "app", label: "Add an application" },
  { id: "signin", label: "Choose the sign-in way" },
  { id: "check", label: "Check it works" },
  { id: "problems", label: "When something fails" },
];

const KEY_COMMANDS = `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out hub-sso-private.pem
openssl rsa -pubout -in hub-sso-private.pem -out hub-sso-public.pem`;

const ENVIRONMENT_NAMES = { development: "Development", staging: "Staging", production: "Production" };

// The whole way from nothing to a connected application, before any application exists. The guide of one application
// (its Setup Guide) takes over once it has been added. Values are filled in only for the Central being looked at.
export function AppStartGuidePage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const contextQuery = useQuery({
    queryKey: ["application-access", "context"],
    queryFn: () => applicationAccessApi.context(),
    enabled: canManageApplications(user),
  });

  if (!canManageApplications(user)) {
    return (
      <div className="min-w-0">
        <PageHeader title="Start Here" />
        <PanelMessage>Only a protected Super Admin can manage application access.</PanelMessage>
      </div>
    );
  }

  const environment = contextQuery.data?.environment ?? "";
  const hubUrl = contextQuery.data?.suggested_hub_url ?? "";
  const part = PARTS.some((item) => item.id === params.get("part")) ? params.get("part") : "how";
  const index = PARTS.findIndex((item) => item.id === part);
  const hrefFor = (id) => `?part=${id}`;
  const context = { environment, hubUrl };
  const body = {
    how: <HowPart {...context} />,
    hub: <HubPart {...context} />,
    app: <AppPart {...context} />,
    signin: <SignInPart />,
    check: <CheckPart {...context} />,
    problems: <ProblemsPart />,
  }[part];
  const previous = PARTS[index - 1];
  const next = PARTS[index + 1];

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title="Start Here"
        description={`How to connect the Hub and the applications to this Central, from nothing${environment ? `. You are in the ${ENVIRONMENT_NAMES[environment] ?? environment} Central` : ""}.`}
        actions={
          <Button asChild variant="secondary" size="icon" aria-label="Back To Applications" title="Back To Applications">
            <Link to="/application-access"><ArrowLeft size={16} /></Link>
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-6">
        <GuideNav parts={PARTS} current={part} hrefFor={hrefFor} />
        <article aria-label={PARTS[index].label} className="min-w-0 space-y-5 rounded-2xl border border-(--mws-line) bg-white p-5 md:p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-(--mws-muted)">
              Part {index + 1} of {PARTS.length}
            </p>
            <h2 className="font-display text-xl font-bold text-(--mws-charcoal)">{PARTS[index].label}</h2>
          </div>
          {body}
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
              <Button asChild size="icon" aria-label="Back To Applications" title="Back To Applications">
                <Link to="/application-access"></Link>
              </Button>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}

function HowPart({ environment }) {
  return (
    <div className="space-y-5">
      <Paragraph>
        Three things work together. Central knows who may use which application and with what role. The Hub is the page where people sign
        in and open applications. Each application asks the Hub who the person is and asks Central what they may do.
      </Paragraph>
      <div>
        <SubHeading>The order</SubHeading>
        <Steps
          items={[
            "Run the Hub, then add it here. Its key, token and secret come in one block to copy. Nothing else can start before the Hub can sign people in.",
            "Every application gets the Hub address and its connection to Central from that, so Central adds no other application before it.",
            "Deploy each application with the lines Central gives it, then add it here.",
            "Make roles, then groups of people, so people have access.",
            "Choose how people sign in to each application.",
          ]}
        />
      </div>
      <div>
        <SubHeading>One of everything per environment</SubHeading>
        <Paragraph>
          Development, staging and production each have their own Central, their own Hub and their own tokens. A token made in one does not
          work in another, and the addresses must never be mixed.
          {environment ? ` This page is about the ${ENVIRONMENT_NAMES[environment] ?? environment} Central you are in.` : ""}
        </Paragraph>
      </div>
      <div>
        <SubHeading>What you need</SubHeading>
        <Steps
          items={[
            "A protected Super Admin account in this Central.",
            "APP_SECRETS_KEY in this Central's own .env. Without it Central cannot keep the Hub secret and the Secret step shows a warning. Make the line with bun run secrets:key in the server folder, then restart Central.",
            "Access to the server where the Hub and the applications run, to set their environment lines.",
            "Access to the GitHub repository of each one, when it deploys by itself.",
          ]}
        />
      </div>
      <DoneWhen>you know what comes first. Open the next part and start with the Hub.</DoneWhen>
    </div>
  );
}

function HubPart({ hubUrl }) {
  return (
    <div className="space-y-5">
      <Paragraph>
        The Hub comes first because every application is given its address. Central will not add any other application until the Hub is
        added, and Add Application opens as the Hub until then. The Hub only has to be running when you add it. Its key, token and
        secret all come in one block at the end, so the .env is filled once.
      </Paragraph>
      <div>
        <SubHeading>1. Run the Hub</SubHeading>
        <Paragraph>
          Deploy the Hub, or start it on your machine. It can run without its .env lines for now, Central only needs to find it at its
          address. Set what the Hub has always needed: FRONTEND_ORIGIN (the address people open the Hub at, with https), JWT_SECRET, and
          the Google sign-in lines (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ALLOWED_DOMAIN), as in the Hub's own setup notes. Also set
          CENTRAL_API_BASE_URL to the address of this Central, ending in /api/internal.
        </Paragraph>
      </div>
      <div>
        <SubHeading>2. Add the Hub here</SubHeading>
        <Steps
          items={[
            "Applications, Add Application. The page is the Hub already when none exists.",
            "Key: choose Make Signing Key. Central makes the key and keeps only its name and fingerprint. The key itself waits in this page until the last step, so do not close the page before you finish.",
            "Address: type the address of the Hub. Central says Found The Hub. A Hub that does not have the key yet is fine here.",
            "Secret: Central makes one secret shared by the Hub and the applications that sign in through it, or you paste the one the Hub already has. Applications get their own secret made from it.",
            "Sign-in: how strictly the Hub checks who may sign in.",
            "Review, then Add Hub.",
          ]}
        />
      </div>
      <div>
        <SubHeading>3. Copy the block once</SubHeading>
        <Paragraph>
          After Add Hub one block of lines appears, once: the signing key (HUB_SSO_PRIVATE_KEY and HUB_SSO_KEY_ID), the token, the
          sign-in lines, CENTRAL_ORGANIZATION_ID and the secret. Copy all of it into the Hub's environment and deploy or restart the Hub. HUB_COOKIE_DOMAIN, the
          parent domain the Hub and the applications on the shared sign-in share, like mws.web.id, can wait until an application uses it.
        </Paragraph>
      </div>
      <div>
        <SubHeading>4. Check that the Hub publishes its key</SubHeading>
        <Paragraph>
          Open {hubUrl ? hubUrl : "the address of the Hub"}/.well-known/jwks.json in a browser. You should see a block of text that starts with
          {" "}
          {`{"keys":[`}. An error page there means the key line is missing or broken.
        </Paragraph>
      </div>
      <div>
        <SubHeading>If the Hub already has a key</SubHeading>
        <Paragraph>
          Choose I Already Have A Key in the Key step and keep its lines in the Hub. To make one by hand, on your machine, once for each
          environment:
        </Paragraph>
        <Code>{KEY_COMMANDS}</Code>
        <Paragraph>
          HUB_SSO_PRIVATE_KEY is the whole private file as one line with each line break written as \n, starting with BEGIN PRIVATE KEY
          (PKCS#8), not BEGIN RSA PRIVATE KEY. The public file is not needed anywhere, the Hub publishes it by itself.
        </Paragraph>
      </div>
      <div>
        <SubHeading>5. Send the Hub's permissions</SubHeading>
        <Paragraph>
          The Hub's own deploy does this, from the Hub's GitHub repository. It needs these repository secrets for each environment:
          CENTRAL_API_BASE_URL_STAGING and CENTRAL_API_TOKEN_STAGING (or the _PRODUCTION pair), and the Komodo webhook URL and secret. Set
          them before the first push, otherwise that step stops the deploy.
        </Paragraph>
      </div>
      <DoneWhen>the Hub is in the list of applications and its status says it is connected.</DoneWhen>
    </div>
  );
}

function AppPart() {
  return (
    <div className="space-y-5">
      <Paragraph>The same way for every application. The Hub has to be added already, Central refuses any other application before that.</Paragraph>
      <div>
        <SubHeading>1. Add it here</SubHeading>
        <Steps
          items={[
            "Applications, Add Application: name it. The ID is made from the name and cannot change later.",
            "Say how the Hub shows it (icon, group, description) and what it may read from Central. Employees is the default.",
            "Add it. A block of environment lines appears once, with the token and CENTRAL_ORGANIZATION_ID. Copy it before you close the box. If you lose it, rotate the token.",
          ]}
        />
      </div>
      <div>
        <SubHeading>2. Give the token what the application reads</SubHeading>
        <Paragraph>
          The token only opens the data you picked under Data Access. An application that reads students needs students:read, one that
          reads who teaches a class needs class_teacher_assignments:read. When a scope is missing, Central answers 403 with the name of the
          scope, and the application skips that list without saying so on screen. Change it on the application's page, then deploy again
          if the token changed.
        </Paragraph>
      </div>
      <div>
        <SubHeading>3. Set the environment on the application's server</SubHeading>
        <Steps
          items={[
            "Put the lines from step 1 in the application's environment on the server, and in its .env on your machine.",
            "Deploy the application. Central shows it as connected as soon as it calls Central with the token.",
            "The application sends CENTRAL_ORGANIZATION_ID with every call. Settings shows Matches when it is the one Central made, and Does Not Match when it was copied wrong or taken from another environment.",
            "The address of the application is checked every few minutes. If its page says it is down, open that address yourself first.",
          ]}
        />
      </div>
      <div>
        <SubHeading>4. Send its permissions</SubHeading>
        <Paragraph>
          The application sends its permissions to Central, usually from its own deploy or a command in its repository, with the
          CENTRAL_API_BASE_URL and CENTRAL_API_TOKEN secrets set for that environment. Roles can only use permissions it has sent, and a
          deploy that cannot send them stops.
        </Paragraph>
      </div>
      <div>
        <SubHeading>5. Roles and groups</SubHeading>
        <Paragraph>Make the roles, then the groups of people that get a role. Without a group nobody has access.</Paragraph>
      </div>
      <div>
        <SubHeading>Notes for the applications we run</SubHeading>
        <Steps
          items={[
            "Daily Check-in: run the permission sync with the removals confirmed, give its token students:read and class_teacher_assignments:read, fill the role permissions here, and back up the database before the people migration.",
            "Exima: create the GitHub environments staging and production, each with the Central address and token and the Komodo webhook. The first push to staging creates the branch on GitHub.",
            "MTSS (older): it keeps the Hub code and token way until it reads the shared session.",
          ]}
        />
      </div>
      <Paragraph>
        Once the application is added, its own Setup Guide continues with the commands, the GitHub settings per environment and what to do
        when you rotate the token. It is on the setup page of that application.
      </Paragraph>
      <DoneWhen>the application is connected, its permissions are sent and a person in a group can open it from the Hub.</DoneWhen>
    </div>
  );
}

function SignInPart() {
  return (
    <div className="space-y-5">
      <Paragraph>Each application has one of two ways to sign people in. You choose it in the application's settings.</Paragraph>
      <div>
        <SubHeading>Hub Code And Token (Legacy)</SubHeading>
        <Paragraph>
          The Hub hands the application a short code and the application trades it for a token. Each application keeps its own session, so
          it works for any address. Applications that have not been changed yet use this.
        </Paragraph>
      </div>
      <div>
        <SubHeading>Shared Hub Session</SubHeading>
        <Paragraph>
          Signing in once covers every application. They read the Hub's session from a cookie on the parent domain, so the Hub and the
          application must be subdomains of the same domain, and the Hub needs HUB_COOKIE_DOMAIN set to it.
        </Paragraph>
        <Paragraph>
          Every application on the shared session has to be under the same parent as the Hub. With the Hub at app.mws.web.id the parent is
          mws.web.id, so daily.mws.web.id works. web.id alone does not count, and another domain like millenniaws.sch.id never gets the cookie.
          Central checks the addresses and marks an application on another domain as Different Domain. You can still switch it, but nobody can
          sign in to it with the shared session and signing out of the Hub does not end a session it still holds. Keep it on Hub Code & Token
          (Legacy) until it moves.
        </Paragraph>
      </div>
      <div>
        <SubHeading>Switching</SubHeading>
        <Steps
          items={[
            "Deploy the application with the code that reads the shared session first.",
            "Set HUB_COOKIE_DOMAIN on the Hub and deploy the Hub again.",
            "Change the way here. Central keeps the old way open until it has seen the application use the new one.",
          ]}
        />
      </div>
      <DoneWhen>the application shows the sign-in way you chose and the warning about waiting for proof is gone.</DoneWhen>
    </div>
  );
}

function CheckPart({ hubUrl }) {
  return (
    <div className="space-y-5">
      <Steps
        items={[
          `Open ${hubUrl || "the Hub"} in a private window and sign in with an account that belongs to a group.`,
          "The application's card should be there. Open it: you land inside without another sign-in.",
          "Back in Central, the application's page shows Connected and when it last called.",
          "Sign out of the Hub. Opening the application again must ask you to sign in.",
        ]}
      />
      <DoneWhen>a person in a group opens the application from the Hub and signing out of the Hub signs them out of it.</DoneWhen>
    </div>
  );
}

const PROBLEMS = [
  {
    message: "A Hub answers here, but it has no sign-in key yet",
    cause: "The Hub is running but HUB_SSO_PRIVATE_KEY is missing or not a PKCS#8 PEM.",
    fix: "Add the Hub in Central and copy the block at the end into the Hub's environment, or write your own as one line with \\n for the line breaks. Deploy the Hub again, then open /.well-known/jwks.json to see the keys.",
  },
  {
    message: "The Hub runs with another key than the one made here",
    cause: "The Hub still has an older key, or the new lines were not deployed yet.",
    fix: "Deploy the Hub with the lines Central showed. If you made the key yourself, carry on, Central cannot tell it apart.",
  },
  {
    message: "Add the Hub first",
    cause: "An application was added before the Hub.",
    fix: "Add the Hub, then add the application again.",
  },
  {
    message: "Something answers, but it does not look like the Hub",
    cause: "The address is another website, or the port is wrong.",
    fix: "Use the address people open the Hub at, without a path.",
  },
  {
    message: "Nothing answers at this address",
    cause: "The Hub is down, or Central cannot reach it from where it runs.",
    fix: "Start the Hub. For a Hub that only runs on your machine, use the anyway option only if you are sure.",
  },
  {
    message: "Missing required scope",
    cause: "The token of that application was not given the scope it needs.",
    fix: "Add the scope to its API client in this Central, or change its data access on the application's page.",
  },
  {
    message: "One or more scopes do not exist or are inactive",
    cause: "This Central has not created its scope rows yet.",
    fix: "Restart Central once, it creates them when it starts.",
  },
  {
    message: "The deploy stops at sending the permissions",
    cause: "The Central address or token secret is missing in the GitHub repository, or the token is not allowed to send permissions.",
    fix: "Set the secrets for that environment and give the token the permissions scope, then run the job again.",
  },
];

function ProblemsPart() {
  return (
    <div className="space-y-4">
      <Paragraph>Find the message you saw. The cause and what to do are next to it.</Paragraph>
      <dl className="space-y-3">
        {PROBLEMS.map((item) => (
          <div key={item.message} className="rounded-xl border border-(--mws-line) bg-(--mws-soft) p-4">
            <dt className="text-sm font-semibold text-(--mws-charcoal)">{item.message}</dt>
            <dd className="mt-1 text-sm leading-6 text-(--mws-muted)">{item.cause}</dd>
            <dd className="mt-1 text-sm leading-6 text-(--mws-muted)">{item.fix}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
