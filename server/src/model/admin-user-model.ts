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

export type SetCanViewAllUnitsRequest = {
  can_view_all_units: boolean;
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

// Direct role toggle for an already-active admin, decoupled from
// promoteEmployee (which requires an employee_id + matching Person email).
// Only DATABASE_ADMIN <-> VIEWER - Super Admin is never a valid target here.
export type ChangeAdminRoleRequest = {
  role: Extract<AdminRole, "DATABASE_ADMIN" | "VIEWER">;
};
