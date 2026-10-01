import type { AdminRole } from "../generated/prisma/client";

export const ADMIN_USER_SORT_FIELDS = [
  "full_name",
  "email",
  "role",
  "created_at",
] as const;
export type AdminUserSortField = (typeof ADMIN_USER_SORT_FIELDS)[number];

export type PromoteEmployeeRequest = {
  employee_id: string;
  role: AdminRole;
};

export type GetAdminUserRequest = {
  id: string;
};

export type SearchAdminUserRequest = {
  page: number;
  size: number;
  search?: string;
  role?: AdminRole;
  is_active?: boolean;
  sort_by?: AdminUserSortField;
  sort_order?: "asc" | "desc";
};

export type GrantAfterHoursWriteRequest = {
  minutes: number;
};

export type SetCanViewSensitiveData = {
  can_view_sensitive_data: boolean;
};

export type SetCanViewAllStudentUnitsRequest = {
  can_view_all_student_units: boolean;
};

export type SetCanViewAllEmployeeUnitsRequest = {
  can_view_all_employee_units: boolean;
};

export type SetCanApproveIdentifierChangesRequest = {
  can_approve_identifier_changes: boolean;
};

export type SetCanViewEmployeePiiRequest = {
  can_view_employee_pii: boolean;
};

export type SetCanWriteEmployeeDataRequest = {
  can_write_employee_data: boolean;
};

export type SetCanWriteStudentDataRequest = {
  can_write_student_data: boolean;
};

export type SetCanViewStudentDataRequest = {
  can_view_student_data: boolean;
};

export type SetCanViewEmployeeDataRequest = {
  can_view_employee_data: boolean;
};

export type SetCanViewEmployeeDisciplinaryDataRequest = {
  can_view_employee_disciplinary_data: boolean;
};

export type SetCanManageEnrollmentsRequest = {
  can_manage_enrollments: boolean;
};

export type SetCanManageTeacherAssignmentsRequest = {
  can_manage_teacher_assignments: boolean;
};

export type UpdateAdminPermissionsRequest = {
  can_view_student_data: boolean;
  can_view_employee_data: boolean;
  can_view_employee_disciplinary_data: boolean;
  can_view_sensitive_data: boolean;
  can_view_employee_pii: boolean;
  can_view_all_student_units: boolean;
  can_view_all_employee_units: boolean;
  student_view_unit_ids: string[];
  employee_view_unit_ids: string[];
  can_write_student_data: boolean;
  can_write_employee_data: boolean;
  can_manage_enrollments: boolean;
  can_manage_teacher_assignments: boolean;
};

// Active admins may switch only between Database Admin and Viewer here.
export type ChangeAdminRoleRequest = {
  role: Extract<AdminRole, "DATABASE_ADMIN" | "VIEWER">;
};

// Super Admin demotion has separate protection and audit handling.
export type DemoteSuperAdminRequest = {
  role: Extract<AdminRole, "DATABASE_ADMIN" | "VIEWER">;
};
