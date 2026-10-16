import { describe, expect, it } from "bun:test";
import { Route, Routes } from "react-router";
import { screen, waitFor } from "@testing-library/react";
import { AuthContext } from "../../../src/features/auth/context/authContext.js";
import { ConfirmProvider } from "../../../src/components/ui/ConfirmDialog.jsx";
import { AppSettingsPage } from "../../../src/features/application-access/pages/AppSettingsPage.jsx";
import { renderWithProviders } from "../../helpers/render.jsx";
import { createFetchRouter, jsonResponse } from "../../helpers/http.js";

const APP = {
  application_id: "demo",
  name: "Demo App",
  description: null,
  icon: null,
  category: "reporting",
  launch_url: "https://demo.example.com/auth/sso",
  logout_url: null,
  published: true,
  retired_at: null,
  launch_mode: "sso",
  session_mode: "relay",
  uses_hub: true,
  hub_status: "maintenance",
  hub_keywords: ["checkin", "daily"],
};

function setup(overrides = {}) {
  return {
    application: APP,
    organization_id: "org_demo_abcdefghijklmnopqrst",
    connection: { client_id: "c1", created: true, last_used_at: new Date().toISOString() },
    permissions: { count: 4, synced_at: new Date().toISOString() },
    roles: { active_count: 2 },
    groups: { active_count: 1 },
    can_publish: true,
    setup_completed: true,
    missing: [],
    is_hub: false,
    env_settings: null,
    removal: { can_remove: false, retire_available: true },
    hub_secret: { mode: "shared", version: 1, applies: true },
    env_keys: [],
    environment: "development",
    data_access: { scope_names: ["application_entitlements:read"], editable: true },
    ...overrides,
  };
}

const SETTINGS = {
  created_at: "2026-10-03T08:00:00.000Z",
  updated_at: "2026-10-12T09:30:00.000Z",
  token: { prefix: "mws_702f6901a3f1", created_at: "2026-10-03T08:05:00.000Z", last_used_at: null, environment: "DEVELOPMENT" },
  access: {
    groups: 1,
    people: 128,
    exceptions: 2,
    blocked: 1,
    roles: [
      { id: "r1", key: "SUPPORT_STAFF", label: "support staff", is_active: true, permission_count: 3, people: 120, groups: 1 },
      { id: "r2", key: "ADMIN", label: "Admin", is_active: true, permission_count: 4, people: 8, groups: 0 },
    ],
  },
  activity: [
    { id: "a1", at: "2026-10-12T09:30:00.000Z", by: "Test Super Admin", by_role: "SUPER_ADMIN", by_email: "admin@example.com", title: "Details Changed", summary: "Changed the card status", changes: [{ label: "card status", from: "Active", to: "Maintenance" }, { label: "Hub secret" }], ip_address: "10.0.0.5" },
    { id: "a2", at: "2026-10-03T08:00:00.000Z", by: "Test Super Admin", by_role: "SUPER_ADMIN", title: "Added", summary: "Added the application", changes: [] },
  ],
  activity_paging: { current_page: 1, total_page: 2, total_item: 12, size: 10 },
};

export function routesFor(data, extra = []) {
  return [
    { path: "/api/admin/application-access/apps/demo/setup", response: () => jsonResponse({ data }) },
    { path: /\/api\/admin\/application-access\/apps\/demo\/settings/, response: () => jsonResponse({ data: SETTINGS }) },
    { path: /\/api\/admin\/application-access\/taxonomy/, response: () => jsonResponse({ data: { categories: [{ key: "reporting", name: "Reporting" }], scopes: [] } }) },
    { path: /internal-endpoints|data-access/, response: () => jsonResponse({ data: [] }) },
    ...extra,
  ];
}

function renderPage(data, route = "/application-access/apps/demo/settings", extra = []) {
  globalThis.fetch = createFetchRouter(routesFor(data, extra));
  return renderWithProviders(
    <AuthContext.Provider value={{ user: { role: "SUPER_ADMIN", is_protected: true } }}>
      <ConfirmProvider>
        <Routes>
          <Route path="/application-access/apps/:applicationId/settings" element={<AppSettingsPage />} />
          <Route path="/application-access/apps/:applicationId/setup" element={<div>Setup steps</div>} />
        </Routes>
      </ConfirmProvider>
    </AuthContext.Provider>,
    { route },
  );
}

