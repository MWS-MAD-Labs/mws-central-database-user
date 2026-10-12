import { describe, expect, it } from "bun:test";
import { screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { AuthContext } from "../../../src/features/auth/context/authContext.js";
import { AppGuidePage } from "../../../src/features/application-access/pages/AppGuidePage.jsx";
import { renderWithProviders } from "../../helpers/render.jsx";
import { createFetchRouter, jsonResponse } from "../../helpers/http.js";
import { ownerMessage, prefixedName, workflowJob } from "../../../src/features/application-access/utils/setupGuide.js";

const KEYS = [
  { key: "CENTRAL_API_BASE_URL", secret: false },
  { key: "CENTRAL_API_TOKEN", secret: true },
  { key: "CENTRAL_ORGANIZATION_ID", secret: false },
  { key: "HUB_BASE_URL", secret: false },
  { key: "HUB_INTERNAL_SECRET", secret: true },
];

function makeSetup(overrides = {}) {
  return {
    application: { application_id: "demo", name: "Demo App" },
    organization_id: "org_demo_abcdefghijklmnopqrst",
    is_hub: false,
    env_keys: KEYS,
    environment: "staging",
    central_url: "https://staging-db.example.com",
    hub_address: "https://staging-hub.example.com",
    ...overrides,
  };
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.search}</p>;
}

function renderGuide(query = "", setup = makeSetup(), user = { role: "SUPER_ADMIN" }) {
  globalThis.fetch = createFetchRouter([
    { path: "/api/admin/application-access/apps/demo/setup", response: () => jsonResponse({ data: setup }) },
  ]);
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <Where />
      <Routes>
        <Route path="/application-access/apps/:applicationId/guide" element={<AppGuidePage />} />
      </Routes>
    </AuthContext.Provider>,
    { route: `/application-access/apps/demo/guide${query}` },
  );
}

const title = async () => (await screen.findByRole("heading", { level: 2 })).textContent;

