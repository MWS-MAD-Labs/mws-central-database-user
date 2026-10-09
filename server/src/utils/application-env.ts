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
};

// A value in double quotes, with \ and " escaped so it reads back the same.
export function quoteEnv(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const item = (key: string, value: string, group: number, secret = false): EnvItem => ({
  key,
  value,
  secret,
  group,
  line: `${key}=${quoteEnv(value)}`,
});

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
};

// The lines an application needs in its .env. Each application reads its own names, so the Hub gets the
// ones the Hub reads, and the others get the ones the apps read.
export function buildEnvItems(facts: Facts): EnvItem[] {
  if (facts.isHub) {
    const settings = facts.hubSettings ?? resolveHubSettings(null);
    return [
      item("CENTRAL_API_BASE_URL", `${facts.publicUrl}/api/internal`, 0),
      item("CENTRAL_API_TOKEN", facts.token, 0, true),
      item("HUB_CENTRAL_ACCESS_MODE", settings.hub_access_mode, 1),
      item("HUB_CENTRAL_ACCESS_APP_ID", facts.applicationId, 1),
      item("HUB_CENTRAL_ACCESS_BYPASS_EMAILS", settings.hub_bypass_emails.join(","), 1),
    ];
  }
  return [
    item("HUB_SSO_APP_ID", facts.applicationId, 0),
    item("CENTRAL_DATA_API_BASE_URL", facts.publicUrl, 0),
    item("CENTRAL_DATA_API_TOKEN", facts.token, 0, true),
    item("CENTRAL_ORGANIZATION_ID", facts.organizationId, 0),
  ];
}

// The same lines as one text, with a blank line between groups.
export function envText(items: EnvItem[]): string {
  return items
    .map((entry, index) => (index > 0 && items[index - 1]!.group !== entry.group ? `\n${entry.line}` : entry.line))
    .join("\n");
}
