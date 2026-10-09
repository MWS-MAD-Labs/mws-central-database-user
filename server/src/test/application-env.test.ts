import { describe, expect, it } from "bun:test";
import { buildEnvItems, envText, quoteEnv, resolveHubSettings } from "../utils/application-env";

const facts = { organizationId: "org_x_abc", publicUrl: "https://db.mws.web.id", token: "mws_abc.def" };

describe("application env", () => {
  it("quotes values and escapes what would break the line", () => {
    expect(quoteEnv("plain")).toBe('"plain"');
    expect(quoteEnv('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it("gives an application the names the applications read, all in quotes", () => {
    const items = buildEnvItems({ ...facts, applicationId: "exima", isHub: false });
    expect(envText(items)).toBe(
      [
        'HUB_SSO_APP_ID="exima"',
        'CENTRAL_DATA_API_BASE_URL="https://db.mws.web.id"',
        'CENTRAL_DATA_API_TOKEN="mws_abc.def"',
        'CENTRAL_ORGANIZATION_ID="org_x_abc"',
      ].join("\n"),
    );
    expect(items.filter((item) => item.secret).map((item) => item.key)).toEqual(["CENTRAL_DATA_API_TOKEN"]);
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
        'CENTRAL_API_BASE_URL="https://db.mws.web.id/api/internal"',
        'CENTRAL_API_TOKEN="mws_abc.def"',
        "",
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

  it("starts safe: warn, and the admin who sets it up gets in", () => {
    expect(resolveHubSettings(null, "me@millennia21.id")).toEqual({ hub_access_mode: "warn", hub_bypass_emails: ["me@millennia21.id"] });
    expect(resolveHubSettings({ hub_access_mode: "enforce", hub_bypass_emails: [] }, "me@millennia21.id")).toEqual({
      hub_access_mode: "enforce",
      hub_bypass_emails: [],
    });
    expect(resolveHubSettings({ hub_access_mode: "nonsense" }).hub_access_mode).toBe("warn");
  });
});
