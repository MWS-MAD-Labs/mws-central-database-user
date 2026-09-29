import { AdminRole, type AdminUser } from "../generated/prisma/client";
import { generateAdminId } from "../utils/generate-id";
import { isProtectedSuperAdminEmail } from "../utils/protected-admin";
import { isChangeRequestApprover } from "../utils/change-request-approver";
import { resolvePersonPhotoUrl } from "../lib/minio";
import { prismaClient } from "../lib/prisma";
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
  last_login: string | null;
  created_at: string;
  type: "admin";
  // Stable link to the Person this admin was promoted from.
  person_id: string | null;
  // Derived from the protected Super Admin configuration.
  is_protected: boolean;
  // Can approve/reject IdentifierChangeRequest and edit a locked
  // identifier field directly, bypassing the request/approval flow.
  is_identifier_change_approver: boolean;
  can_view_sensitive_data?: boolean;
  can_view_all_student_units?: boolean;
  can_view_all_employee_units?: boolean;
  student_view_unit_ids?: string[];
  employee_view_unit_ids?: string[];
  can_view_employee_pii?: boolean;
  can_write_employee_data?: boolean;
  can_write_student_data?: boolean;
  can_view_student_data?: boolean;
  can_view_employee_data?: boolean;
  can_view_employee_disciplinary_data?: boolean;
  can_manage_enrollments?: boolean;
  can_manage_teacher_assignments?: boolean;
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

export async function toAdminResponse(
  admin: AdminUser & {
    student_view_units?: { unit_id: string }[];
    employee_view_units?: { unit_id: string }[];
  },
): Promise<AdminResponse> {
  const isSuperAdmin = admin.role === AdminRole.SUPER_ADMIN;

  // Most callers fetch a single admin without including these relations -
  // self-fetch here rather than pushing an include onto every call site.
  // search()'s findMany includes them directly, skipping this query.
  const [studentViewUnits, employeeViewUnits] = await Promise.all([
    admin.student_view_units ??
      prismaClient.adminUserStudentViewUnit.findMany({
        where: { admin_id: admin.id },
        select: { unit_id: true },
      }),
    admin.employee_view_units ??
      prismaClient.adminUserEmployeeViewUnit.findMany({
        where: { admin_id: admin.id },
        select: { unit_id: true },
      }),
  ]);

  const response: AdminResponse = {
    id: admin.id,
    admin_no: generateAdminId(admin.admin_no),
    email: admin.email,
    full_name: admin.full_name,
    role: admin.role,
    // MinIO-cached copy when one exists (see cacheGoogleAvatar) - falls
    // back to the raw Google URL for admins who haven't logged in since
    // this was added.
    avatar_url: await resolvePersonPhotoUrl(
      admin.avatar_object_key,
      admin.avatar_url,
    ),
    unit_id: admin.unit_id,
    is_active: admin.is_active,
    last_login: admin.last_login ? admin.last_login.toISOString() : null,
    created_at: admin.created_at.toISOString(),
    type: "admin",
    is_protected: isProtectedSuperAdminEmail(admin.email),
    is_identifier_change_approver: isChangeRequestApprover(admin),
    person_id: admin.person_id,
  };

  if (!isSuperAdmin) {
    response.can_view_sensitive_data = admin.can_view_sensitive_data;
    response.can_view_all_student_units = admin.can_view_all_student_units;
    response.can_view_all_employee_units = admin.can_view_all_employee_units;
    response.student_view_unit_ids = studentViewUnits.map((row) => row.unit_id);
    response.employee_view_unit_ids = employeeViewUnits.map((row) => row.unit_id);
    response.can_view_employee_pii = admin.can_view_employee_pii;
    response.can_write_employee_data = admin.can_write_employee_data;
    response.can_write_student_data = admin.can_write_student_data;
    response.can_view_student_data = admin.can_view_student_data;
    response.can_view_employee_data = admin.can_view_employee_data;
    response.can_view_employee_disciplinary_data =
      admin.can_view_employee_disciplinary_data;
    response.can_manage_enrollments = admin.can_manage_enrollments;
    response.can_manage_teacher_assignments = admin.can_manage_teacher_assignments;
    response.after_hours_write_until = admin.after_hours_write_until
      ? admin.after_hours_write_until.toISOString()
      : null;
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
