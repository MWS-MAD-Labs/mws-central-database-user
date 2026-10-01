import { describe, expect, it } from "bun:test";
import { AdminRole, type AdminUser } from "../generated/prisma/client";
import {
  assertCanWriteUnit,
  assertCanWriteUnits,
  assertCanManageEnrollments,
  assertCanManageTeacherAssignments,
  canViewAcademicData,
  canViewEmployeeDisciplinaryData,
  canViewEmployeeData,
  canViewStudentData,
  isUnitWritable,
  resolveAcademicUnitScope,
  resolveEmployeeUnitScope,
  resolveStudentUnitScope,
  resolveWriteUnitScope,
} from "../utils/admin-permissions";
import { normalizeAdminPermissions } from "../service/admin-user-service";

function admin(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    role: AdminRole.VIEWER,
    can_view_student_data: false,
    can_view_employee_data: false,
    can_view_employee_disciplinary_data: false,
    can_manage_enrollments: false,
    can_manage_teacher_assignments: false,
    ...overrides,
  } as AdminUser;
}

describe("admin domain permissions", () => {
  it("keeps student and workforce view independent", () => {
    const studentViewer = admin({ can_view_student_data: true });
    expect(canViewStudentData(studentViewer)).toBe(true);
    expect(canViewEmployeeData(studentViewer)).toBe(false);
    expect(canViewAcademicData(studentViewer)).toBe(true);
  });

  it("allows task capabilities only for database admins", () => {
    const databaseAdmin = admin({
      role: AdminRole.DATABASE_ADMIN,
      can_manage_enrollments: true,
      can_manage_teacher_assignments: true,
    });
    expect(() => assertCanManageEnrollments(databaseAdmin)).not.toThrow();
    expect(() => assertCanManageTeacherAssignments(databaseAdmin)).not.toThrow();

    const viewer = admin({
      can_manage_enrollments: true,
      can_manage_teacher_assignments: true,
    });
    expect(() => assertCanManageEnrollments(viewer)).toThrow();
    expect(() => assertCanManageTeacherAssignments(viewer)).toThrow();
  });

  it("gives super admins every effective capability", () => {
    const superAdmin = admin({ role: AdminRole.SUPER_ADMIN });
    expect(canViewStudentData(superAdmin)).toBe(true);
    expect(canViewEmployeeData(superAdmin)).toBe(true);
    expect(() => assertCanManageEnrollments(superAdmin)).not.toThrow();
    expect(() => assertCanManageTeacherAssignments(superAdmin)).not.toThrow();
  });

  it("revokes employee dependencies when employee view is unchecked", () => {
    const result = normalizeAdminPermissions(
      admin({
        role: AdminRole.DATABASE_ADMIN,
        can_view_student_data: true,
        can_view_employee_data: true,
      }),
      {
        can_view_student_data: true,
        can_view_employee_data: false,
        can_view_employee_disciplinary_data: true,
        can_view_sensitive_data: true,
        can_view_employee_pii: true,
        can_view_all_student_units: false,
        can_view_all_employee_units: true,
        student_view_unit_ids: ["student-unit"],
        employee_view_unit_ids: ["employee-unit"],
        can_write_student_data: true,
        can_write_employee_data: true,
        can_manage_enrollments: true,
        can_manage_teacher_assignments: true,
      },
    );

    expect(result.can_view_employee_data).toBe(false);
    expect(result.can_view_employee_pii).toBe(false);
    expect(result.can_view_employee_disciplinary_data).toBe(false);
    expect(result.can_write_employee_data).toBe(false);
    expect(result.can_manage_teacher_assignments).toBe(false);
    expect(result.can_view_all_employee_units).toBe(false);
    expect(result.employee_view_unit_ids).toEqual([]);
    expect(result.can_view_student_data).toBe(true);
    expect(result.can_view_all_student_units).toBe(false);
    expect(result.student_view_unit_ids).toEqual(["student-unit"]);
  });

  it("revokes student dependencies when student view is unchecked", () => {
    const result = normalizeAdminPermissions(
      admin({
        role: AdminRole.DATABASE_ADMIN,
        can_view_student_data: true,
        can_view_employee_data: true,
        can_view_employee_disciplinary_data: true,
      }),
      {
        can_view_student_data: false,
        can_view_employee_data: true,
        can_view_employee_disciplinary_data: true,
        can_view_sensitive_data: true,
        can_view_employee_pii: true,
        can_view_all_student_units: true,
        can_view_all_employee_units: false,
        student_view_unit_ids: ["student-unit"],
        employee_view_unit_ids: ["employee-unit"],
        can_write_student_data: true,
        can_write_employee_data: true,
        can_manage_enrollments: true,
        can_manage_teacher_assignments: true,
      },
    );

    expect(result.can_view_student_data).toBe(false);
    expect(result.can_view_sensitive_data).toBe(false);
    expect(result.can_write_student_data).toBe(false);
    expect(result.can_manage_enrollments).toBe(false);
    expect(result.can_view_all_student_units).toBe(false);
    expect(result.student_view_unit_ids).toEqual([]);
    expect(result.can_view_employee_data).toBe(true);
    expect(result.employee_view_unit_ids).toEqual(["employee-unit"]);
  });

  it("enables parent view when a dependency is newly granted", () => {
    const result = normalizeAdminPermissions(
      admin({ role: AdminRole.DATABASE_ADMIN }),
      {
        can_view_student_data: false,
        can_view_employee_data: false,
        can_view_employee_disciplinary_data: false,
        can_view_sensitive_data: false,
        can_view_employee_pii: true,
        can_view_all_student_units: false,
        can_view_all_employee_units: false,
        student_view_unit_ids: [],
        employee_view_unit_ids: [],
        can_write_student_data: false,
        can_write_employee_data: false,
        can_manage_enrollments: false,
        can_manage_teacher_assignments: false,
      },
    );

    expect(result.can_view_employee_data).toBe(true);
    expect(result.can_view_employee_pii).toBe(true);
  });

  it("allows viewers to retain disciplinary read access with employee view", () => {
    const viewer = admin({
      can_view_employee_data: true,
      can_view_employee_disciplinary_data: true,
    });
    expect(canViewEmployeeDisciplinaryData(viewer)).toBe(true);

    const normalized = normalizeAdminPermissions(viewer, {
      can_view_student_data: false,
      can_view_employee_data: true,
      can_view_employee_disciplinary_data: true,
      can_view_sensitive_data: false,
      can_view_employee_pii: false,
      can_view_all_student_units: false,
      can_view_all_employee_units: false,
      student_view_unit_ids: [],
      employee_view_unit_ids: [],
      can_write_student_data: true,
      can_write_employee_data: true,
      can_manage_enrollments: true,
      can_manage_teacher_assignments: true,
    });
    expect(normalized.can_view_employee_disciplinary_data).toBe(true);
    expect(normalized.can_write_employee_data).toBe(false);
    expect(normalized.can_manage_teacher_assignments).toBe(false);
  });

  it("resolves custom student and employee unit lists independently", () => {
    const scopedAdmin = {
      role: AdminRole.VIEWER,
      unit_id: "own-unit",
      can_view_student_data: true,
      can_view_employee_data: true,
      can_view_all_student_units: false,
      can_view_all_employee_units: false,
      student_view_units: [{ unit_id: "student-unit" }],
      employee_view_units: [{ unit_id: "employee-unit" }],
    };

    expect(resolveStudentUnitScope(scopedAdmin)).toEqual(["student-unit"]);
    expect(resolveEmployeeUnitScope(scopedAdmin)).toEqual(["employee-unit"]);
    expect(resolveAcademicUnitScope(scopedAdmin)).toEqual([
      "student-unit",
      "employee-unit",
    ]);
  });

  it("uses own-unit fallback and unrestricted academic union semantics", () => {
    const scopedAdmin = {
      role: AdminRole.VIEWER,
      unit_id: "own-unit",
      can_view_student_data: true,
      can_view_employee_data: true,
      can_view_all_student_units: false,
      can_view_all_employee_units: true,
      student_view_units: [],
      employee_view_units: [{ unit_id: "ignored-unit" }],
    };

    expect(resolveStudentUnitScope(scopedAdmin)).toEqual(["own-unit"]);
    expect(resolveEmployeeUnitScope(scopedAdmin)).toBeUndefined();
    expect(resolveAcademicUnitScope(scopedAdmin)).toBeUndefined();
  });

  it("ignores an unrestricted disabled domain in the academic union", () => {
    const scopedAdmin = {
      role: AdminRole.VIEWER,
      unit_id: "own-unit",
      can_view_student_data: true,
      can_view_employee_data: false,
      can_view_all_student_units: false,
      can_view_all_employee_units: true,
      student_view_units: [{ unit_id: "student-unit" }],
      employee_view_units: [],
    };

    expect(resolveAcademicUnitScope(scopedAdmin)).toEqual(["student-unit"]);
  });

  it("is unrestricted when either enabled domain is unrestricted", () => {
    const scopedAdmin = {
      role: AdminRole.VIEWER,
      unit_id: "own-unit",
      can_view_student_data: false,
      can_view_employee_data: true,
      can_view_all_student_units: false,
      can_view_all_employee_units: true,
      student_view_units: [{ unit_id: "student-unit" }],
      employee_view_units: [],
    };

    expect(resolveAcademicUnitScope(scopedAdmin)).toBeUndefined();
  });
});

