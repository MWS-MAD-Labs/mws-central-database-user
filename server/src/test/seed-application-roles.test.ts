import { describe, expect, it } from "bun:test";
import { planRoles, type PresetRole } from "../../scripts/seed-application-roles";

const role = (key: string, permissions: string[]): PresetRole => ({ key, label: key, permissions });

describe("seed application roles plan", () => {
  it("creates what is missing, once the permissions are published", () => {
    const plan = planRoles([role("DIRECTOR", ["a", "b"]), role("PRINCIPAL", ["a"])], [], ["a", "b"]);
    expect(plan.map((step) => step.action)).toEqual(["create", "create"]);
  });

  it("leaves an existing role alone and says why it skips the rest", () => {
    const plan = planRoles(
      [role("DIRECTOR", ["a"]), role("PRINCIPAL", ["b", "x"]), role("COACH", ["a"]), role("GUIDE", ["b"])],
      [{ key: "DIRECTOR", permissions: ["a"], is_active: true }],
      ["a", "b"],
    );
    expect(plan).toEqual([
      { key: "DIRECTOR", action: "skip", reason: "already exists" },
      { key: "PRINCIPAL", action: "skip", reason: "permissions not published yet: x" },
      { key: "COACH", action: "skip", reason: "DIRECTOR already has the same permissions" },
      { key: "GUIDE", action: "create", role: role("GUIDE", ["b"]) },
    ]);
  });

  it("does not make two presets with the same permissions in one run", () => {
    const plan = planRoles([role("ONE", ["a"]), role("TWO", ["a"])], [], ["a"]);
    expect(plan.map((step) => step.action)).toEqual(["create", "skip"]);
  });
});
