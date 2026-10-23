import { describe, expect, it } from "bun:test";
import { screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { AuthContext } from "../../../src/features/auth/context/authContext.js";
import { GuidesPage } from "../../../src/features/application-access/pages/GuidesPage.jsx";
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

function renderGuide(query = "", setup = makeSetup(), user = { role: "SUPER_ADMIN", is_protected: true }, withApp = true) {
  globalThis.fetch = createFetchRouter([
    { path: "/api/admin/application-access/context", response: () => jsonResponse({ data: { environment: "staging", suggested_hub_url: "https://app-stg.mws.web.id" } }) },
    { path: "/api/admin/application-access/applications", response: () => jsonResponse({ data: [{ application_id: "demo", name: "Demo App" }] }) },
    { path: "/api/admin/application-access/apps/demo/setup", response: () => jsonResponse({ data: setup }) },
  ]);
  const address = new URLSearchParams(query);
  if (!address.has("app") && withApp) address.set("app", "demo");
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <Where />
      <Routes>
        <Route path="/application-access/guides" element={<GuidesPage />} />
      </Routes>
    </AuthContext.Provider>,
    { route: `/application-access/guides?${address.toString()}` },
  );
}

const title = async () => (await screen.findByRole("heading", { level: 2 })).textContent;

describe("GuidesPage", () => {
  it("refuses anyone who is not a Super Admin", async () => {
    renderGuide("", makeSetup(), { role: "DATABASE_ADMIN" });
    expect(await screen.findByText("Only a protected Super Admin can manage application access.")).toBeVisible();
  });

  it("shows one numbered part at a time, with Back and Next that keep the place in the address", async () => {
    const { user } = renderGuide();
    expect(await title()).toBe("How it fits");
    expect(screen.getByText("Part 1 of 11")).toBeVisible();
    // The list of parts is there for the whole read.
    const nav = screen.getByRole("navigation", { name: "Parts of the guide" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent.replace(/^\d+/, ""))).toEqual([
      "How it fits",
      "Add the Hub first",
      "Add an application",
      "Choose the sign-in way",
      "On your machine",
      "Send the permissions",
      "Staging and production",
      "Check it works",
      "When you rotate",
      "Retire or remove",
      "When something fails",
    ]);
    expect(within(nav).getByRole("link", { name: /How it fits/ })).toHaveAttribute("aria-current", "step");
    // Nothing to go back to on the first part.
    expect(screen.queryByRole("link", { name: "Back" })).toBeNull();

    await user.click(screen.getAllByRole("link", { name: /Next: Add the Hub first/ })[0]);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("?part=hub&app=demo"));
    expect(await title()).toBe("Add the Hub first");
    await user.click(screen.getAllByRole("link", { name: "Back" })[0]);
    expect(await title()).toBe("How it fits");
  });

  it("opens on the part named in the address, and falls back to the first for an unknown one", async () => {
    const view = renderGuide("?part=rotate");
    expect(await title()).toBe("When you rotate");
    view.unmount();
    renderGuide("?part=nowhere");
    expect(await title()).toBe("How it fits");
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
      // Only the three names of the pipeline are set in GitHub. The rest is for the server.
      expect(within(stagingSecrets).queryByText("HUB_INTERNAL_SECRET")).toBeNull();
      const server = screen.getByRole("region", { name: "Not in GitHub" });
      expect(within(server).getByText("HUB_INTERNAL_SECRET")).toBeVisible();
      expect(within(server).getByText("HUB_BASE_URL")).toBeVisible();
      expect(within(server).queryByText("CENTRAL_API_TOKEN")).toBeNull();
      const stagingVariables = within(staging).getAllByRole("table")[1];
      expect(within(stagingVariables).getByText("https://staging-db.example.com/api/internal")).toBeVisible();
      expect(within(stagingVariables).queryByText("https://staging-hub.example.com")).toBeNull();
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
      expect(screen.getByText("Part 7 of 11")).toBeVisible();
    });

    it("writes a message for the repository owner when nothing can be changed", async () => {
      renderGuide("?part=deploy&github=owner");
      const message = await screen.findByText(/Hi, I am setting up Demo App/, { selector: "pre" });
      expect(message.textContent).toContain("STAGING_CENTRAL_API_BASE_URL: https://staging-db.example.com/api/internal");
      // Another Central's values are not guessed, and no token is ever in it.
      expect(message.textContent).toContain("PRODUCTION_CENTRAL_API_BASE_URL: (from the production Central, I will send it)");
      expect(message.textContent).toContain("STAGING_CENTRAL_API_TOKEN: (from the staging Central, I will send it)");
      expect(message.textContent).toContain("node scripts/sync-permissions.mjs");
      // The lines for the server are not asked for in GitHub.
      expect(message.textContent).not.toContain("HUB_BASE_URL");
      expect(message.textContent).not.toContain("HUB_INTERNAL_SECRET");
      expect(message.textContent).toContain("Only these three names are needed in GitHub");
      expect(screen.getByRole("button", { name: "Copy Message" })).toBeVisible();
      expect(screen.queryByRole("region", { name: /GitHub environment/ })).toBeNull();
      expect(screen.getByText(/finish On your machine and Send the permissions/)).toBeVisible();
    });

    it("builds the names and the job the same way outside the page", () => {
      expect(prefixedName("CENTRAL_API_TOKEN", "production")).toBe("PRODUCTION_CENTRAL_API_TOKEN");
      const hub = workflowJob({ keys: KEYS, isHub: true, mode: "prefixed" });
      expect(hub).toContain("bun run permissions:sync --retries 5 --wait 20");
      expect(hub).not.toContain("environment:");
      expect(hub).toContain("PRODUCTION_CENTRAL_ORGANIZATION_ID: ${{ secrets.PRODUCTION_CENTRAL_ORGANIZATION_ID }}");
      expect(hub).not.toContain("&&");
      const withEnvironments = workflowJob({ keys: KEYS, isHub: false, mode: "environments" });
      expect(withEnvironments).toContain("environment: ${{ github.ref_name == 'main' && 'production' || 'staging' }}");
      expect(withEnvironments).toContain("CENTRAL_ORGANIZATION_ID: ${{ vars.CENTRAL_ORGANIZATION_ID || secrets.CENTRAL_ORGANIZATION_ID }}");
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
      screen.getByText(
        "In GitHub replace the secret CENTRAL_API_TOKEN with the new value. It is in the environment staging, or among the repository secrets as STAGING_CENTRAL_API_TOKEN if you do not use Environments.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Rotate the Hub secret of this application")).toBeVisible();
    expect(screen.getByText("Rotate the Hub's master secret")).toBeVisible();
    // The last part of the guide goes back to the setup.
  });

  it("links the rotation to the Connection tab of the application picked", async () => {
    renderGuide("?part=rotate");
    expect(await screen.findByRole("link", { name: "Open The Connection Tab" })).toHaveAttribute("href", "/application-access/apps/demo?tab=connection");
  });

  it("covers a deploy without a pipeline, the checks after a rotation and Rotate Everything", async () => {
    renderGuide("?part=rotate");
    expect(await screen.findByText("No pipeline or GitHub secrets")).toBeVisible();
    expect(screen.getByText(/Komodo: open the stack/)).toBeVisible();
    expect(screen.getByText("After you put the values in")).toBeVisible();
    expect(screen.getByText("Rotate Everything")).toBeVisible();
    expect(screen.queryByText("Rotate the Hub's signing key")).toBeNull();
  });

  it("explains the signing key rotation on the Hub's guide", async () => {
    renderGuide("?part=rotate", makeSetup({ is_hub: true }));
    expect(await screen.findByText("Rotate the Hub's signing key")).toBeVisible();
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

  it("lists what to check when nothing arrives, for the application picked, and ends by going back to the applications", async () => {
    renderGuide("?part=problems");
    expect(await screen.findByText("Still nothing after 10 minutes")).toBeVisible();
    expect(screen.getByText(/its ID is demo/)).toBeVisible();
    expect(screen.getByText(/The deploy job cannot see a secret/)).toBeVisible();
    expect(screen.queryByRole("link", { name: /^Next:/ })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Back To Applications" })[0]).toHaveAttribute("href", "/application-access");
  });

  it("covers a deploy without a pipeline, with Komodo and with curl", async () => {
    const { user } = renderGuide("?part=deploy&github=komodo");
    expect(await screen.findByText(/Open the terminal of the application container in Komodo/)).toBeVisible();
    await user.click(screen.getByRole("radio", { name: /No pipeline, I use curl/ }));
    expect(await screen.findByText(/curl -i -X PUT "https:\/\/staging-db.example.com\/api\/internal\/application-permissions\/me"/)).toBeVisible();
  });

  it("keeps the general text before an application is picked", async () => {
    renderGuide("?part=local", makeSetup(), undefined, false);
    expect(await screen.findByText("General")).toBeVisible();
    const href = screen.getByRole("link", { name: /How it fits/ }).getAttribute("href");
    expect(href).toContain("part=how");
    expect(href).not.toContain("app=");
    expect(screen.queryByText(/its ID is demo/)).toBeNull();
  });

  describe("the start of the way", () => {
    it("names what Central needs and the Hub with its key command, lines and address", async () => {
      renderGuide("?part=how");
      expect(await screen.findByText(/APP_SECRETS_KEY in this Central/)).toBeVisible();
      expect(await screen.findByText(/You are in the Staging Central/)).toBeVisible();
    });

    it("walks through the Hub with the key command and the address of this Hub", async () => {
      renderGuide("?part=hub");
      expect(await title()).toBe("Add the Hub first");
      expect(screen.getByText(/openssl genpkey -algorithm RSA/)).toBeVisible();
      expect(screen.getByText(/Key: choose Make Signing Key/)).toBeVisible();
      expect(await screen.findByText(/https:\/\/app-stg\.mws\.web\.id\/\.well-known\/jwks\.json/)).toBeVisible();
    });

    it("walks through adding an application and lists what failed with its cause", async () => {
      const view = renderGuide("?part=app");
      expect(await title()).toBe("Add an application");
      expect(screen.getByText(/needs students:read/)).toBeVisible();
      view.unmount();
      renderGuide("?part=problems");
      const message = await screen.findByText("A Hub answers here, but it has no sign-in key yet");
      expect(message.closest("div")).toHaveTextContent("HUB_SSO_PRIVATE_KEY");
      expect(screen.getByText("Missing required scope")).toBeVisible();
    });

    it("explains how an application is retired and removed", async () => {
      renderGuide("?part=remove");
      expect(await screen.findByText(/1\. Retire\./)).toBeVisible();
      expect(screen.getByText(/The Hub itself:/)).toBeVisible();
    });

    it("never prints a secret", async () => {
      const { container } = renderGuide("?part=hub");
      await title();
      expect(container.textContent).not.toMatch(/BEGIN PRIVATE KEY-----\s*[A-Za-z0-9+/=]{20,}/);
    });
  });

  describe("languages", () => {
    it("reads in English by default and switches to Indonesian, keeping the place and the choice", async () => {
      window.localStorage.removeItem("mws-guide-lang");
      const { user } = renderGuide("?part=rotate");
      expect(await title()).toBe("When you rotate");
      expect(screen.getByRole("radio", { name: "English" })).toHaveAttribute("aria-checked", "true");
      await user.click(screen.getByRole("radio", { name: "Indonesia" }));
      expect(await title()).toBe("Rotasi");
      expect(screen.getByText(/Rotasi menghasilkan nilai baru/)).toBeVisible();
      expect(screen.getByText(/Selesai jika/)).toBeVisible();
      expect(screen.getByText(/Bagian 9 dari 11/)).toBeVisible();
      expect(screen.getByTestId("where").textContent).toContain("lang=id");
      expect(window.localStorage.getItem("mws-guide-lang")).toBe("id");
      window.localStorage.removeItem("mws-guide-lang");
    });

    it("opens in Indonesian from the address and carries it to the next part", async () => {
      const { user } = renderGuide("?part=how&lang=id");
      expect(await title()).toBe("Gambaran umum");
      expect(screen.getByText(/Ada tiga bagian yang saling bergantung/)).toBeVisible();
      await user.click(screen.getAllByRole("link", { name: /Berikutnya: Tambahkan Hub terlebih dahulu/ })[0]);
      await waitFor(() => expect(screen.getByTestId("where").textContent).toContain("lang=id"));
      expect(await title()).toBe("Tambahkan Hub terlebih dahulu");
    });

    it("writes the deploy choices, the owner message and the rotation in Indonesian", async () => {
      renderGuide("?part=deploy&github=owner&lang=id");
      expect(await screen.findByText("Saya tidak dapat mengubah pengaturan GitHub")).toBeVisible();
      expect(screen.getByText(/Halo, saya sedang menghubungkan Demo App/, { selector: "pre" })).toBeVisible();
    });
  });
});
