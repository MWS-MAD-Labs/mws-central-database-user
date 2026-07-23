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
  can_write_data: boolean;
  can_view_sensitive_data: boolean;
  after_hours_write_until: string | null;
  is_active: boolean;
  type: "admin";
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
  return {
    id: admin.id,
    admin_no: generateAdminId(admin.admin_no),
    email: admin.email,
    full_name: admin.full_name,
    role: admin.role,
    avatar_url: admin.avatar_url,
    unit_id: admin.unit_id,
    can_write_data: admin.can_write_data,
    can_view_sensitive_data: admin.can_view_sensitive_data,
    after_hours_write_until: admin.after_hours_write_until
      ? admin.after_hours_write_until.toISOString()
      : null,
    is_active: admin.is_active,
    type: "admin",
  };
}

export function toEmployeeAuthResponse(
  person: PersonWithEmployee,
): EmployeeAuthResponse {
  return {
    ...toEmployeeDetailResponse(person, { role: AdminRole.SUPER_ADMIN }),
    type: "employee",
  };
}