describe("admin write unit scope", () => {
  const scopedAdmin = (overrides: Record<string, unknown> = {}) => ({
    role: AdminRole.DATABASE_ADMIN,
    unit_id: "own-unit",
    can_view_all_student_units: false,
    can_view_all_employee_units: false,
    student_view_units: [],
    employee_view_units: [],
    ...overrides,
  });

  it("resolves own, selected, and all student scopes", () => {
    expect(resolveWriteUnitScope(scopedAdmin(), "student")).toEqual(["own-unit"]);
    expect(
      resolveWriteUnitScope(
        scopedAdmin({ student_view_units: [{ unit_id: "selected-unit" }] }),
        "student",
      ),
    ).toEqual(["selected-unit"]);
    expect(
      resolveWriteUnitScope(
        scopedAdmin({ can_view_all_student_units: true }),
        "student",
      ),
    ).toBeUndefined();
  });

  it("keeps student and employee write scopes independent", () => {
    const value = scopedAdmin({
      can_view_all_employee_units: true,
      student_view_units: [{ unit_id: "student-unit" }],
      employee_view_units: [{ unit_id: "employee-unit" }],
    });

    expect(resolveWriteUnitScope(value, "student")).toEqual(["student-unit"]);
    expect(resolveWriteUnitScope(value, "employee")).toBeUndefined();
    expect(isUnitWritable(value, "outside-unit", "student")).toBe(false);
    expect(isUnitWritable(value, "outside-unit", "employee")).toBe(true);
    expect(isUnitWritable(value, "outside-unit", "academic")).toBe(true);
  });

  it("uses the union for academic writes without widening either domain", () => {
    const value = scopedAdmin({
      student_view_units: [{ unit_id: "student-unit" }],
      employee_view_units: [{ unit_id: "employee-unit" }],
    });

    expect(resolveWriteUnitScope(value, "academic")).toEqual([
      "student-unit",
      "employee-unit",
    ]);
    expect(isUnitWritable(value, "employee-unit", "student")).toBe(false);
    expect(isUnitWritable(value, "employee-unit", "academic")).toBe(true);
  });

  it("assertCanWriteUnit audits and rejects only outside units", async () => {
    let denied = 0;
    const value = scopedAdmin();

    await expect(
      assertCanWriteUnit(value, "own-unit", "student", {
        onDeny: async () => {
          denied += 1;
        },
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertCanWriteUnit(value, "outside-unit", "student", {
        onDeny: async () => {
          denied += 1;
        },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(denied).toBe(1);
  });

  it("assertCanWriteUnits distinguishes any and all semantics", async () => {
    const value = scopedAdmin();

    await expect(
      assertCanWriteUnits(
        value,
        ["own-unit", "outside-unit"],
        "student",
        "any",
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertCanWriteUnits(
        value,
        ["own-unit", "outside-unit"],
        "student",
        "all",
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      assertCanWriteUnits(value, [], "student", "any"),
    ).rejects.toMatchObject({ status: 403 });
  });
});
