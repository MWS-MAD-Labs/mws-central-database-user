import { describe, expect, it } from "bun:test";
import { buildEnvItems, envText, hubLinesMissing, quoteEnv, resolveHubSettings } from "../utils/application-env";

const facts = { organizationId: "org_x_abc", publicUrl: "https://db.mws.web.id", token: "mws_abc.def" };

describe("application env", () => {
  const hub = { baseUrl: "https://app.mws.web.id/", secret: "s3cret" };

  it("gives every application the Hub lines when the Hub has an address and a secret", () => {
    for (const applicationId of ["exima", "daily-checkin"]) {
      const items = buildEnvItems({ ...facts, applicationId, isHub: false, hub });
      const byKey = Object.fromEntries(items.map((item) => [item.key, item]));
      expect(byKey.HUB_BASE_URL!.line).toBe('HUB_BASE_URL="https://app.mws.web.id"');
      expect(byKey.HUB_SSO_JWKS_URL!.value).toBe("https://app.mws.web.id/.well-known/jwks.json");
      expect(byKey.HUB_INTERNAL_SECRET!.secret).toBe(true);
      expect(hubLinesMissing({ isHub: false, hub })).toBe(false);
    }
  });

  it("writes where each group of lines comes from, so a rotation is clear", () => {
    const text = envText(buildEnvItems({ ...facts, applicationId: "exima", isHub: false, hub }));
    expect(text).toContain("# From the Hub, the same for every application. Changes only if the Hub's address changes.");
    expect(text).toContain("# From the Hub, shared with the other applications that have not moved to their own.");
    expect(envText(buildEnvItems({ ...facts, applicationId: "exima", isHub: false, hub, hubSecretOwn: true }))).toContain(
      "# From the Hub, for this application only.",
    );
    const hubText = envText(buildEnvItems({ ...facts, applicationId: "hub", isHub: true, hub }));
    expect(hubText).toContain("# The Hub's master secret. Never copy it into another application.");
    // Every comment sits directly above its first line.
    expect(text.split("\n").filter((line) => line.startsWith("#")).length).toBe(4);
  });

  it("gives an application that reads the Hub session only the Hub address, with no secret and no keys address", () => {
    const items = buildEnvItems({ ...facts, applicationId: "exima", isHub: false, hub, sessionMode: "shared" });
    expect(items.map((item) => item.key)).toEqual(["HUB_SSO_APP_ID", "CENTRAL_API_BASE_URL", "CENTRAL_API_TOKEN", "CENTRAL_ORGANIZATION_ID", "HUB_BASE_URL"]);
    expect(items.find((item) => item.key === "HUB_BASE_URL")!.line).toBe('HUB_BASE_URL="https://app.mws.web.id"');
    expect(envText(items)).toContain("reads the Hub's session");
    // Only the address is needed, so a missing secret is not a problem.
    expect(hubLinesMissing({ isHub: false, hub: { baseUrl: "https://app.mws.web.id", secret: null }, sessionMode: "shared" })).toBe(false);
    expect(hubLinesMissing({ isHub: false, hub: { baseUrl: null, secret: "s" }, sessionMode: "shared" })).toBe(true);
    // The older way still needs both.
    expect(hubLinesMissing({ isHub: false, hub: { baseUrl: "https://app.mws.web.id", secret: null }, sessionMode: "relay" })).toBe(true);
  });

  it("leaves the Hub lines out and says so when the Hub has no address or secret yet", () => {
    const items = buildEnvItems({ ...facts, applicationId: "exima", isHub: false, hub: { baseUrl: null, secret: null } });
    expect(items.some((item) => item.key.startsWith("HUB_BASE") || item.key === "HUB_INTERNAL_SECRET")).toBe(false);
    expect(hubLinesMissing({ isHub: false, hub: { baseUrl: null, secret: "x" } })).toBe(true);
    expect(hubLinesMissing({ isHub: true, hub: undefined })).toBe(false);
  });

  it("gives the Hub the same secret but not its own address", () => {
    const items = buildEnvItems({ ...facts, applicationId: "hub", isHub: true, hub });
    expect(items.map((item) => item.key)).toContain("HUB_INTERNAL_SECRET");
    expect(items.map((item) => item.key)).not.toContain("HUB_BASE_URL");
  });

  it("quotes values and escapes what would break the line", () => {
    expect(quoteEnv("plain")).toBe('"plain"');
    expect(quoteEnv('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it("gives an application the names the applications read, all in quotes", () => {
    const items = buildEnvItems({ ...facts, applicationId: "exima", isHub: false });
    expect(envText(items)).toBe(
      [
        "# This application. Fixed when it is added.",
        'HUB_SSO_APP_ID="exima"',
        "",
        "# Connection to Central. Its own token. Changes when this application's token is rotated.",
        'CENTRAL_API_BASE_URL="https://db.mws.web.id/api/internal"',
        'CENTRAL_API_TOKEN="mws_abc.def"',
        'CENTRAL_ORGANIZATION_ID="org_x_abc"',
      ].join("\n"),
    );
    expect(items.filter((item) => item.secret).map((item) => item.key)).toEqual(["CENTRAL_API_TOKEN"]);
  });

  it("gives the Hub the names the Hub reads, with the address ending in /api/internal", () => {
    const items = buildEnvItems({
      ...facts,
      applicationId: "hub",
      isHub: true,
      hubSettings: { hub_access_mode: "enforce", hub_bypass_emails: ["a@millennia21.id", "b@millennia21.id"] },
    });
    expect(envText(items)).toBe(
      [
        "# The Hub's own connection to Central. Changes when the Hub's token is rotated.",
        'CENTRAL_API_BASE_URL="https://db.mws.web.id/api/internal"',
        'CENTRAL_API_TOKEN="mws_abc.def"',
        "",
        "# How the Hub checks who may sign in. Changes in the Hub setup wizard.",
        'HUB_CENTRAL_ACCESS_MODE="enforce"',
        'HUB_CENTRAL_ACCESS_APP_ID="hub"',
        'HUB_CENTRAL_ACCESS_BYPASS_EMAILS="a@millennia21.id,b@millennia21.id"',
      ].join("\n"),
    );
    // The Hub does not read these two, so they are not sent.
    expect(items.map((item) => item.key)).not.toContain("HUB_SSO_APP_ID");
    expect(items.map((item) => item.key)).not.toContain("CENTRAL_ORGANIZATION_ID");
    expect(items.find((item) => item.key === "CENTRAL_API_TOKEN")?.secret).toBe(true);
  });

  it("gives Daily Check-in the same block as every other application", () => {
    const text = (applicationId: string) => envText(buildEnvItems({ ...facts, applicationId, isHub: false }));
    expect(text("daily-checkin")).toBe(text("exima").replace('HUB_SSO_APP_ID="exima"', 'HUB_SSO_APP_ID="daily-checkin"'));
    expect(text("daily-checkin")).toContain('CENTRAL_ORGANIZATION_ID="org_x_abc"');
    expect(text("daily-checkin")).not.toContain("CENTRAL_ENTITLEMENT_ORGANIZATION_ID");
  });

  it("starts safe: warn, and the admin who sets it up gets in", () => {
    expect(resolveHubSettings(null, "me@millennia21.id")).toEqual({ hub_access_mode: "warn", hub_bypass_emails: ["me@millennia21.id"] });
    expect(resolveHubSettings({ hub_access_mode: "enforce", hub_bypass_emails: [] }, "me@millennia21.id")).toEqual({
      hub_access_mode: "enforce",
      hub_bypass_emails: [],
    });
    expect(resolveHubSettings({ hub_access_mode: "nonsense" }).hub_access_mode).toBe("warn");
  });
});

describe("pasted Hub secret", () => {
  it("takes the value out of a whole .env line", async () => {
    const { cleanPastedSecret } = await import("../validation/application-entitlement-validation");
    const raw = "a".repeat(32);
    expect(cleanPastedSecret(`HUB_INTERNAL_SECRET="${raw}"`)).toBe(raw);
    expect(cleanPastedSecret(`  ${raw} `)).toBe(raw);
    expect(cleanPastedSecret(`HUB_INTERNAL_SECRET='${raw}'`)).toBe(raw);
    const { NOT_A_HUB_SECRET } = await import("../validation/application-entitlement-validation");
    expect(NOT_A_HUB_SECRET.test(`CENTRAL_API_TOKEN="mws_abc.def"`)).toBe(true);
    expect(NOT_A_HUB_SECRET.test("mws_abc.def")).toBe(true);
    expect(NOT_A_HUB_SECRET.test(raw)).toBe(false);
    // Wrapped again and again by earlier copies.
    expect(cleanPastedSecret(`HUB_INTERNAL_SECRET="HUB_INTERNAL_SECRET=\\"${raw}\\""`)).toBe(raw);
  });
});
