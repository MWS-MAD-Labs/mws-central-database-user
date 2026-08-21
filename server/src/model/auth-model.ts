import { AdminRole, type AdminUser } from "../generated/prisma/client";
import { generateAdminId } from "../utils/generate-id";
import {
  toEmployeeDetailResponse,
  type EmployeeDetailResponse,
  type PersonWithEmployee,
} from "./employee-model";

export type AdminResponse = {
  id: string;
  admin_no: string;
  email: string;
  full_name: string;
  role: AdminRole;
  avatar_url: string | null;
  unit_id: string;
  is_active: boolean;
  type: "admin";
  can_view_sensitive_data?: boolean;
  can_view_all_units?: boolean;
  can_view_employee_pii?: boolean;
  can_write_employee_data?: boolean;
  can_write_student_data?: boolean;
  after_hours_write_until?: string | null;
};

export type EmployeeAuthResponse = EmployeeDetailResponse & {
  type: "employee";
};

export type GoogleLoginResponse = AdminResponse | EmployeeAuthResponse;

export type GoogleLoginRequest = {
  code: string;
};

export type GoogleLogoutRequest = {
  id: string;
};

export type RefreshRequest = {
  refreshToken: string;
};

export function toAdminResponse(admin: AdminUser): AdminResponse {
  const isSuperAdmin = admin.role === AdminRole.SUPER_ADMIN;

  const response: AdminResponse = {
    id: admin.id,
    admin_no: generateAdminId(admin.admin_no),
    email: admin.email,
    full_name: admin.full_name,
    role: admin.role,
    avatar_url: admin.avatar_url,
    unit_id: admin.unit_id,
    is_active: admin.is_active,
    type: "admin",
  };

  if (!isSuperAdmin) {
    response.can_view_sensitive_data = admin.can_view_sensitive_data;
    response.can_view_all_units = admin.can_view_all_units;
    response.can_view_employee_pii = admin.can_view_employee_pii;
    response.can_write_employee_data = admin.can_write_employee_data;
    response.can_write_student_data = admin.can_write_student_data;
    response.after_hours_write_until = admin.after_hours_write_until
      ? admin.after_hours_write_until.toISOString()
      : null;
  } else if (admin.role === AdminRole.VIEWER) {
    response.can_view_sensitive_data = admin.can_view_sensitive_data;
    response.can_view_all_units = admin.can_view_all_units;
    response.can_view_employee_pii = admin.can_view_employee_pii;
    response.can_write_employee_data = admin.can_write_employee_data;
    response.can_write_student_data = admin.can_write_student_data;
  }

  return response;
}
export function toEmployeeAuthResponse(
  person: PersonWithEmployee,
): EmployeeAuthResponse {
  return {
    ...toEmployeeDetailResponse(person, { role: AdminRole.SUPER_ADMIN }),
    type: "employee",
  };
}
