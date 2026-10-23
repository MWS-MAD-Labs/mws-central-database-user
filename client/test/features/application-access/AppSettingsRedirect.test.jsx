import { describe, expect, it } from "bun:test";
import { screen } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { AppSettingsRedirect } from "../../../src/features/application-access/pages/AppSettingsRedirect.jsx";
import { renderWithProviders } from "../../helpers/render.jsx";

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderAt(route) {
  return renderWithProviders(
    <Routes>
      <Route path="/application-access/apps/:applicationId/settings" element={<AppSettingsRedirect />} />
      <Route path="/application-access/apps/:applicationId" element={<Where />} />
    </Routes>,
    { route },
  );
}

describe("AppSettingsRedirect", () => {
  it("opens the overview of the application when no tab is named", async () => {
    renderAt("/application-access/apps/demo/settings");
    expect((await screen.findByTestId("where")).textContent).toBe("/application-access/apps/demo?tab=overview");
  });

  it("keeps the tab that was named", async () => {
    renderAt("/application-access/apps/demo/settings?tab=connection");
    expect((await screen.findByTestId("where")).textContent).toBe("/application-access/apps/demo?tab=connection");
  });
});
