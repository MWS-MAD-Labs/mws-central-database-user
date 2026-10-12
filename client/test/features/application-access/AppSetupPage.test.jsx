import { describe, expect, it } from "bun:test";
import { screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { ConfirmProvider } from "../../../src/components/ui/ConfirmDialog.jsx";
import { AuthContext } from "../../../src/features/auth/context/authContext.js";
import { AppSetupPage } from "../../../src/features/application-access/pages/AppSetupPage.jsx";
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
  published: false,
};

function makeSetup(overrides = {}) {
  return {
    application: APP,
    organization_id: "org_demo_abcdefghijklmnopqrst",
    connection: { client_id: null, created: false, last_used_at: null },
    permissions: { count: 0, synced_at: null },
    roles: { active_count: 0 },
    groups: { active_count: 0 },
    can_publish: false,
    missing: ["permissions", "roles", "groups"],
    is_hub: false,
    env_settings: null,
    removal: { can_remove: false, retire_available: true },
    data_access: {
      scope_names: [
        "application_entitlements:read",
        "application_permissions:write",
      ],
      editable: true,
    },
    ...overrides,
  };
}

function renderPage(routes, user = { role: "SUPER_ADMIN" }) {
  globalThis.fetch = createFetchRouter(routes);
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <ConfirmProvider>
        <Routes>
          <Route
            path="/application-access/apps/:applicationId/setup"
            element={<AppSetupPage />}
          />
        </Routes>
      </ConfirmProvider>
    </AuthContext.Provider>,
    { route: "/application-access/apps/demo/setup" },
  );
}

const setupRoute = (setup) => ({
  path: "/api/admin/application-access/apps/demo/setup",
  response: () => jsonResponse({ data: setup }),
});

const stepOf = (name) =>
  screen.getByRole("heading", { name: new RegExp(`^${name}`) }).closest("li");

