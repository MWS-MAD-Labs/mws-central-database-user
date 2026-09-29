import { AdminRole, type AdminUser } from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";

type AdminPermissionSubject = Pick<
  AdminUser,
  | "role"
  | "can_view_student_data"
  | "can_view_employee_data"
  | "can_view_employee_disciplinary_data"
  | "can_manage_enrollments"
  | "can_manage_teacher_assignments"
>;

export function canViewStudentData(admin: AdminPermissionSubject): boolean {
  return admin.role === AdminRole.SUPER_ADMIN || admin.can_view_student_data;
}

export function canViewEmployeeData(admin: AdminPermissionSubject): boolean {
  return admin.role === AdminRole.SUPER_ADMIN || admin.can_view_employee_data;
}

export function canViewAcademicData(admin: AdminPermissionSubject): boolean {
  return canViewStudentData(admin) || canViewEmployeeData(admin);
}

export function canViewEmployeeDisciplinaryData(
  admin: AdminPermissionSubject,
): boolean {
  return (
    admin.role === AdminRole.SUPER_ADMIN ||
    (admin.can_view_employee_data &&
      admin.can_view_employee_disciplinary_data)
  );
}

export function assertCanViewStudentData(admin: AdminPermissionSubject): void {
  if (!canViewStudentData(admin)) {
    throw new ResponseError(403, "Forbidden: Student access is required");
  }
}

export function assertCanViewEmployeeData(admin: AdminPermissionSubject): void {
  if (!canViewEmployeeData(admin)) {
    throw new ResponseError(403, "Forbidden: Employee and intern access is required");
  }
}

export function assertCanViewAcademicData(admin: AdminPermissionSubject): void {
  if (!canViewAcademicData(admin)) {
    throw new ResponseError(403, "Forbidden: Student or employee access is required");
  }
}

export function assertCanManageEnrollments(admin: AdminPermissionSubject): void {
  if (admin.role === AdminRole.SUPER_ADMIN) return;
  if (admin.role !== AdminRole.DATABASE_ADMIN || !admin.can_manage_enrollments) {
    throw new ResponseError(403, "Forbidden: Enrollment management permission is required");
  }
}

export function assertCanManageTeacherAssignments(admin: AdminPermissionSubject): void {
  if (admin.role === AdminRole.SUPER_ADMIN) return;
  if (
    admin.role !== AdminRole.DATABASE_ADMIN ||
    !admin.can_manage_teacher_assignments
  ) {
    throw new ResponseError(403, "Forbidden: Teacher assignment permission is required");
  }
}

// student_view_units/employee_view_units aren't on the base Prisma AdminUser
// type - the admin-auth middleware loads them once per request alongside
// every other permission flag (see hono-context.ts's AdminUser).
export type AdminWithStudentViewScope = Pick<
  AdminUser,
  "role" | "unit_id" | "can_view_all_student_units"
> & {
  student_view_units: { unit_id: string }[];
};

export type AdminWithEmployeeViewScope = Pick<
  AdminUser,
  "role" | "unit_id" | "can_view_all_employee_units"
> & {
  employee_view_units: { unit_id: string }[];
};

type AdminWithAcademicViewScope = AdminWithStudentViewScope &
  AdminWithEmployeeViewScope &
  Pick<AdminUser, "can_view_student_data" | "can_view_employee_data">;

// Full-AdminUser counterparts of the two Pick-based types above, for
// service methods that also read other AdminUser fields (person_id,
// can_view_employee_pii, ...) alongside resolving unit scope - avoids
// repeating the `AdminUser & { student_view_units: {...} }` intersection
// inline at every call site.
export type AdminUserWithStudentScope = AdminUser & {
  student_view_units: { unit_id: string }[];
};

export type AdminUserWithEmployeeScope = AdminUser & {
  employee_view_units: { unit_id: string }[];
};

// Carries both relation lists - for service methods that need either the
// student and employee scopes independently, or the union via
// resolveAcademicUnitScope.
export type AdminUserWithAcademicScope = AdminUserWithStudentScope &
  AdminUserWithEmployeeScope;

// Returns the unit ids a DATABASE_ADMIN's student-domain queries should be
// restricted to, or undefined for unrestricted (SUPER_ADMIN or
// can_view_all_student_units). An empty custom list falls back to the
// admin's own unit - same convention as EmployeePcMentorUnit.
export function resolveStudentUnitScope(
  admin: AdminWithStudentViewScope,
): string[] | undefined {
  if (admin.role === AdminRole.SUPER_ADMIN || admin.can_view_all_student_units) {
    return undefined;
  }
  const custom = admin.student_view_units.map((row) => row.unit_id);
  return custom.length > 0 ? custom : [admin.unit_id];
}

// Employee-domain counterpart of resolveStudentUnitScope.
export function resolveEmployeeUnitScope(
  admin: AdminWithEmployeeViewScope,
): string[] | undefined {
  if (admin.role === AdminRole.SUPER_ADMIN || admin.can_view_all_employee_units) {
    return undefined;
  }
  const custom = admin.employee_view_units.map((row) => row.unit_id);
  return custom.length > 0 ? custom : [admin.unit_id];
}

// For structural/reference data that isn't owned by one domain (Grade, the
// Class entity itself, Dashboard summary, export rosters) - a unit is
// visible if it's covered by EITHER the student or the employee scope,
// matching canViewAcademicData's own "student OR employee" gate. Undefined
// means unrestricted (either domain scope was "all units").
export function resolveAcademicUnitScope(
  admin: AdminWithAcademicViewScope,
): string[] | undefined {
  if (admin.role === AdminRole.SUPER_ADMIN) return undefined;

  const enabledScopes = [
    admin.can_view_student_data ? resolveStudentUnitScope(admin) : null,
    admin.can_view_employee_data ? resolveEmployeeUnitScope(admin) : null,
  ].filter((scope): scope is string[] | undefined => scope !== null);

  if (enabledScopes.some((scope) => scope === undefined)) return undefined;
  return [...new Set(enabledScopes.flatMap((scope) => scope ?? []))];
}