describe("AppSettingsPage", () => {
  it("summarises the application on top and opens on the overview", async () => {
    renderPage(setup());
    expect(await screen.findByRole("heading", { name: "Demo App Settings" })).toBeVisible();
    expect(screen.getByText("Shown in the Hub")).toBeVisible();
    expect(screen.getByText("Connected")).toBeVisible();
    expect(screen.getByText(/Last Call/)).toBeVisible();
    expect(screen.getByText(/Groups? · \d+ Exceptions? · \d+ Blocked/)).toBeVisible();
    expect(screen.getByText("128 People With Access")).toBeVisible();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("https://demo.example.com/auth/sso")).toBeVisible();
    expect(screen.getByText("Reporting")).toBeVisible();
    expect(screen.getByRole("link", { name: /Setup Guide/ })).toHaveAttribute("href", "/application-access/apps/demo/guide?part=local");
    // One way to edit, and retiring is not a button on the page.
    expect(screen.getAllByRole("button", { name: /Edit/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Retire Application" })).toBeNull();
  });

  it("opens the details form with the status and keywords in it", async () => {
    const { user } = renderPage(setup());
    await user.click(await screen.findByRole("button", { name: "Edit Details" }));
    expect(await screen.findByLabelText("Keywords")).toHaveValue("checkin, daily");
  });

  it("shows the token, data access and the names it reads on the connection tab", async () => {
    const { user } = renderPage(setup());
    await user.click(await screen.findByRole("tab", { name: "Connection" }));
    // Only that there is a token and when it was made. Not the token, not even its beginning.
    expect(screen.getByText(/^Made \d{1,2} \w{3} 2026$/)).toBeVisible();
    expect(screen.queryByText(/mws_702f6901a3f1/)).toBeNull();
    expect(screen.getByText("Development")).toBeVisible();
    expect(screen.getByText("Permissions").previousElementSibling).toHaveTextContent("4");
    expect(screen.getByText("Scopes").previousElementSibling).toHaveTextContent("1");
    expect(screen.getByText("Last Call")).toBeVisible();
    expect(screen.getByText("application_entitlements:read")).toBeVisible();
    expect(screen.getByRole("button", { name: "Rotate Token" })).toBeVisible();
  });

  it("says how the application signs in, and shows the Hub secret only for the code and token way", async () => {
    const relay = renderPage(setup());
    await relay.user.click(await screen.findByRole("tab", { name: "Connection" }));
    expect(screen.getByText("Sign-In Way").nextElementSibling).toHaveTextContent("Hub Code & Token (Legacy)");
    expect(screen.getByText("Hub Secret").nextElementSibling).toHaveTextContent("Shared With Other Apps");
    relay.unmount();

    const shared = renderPage(setup({ application: { ...APP, session_mode: "shared" }, hub_secret: { mode: "shared", version: 1, applies: false } }));
    await shared.user.click(await screen.findByRole("tab", { name: "Connection" }));
    expect(screen.getByText("Sign-In Way").nextElementSibling).toHaveTextContent("Shared Hub Session");
    expect(screen.queryByText("Hub Secret")).toBeNull();
  });

  it("shows the card, its status and the switch on the Hub card tab, and hides it with one click", async () => {
    const calls = [];
    globalThis.fetch = createFetchRouter(
      routesFor(setup(), [
        {
          path: "/api/admin/application-access/apps/demo/unpublish",
          method: "POST",
          response: () => {
            calls.push("unpublish");
            return jsonResponse({ data: APP });
          },
        },
      ]),
    );
    const { user } = renderWithProviders(
      <AuthContext.Provider value={{ user: { role: "SUPER_ADMIN", is_protected: true } }}>
        <ConfirmProvider>
          <Routes>
            <Route path="/application-access/apps/:applicationId/settings" element={<AppSettingsPage />} />
          </Routes>
        </ConfirmProvider>
      </AuthContext.Provider>,
      { route: "/application-access/apps/demo/settings?tab=card" },
    );
    expect(await screen.findAllByText("Maintenance")).not.toHaveLength(0);
    expect(screen.getByText("In The Hub").previousElementSibling).toHaveTextContent("Shown");
    expect(screen.getByText("checkin, daily")).toBeVisible();
    expect(screen.getByText("Preview")).toBeVisible();
    await user.click(screen.getByRole("switch", { name: "Shown In Hub" }));
    // Nothing is sent until it is confirmed.
    expect(await screen.findByText(/Hide .* From The Hub/)).toBeVisible();
    expect(calls).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(calls).toEqual(["unpublish"]));
  });

  it("lists the roles with a name that has capitals and its own key column", async () => {
    renderPage(setup(), "/application-access/apps/demo/settings?tab=access");
    expect(await screen.findByRole("columnheader", { name: "Key" })).toBeVisible();
    expect(screen.getByText("Support Staff")).toBeVisible();
    expect(screen.getByText("SUPPORT_STAFF")).toBeVisible();
    // Two roles need no pager.
    expect(screen.queryByText(/ roles$/)).toBeNull();
    // Figures first, what they count under them.
    expect(screen.getByText("Active Groups").previousElementSibling).toHaveTextContent("1");
    expect(screen.getByText("People Reached").previousElementSibling).toHaveTextContent("128");
    expect(screen.getByText("Exceptions").previousElementSibling).toHaveTextContent("2");
    expect(screen.getByText("Blocked").previousElementSibling).toHaveTextContent("1");
  });

  it("shows the people of a role as a plain number, without an icon", async () => {
    renderPage(setup(), "/application-access/apps/demo/settings?tab=access");
    const cell = (await screen.findByText("120")).closest("td");
    expect(cell.querySelector("svg")).toBeNull();
  });

  it("links the address of the application so it can be opened from here", async () => {
    renderPage(setup());
    const link = await screen.findByRole("link", { name: "https://demo.example.com/" });
    expect(link).toHaveAttribute("href", "https://demo.example.com/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    // The sign-in address stays visible next to it.
    expect(screen.getByText("https://demo.example.com/auth/sso")).toBeVisible();
  });

  it("marks an application on the shared session that is under another domain than the Hub", async () => {
    const shared = { ...APP, session_mode: "shared", launch_url: "https://app.millenniaws.sch.id/daily-checkin/auth/sso" };
    const other = renderPage(setup({ application: shared, hub_address: "https://app.mws.web.id", hub_secret: { mode: "shared", version: 1, applies: false } }));
    await other.user.click(await screen.findByRole("tab", { name: "Connection" }));
    expect(screen.getByText("Sign-In Way").nextElementSibling).toHaveTextContent("Shared Hub Session (Different Domain)");
    expect(screen.getByText(/The Hub is under mws\.web\.id and this application is under millenniaws\.sch\.id/)).toBeVisible();
    other.unmount();

    const same = renderPage(
      setup({ application: { ...shared, launch_url: "https://daily.mws.web.id/auth/sso" }, hub_address: "https://app.mws.web.id", hub_secret: { mode: "shared", version: 1, applies: false } }),
    );
    await same.user.click(await screen.findByRole("tab", { name: "Connection" }));
    expect(screen.getByText("Sign-In Way").nextElementSibling).toHaveTextContent(/^Shared Hub Session$/);
    expect(screen.queryByText("Different Domain")).toBeNull();
  });

  it("says whether the application sends the Organization ID Central made, for the Hub too", async () => {
    const organization = (check, reported = null) => ({ id: "org_demo_abcdefghijklmnopqrst", check, reported, checked_at: reported ? new Date().toISOString() : null });
    const none = renderPage(setup({ organization: organization("not_reported") }));
    expect(await screen.findByText(/Not Reported Yet/)).toBeVisible();
    none.unmount();

    const good = renderPage(setup({ organization: organization("matches", "org_demo_abcdefghijklmnopqrst") }));
    expect(await screen.findAllByText("Matches")).not.toHaveLength(0);
    good.unmount();

    const bad = renderPage(setup({ organization: organization("mismatch", "org_other_zzzzzzzzzzzzzzzzzzzz") }));
    expect(await screen.findAllByText(/Does Not Match, it sent/)).not.toHaveLength(0);
    expect(screen.getAllByText("org_other_zzzzzzzzzzzzzzzzzzzz").length).toBeGreaterThan(0);
    bad.unmount();

    renderPage(setup({ is_hub: true, application: { ...APP, application_id: "hub" }, hub: { base_url: "https://hub.example.com", secret_set: true, key_ready: true }, env_settings: { hub_access_mode: "warn", hub_bypass_emails: [] }, organization: organization("matches", "org_demo_abcdefghijklmnopqrst") }));
    expect(await screen.findByText("Organization ID")).toBeVisible();
    expect(screen.getByText("Matches")).toBeVisible();
  });

  it("filters the activity by date range, with this month as the start", async () => {
    const { user } = renderPage(setup(), "/application-access/apps/demo/settings?tab=activity");
    await screen.findByText("Details Changed");
    const settingsCalls = () => globalThis.fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/settings?"));
    expect(settingsCalls()[0]).toMatch(/date_from=\d{4}-\d{2}-01T00%3A00%3A00\.000&date_to=/);
    await user.click(screen.getByText("This Month"));
    await user.click(await screen.findByText("Today"));
    await waitFor(() => expect(settingsCalls().at(-1)).toMatch(/date_from=(\d{4}-\d{2}-\d{2})T00%3A00%3A00\.000&date_to=\1T23%3A59%3A59\.999/));
    // Clear filters shows only once the range is not the start one, and brings it back.
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    expect(screen.getByText("This Month")).toBeVisible();
  });

  it("pages the roles of the Access tab when there are more than ten", async () => {
    const original = SETTINGS.access.roles;
    SETTINGS.access.roles = Array.from({ length: 12 }, (_, index) => ({
      id: `r${index}`,
      key: `ROLE_${String(index).padStart(2, "0")}`,
      label: `Role ${String(index).padStart(2, "0")}`,
      is_active: true,
      permission_count: 1,
      people: index,
      groups: 0,
    }));
    try {
      const { user } = renderPage(setup(), "/application-access/apps/demo/settings?tab=access");
      expect(await screen.findByText("Role 00")).toBeVisible();
      expect(screen.queryByText("Role 11")).toBeNull();
      expect(screen.getByText(/Page 1 of 2 \/ 12 roles/)).toBeVisible();
      await user.click(screen.getByRole("button", { name: /Next/ }));
      expect(await screen.findByText("Role 11")).toBeVisible();
      expect(screen.queryByText("Role 00")).toBeNull();
    } finally {
      SETTINGS.access.roles = original;
    }
  });

  it("lists the latest changes in a table, and opens the details of one", async () => {
    const { user } = renderPage(setup(), "/application-access/apps/demo/settings?tab=activity");
    expect(await screen.findByRole("columnheader", { name: "Actor" })).toBeVisible();
    for (const name of ["Time", "Action", "Changes"]) expect(screen.getByRole("columnheader", { name })).toBeVisible();
    expect(screen.getByText("Details Changed")).toBeVisible();
    expect(screen.getByText("Added")).toBeVisible();
    // The names of what changed sit in one short line, the values are in the details.
    expect(screen.getByText("Card Status, Hub Secret")).toBeVisible();
    expect(screen.queryByText(/Active → Maintenance/)).toBeNull();
    await user.click(screen.getAllByRole("button", { name: "View Details" })[0]);
    expect(await screen.findByText("Change Details")).toBeVisible();
    expect(screen.getByText("Active")).toBeVisible();
    expect(screen.getByText("Maintenance")).toBeVisible();
    // A secret only says that it changed.
    expect(screen.getByText("Changed")).toBeVisible();
    expect(screen.getByText("10.0.0.5")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Close/ }));
    // The changes come a page at a time.
    expect(screen.getByText(/Page 1 of 2 \/ 12 changes/)).toBeVisible();
    expect(screen.getByRole("button", { name: /Next/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Prev/ })).toBeDisabled();
  });

  it("keeps the switch on for an application that was hidden again, without the setup steps", async () => {
    renderPage(setup({ application: { ...APP, published: false } }), "/application-access/apps/demo/settings?tab=card");
    const toggle = await screen.findByRole("switch", { name: "Hidden From Hub" });
    expect(toggle).toBeEnabled();
    expect(screen.queryByText("Setup steps")).toBeNull();
  });

  it("sends an application that is not finished back to its steps", async () => {
    renderPage(setup({ setup_completed: false, application: { ...APP, published: false }, can_publish: false, groups: { active_count: 0 }, missing: ["groups"] }));
    expect(await screen.findByText("Setup steps")).toBeVisible();
  });

  it("has no connection tab for a plain link", async () => {
    renderPage(setup({ application: { ...APP, launch_mode: "link" }, connection: { client_id: null, created: false, last_used_at: null }, permissions: { count: 0, synced_at: null } }));
    expect(await screen.findByRole("heading", { name: "Demo App Settings" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Connection" })).toBeNull();
    expect(screen.getAllByText("Plain Link").length).toBeGreaterThan(0);
  });

  it("writes the overview labels in Title Case and names how it opens like the form does", async () => {
    renderPage(setup());
    expect(await screen.findByText("Logout Address")).toBeVisible();
    expect(screen.getByText("Opens As").nextElementSibling).toHaveTextContent("Single Sign-On");
    expect(screen.getByText("Last Updated")).toBeVisible();
    expect(screen.queryByText("Logout address")).toBeNull();
  });

  it("calls a dedicated Hub secret dedicated, and counts the scopes in Title Case", async () => {
    const { user } = renderPage(setup({ hub_secret: { mode: "own", version: 1, applies: true }, data_access: { scope_names: ["a:read", "b:read"], editable: true } }));
    await user.click(await screen.findByRole("tab", { name: "Connection" }));
    expect(screen.getByText("Hub Secret").nextElementSibling).toHaveTextContent("Dedicated, Version 1");
    expect(screen.getByRole("button", { name: "2 Scopes" })).toBeVisible();
    expect(screen.queryByText(/Its own/)).toBeNull();
  });

  it("changes the sign-in way only after asking, and sends the new way", async () => {
    const { user } = renderPage(setup(), "/application-access/apps/demo/settings", [
      { path: "/api/admin/application-access/apps/demo/details", method: "PATCH", response: () => jsonResponse({ data: { ...APP, session_mode: "shared" } }) },
    ]);
    const sent = () => globalThis.fetch.mock.calls.filter(([, options]) => options?.method === "PATCH").map(([, options]) => JSON.parse(options.body));
    await user.click(await screen.findByRole("tab", { name: "Connection" }));
    await user.click(screen.getByRole("button", { name: "Change Sign-In Way" }));
    expect(await screen.findByText("Switch To Shared Hub Session")).toBeVisible();
    // Nothing is sent until it is confirmed.
    expect(sent()).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Switch To Shared Session" }));
    await waitFor(() => expect(sent()).toEqual([{ session_mode: "shared" }]));
  });

  it("shows the lines to add after moving to Hub Code & Token, without rotating the token", async () => {
    const line = (key, value, secret = false) => ({ key, value, secret, group: 0, line: `${key}="${value}"` });
    const { user } = renderPage(setup({ application: { ...APP, session_mode: "shared" } }), "/application-access/apps/demo/settings", [
      {
        path: "/api/admin/application-access/apps/demo/details",
        method: "PATCH",
        response: () => jsonResponse({ data: { ...APP, session_mode: "relay", env_changes: { add: [line("HUB_BASE_URL", "https://hub.example.com"), line("HUB_INTERNAL_SECRET", "s3cret-value-1234567890", true)], remove: [] } } }),
      },
    ]);
    await user.click(await screen.findByRole("tab", { name: "Connection" }));
    await user.click(screen.getByRole("button", { name: "Change Sign-In Way" }));
    expect(await screen.findByText(/Update its code first/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Switch To Code & Token" }));
    expect(await screen.findByText("Add To .env")).toBeVisible();
    expect(screen.getByText(/Your Central token stays the same/)).toBeVisible();
    expect(screen.queryByText(/s3cret-value/)).toBeNull();
    // Closing before the values are copied asks first, and Keep Open leaves the dialog as it is.
    await user.click(screen.getByRole("button", { name: "Close Dialog" }));
    expect(await screen.findByText("Not in use yet.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Keep Open" }));
    expect(screen.getByText("Add To .env")).toBeVisible();
    // Central has not seen the app sign in with a Hub code yet, so Done waits.
    expect(screen.getByText(/Waiting for the app to sign someone in with a Hub code/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
  });

  describe("after moving to Shared Hub Session", () => {
    const open = async (confirmed) => {
      const { user } = renderPage(setup({ session_check: { mode: "shared", changed_at: "2026-10-24T01:00:00.000Z", confirmed_at: confirmed, known: true } }), "/application-access/apps/demo/settings", [
        {
          path: "/api/admin/application-access/apps/demo/details",
          method: "PATCH",
          response: () => jsonResponse({ data: { ...APP, session_mode: "shared", env_changes: { add: [], remove: ["HUB_SSO_JWKS_URL", "HUB_INTERNAL_SECRET"] } } }),
        },
      ]);
      await user.click(await screen.findByRole("tab", { name: "Connection" }));
      await user.click(screen.getByRole("button", { name: "Change Sign-In Way" }));
      await user.click(await screen.findByRole("button", { name: "Switch To Shared Session" }));
      expect(await screen.findByText("Remove From .env")).toBeVisible();
      return user;
    };

    it("lists the lines to remove and waits until Central saw the app read the Hub session", async () => {
      const user = await open(null);
      expect(screen.getByText("HUB_INTERNAL_SECRET")).toBeVisible();
      expect(screen.getByText(/In the .env of Demo App, delete/)).toBeVisible();
      expect(await screen.findByText(/Waiting for the app to read the Hub session/)).toBeVisible();
      expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
      await user.click(screen.getByRole("button", { name: "Close Dialog" }));
      expect(await screen.findByText("Not in use yet.")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Keep Open" }));
      expect(screen.getByText("Remove From .env")).toBeVisible();
    });

    it("is done once Central saw it", async () => {
      const user = await open("2026-10-24T01:05:00.000Z");
      expect(await screen.findByText(/The app reads the Hub session. You are done/)).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Done" }));
      await waitFor(() => expect(screen.queryByText("Remove From .env")).toBeNull());
    });
  });

  it("explains what each sign-in way needs, on the Connection tab", async () => {
    const shared = renderPage(setup({ application: { ...APP, session_mode: "shared" }, hub_secret: { mode: "shared", version: 1, applies: false } }));
    await shared.user.click(await screen.findByRole("tab", { name: "Connection" }));
    expect(screen.getByText("How This App Signs In")).toBeVisible();
    expect(screen.getByText(/HUB_BASE_URL is the only Hub line the app reads/)).toBeVisible();
    expect(screen.getByText(/Leaving them does no harm/)).toBeVisible();
    shared.unmount();
    const relay = renderPage(setup());
    await relay.user.click(await screen.findByRole("tab", { name: "Connection" }));
    expect(screen.getByText(/HUB_INTERNAL_SECRET not copied or wrong/)).toBeVisible();
    expect(screen.queryByText(/HUB_BASE_URL is the only Hub line/)).toBeNull();
  });

  it("warns when the app still uses an old token, and when it does not answer", async () => {
    const old = renderPage(setup({ health: { status: "check_token", detail: "Still calling with an old token", since: new Date(Date.now() - 3 * 60_000).toISOString() } }));
    expect(await screen.findByText(/Still calling with an old token, last seen/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Rotation Guide" })).toHaveAttribute("href", expect.stringContaining("part=rotate"));
    old.unmount();
    const down = renderPage(setup({ health: { status: "unreachable", detail: "Not answering at its address", since: "2026-10-23T08:00:00.000Z" } }));
    expect(await screen.findByText(/Not answering at its address since/)).toBeVisible();
    expect(screen.getByText(/Check the app in Komodo/)).toBeVisible();
    down.unmount();
    const waiting = renderPage(setup({ health: { status: "token_pending", detail: "Waiting for the app to use the new token. The old one works until", since: "2026-10-25T08:00:00.000Z" } }));
    expect(await screen.findByText(/Waiting for the app to use the new token. The old one works until/)).toBeVisible();
    expect(screen.getAllByText("Update Pending").length).toBeGreaterThan(0);
    waiting.unmount();
    const stopped = renderPage(setup({ health: { status: "sign_in_pending", detail: "Waiting for the app to sign someone in the new way", since: new Date(Date.now() - 3_600_000).toISOString() } }));
    expect(await screen.findByText(/Waiting for the app to sign someone in the new way/)).toBeVisible();
    stopped.unmount();
    renderPage(setup({ health: { status: "healthy", detail: null, since: null } }));
    await screen.findByRole("heading", { name: "Demo App Settings" });
    expect(screen.queryByText(/Check the app in Komodo/)).toBeNull();
    expect(screen.queryByText(/old token, last seen/)).toBeNull();
  });

  it("does not offer to change the sign-in way for a plain link", async () => {
    renderPage(setup({ application: { ...APP, launch_mode: "link" } }));
    await screen.findByRole("heading", { name: "Demo App Settings" });
    expect(screen.queryByRole("button", { name: "Change Sign-In Way" })).toBeNull();
    expect(screen.queryByText("How This App Signs In")).toBeNull();
  });
});
