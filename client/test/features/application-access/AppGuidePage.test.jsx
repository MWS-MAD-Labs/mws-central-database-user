import { describe, expect, it } from "bun:test";
import { screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { AuthContext } from "../../../src/features/auth/context/authContext.js";
import { AppGuidePage } from "../../../src/features/application-access/pages/AppGuidePage.jsx";
import { renderWithProviders } from "../../helpers/render.jsx";
import { createFetchRouter, jsonResponse } from "../../helpers/http.js";

const KEYS = [
  { key: "CENTRAL_API_BASE_URL", secret: false },
  { key: "CENTRAL_API_TOKEN", secret: true },
  { key: "CENTRAL_ENTITLEMENT_ORGANIZATION_ID", secret: false },
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

function renderGuide(setup = makeSetup(), user = { role: "SUPER_ADMIN" }) {
  globalThis.fetch = createFetchRouter([
    { path: "/api/admin/application-access/apps/demo/setup", response: () => jsonResponse({ data: setup }) },
  ]);
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <Routes>
        <Route path="/application-access/apps/:applicationId/guide" element={<AppGuidePage />} />
      </Routes>
    </AuthContext.Provider>,
    { route: "/application-access/apps/demo/guide" },
  );
}

describe("AppGuidePage", () => {
  it("refuses anyone who is not a Super Admin", async () => {
    renderGuide(makeSetup(), { role: "DATABASE_ADMIN" });
    expect(await screen.findByText("Only Super Admin can manage application access.")).toBeVisible();
  });

  it("has the parts in order, with a way back to the setup", async () => {
    renderGuide();
    const titles = (await screen.findAllByRole("heading", { level: 2 })).map((heading) => heading.textContent);
    expect(titles).toEqual(["First setup", "Staging and production, with GitHub", "When you rotate", "Troubleshooting"]);
    expect(screen.getByRole("link", { name: /Back To Setup/ })).toHaveAttribute("href", "/application-access/apps/demo/setup");
    expect(within(screen.getByRole("navigation", { name: "Parts of the guide" })).getAllByRole("link")).toHaveLength(4);
  });

  it("tells the first setup with the names this application reads and a script that uses them", async () => {
    renderGuide();
    expect((await screen.findAllByText(/CENTRAL_API_BASE_URL, CENTRAL_API_TOKEN, CENTRAL_ENTITLEMENT_ORGANIZATION_ID/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/curl -i "\$CENTRAL_API_BASE_URL\/application-permissions\/me"/)).toBeVisible();
    expect(screen.getByText(/A 200 means Central knows the token/)).toBeVisible();
    const script = screen.getByText(/process.env.CENTRAL_API_BASE_URL/, { selector: "pre" });
    expect(script.textContent).toContain("process.env.CENTRAL_API_TOKEN");
    expect(script.textContent).toContain("/application-permissions/me");
    expect(script.textContent).toContain("attempts");
    expect(screen.getByText(/Add it to predev too/)).toBeVisible();
  });

  it("keeps staging and production apart, with the values of this Central only in its own card", async () => {
    renderGuide();
    await screen.findByText(/Not on the Repository secrets page/);
    const staging = screen.getByRole("region", { name: "GitHub environment staging" });
    const production = screen.getByRole("region", { name: "GitHub environment production" });
    expect(within(staging).getByText("This Central")).toBeVisible();
    expect(within(production).getByText("Another Central")).toBeVisible();

    // Staging: the secret names, the variable names and the values that are known.
    const stagingSecrets = within(staging).getAllByRole("table")[0];
    expect(within(stagingSecrets).getByText("CENTRAL_API_TOKEN")).toBeVisible();
    expect(within(stagingSecrets).getByText("HUB_INTERNAL_SECRET")).toBeVisible();
    expect(within(stagingSecrets).queryByText("CENTRAL_API_BASE_URL")).toBeNull();
    const stagingVariables = within(staging).getAllByRole("table")[1];
    expect(within(stagingVariables).getByText("https://staging-db.example.com/api/internal")).toBeVisible();
    expect(within(stagingVariables).getByText("https://staging-hub.example.com")).toBeVisible();
    expect(within(stagingVariables).getByText("org_demo_abcdefghijklmnopqrst")).toBeVisible();
    // A token is never filled in.
    expect(within(stagingSecrets).getAllByText(/Shown once/).length).toBeGreaterThan(0);

    // Production: the same names, but no value is guessed.
    const prodVariables = within(production).getAllByRole("table")[1];
    expect(within(prodVariables).getByText("CENTRAL_API_BASE_URL")).toBeVisible();
    expect(within(prodVariables).queryByText("https://staging-db.example.com/api/internal")).toBeNull();
    expect(within(production).getByText(/The values come from the production Central/)).toBeVisible();
  });

  it("marks production as this Central when that is where the guide is opened", async () => {
    renderGuide(makeSetup({ environment: "production", central_url: "https://db.example.com" }));
    const production = await screen.findByRole("region", { name: "GitHub environment production" });
    expect(within(production).getByText("This Central")).toBeVisible();
    expect(within(production).getByText("https://db.example.com/api/internal")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "GitHub environment staging" })).getByText("Another Central")).toBeVisible();
  });

  it("has the job for the pipeline that picks the environment from the branch", async () => {
    renderGuide(makeSetup({ environment: "development" }));
    const job = await screen.findByText(/environment: \$\{\{ github.ref_name == 'main'/, { selector: "pre" });
    expect(job.textContent).toContain("secrets.CENTRAL_API_TOKEN");
    expect(job.textContent).toContain("node scripts/sync-permissions.mjs");
    // A development Central is neither card.
    expect(screen.getAllByText("Another Central")).toHaveLength(2);
  });

  it("says what to do after a rotation, in order, with the names and the environment of this Central", async () => {
    renderGuide();
    const rotate = (await screen.findByRole("heading", { level: 2, name: "When you rotate" })).closest("section");
    expect(within(rotate).getByText("Rotate the token of this application")).toBeVisible();
    expect(within(rotate).getByText("Replace CENTRAL_API_TOKEN in the .env of the application.")).toBeVisible();
    expect(
      within(rotate).getByText(
        "In GitHub open Settings, then Environments, then staging, and replace the secret CENTRAL_API_TOKEN with the new value.",
      ),
    ).toBeVisible();
    expect(within(rotate).getByText("Rotate the Hub secret of this application")).toBeVisible();
    expect(within(rotate).getByText("Rotate the Hub's master secret")).toBeVisible();
  });

  it("uses the sync command of the Hub for the Hub and has no secret of its own to rotate", async () => {
    renderGuide(makeSetup({ is_hub: true }));
    await screen.findByText(/The Hub keeps its permissions in its code/);
    expect(screen.queryByText("Copy Script")).toBeNull();
    expect(screen.queryByText("Rotate the Hub secret of this application")).toBeNull();
    const job = screen.getByText(/environment: \$\{\{ github.ref_name == 'main'/, { selector: "pre" });
    expect(job.textContent).toContain("bun run permissions:sync --retries 5 --wait 20");
  });

  it("lists what to check when nothing arrives", async () => {
    renderGuide();
    expect(await screen.findByText("Still nothing after 10 minutes")).toBeVisible();
    expect(screen.getByText(/its ID is demo/)).toBeVisible();
  });
});
