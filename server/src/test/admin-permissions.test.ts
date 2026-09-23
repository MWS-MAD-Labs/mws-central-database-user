import { describe, expect, it } from "bun:test";
import { AdminRole, type AdminUser } from "../generated/prisma/client";
import {
  assertCanManageEnrollments,
  assertCanManageTeacherAssignments,
  canViewAcademicData,
  canViewEmployeeData,
  canViewStudentData,
} from "../utils/admin-permissions";
import { normalizeAdminPermissions } from "../service/admin-user-service";

function admin(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    role: AdminRole.VIEWER,
    can_view_student_data: false,
    can_view_employee_data: false,
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
        can_view_sensitive_data: true,
        can_view_employee_pii: true,
        can_view_all_units: false,
        can_write_student_data: true,
        can_write_employee_data: true,
        can_manage_enrollments: true,
        can_manage_teacher_assignments: true,
      },
    );

    expect(result.can_view_employee_data).toBe(false);
    expect(result.can_view_employee_pii).toBe(false);
    expect(result.can_write_employee_data).toBe(false);
    expect(result.can_manage_teacher_assignments).toBe(false);
    expect(result.can_view_student_data).toBe(true);
  });

  it("revokes student dependencies when student view is unchecked", () => {
    const result = normalizeAdminPermissions(
      admin({
        role: AdminRole.DATABASE_ADMIN,
        can_view_student_data: true,
        can_view_employee_data: true,
      }),
      {
        can_view_student_data: false,
        can_view_employee_data: true,
        can_view_sensitive_data: true,
        can_view_employee_pii: true,
        can_view_all_units: false,
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
    expect(result.can_view_employee_data).toBe(true);
  });

  it("enables parent view when a dependency is newly granted", () => {
    const result = normalizeAdminPermissions(
      admin({ role: AdminRole.DATABASE_ADMIN }),
      {
        can_view_student_data: false,
        can_view_employee_data: false,
        can_view_sensitive_data: false,
        can_view_employee_pii: true,
        can_view_all_units: false,
        can_write_student_data: false,
        can_write_employee_data: false,
        can_manage_enrollments: false,
        can_manage_teacher_assignments: false,
      },
    );

    expect(result.can_view_employee_data).toBe(true);
    expect(result.can_view_employee_pii).toBe(true);
  });
});
