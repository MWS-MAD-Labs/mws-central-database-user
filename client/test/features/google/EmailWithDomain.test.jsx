import { describe, expect, it } from "bun:test";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { EmailWithDomain } from "../../../src/features/google/components/EmailWithDomain.jsx";
import { renderWithProviders } from "../../helpers/render.jsx";

function Harness({ initial = "" }) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <EmailWithDomain value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </div>
  );
}

const value = () => screen.getByTestId("value").textContent;
// The domain is the app's own dropdown: open it from the button that shows the current pick, then choose.
async function pick(user, current, next) {
  await user.click(screen.getByRole("button", { name: current }));
  await user.click(screen.getByRole("option", { name: next }));
}

describe("EmailWithDomain", () => {
  it("makes a whole email from the name and a domain pick, gmail.com first", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    expect(screen.getByRole("button", { name: "@gmail.com" })).toBeVisible();
    await user.type(screen.getByPlaceholderText("Email"), "Budi.Santoso");
    expect(value()).toBe("budi.santoso@gmail.com");
    await pick(user, "@gmail.com", "@yahoo.co.id");
    expect(value()).toBe("budi.santoso@yahoo.co.id");
  });

  it("keeps the domain picked before any name is typed", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await pick(user, "@gmail.com", "@outlook.com");
    await user.type(screen.getByPlaceholderText("Email"), "ari");
    expect(value()).toBe("ari@outlook.com");
  });

  it("takes a whole address for another domain, and goes back to the list", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await pick(user, "@gmail.com", "Another Domain");
    await user.type(screen.getByPlaceholderText("Email"), "ari@sekolah.sch.id");
    expect(value()).toBe("ari@sekolah.sch.id");
    await user.click(
      screen.getByRole("button", { name: "Pick a common domain" }),
    );
    expect(value()).toBe("ari@gmail.com");
    expect(screen.getByRole("button", { name: "@gmail.com" })).toBeVisible();
  });

  it("shows an address on an unlisted domain whole, however it got there", () => {
    renderWithProviders(<Harness initial="ari@sekolah.sch.id" />);
    expect(screen.getByPlaceholderText("Email").value).toBe(
      "ari@sekolah.sch.id",
    );
  });
});
