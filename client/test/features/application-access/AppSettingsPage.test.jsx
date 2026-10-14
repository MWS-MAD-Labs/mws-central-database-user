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
    { id: "a1", at: "2026-10-12T09:30:00.000Z", by: "Test Super Admin", summary: "Changed the card status" },
    { id: "a2", at: "2026-10-03T08:00:00.000Z", by: "Test Super Admin", summary: "Added the application" },
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
    <AuthContext.Provider value={{ user: { role: "SUPER_ADMIN" } }}>
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
    expect(screen.getByText(/Connected, Last Call/)).toBeVisible();
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
    expect(screen.getByText("Sign-In Way").nextElementSibling).toHaveTextContent("Hub Code & Token");
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
      <AuthContext.Provider value={{ user: { role: "SUPER_ADMIN" } }}>
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
    await user.click(screen.getByRole("switch", { name: "Shown" }));
    await waitFor(() => expect(calls).toEqual(["unpublish"]));
  });

  it("lists the roles with a name that has capitals and its own key column", async () => {
    renderPage(setup(), "/application-access/apps/demo/settings?tab=access");
    expect(await screen.findByRole("columnheader", { name: "Key" })).toBeVisible();
    expect(screen.getByText("Support Staff")).toBeVisible();
    expect(screen.getByText("SUPPORT_STAFF")).toBeVisible();
    // Figures first, what they count under them.
    expect(screen.getByText("Active Groups").previousElementSibling).toHaveTextContent("1");
    expect(screen.getByText("People Reached").previousElementSibling).toHaveTextContent("128");
    expect(screen.getByText("Exceptions").previousElementSibling).toHaveTextContent("2");
    expect(screen.getByText("Blocked").previousElementSibling).toHaveTextContent("1");
  });

  it("lists the latest changes on the activity tab", async () => {
    renderPage(setup(), "/application-access/apps/demo/settings?tab=activity");
    expect(await screen.findByText("Changed the card status")).toBeVisible();
    expect(screen.getByText("Added the application")).toBeVisible();
    // The changes come a page at a time.
    expect(screen.getByText(/Page 1 of 2 \/ 12 changes/)).toBeVisible();
    expect(screen.getByRole("button", { name: /Next/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Prev/ })).toBeDisabled();
  });

  it("keeps the switch on for an application that was hidden again, without the setup steps", async () => {
    renderPage(setup({ application: { ...APP, published: false } }), "/application-access/apps/demo/settings?tab=card");
    const toggle = await screen.findByRole("switch", { name: "Hidden" });
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
    expect(await screen.findByText(/not rotated/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Switch To Code & Token" }));
    expect(await screen.findByText("Add These .env Lines")).toBeVisible();
    expect(screen.getByText(/no rotation needed/)).toBeVisible();
    expect(screen.queryByText(/s3cret-value/)).toBeNull();
  });

  it("lists the lines to remove after moving to Shared Hub Session", async () => {
    const { user } = renderPage(setup(), "/application-access/apps/demo/settings", [
      {
        path: "/api/admin/application-access/apps/demo/details",
        method: "PATCH",
        response: () => jsonResponse({ data: { ...APP, session_mode: "shared", env_changes: { add: [], remove: ["HUB_SSO_JWKS_URL", "HUB_INTERNAL_SECRET"] } } }),
      },
    ]);
    await user.click(await screen.findByRole("tab", { name: "Connection" }));
    await user.click(screen.getByRole("button", { name: "Change Sign-In Way" }));
    await user.click(await screen.findByRole("button", { name: "Switch To Shared Session" }));
    expect(await screen.findByText("Remove These .env Lines")).toBeVisible();
    expect(screen.getByText("HUB_INTERNAL_SECRET")).toBeVisible();
  });

  it("does not offer to change the sign-in way for a plain link", async () => {
    renderPage(setup({ application: { ...APP, launch_mode: "link" } }));
    await screen.findByRole("heading", { name: "Demo App Settings" });
    expect(screen.queryByRole("button", { name: "Change Sign-In Way" })).toBeNull();
  });
});
