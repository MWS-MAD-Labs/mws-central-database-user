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
  can_write_data?: boolean;
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

export type SetCanWriteDataRequest = {
  can_write_data: boolean;
};

export type GrantAfterHoursWriteRequest = {
  minutes: number;
};

export type SetCanViewSensitiveData = {
  can_view_sensitive_data: boolean;
};
