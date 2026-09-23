import { AdminRole, type AdminUser } from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";

type AdminPermissionSubject = Pick<
  AdminUser,
  | "role"
  | "can_view_student_data"
  | "can_view_employee_data"
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
