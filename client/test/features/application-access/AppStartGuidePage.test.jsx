import { describe, expect, it } from "bun:test";
import { screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { AuthContext } from "../../../src/features/auth/context/authContext.js";
import { AppStartGuidePage } from "../../../src/features/application-access/pages/AppStartGuidePage.jsx";
import { renderWithProviders } from "../../helpers/render.jsx";
import { createFetchRouter, jsonResponse } from "../../helpers/http.js";

function renderGuide(query = "", user = { role: "SUPER_ADMIN", is_protected: true }, context = { environment: "staging", suggested_hub_url: "https://app-stg.mws.web.id" }) {
  globalThis.fetch = createFetchRouter([
    { path: "/api/admin/application-access/context", response: () => jsonResponse({ data: context }) },
  ]);
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <Routes>
        <Route path="/application-access/guide" element={<AppStartGuidePage />} />
      </Routes>
    </AuthContext.Provider>,
    { route: `/application-access/guide${query}` },
  );
}

const title = async () => (await screen.findByRole("heading", { level: 2 })).textContent;

describe("AppStartGuidePage", () => {
  it("refuses anyone who is not a protected Super Admin", async () => {
    renderGuide("", { role: "DATABASE_ADMIN" });
    expect(await screen.findByText("Only a protected Super Admin can manage application access.")).toBeVisible();
  });

  it("starts at the beginning, lists every part and says which Central it is about", async () => {
    renderGuide();
    expect(await title()).toBe("How it fits");
    expect(screen.getByText("Part 1 of 6")).toBeVisible();
    expect(await screen.findByText(/You are in the Staging Central/)).toBeVisible();
    const nav = screen.getByRole("navigation", { name: "Parts of the guide" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent.replace(/^\d/, ""))).toEqual([
      "How it fits",
      "Add the Hub first",
      "Add an application",
      "Choose the sign-in way",
      "Check it works",
      "When something fails",
    ]);
  });

  it("names what Central itself needs before the Hub can be added", async () => {
    renderGuide();
    await title();
    expect(screen.getByText(/APP_SECRETS_KEY in this Central/)).toBeVisible();
  });

  it("moves with Next and Back and stays on the part named in the address", async () => {
    const { user } = renderGuide();
    await title();
    await user.click(screen.getByRole("link", { name: /Next: Add the Hub first/ }));
    expect(await title()).toBe("Add the Hub first");
    await user.click(screen.getByRole("link", { name: "Back" }));
    expect(await title()).toBe("How it fits");
  });

  it("walks through the Hub with the key command, the environment lines and the address of this Hub", async () => {
    renderGuide("?part=hub");
    expect(await title()).toBe("Add the Hub first");
    expect(screen.getByText(/openssl genpkey -algorithm RSA/)).toBeVisible();
    expect(screen.getByText(/HUB_SSO_PRIVATE_KEY: the whole private file/)).toBeVisible();
    expect(await screen.findByText(/https:\/\/app-stg\.mws\.web\.id\/\.well-known\/jwks\.json/)).toBeVisible();
    expect(screen.getByText(/CENTRAL_API_TOKEN_STAGING/)).toBeVisible();
  });

  it("lists what failed with its cause and what to do", async () => {
    renderGuide("?part=problems");
    expect(await title()).toBe("When something fails");
    const message = screen.getByText("A Hub answers here, but it has no sign-in key yet");
    expect(message.closest("div")).toHaveTextContent("HUB_SSO_PRIVATE_KEY");
    expect(screen.getByText("Missing required scope")).toBeVisible();
  });

  it("never prints a secret", async () => {
    const { container } = renderGuide("?part=hub");
    await title();
    expect(container.textContent).not.toMatch(/BEGIN PRIVATE KEY-----\s*[A-Za-z0-9+/=]{20,}/);
  });
});
