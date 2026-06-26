import type { AdminRole, AdminUser } from "../generated/prisma/client";
import { generateAdminId } from "../utils/generate-id";

export type AdminResponse = {
  id: string;
  admin_no: string;
  email: string;
  full_name: string;
  role: AdminRole;
  avatar_url: string | null;
  unit_scope: string | null;
};

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
    unit_scope: admin.unit_scope,
  };
}
