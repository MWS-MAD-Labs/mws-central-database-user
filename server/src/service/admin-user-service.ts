import { ResponseError } from "../error/response-error";
import { AdminRole, type AdminUser } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { toAdminResponse, type AdminResponse } from "../model/auth-model";
import type { PromoteEmployeeRequest } from "../model/admin-user-model";
import { CheckExist } from "../utils/check-exist";
import { AdminUserValidation } from "../validation/admin-user-validation";
import { Validation } from "../validation/validation";

export class AdminUserService {
  static async promoteEmployee(
    admin: AdminUser,
    request: PromoteEmployeeRequest,
  ): Promise<AdminResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can grant admin panel access",
      );
    }

    const promoteRequest = Validation.validate(
      AdminUserValidation.PROMOTE,
      request,
    );

    const employee = await CheckExist.checkEmployeeExists(
      promoteRequest.employee_id,
    );

    const existingAdmin = await prismaClient.adminUser.findUnique({
      where: { email: employee.person.email },
    });

    if (existingAdmin?.is_active) {
      throw new ResponseError(
        400,
        "This employee already has an active admin account",
      );
    }

    const adminData = {
      full_name: employee.person.full_name,
      unit_id: employee.unit_id,
      role: promoteRequest.role,
      can_create_data: promoteRequest.can_create_data ?? false,
      is_active: true,
    };

    // A deactivated AdminUser row from a previous demote is reactivated
    // in place instead of being duplicated — keeps admin_no and audit_logs
    // attribution intact.
    const resultAdmin = existingAdmin
      ? await prismaClient.adminUser.update({
          where: { id: existingAdmin.id },
          data: adminData,
        })
      : await prismaClient.adminUser.create({
          data: { ...adminData, email: employee.person.email },
        });

    return toAdminResponse(resultAdmin);
  }

  static async demoteAdmin(
    admin: AdminUser,
    targetAdminId: string,
  ): Promise<AdminResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can revoke admin panel access",
      );
    }

    if (admin.id === targetAdminId) {
      throw new ResponseError(400, "You cannot demote your own admin account");
    }

    const targetAdmin = await prismaClient.adminUser.findUnique({
      where: { id: targetAdminId },
    });

    if (!targetAdmin) {
      throw new ResponseError(404, "Admin not found");
    }

    if (!targetAdmin.is_active) {
      throw new ResponseError(400, "Admin is already deactivated");
    }

    const updatedAdmin = await prismaClient.adminUser.update({
      where: { id: targetAdminId },
      data: {
        is_active: false,
        refresh_token_hash: null,
        refresh_token_exp: null,
      },
    });

    return toAdminResponse(updatedAdmin);
  }
}