describe("AppSetupPage", () => {
  it("refuses anyone who is not a Super Admin", async () => {
    renderPage([], { role: "DATABASE_ADMIN" });
    expect(
      await screen.findByText(
        "Only Super Admin can manage application access.",
      ),
    ).toBeVisible();
  });

  it("opens at Connect with the later steps locked", async () => {
    renderPage([setupRoute(makeSetup())]);
    expect(
      await screen.findByText("1 of 6 steps done.", { exact: false }),
    ).toBeVisible();
    expect(stepOf("About")).toHaveAttribute("data-status", "done");
    expect(stepOf("Connect")).toHaveAttribute("data-status", "current");
    for (const name of ["Permissions", "Roles", "Groups", "Show in Hub"]) {
      expect(stepOf(name)).toHaveAttribute("data-status", "locked");
    }
    expect(
      screen.getByRole("button", { name: "Create Connection" }),
    ).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Show In Hub" })).toBeNull();
  });

  it("creates the connection and hands over the .env values behind a masked token", async () => {
    const token = "mws_47d0b31fa20c.0123456789abcdef0123456789abcdef";
    const { user } = renderPage([
      setupRoute(makeSetup()),
      {
        path: "/api/admin/application-access/apps/demo/connect",
        method: "POST",
        response: () =>
          jsonResponse({
            data: {
              token,
              client: { token },
              env: [
                {
                  key: "HUB_SSO_APP_ID",
                  value: "demo",
                  secret: false,
                  group: 0,
                  line: 'HUB_SSO_APP_ID="demo"',
                },
                {
                  key: "CENTRAL_API_BASE_URL",
                  value: "https://db.example.com",
                  secret: false,
                  group: 0,
                  line: 'CENTRAL_API_BASE_URL="https://db.example.com"',
                },
                {
                  key: "CENTRAL_API_TOKEN",
                  value: token,
                  secret: true,
                  group: 0,
                  line: `CENTRAL_API_TOKEN="${token}"`,
                },
                {
                  key: "CENTRAL_ORGANIZATION_ID",
                  value: "org_demo_abcdefghijklmnopqrst",
                  secret: false,
                  group: 0,
                  line: 'CENTRAL_ORGANIZATION_ID="org_demo_abcdefghijklmnopqrst"',
                },
              ],
            },
          }),
      },
    ]);
    await user.click(
      await screen.findByRole("button", { name: "Create Connection" }),
    );
    expect(await screen.findByText("Connection Created")).toBeVisible();
    expect(screen.getByText('HUB_SSO_APP_ID="demo"')).toBeVisible();
    expect(
      screen.getByText(/CENTRAL_API_TOKEN="mws_47d0b3/),
    ).toBeVisible();
    expect(screen.queryByText(new RegExp(token.slice(-12)))).toBeNull();
  });

  it("shows that it is waiting for the application to send permissions", async () => {
    renderPage([
      setupRoute(
        makeSetup({
          connection: { client_id: "c1", created: true, last_used_at: null },
        }),
      ),
    ]);
    expect(
      await screen.findByText(
        "Waiting for the application. Deploy it with the .env values and its permission sync.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Rotate Token" })).toBeVisible();
    // Tells what to do next instead of leaving the person guessing.
    expect(screen.getByText("Do This Next")).toBeVisible();
    expect(
      screen.getByText(
        /In production, the deploy pipeline should run the sync/,
      ),
    ).toBeVisible();
    expect(screen.queryByText(/Still nothing after 10 minutes/)).toBeNull();
  });

  it("tells how many endpoints the connection can call and opens Data Access", async () => {
    const { user } = renderPage([
      setupRoute(
        makeSetup({
          connection: { client_id: "c1", created: true, last_used_at: null },
        }),
      ),
      {
        path: "/api/admin/api-clients/internal-endpoints",
        response: () =>
          jsonResponse({
            data: [
              {
                method: "GET",
                path: "/api/internal/application-taxonomy",
                scope: "application_entitlements:read",
                title: "Categories and scopes",
              },
              {
                method: "PUT",
                path: "/api/internal/application-permissions/{application_id}",
                scope: "application_permissions:write",
                title: "Publish permissions",
              },
              {
                method: "GET",
                path: "/api/internal/employees",
                scope: "employees:read",
                title: "List employees",
              },
            ],
          }),
      },
      {
        path: "/api/admin/application-integration-profiles/scopes",
        response: () => jsonResponse({ data: [] }),
      },
    ]);
    await user.click(
      await screen.findByRole("button", { name: "Data Access, 2 endpoints" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Data Access" }),
    ).toBeVisible();
  });

  it("links to the guide page from the Connect step, the menu and the rotation result", async () => {
    const { user } = renderPage([
      setupRoute(
        makeSetup({
          connection: { client_id: "c1", created: true, last_used_at: null },
        }),
      ),
    ]);
    const link = await screen.findByRole("link", { name: "Setup Guide" });
    expect(link).toHaveAttribute(
      "href",
      "/application-access/apps/demo/guide?part=local",
    );
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("button", { name: "Setup Guide" })).toBeVisible();
  });

  it("adds a troubleshooting note when nothing called Central for ten minutes", async () => {
    const old = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    renderPage([
      setupRoute(
        makeSetup({
          connection: {
            client_id: "c1",
            created: true,
            created_at: old,
            last_used_at: null,
          },
        }),
      ),
    ]);
    expect(
      await screen.findByText(/Still nothing after 10 minutes/),
    ).toBeVisible();
  });

  it("publishes once everything before it is done, and can hide it again", async () => {
    const ready = makeSetup({
      connection: {
        client_id: "c1",
        created: true,
        last_used_at: new Date().toISOString(),
      },
      permissions: { count: 2, synced_at: new Date().toISOString() },
      roles: { active_count: 1 },
      groups: { active_count: 1 },
      can_publish: true,
      missing: [],
    });
    let published = false;
    const calls = [];
    const { user } = renderPage([
      {
        path: "/api/admin/application-access/apps/demo/setup",
        response: () =>
          jsonResponse({
            data: { ...ready, application: { ...APP, published } },
          }),
      },
      {
        path: "/api/admin/application-access/apps/demo/publish",
        method: "POST",
        response: () => {
          published = true;
          calls.push("publish");
          return jsonResponse({ data: { ...APP, published: true } });
        },
      },
      {
        path: "/api/admin/application-access/apps/demo/unpublish",
        method: "POST",
        response: () => {
          published = false;
          calls.push("unpublish");
          return jsonResponse({ data: { ...APP, published: false } });
        },
      },
    ]);
    await user.click(
      await screen.findByRole("button", { name: "Show In Hub" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Hide From Hub" }),
    );
    await waitFor(() => expect(calls).toEqual(["publish", "unpublish"]));
    // The button is usable again after the first action finished.
    expect(
      await screen.findByRole("button", { name: "Show In Hub" }),
    ).toBeEnabled();
  });
  it("removes the application without a second error toast from the page it leaves", async () => {
    let removed = false;
    const requests = [];
    globalThis.fetch = createFetchRouter([
      {
        path: "/api/admin/application-access/apps/demo/setup",
        response: () => {
          requests.push("setup");
          return removed
            ? jsonResponse({ errors: "Application demo not found" }, 404)
            : jsonResponse({
                data: makeSetup({
                  removal: { can_remove: true, retire_available: false },
                }),
              });
        },
      },
      {
        path: "/api/admin/application-access/apps/demo/removal",
        response: () =>
          jsonResponse({
            data: {
              can_remove: true,
              blockers: [],
              will_delete: { roles: 0, groups: 0, permissions: 0, clients: 0 },
            },
          }),
      },
      {
        path: "/api/admin/application-access/apps/demo",
        method: "DELETE",
        response: () => {
          removed = true;
          return jsonResponse({ data: true });
        },
      },
    ]);
    const { user } = renderWithProviders(
      <AuthContext.Provider value={{ user: { role: "SUPER_ADMIN" } }}>
        <ConfirmProvider>
          <Routes>
            <Route
              path="/application-access/apps/:applicationId/setup"
              element={<AppSetupPage />}
            />
            <Route path="/application-access" element={<div>List page</div>} />
          </Routes>
        </ConfirmProvider>
      </AuthContext.Provider>,
      { route: "/application-access/apps/demo/setup" },
    );
    await user.click(
      await screen.findByRole("button", { name: "More actions" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Delete Application" }),
    );
    await user.type(
      await screen.findByRole("textbox"),
      "demo",
    );
    const before = requests.length;
    await user.click(
      screen.getAllByRole("button", { name: "Delete Application" }).at(-1),
    );
    expect(await screen.findByText("List page")).toBeVisible();
    // Nothing asked for the removed application again.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requests.length).toBe(before);
  });
  it("has no Show in Hub step for the Hub itself", async () => {
    renderPage([setupRoute(makeSetup({ is_hub: true }))]);
    expect(
      await screen.findByText("1 of 5 steps done.", { exact: false }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: /Show in Hub/ })).toBeNull();
  });

  it("changes the data access from the menu", async () => {
    const saved = [];
    const { user } = renderPage([
      setupRoute(makeSetup()),
      {
        path: "/api/admin/application-integration-profiles/scopes",
        response: () =>
          jsonResponse({
            data: [
              {
                name: "application_permissions:write",
                description: "",
                is_sensitive: false,
              },
              {
                name: "application_entitlements:read",
                description: "",
                is_sensitive: false,
              },
              { name: "students:read", description: "", is_sensitive: false },
            ],
          }),
      },
      {
        path: "/api/admin/application-access/apps/demo/connection-scopes",
        method: "PATCH",
        response: ({ options }) => {
          saved.push(JSON.parse(options.body));
          return jsonResponse({ data: { scope_names: [], editable: true } });
        },
      },
    ]);
    await user.click(
      await screen.findByRole("button", { name: "More actions" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Change Data Access" }),
    );
    const student = await screen.findByRole("checkbox", {
      name: /View student profiles/,
    });
    // Nothing changed yet.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(student);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(student);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(student);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].scope_names.sort()).toEqual([
      "application_entitlements:read",
      "application_permissions:write",
      "students:read",
    ]);
  });
  it("rotates the token of the connection from the setup page", async () => {
    const rotations = [];
    const { user } = renderPage([
      setupRoute(
        makeSetup({
          connection: {
            client_id: "c1",
            created: true,
            created_at: new Date().toISOString(),
            last_used_at: new Date().toISOString(),
          },
          permissions: { count: 1, synced_at: null },
        }),
      ),
      {
        path: "/api/admin/application-access/apps/demo/rotate",
        method: "POST",
        response: ({ options }) => {
          rotations.push(JSON.parse(options.body));
          return jsonResponse({
            data: {
              token: "mws_new.secret",
              credentials: [],
              env: [
                {
                  key: "HUB_SSO_APP_ID",
                  value: "demo",
                  secret: false,
                  group: 0,
                  line: 'HUB_SSO_APP_ID="demo"',
                },
                {
                  key: "CENTRAL_API_BASE_URL",
                  value: "https://db.example.com",
                  secret: false,
                  group: 0,
                  line: 'CENTRAL_API_BASE_URL="https://db.example.com"',
                },
                {
                  key: "CENTRAL_API_TOKEN",
                  value: "mws_new.secretsecretsecret",
                  secret: true,
                  group: 0,
                  line: 'CENTRAL_API_TOKEN="mws_new.secretsecretsecret"',
                },
                {
                  key: "CENTRAL_ORGANIZATION_ID",
                  value: "org_demo_abc",
                  secret: false,
                  group: 0,
                  line: 'CENTRAL_ORGANIZATION_ID="org_demo_abc"',
                },
              ],
            },
          });
        },
      },
    ]);
    await user.click(
      await screen.findByRole("button", { name: "Rotate Token" }),
    );
    await user.click(await screen.findByRole("button", { name: "Rotate" }));
    await user.click(
      await screen.findByRole("button", { name: "Start Rotation" }),
    );
    expect(await screen.findByText("Rotated Credentials")).toBeVisible();
    // All four values come back, not only the token.
    expect(screen.getByText('HUB_SSO_APP_ID="demo"')).toBeVisible();
    expect(
      screen.getByText('CENTRAL_ORGANIZATION_ID="org_demo_abc"'),
    ).toBeVisible();
    expect(
      screen.getByText('CENTRAL_API_BASE_URL="https://db.example.com"'),
    ).toBeVisible();
    expect(rotations).toEqual([{ immediate: false, grace_hours: 24 }]);
    // What to do next is right there, with the names of this application, and the full steps are one click away.
    expect(screen.getByText("What To Do Now")).toBeVisible();
    expect(
      screen.getByText(
        "Replace CENTRAL_API_TOKEN in the .env of the application.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open the full steps" }),
    ).toHaveAttribute(
      "href",
      "/application-access/apps/demo/guide?part=rotate",
    );
  });
  it("offers Edit Details on the About step", async () => {
    renderPage([setupRoute(makeSetup())]);
    const about = (
      await screen.findByRole("heading", { name: /^About/ })
    ).closest("li");
    expect(
      within(about).getByRole("button", { name: "Edit Details" }),
    ).toBeVisible();
  });

  it("keeps Save in Edit Details off until something changes", async () => {
    const { user } = renderPage([setupRoute(makeSetup())]);
    const about = (
      await screen.findByRole("heading", { name: /^About/ })
    ).closest("li");
    await user.click(
      within(about).getByRole("button", { name: "Edit Details" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Description"), "x");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled();
    await user.keyboard("{Backspace}");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("edits an application on the standard paths by its address only, and keeps the paths of one that differs", async () => {
    const { user } = renderPage([
      setupRoute(
        makeSetup({
          application: {
            ...APP,
            launch_url: "https://demo.example.com/auth/sso",
            logout_url: "https://demo.example.com/auth/logout",
          },
        }),
      ),
    ]);
    const about = (
      await screen.findByRole("heading", { name: /^About/ })
    ).closest("li");
    await user.click(
      within(about).getByRole("button", { name: "Edit Details" }),
    );
    expect(await screen.findByLabelText("Application Address")).toHaveValue(
      "demo.example.com",
    );
    expect(screen.queryByLabelText("Logout URL")).toBeNull();
  });

  it("opens an application with its own sign-out setup on the full addresses", async () => {
    const { user } = renderPage([setupRoute(makeSetup())]);
    const about = (
      await screen.findByRole("heading", { name: /^About/ })
    ).closest("li");
    await user.click(
      within(about).getByRole("button", { name: "Edit Details" }),
    );
    expect(await screen.findByLabelText("Launch URL")).toHaveValue(
      "demo.example.com/auth/sso",
    );
    expect(
      screen.getByRole("button", { name: "Use the standard paths again" }),
    ).toBeVisible();
  });

  it("counts About as done for the Hub, which has no launch address", async () => {
    renderPage([
      setupRoute(
        makeSetup({ is_hub: true, application: { ...APP, launch_url: null } }),
      ),
    ]);
    expect(
      await screen.findByText("1 of 5 steps done.", { exact: false }),
    ).toBeVisible();
  });

  it("goes back one level to the application page, however the setup was opened", async () => {
    renderPage([setupRoute(makeSetup())]);
    const back = await screen.findByRole("link", { name: "Back" });
    expect(back).toHaveAttribute("href", "/application-access/apps/demo");
  });
  it("shows a retired application with Restore and Delete, and no step actions", async () => {
    const restores = [];
    const { user } = renderPage([
      setupRoute(
        makeSetup({
          application: { ...APP, retired_at: new Date().toISOString() },
          connection: {
            client_id: null,
            created: false,
            created_at: null,
            last_used_at: null,
          },
        }),
      ),
      {
        path: "/api/admin/application-access/apps/demo/restore",
        method: "POST",
        response: () => {
          restores.push("demo");
          return jsonResponse({ data: { ...APP, retired_at: null } });
        },
      },
    ]);
    expect(
      await screen.findByText(
        /Its token is revoked, it is hidden from the Hub/,
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Create Connection" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(restores).toEqual(["demo"]));
  });

  it("retires from the menu after a confirmation, and the Hub has no Retire", async () => {
    const retired = [];
    const { user } = renderPage([
      setupRoute(makeSetup()),
      {
        path: "/api/admin/application-access/apps/demo/retire",
        method: "POST",
        response: () => {
          retired.push("demo");
          return jsonResponse({
            data: { ...APP, retired_at: new Date().toISOString() },
          });
        },
      },
    ]);
    await user.click(
      await screen.findByRole("button", { name: "More actions" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Retire Application" }),
    );
    await user.click(await screen.findByRole("button", { name: "Retire" }));
    await waitFor(() => expect(retired).toEqual(["demo"]));
  });

  it("explains on the Hub itself that it goes after the other applications", async () => {
    renderPage([
      setupRoute(
        makeSetup({
          is_hub: true,
          removal: { can_remove: false, retire_available: false },
        }),
      ),
    ]);
    expect(await screen.findByText("This is the Hub itself.")).toBeVisible();
    expect(
      screen.getByText(/can only be removed after they are/),
    ).toBeVisible();
  });

  it("offers Delete on the Hub once nothing else is set up", async () => {
    const { user } = renderPage([
      setupRoute(
        makeSetup({
          is_hub: true,
          removal: { can_remove: true, retire_available: false },
        }),
      ),
    ]);
    await user.click(
      await screen.findByRole("button", { name: "More actions" }),
    );
    expect(
      await screen.findByRole("button", { name: "Delete Application" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Retire Application" }),
    ).toBeNull();
  });

  it("has no Retire in the menu for the Hub while other applications are set up", async () => {
    const { user } = renderPage([
      setupRoute(
        makeSetup({
          is_hub: true,
          removal: { can_remove: false, retire_available: false },
        }),
      ),
    ]);
    await user.click(
      await screen.findByRole("button", { name: "More actions" }),
    );
    expect(
      await screen.findByRole("button", { name: "How Removing Works" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Retire Application" }),
    ).toBeNull();
  });
  describe("the menu offers only what applies", () => {
    const openMenu = async (user) =>
      user.click(await screen.findByRole("button", { name: "More actions" }));
    const names = () =>
      screen.getAllByRole("button").map((button) => button.textContent);

    it("offers Retire alone while the application cannot be deleted yet", async () => {
      const { user } = renderPage([setupRoute(makeSetup())]);
      await openMenu(user);
      expect(
        await screen.findByRole("button", { name: "Retire Application" }),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Delete Application" }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Restore Application" }),
      ).toBeNull();
    });

    it("shows Delete next to Retire once it can be deleted, in warning and danger colours", async () => {
      const { user } = renderPage([
        setupRoute(
          makeSetup({ removal: { can_remove: true, retire_available: false } }),
        ),
      ]);
      await openMenu(user);
      const retire = await screen.findByRole("button", {
        name: "Retire Application",
      });
      const remove = screen.getByRole("button", { name: "Delete Application" });
      expect(retire.className).toContain("text-[#8a6419]");
      expect(remove.className).toContain("text-[#9f3d41]");
      expect(names()).toContain("Delete Application");
    });

    it("offers Restore and Delete for a retired application, and no Retire", async () => {
      const { user } = renderPage([
        setupRoute(
          makeSetup({
            application: { ...APP, retired_at: new Date().toISOString() },
            removal: { can_remove: true, retire_available: false },
          }),
        ),
      ]);
      await openMenu(user);
      expect(
        await screen.findByRole("button", { name: "Restore Application" }),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Delete Application" }),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Retire Application" }),
      ).toBeNull();
    });

    it("offers neither Retire nor Delete for the Hub", async () => {
      const { user } = renderPage([
        setupRoute(
          makeSetup({
            is_hub: true,
            removal: { can_remove: false, retire_available: false },
          }),
        ),
      ]);
      await openMenu(user);
      expect(
        await screen.findByRole("button", { name: "How Removing Works" }),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Retire Application" }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Delete Application" }),
      ).toBeNull();
    });
  });
  describe("the Hub sign-in settings", () => {
    const hubSettings = {
      hub_access_mode: "warn",
      hub_bypass_emails: ["me@millennia21.id"],
    };

    const HUB = {
      base_url: "https://app.mws.web.id",
      secret_set: true,
      key_ready: true,
    };
    const wizard = async (user) => {
      await user.click(
        await screen.findByRole("button", {
          name: /^(Open Setup Wizard|Finish Setup)$/,
        }),
      );
    };
    const SECRET_OK = {
      path: "/api/admin/application-access/hub-secret-check",
      method: "POST",
      response: () => jsonResponse({ data: { verdict: "ok" } }),
    };
    const HUB_OK = {
      path: /\/api\/admin\/application-access\/hub-address-check/,
      response: () => jsonResponse({ data: { verdict: "ok" } }),
    };
    const IMPACT = {
      path: "/api/admin/application-access/apps/demo/hub-secret-impact",
      response: () =>
        jsonResponse({
          data: {
            applications: [
              { application_id: "exima", name: "Exima" },
              { application_id: "daily-checkin", name: "Daily Check-in" },
            ],
          },
        }),
    };

    it("shows a summary on the Hub only, and the steps in a wizard that saves each one", async () => {
      const calls = [];
      const { user } = renderPage([
        setupRoute(
          makeSetup({ is_hub: true, env_settings: hubSettings, hub: HUB }),
        ),
        IMPACT,
        HUB_OK,
        SECRET_OK,
        {
          path: "/api/admin/application-access/apps/demo/hub-address",
          method: "PATCH",
          response: ({ options }) => {
            calls.push(["address", JSON.parse(options.body)]);
            return jsonResponse({
              data: { base_url: "http://localhost:5175" },
            });
          },
        },
        {
          path: "/api/admin/application-access/apps/demo/env-settings",
          method: "PATCH",
          response: ({ options }) => {
            calls.push(["settings", JSON.parse(options.body)]);
            return jsonResponse({ data: JSON.parse(options.body) });
          },
        },
      ]);
      expect(await screen.findByText("Hub Sign-in")).toBeVisible();
      expect(screen.getByText("https://app.mws.web.id")).toBeVisible();
      // The Hub has no organization id to copy.
      expect(screen.queryByText("Organization ID")).toBeNull();
      await wizard(user);

      // 1. Address. Nothing to save until it changes.
      expect(screen.getByLabelText("Hub Address")).toHaveValue(
        "app.mws.web.id",
      );
      expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
      await user.click(screen.getByRole("radio", { name: "Hub Local" }));
      await user.clear(screen.getByLabelText("Hub Address"));
      await user.type(screen.getByLabelText("Hub Address"), "localhost:5175");
      expect(await screen.findByText("Found the Hub.")).toBeVisible();
      await user.click(
        screen.getByRole("button", { name: "Save and Continue" }),
      );
      await waitFor(() =>
        expect(calls).toContainEqual([
          "address",
          { hub_base_url: "http://localhost:5175" },
        ]),
      );

      // 2. Secret is there already, with the applications it reaches.
      expect(
        await screen.findByText("2 applications take this into their .env"),
      ).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Continue" }));

      // 3. Sign-in.
      expect(screen.getByRole("radio", { name: /Warn/ })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
      await user.click(screen.getByRole("radio", { name: /Enforce/ }));
      await user.type(
        screen.getByLabelText("Add an email that always gets in"),
        "Boss{Enter}",
      );
      await user.click(
        screen.getByRole("button", { name: "Save and Continue" }),
      );
      await waitFor(() =>
        expect(calls).toContainEqual([
          "settings",
          {
            hub_access_mode: "enforce",
            hub_bypass_emails: ["me@millennia21.id", "boss@millennia21.id"],
          },
        ]),
      );

      // 4. Review.
      expect(
        await screen.findByText(
          /Put the sign-in lines in the Hub's .env, then restart the Hub/,
        ),
      ).toBeVisible();
      expect(screen.queryByRole("button", { name: /Show Secret/ })).toBeNull();
    });

    it("keeps a long list of affected applications short until asked", async () => {
      const many = Array.from({ length: 20 }, (_, i) => ({
        application_id: `app-${i}`,
        name: `App ${i}`,
      }));
      const { user } = renderPage([
        setupRoute(
          makeSetup({ is_hub: true, env_settings: hubSettings, hub: HUB }),
        ),
        {
          path: "/api/admin/application-access/apps/demo/hub-secret-impact",
          response: () => jsonResponse({ data: { applications: many } }),
        },
      ]);
      await wizard(user);
      await user.click(screen.getByRole("button", { name: "Continue" }));
      expect(
        await screen.findByText("20 applications take this into their .env"),
      ).toBeVisible();
      expect(screen.getByText("App 7")).toBeVisible();
      expect(screen.queryByText("App 8")).toBeNull();
      await user.click(
        screen.getByRole("button", { name: "Show all 20 (12 more)" }),
      );
      expect(screen.getByText("App 19")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Show fewer" }));
      expect(screen.queryByText("App 19")).toBeNull();
    });

    it("asks before it makes the Hub secret, naming the applications it reaches", async () => {
      const calls = [];
      const { user } = renderPage([
        setupRoute(
          makeSetup({
            is_hub: true,
            env_settings: hubSettings,
            hub: {
              base_url: "https://app.mws.web.id",
              secret_set: false,
              key_ready: true,
            },
          }),
        ),
        IMPACT,
        HUB_OK,
        SECRET_OK,
        {
          path: "/api/admin/application-access/apps/demo/hub-secret",
          method: "POST",
          response: ({ options }) => {
            calls.push(JSON.parse(options.body));
            return jsonResponse({ data: { secret_set: true } });
          },
        },
      ]);
      await wizard(user);
      await user.click(screen.getByRole("button", { name: "Continue" }));
      expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
      await user.click(screen.getByRole("button", { name: "Generate Secret" }));
      const dialog = await screen.findByRole("dialog", {
        name: "Generate Hub Secret",
      });
      expect(await within(dialog).findByText("Exima")).toBeVisible();
      expect(within(dialog).getByText("Daily Check-in")).toBeVisible();
      // Nothing is made until it is confirmed.
      expect(calls).toEqual([]);
      await user.click(
        within(dialog).getByRole("button", { name: "Generate" }),
      );
      await waitFor(() => expect(calls).toEqual([{}]));
    });

    it("keeps an existing secret behind a dialog and rotates with a stronger warning", async () => {
      const calls = [];
      const { user } = renderPage([
        setupRoute(
          makeSetup({
            is_hub: true,
            env_settings: hubSettings,
            hub: { ...HUB, secret_set: false },
          }),
        ),
        IMPACT,
        HUB_OK,
        SECRET_OK,
        {
          path: "/api/admin/application-access/apps/demo/hub-secret",
          method: "POST",
          response: ({ options }) => {
            calls.push(JSON.parse(options.body));
            return jsonResponse({ data: { secret_set: true } });
          },
        },
      ]);
      await wizard(user);
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(
        screen.getByRole("button", { name: "Use The Hub's Current Secret" }),
      );
      const dialog = await screen.findByRole("dialog", {
        name: "Use The Hub's Current Secret",
      });
      expect(
        within(dialog).getByRole("button", { name: "Use This Secret" }),
      ).toBeDisabled();
      await user.type(
        within(dialog).getByLabelText("Existing Hub secret"),
        "short",
      );
      expect(within(dialog).getByText("At least 16 characters.")).toBeVisible();
      await user.clear(within(dialog).getByLabelText("Existing Hub secret"));
      await user.type(
        within(dialog).getByLabelText("Existing Hub secret"),
        "kept-from-the-hub-env-0123",
      );
      expect(
        within(dialog).getByRole("button", { name: "Use This Secret" }),
      ).toBeDisabled();
      await user.click(
        within(dialog).getByRole("button", { name: "Test This Secret" }),
      );
      expect(
        await within(dialog).findByText("The Hub accepts this secret."),
      ).toBeVisible();
      await user.click(
        within(dialog).getByRole("button", { name: "Use This Secret" }),
      );
      await waitFor(() =>
        expect(calls).toEqual([{ secret: "kept-from-the-hub-env-0123" }]),
      );
    });

    it("says so and blocks the secret when Central has no key to keep it with", async () => {
      const { user } = renderPage([
        setupRoute(
          makeSetup({
            is_hub: true,
            env_settings: hubSettings,
            hub: {
              base_url: "https://app.mws.web.id",
              secret_set: false,
              key_ready: false,
            },
          }),
        ),
        IMPACT,
        HUB_OK,
        SECRET_OK,
      ]);
      await wizard(user);
      await user.click(screen.getByRole("button", { name: "Continue" }));
      expect(
        screen.getByText("Central cannot keep a secret yet."),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Generate Secret" }),
      ).toBeDisabled();
    });

    it("shows a secret Central made once, masked, and never offers to show it again", async () => {
      const { user } = renderPage([
        setupRoute(
          makeSetup({ is_hub: true, env_settings: hubSettings, hub: HUB }),
        ),
        IMPACT,
        HUB_OK,
        SECRET_OK,
        {
          path: "/api/admin/application-access/apps/demo/hub-secret",
          method: "POST",
          response: () =>
            jsonResponse({
              data: { secret_set: true, secret: "abc123secret-0123456789-xyz" },
            }),
        },
      ]);
      await wizard(user);
      await user.click(screen.getByRole("button", { name: "Continue" }));
      // Nothing to reveal: the secret is generated and can only be replaced.
      expect(screen.getByText("Secret Generated")).toBeVisible();
      expect(
        screen.queryByRole("button", { name: /Show Secret|Reveal/ }),
      ).toBeNull();
      await user.click(screen.getByRole("button", { name: "Rotate Secret" }));
      const confirm = await screen.findByRole("dialog", {
        name: "Rotate Hub Secret",
      });
      await user.click(within(confirm).getByRole("button", { name: "Rotate" }));

      const dialog = await screen.findByRole("dialog", { name: "Hub Secret" });
      expect(within(dialog).getByText("Secret Shown Once")).toBeVisible();
      // Only a mask is on screen, the whole line is what gets copied.
      expect(
        within(dialog).queryByText(/abc123secret-0123456789-xyz/),
      ).toBeNull();
      await user.click(within(dialog).getByRole("button", { name: /Copy/ }));
      await waitFor(async () => {
        expect(await navigator.clipboard.readText()).toContain(
          'HUB_INTERNAL_SECRET="abc123secret-0123456789-xyz"',
        );
      });
    });

    it("shows the three sign-in lines first and copies them from the dialog", async () => {
      const { user } = renderPage([
        setupRoute(makeSetup({ is_hub: true, env_settings: hubSettings })),
      ]);
      await screen.findByText("Hub Sign-in");
      await user.click(
        screen.getByRole("button", { name: "Copy Sign-in Lines" }),
      );
      const dialog = await screen.findByRole("dialog", {
        name: "Sign-in Lines",
      });
      const lines =
        '# How the Hub checks who may sign in. Changes in the Hub setup wizard.\nHUB_CENTRAL_ACCESS_MODE="warn"\nHUB_CENTRAL_ACCESS_APP_ID="demo"\nHUB_CENTRAL_ACCESS_BYPASS_EMAILS="me@millennia21.id"';
      expect(
        within(dialog).getByText(/HUB_CENTRAL_ACCESS_MODE="warn"/),
      ).toBeVisible();
      await user.click(
        within(dialog).getByRole("button", { name: "Copy Lines" }),
      );
      await waitFor(async () => {
        expect(await navigator.clipboard.readText()).toBe(lines);
      });
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Sign-in Lines" }),
        ).toBeNull(),
      );
    });

    it("refuses an email that is not one", async () => {
      const { user } = renderPage([
        setupRoute(
          makeSetup({ is_hub: true, env_settings: hubSettings, hub: HUB }),
        ),
        IMPACT,
        HUB_OK,
        SECRET_OK,
      ]);
      await wizard(user);
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(screen.getByRole("radio", { name: /Enforce/ }));
      await user.click(
        screen.getByLabelText("Add an email that always gets in"),
      );
      await user.paste("nonsense@gmail.com");
      expect(screen.getByText(/Only millennia21.id emails/)).toBeVisible();
    });

    it("has none for an ordinary application", async () => {
      renderPage([setupRoute(makeSetup())]);
      await screen.findByText("Organization ID");
      expect(screen.queryByText("Hub Sign-in")).toBeNull();
    });
  });
});
