import { describe, expect, it } from "bun:test";
import { ApplicationRoleValidation, ROLE_LABEL_PATTERN } from "../validation/application-entitlement-validation";

const base = { application_id: "exima", key: "STAFF", permissions: ["app.use"] };

describe("role label", () => {
  it("is plain words", () => {
    for (const label of ["Admin", "Support Staff", "Guru Kelas 2", "Wali Murid"]) {
      expect(ROLE_LABEL_PATTERN.test(label)).toBe(true);
    }
    for (const label of ["Staff-IT", "Staff_IT", "Staff  IT", "Staff!", "Staff 😀", "A&B"]) {
      expect(ROLE_LABEL_PATTERN.test(label)).toBe(false);
    }
  });

  it("is checked when a role is created or its label changed", () => {
    expect(ApplicationRoleValidation.CREATE.safeParse({ ...base, label: "Support Staff" }).success).toBe(true);
    const bad = ApplicationRoleValidation.CREATE.safeParse({ ...base, label: "Staff-IT" });
    expect(bad.success).toBe(false);
    expect(ApplicationRoleValidation.UPDATE.safeParse({ id: "r1", label: "Staff #1" }).success).toBe(false);
    expect(ApplicationRoleValidation.UPDATE.safeParse({ id: "r1", is_active: false }).success).toBe(true);
  });
});
