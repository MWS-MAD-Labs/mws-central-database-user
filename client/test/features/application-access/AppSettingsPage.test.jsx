import { describe, expect, it } from "bun:test";
import { Route, Routes } from "react-router";
import { screen } from "@testing-library/react";
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
  category: null,
  launch_url: "https://demo.example.com/auth/sso",
  logout_url: null,
  published: true,
  retired_at: null,
  launch_mode: "sso",
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

function renderPage(data) {
  globalThis.fetch = createFetchRouter([
    { path: "/api/admin/application-access/apps/demo/setup", response: () => jsonResponse({ data }) },
    { path: /internal-endpoints|data-access/, response: () => jsonResponse({ data: [] }) },
  ]);
  return renderWithProviders(
    <AuthContext.Provider value={{ user: { role: "SUPER_ADMIN" } }}>
      <ConfirmProvider>
        <Routes>
          <Route path="/application-access/apps/:applicationId/settings" element={<AppSettingsPage />} />
          <Route path="/application-access/apps/:applicationId/setup" element={<div>Setup steps</div>} />
        </Routes>
      </ConfirmProvider>
    </AuthContext.Provider>,
    { route: "/application-access/apps/demo/settings" },
  );
}

describe("AppSettingsPage", () => {
  it("shows what can still change, with the guide one click away", async () => {
    renderPage(setup());
    expect(await screen.findByRole("heading", { name: "Demo App Settings" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Setup Guide/ })).toHaveAttribute("href", "/application-access/apps/demo/guide?part=local");
    expect(screen.getByRole("button", { name: "Edit Details" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Rotate Token" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Hide From Hub" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Retire Application" })).toBeVisible();
    expect(screen.getByText("1 active group")).toBeVisible();
  });

  it("offers Show In Hub for an application that was hidden again, still without the setup steps", async () => {
    renderPage(setup({ application: { ...APP, published: false } }));
    expect(await screen.findByRole("button", { name: "Show In Hub" })).toBeEnabled();
    expect(screen.queryByText("Setup steps")).toBeNull();
  });

  it("sends an application that is not finished back to its steps", async () => {
    renderPage(setup({ setup_completed: false, application: { ...APP, published: false }, can_publish: false, groups: { active_count: 0 }, missing: ["groups"] }));
    expect(await screen.findByText("Setup steps")).toBeVisible();
  });

  it("has no connection card for a plain link", async () => {
    renderPage(setup({ application: { ...APP, launch_mode: "link" }, connection: { client_id: null, created: false, last_used_at: null }, permissions: { count: 0, synced_at: null } }));
    expect(await screen.findByRole("heading", { name: "Demo App Settings" })).toBeVisible();
    expect(screen.queryByText("Connection")).toBeNull();
  });
});