describe("AppGuidePage", () => {
  it("refuses anyone who is not a Super Admin", async () => {
    renderGuide("", makeSetup(), { role: "DATABASE_ADMIN" });
    expect(await screen.findByText("Only Super Admin can manage application access.")).toBeVisible();
  });

  it("shows one numbered part at a time, with Back and Next that keep the place in the address", async () => {
    const { user } = renderGuide();
    expect(await title()).toBe("Before you start");
    expect(screen.getByText("Part 1 of 6")).toBeVisible();
    // The list of parts is there for the whole read.
    const nav = screen.getByRole("navigation", { name: "Parts of the guide" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent.replace(/^\d/, ""))).toEqual([
      "Before you start",
      "On your machine",
      "Send the permissions",
      "Staging and production",
      "When you rotate",
      "Troubleshooting",
    ]);
    expect(within(nav).getByRole("link", { name: /Before you start/ })).toHaveAttribute("aria-current", "step");
    // Nothing to go back to on the first part.
    expect(screen.queryByRole("link", { name: "Back" })).toBeNull();

    await user.click(screen.getAllByRole("link", { name: /Next: On your machine/ })[0]);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("?part=local"));
    expect(await title()).toBe("On your machine");
    await user.click(screen.getAllByRole("link", { name: "Back" })[0]);
    expect(await title()).toBe("Before you start");
  });

  it("opens on the part named in the address, and falls back to the first for an unknown one", async () => {
    const view = renderGuide("?part=rotate");
    expect(await title()).toBe("When you rotate");
    view.unmount();
    renderGuide("?part=nowhere");
    expect(await title()).toBe("Before you start");
  });

  it("walks the local setup with the names this application reads and ends with what to expect", async () => {
    renderGuide("?part=local");
    expect(await screen.findByText(/CENTRAL_API_BASE_URL, CENTRAL_API_TOKEN, CENTRAL_ORGANIZATION_ID/)).toBeVisible();
    expect(screen.getByText(/curl -i "\$CENTRAL_API_BASE_URL\/application-permissions\/me"/)).toBeVisible();
    expect(screen.getByText(/older variables for the same thing with other names/)).toBeVisible();
    expect(screen.getByText(/You are done when/)).toBeVisible();
    expect(screen.getByText(/turns to Connected by itself/)).toBeVisible();
  });

  it("tells what to do to send the permissions, with a script that uses the names of this application", async () => {
    renderGuide("?part=permissions");
    const script = await screen.findByText(/process.env.CENTRAL_API_BASE_URL/, { selector: "pre" });
    expect(script.textContent).toContain("process.env.CENTRAL_API_TOKEN");
    expect(script.textContent).toContain("/application-permissions/me");
    expect(script.textContent).toContain("attempts");
    expect(screen.getByText(/Add it to predev too/)).toBeVisible();
    expect(screen.getByText(/the Permissions step on the setup page is done/)).toBeVisible();
  });

  describe("staging and production", () => {
    it("keeps the two apart with Environments by default, values of this Central only in its own card", async () => {
      renderGuide("?part=deploy");
      await screen.findByText(/Not on the Repository secrets page/);
      expect(screen.getByRole("radio", { name: /I can use Environments/ })).toHaveAttribute("aria-checked", "true");
      const staging = screen.getByRole("region", { name: "GitHub environment staging" });
      const production = screen.getByRole("region", { name: "GitHub environment production" });
      expect(within(staging).getByText("This Central")).toBeVisible();
      expect(within(production).getByText("Another Central")).toBeVisible();

      const stagingSecrets = within(staging).getAllByRole("table")[0];
      expect(within(stagingSecrets).getByText("CENTRAL_API_TOKEN")).toBeVisible();
      expect(within(stagingSecrets).getByText("HUB_INTERNAL_SECRET")).toBeVisible();
      const stagingVariables = within(staging).getAllByRole("table")[1];
      expect(within(stagingVariables).getByText("https://staging-db.example.com/api/internal")).toBeVisible();
      expect(within(stagingVariables).getByText("https://staging-hub.example.com")).toBeVisible();
      expect(within(stagingVariables).getByText("org_demo_abcdefghijklmnopqrst")).toBeVisible();
      // A token is never filled in.
      expect(within(stagingSecrets).getAllByText(/Shown once/).length).toBeGreaterThan(0);

      const prodVariables = within(production).getAllByRole("table")[1];
      expect(within(prodVariables).queryByText("https://staging-db.example.com/api/internal")).toBeNull();
      expect(within(production).getByText(/The values come from the production Central/)).toBeVisible();
      const job = screen.getByText(/environment: \$\{\{ github.ref_name == 'main'/, { selector: "pre" });
      expect(job.textContent).toContain("secrets.CENTRAL_API_TOKEN");
    });

    it("marks production as this Central when that is where the guide is opened", async () => {
      renderGuide("?part=deploy", makeSetup({ environment: "production", central_url: "https://db.example.com" }));
      const production = await screen.findByRole("region", { name: "GitHub environment production" });
      expect(within(production).getByText("This Central")).toBeVisible();
      expect(within(production).getByText("https://db.example.com/api/internal")).toBeVisible();
    });

    it("names the secrets with STAGING_ and PRODUCTION_ when there are no Environments, and the job picks by branch", async () => {
      const { user } = renderGuide("?part=deploy");
      await user.click(await screen.findByRole("radio", { name: /I can only add repository secrets/ }));
      await waitFor(() => expect(screen.getByTestId("where").textContent).toContain("github=prefixed"));
      const staging = await screen.findByRole("region", { name: "GitHub environment staging" });
      const production = screen.getByRole("region", { name: "GitHub environment production" });
      const table = within(staging).getByRole("table");
      expect(within(table).getByText("STAGING_CENTRAL_API_TOKEN")).toBeVisible();
      expect(within(table).getByText("STAGING_CENTRAL_API_BASE_URL")).toBeVisible();
      expect(within(table).queryByText("PRODUCTION_CENTRAL_API_TOKEN")).toBeNull();
      expect(within(within(production).getByRole("table")).getByText("PRODUCTION_CENTRAL_API_TOKEN")).toBeVisible();
      expect(screen.queryByText(/Not on the Repository secrets page/)).toBeNull();
      expect(screen.getByText(/Without Environments, the name keeps them apart/)).toBeVisible();
      const job = screen.getByText(/secrets.PRODUCTION_CENTRAL_API_TOKEN/, { selector: "pre" });
      expect(job.textContent).not.toContain("environment:");
      expect(job.textContent).toContain("secrets.STAGING_CENTRAL_API_TOKEN");
      // The place in the guide is kept while the choice changes.
      expect(screen.getByText("Part 4 of 6")).toBeVisible();
    });

    it("writes a message for the repository owner when nothing can be changed", async () => {
      renderGuide("?part=deploy&github=owner");
      const message = await screen.findByText(/Hi, I am setting up Demo App/, { selector: "pre" });
      expect(message.textContent).toContain("STAGING_CENTRAL_API_BASE_URL: https://staging-db.example.com/api/internal");
      // Another Central's values are not guessed, and no token is ever in it.
      expect(message.textContent).toContain("PRODUCTION_CENTRAL_API_BASE_URL: (from the production Central, I will send it)");
      expect(message.textContent).toContain("STAGING_CENTRAL_API_TOKEN: (from the staging Central, I will send it)");
      expect(message.textContent).toContain("node scripts/sync-permissions.mjs");
      expect(screen.getByRole("button", { name: "Copy Message" })).toBeVisible();
      expect(screen.queryByRole("region", { name: /GitHub environment/ })).toBeNull();
      expect(screen.getByText(/finish On your machine and Send the permissions/)).toBeVisible();
    });

    it("builds the names and the job the same way outside the page", () => {
      expect(prefixedName("CENTRAL_API_TOKEN", "production")).toBe("PRODUCTION_CENTRAL_API_TOKEN");
      const hub = workflowJob({ keys: KEYS, isHub: true, mode: "prefixed" });
      expect(hub).toContain("bun run permissions:sync --retries 5 --wait 20");
      expect(hub).not.toContain("environment:");
      expect(ownerMessage({ applicationName: "X", keys: KEYS, isHub: false, environment: "development", centralUrl: "http://localhost:3000", applicationId: "x" })).toContain(
        "(from the staging Central, I will send it)",
      );
    });
  });

  it("says what to do after a rotation, in order, with the names and the environment of this Central", async () => {
    renderGuide("?part=rotate");
    expect(await screen.findByText("Rotate the token of this application")).toBeVisible();
    expect(screen.getByText("Replace CENTRAL_API_TOKEN in the .env of the application.")).toBeVisible();
    expect(
      screen.getByText("In GitHub open Settings, then Environments, then staging, and replace the secret CENTRAL_API_TOKEN with the new value."),
    ).toBeVisible();
    expect(screen.getByText("Rotate the Hub secret of this application")).toBeVisible();
    expect(screen.getByText("Rotate the Hub's master secret")).toBeVisible();
    // The last part of the guide goes back to the setup.
  });

  it("uses the sync command of the Hub for the Hub and has no secret of its own to rotate", async () => {
    const view = renderGuide("?part=permissions", makeSetup({ is_hub: true }));
    expect(await screen.findByText(/The Hub keeps its permissions in its code/)).toBeVisible();
    expect(screen.queryByText("Copy Script")).toBeNull();
    view.unmount();
    renderGuide("?part=rotate", makeSetup({ is_hub: true }));
    await screen.findByText("Rotate the token of this application");
    expect(screen.queryByText("Rotate the Hub secret of this application")).toBeNull();
  });

  it("lists what to check when nothing arrives, and ends by going back to the setup", async () => {
    renderGuide("?part=troubleshooting");
    expect(await screen.findByText("Still nothing after 10 minutes")).toBeVisible();
    expect(screen.getByText(/its ID is demo/)).toBeVisible();
    expect(screen.getByText(/The deploy job cannot see a secret/)).toBeVisible();
    expect(screen.queryByRole("link", { name: /^Next:/ })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Back To Setup" })[0]).toHaveAttribute("href", "/application-access/apps/demo/setup");
  });
});
