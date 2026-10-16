export type HubAccessMode = "off" | "warn" | "enforce";

// What the Hub is told about who may sign in. Kept on the Hub's own application in Central.
export type HubEnvSettings = { hub_access_mode: HubAccessMode; hub_bypass_emails: string[] };

export type EnvItem = {
  key: string;
  value: string;
  // The token. It is hidden on screen and copied with the rest.
  secret: boolean;
  // Lines of one group sit together, groups are apart by a blank line.
  group: number;
  // The line as it is written in the .env, with the value quoted.
  line: string;
  // A comment written above the first line of a group, saying where the lines come from and what changes them.
  heading?: string;
};

// A value in double quotes, with \ and " escaped so it reads back the same.
export function quoteEnv(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const item = (key: string, value: string, group: number, secret = false, heading?: string): EnvItem => ({
  key,
  value,
  secret,
  group,
  line: `${key}=${quoteEnv(value)}`,
  ...(heading ? { heading } : {}),
});

const HEADINGS = {
  application: "This application. Fixed when it is added.",
  central: "Connection to Central. Its own token. Changes when this application's token is rotated.",
  hubShared: "From the Hub, the same for every application. Changes only if the Hub's address changes.",
  hubSecret:
    "From the Hub, shared with the other applications that have not moved to their own. Changes only when the Hub secret is rotated. Give this application its own secret.",
  hubSecretOwn:
    "From the Hub, for this application only. Changes when this application's Hub secret is rotated, or when the Hub secret is.",
  hubSession:
    "From the Hub. This application reads the Hub's session, so it needs only the Hub's address and no secret. Changes only if the Hub's address changes.",
  hubOwnCentral: "The Hub's own connection to Central. Changes when the Hub's token is rotated.",
  hubSignIn: "How the Hub checks who may sign in. Changes in the Hub setup wizard.",
  hubMaster: "The Hub's master secret. Never copy it into another application. Changes only when it is rotated here.",
};

// The Hub's signing key lines. Made once when the key is made, and never read back from Central.
// The key is written without quoteEnv: its line breaks are already a backslash and n, which the Hub turns back into
// line breaks, and doubling the backslash would leave a stray one in front of every line of the PEM.
export function hubKeyEnvItems(kid: string, privatePemOneLine: string): EnvItem[] {
  return [
    {
      key: "HUB_SSO_PRIVATE_KEY",
      value: privatePemOneLine,
      secret: true,
      group: 0,
      line: `HUB_SSO_PRIVATE_KEY="${privatePemOneLine}"`,
      heading: "The Hub's signing key. Shown once and not kept in Central. Changes only when a new key is made here.",
    },
    item("HUB_SSO_KEY_ID", kid, 0),
  ];
}

// Safe by default: people still get in, and whoever would be turned away is only logged.
export function resolveHubSettings(stored: unknown, adminEmail?: string): HubEnvSettings {
  const value = (stored ?? {}) as Partial<HubEnvSettings>;
  const mode = value.hub_access_mode === "off" || value.hub_access_mode === "enforce" ? value.hub_access_mode : "warn";
  const emails = Array.isArray(value.hub_bypass_emails)
    ? value.hub_bypass_emails
    : adminEmail
      ? [adminEmail]
      : [];
  return { hub_access_mode: mode, hub_bypass_emails: emails };
}

type Facts = {
  applicationId: string;
  organizationId: string;
  publicUrl: string;
  token: string;
  isHub: boolean;
  hubSettings?: HubEnvSettings;
  // What the Hub shares with the applications. Missing until the Hub has its address and secret.
  hub?: HubFacts;
  // The secret in `hub` was made for this application alone, not the Hub's master secret.
  hubSecretOwn?: boolean;
  // shared: the application reads the Hub's session and needs neither a secret nor the Hub's keys address.
  sessionMode?: "relay" | "shared";
};

export type HubFacts = { baseUrl: string | null; secret: string | null };

// The lines every application that signs in through the Hub reads about the Hub.
function hubLines(hub: HubFacts | undefined, group: number, secretHeading = HEADINGS.hubSecret): EnvItem[] {
  if (!hub) return [];
  const lines: EnvItem[] = [];
  if (hub.baseUrl) {
    const base = hub.baseUrl.replace(/\/+$/, "");
    lines.push(
      item("HUB_BASE_URL", base, group, false, HEADINGS.hubShared),
      item("HUB_SSO_JWKS_URL", `${base}/.well-known/jwks.json`, group),
    );
  }
  if (hub.secret) lines.push(item("HUB_INTERNAL_SECRET", hub.secret, hub.baseUrl ? group + 1 : group, true, secretHeading));
  return lines;
}

// Whether an application's block lacks the Hub lines, so the screen can say why.
export function hubLinesMissing(facts: Pick<Facts, "isHub" | "hub" | "sessionMode">): boolean {
  if (facts.isHub) return false;
  if (facts.sessionMode === "shared") return !facts.hub?.baseUrl;
  return !(facts.hub?.baseUrl && facts.hub?.secret);
}

// The lines an application needs in its .env. Every application gets the same names. The Hub also gets
// the lines only it reads.
export function buildEnvItems(facts: Facts): EnvItem[] {
  if (facts.isHub) {
    const settings = facts.hubSettings ?? resolveHubSettings(null);
    return [
      item("CENTRAL_API_BASE_URL", `${facts.publicUrl}/api/internal`, 0, false, HEADINGS.hubOwnCentral),
      item("CENTRAL_API_TOKEN", facts.token, 0, true),
      item("CENTRAL_ORGANIZATION_ID", facts.organizationId, 0),
      item("HUB_CENTRAL_ACCESS_MODE", settings.hub_access_mode, 1, false, HEADINGS.hubSignIn),
      item("HUB_CENTRAL_ACCESS_APP_ID", facts.applicationId, 1),
      item("HUB_CENTRAL_ACCESS_BYPASS_EMAILS", settings.hub_bypass_emails.join(","), 1),
      // The Hub's own address is not read by the Hub. The secret is the same one the applications get.
      ...hubLines(facts.hub ? { baseUrl: null, secret: facts.hub.secret } : undefined, 2, HEADINGS.hubMaster),
    ];
  }
  // Every other application gets the same block, only its id, token and organization differ.
  return [
    item("HUB_SSO_APP_ID", facts.applicationId, 0, false, HEADINGS.application),
    item("CENTRAL_API_BASE_URL", `${facts.publicUrl}/api/internal`, 1, false, HEADINGS.central),
    item("CENTRAL_API_TOKEN", facts.token, 1, true),
    item("CENTRAL_ORGANIZATION_ID", facts.organizationId, 1),
    ...(facts.sessionMode === "shared"
      ? facts.hub?.baseUrl
        ? [item("HUB_BASE_URL", facts.hub.baseUrl.replace(/\/+$/, ""), 2, false, HEADINGS.hubSession)]
        : []
      : hubLines(facts.hub, 2, facts.hubSecretOwn ? HEADINGS.hubSecretOwn : HEADINGS.hubSecret)),
  ];
}

// The same lines as one text, each group under its comment and a blank line between groups.
export function envText(items: EnvItem[]): string {
  return items
    .map((entry, index) => {
      const newGroup = index === 0 || items[index - 1]!.group !== entry.group;
      const heading = newGroup && entry.heading ? `# ${entry.heading}\n` : "";
      return `${index > 0 && newGroup ? "\n" : ""}${heading}${entry.line}`;
    })
    .join("\n");
}
