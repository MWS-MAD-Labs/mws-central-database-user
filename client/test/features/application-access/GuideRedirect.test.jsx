import { describe, expect, it } from "bun:test";
import { screen } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { GuideRedirect } from "../../../src/features/application-access/pages/GuideRedirect.jsx";
import { renderWithProviders } from "../../helpers/render.jsx";

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderAt(route) {
  return renderWithProviders(
    <Routes>
      <Route path="/application-access/guide" element={<GuideRedirect />} />
      <Route path="/application-access/apps/:applicationId/guide" element={<GuideRedirect />} />
      <Route path="/application-access/guides" element={<Where />} />
    </Routes>,
    { route },
  );
}

describe("GuideRedirect", () => {
  it("sends the start guide to the Guides page with the same part", async () => {
    renderAt("/application-access/guide?part=hub");
    expect((await screen.findByTestId("where")).textContent).toBe("/application-access/guides?part=hub");
  });

  it("sends the guide of an application with the application and the renamed part", async () => {
    renderAt("/application-access/apps/demo/guide?part=troubleshooting");
    expect((await screen.findByTestId("where")).textContent).toBe("/application-access/guides?part=problems&app=demo");
  });
});
