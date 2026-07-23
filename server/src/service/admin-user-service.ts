import { ResponseError } from "../error/response-error";
import {
  AdminRole,
  AuditAction,
  AuditSource,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { toAdminResponse, type AdminResponse } from "../model/auth-model";
import type {
  AdminUserSortField,
  GetAdminUserRequest,
  GrantAfterHoursWriteRequest,
  PromoteEmployeeRequest,
  SearchAdminUserRequest,
  SetCanViewSensitiveData,
  SetCanWriteDataRequest,
} from "../model/admin-user-model";
import type { AuditRequestContext } from "../model/audit-log-model";
import { paginate, type Pageable } from "../model/page-model";
import { AuditService } from "./audit-service";
import { CheckExist } from "../utils/check-exist";
import { AdminUserValidation } from "../validation/admin-user-validation";
import { Validation } from "../validation/validation";

export class AdminUserService {
  static async promoteEmployee(
    admin: AdminUser,
    request: PromoteEmployeeRequest,
    context: AuditRequestContext = {},
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

    if (
      promoteRequest.can_write_data &&
      promoteRequest.role !== AdminRole.DATABASE_ADMIN
    ) {
      throw new ResponseError(
        400,
        "can_write_data only applies to Database Admin accounts",
      );
    }

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
      can_write_data: promoteRequest.can_write_data ?? false,
      is_active: true,
    };

    const resultAdmin = existingAdmin
      ? await prismaClient.adminUser.update({
          where: { id: existingAdmin.id },
          data: adminData,
        })
      : await prismaClient.adminUser.create({
          data: { ...adminData, email: employee.person.email },
        });

    await AuditService.record({
      action: AuditAction.ROLE_CHANGE,
      source: AuditSource.UI,
      entity_type: "AdminUser",
      entity_id: resultAdmin.id,
      admin_id: admin.id,
      old_values: existingAdmin
        ? { role: existingAdmin.role, is_active: existingAdmin.is_active }
        : undefined,
      new_values: { role: resultAdmin.role, is_active: resultAdmin.is_active },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toAdminResponse(resultAdmin);
  }

  static async demoteAdmin(
    admin: AdminUser,
    targetAdminId: string,
    context: AuditRequestContext = {},
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

    await AuditService.record({
      action: AuditAction.ROLE_CHANGE,
      source: AuditSource.UI,
      entity_type: "AdminUser",
      entity_id: targetAdmin.id,
      admin_id: admin.id,
      old_values: { role: targetAdmin.role, is_active: targetAdmin.is_active },
      new_values: {
        role: updatedAdmin.role,
        is_active: updatedAdmin.is_active,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toAdminResponse(updatedAdmin);
  }

  static async setCanWriteData(
    admin: AdminUser,
    targetAdminId: string,
    request: SetCanWriteDataRequest,
    context: AuditRequestContext = {},
  ): Promise<AdminResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can change write access",
      );
    }

    const setRequest = Validation.validate(
      AdminUserValidation.SET_CAN_WRITE_DATA,
      request,
    );

    const targetAdmin = await prismaClient.adminUser.findUnique({
      where: { id: targetAdminId },
    });

    if (!targetAdmin) {
      throw new ResponseError(404, "Admin not found");
    }

    if (targetAdmin.role !== AdminRole.DATABASE_ADMIN) {
      throw new ResponseError(
        400,
        "can_write_data only applies to Database Admin accounts",
      );
    }

    if (targetAdmin.can_write_data === setRequest.can_write_data) {
      throw new ResponseError(
        400,
        `can_write_data is already ${setRequest.can_write_data}`,
      );
    }

    const updatedAdmin = await prismaClient.adminUser.update({
      where: { id: targetAdminId },
      data: { can_write_data: setRequest.can_write_data },
    });

    await AuditService.record({
      action: AuditAction.PERMISSION_CHANGE,
      source: AuditSource.UI,
      entity_type: "AdminUser",
      entity_id: targetAdmin.id,
      admin_id: admin.id,
      old_values: { can_write_data: targetAdmin.can_write_data },
      new_values: { can_write_data: updatedAdmin.can_write_data },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toAdminResponse(updatedAdmin);
  }

  static async setCanViewSensitiveData(
    admin: AdminUser,
    targetAdminId: string,
    request: SetCanViewSensitiveData,
    context: AuditRequestContext = {},
  ): Promise<AdminResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can change sensitive data access",
      );
    }

    const setRequest = Validation.validate(
      AdminUserValidation.SET_CAN_VIEW_SENSITIVE_DATA,
      request,
    );

    const targetAdmin = await prismaClient.adminUser.findUnique({
      where: { id: targetAdminId },
    });

    if (!targetAdmin) {
      throw new ResponseError(404, "Admin not found");
    }

    if (
      targetAdmin.can_view_sensitive_data === setRequest.can_view_sensitive_data
    ) {
      throw new ResponseError(
        400,
        `can_view_sensitive_data is already ${setRequest.can_view_sensitive_data}`,
      );
    }

    const updatedAdmin = await prismaClient.adminUser.update({
      where: { id: targetAdminId },
      data: { can_view_sensitive_data: setRequest.can_view_sensitive_data },
    });

    await AuditService.record({
      action: AuditAction.PERMISSION_CHANGE,
      source: AuditSource.UI,
      entity_type: "AdminUser",
      entity_id: targetAdmin.id,
      admin_id: admin.id,
      old_values: {
        can_view_sensitive_data: targetAdmin.can_view_sensitive_data,
      },
      new_values: {
        can_view_sensitive_data: updatedAdmin.can_view_sensitive_data,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toAdminResponse(updatedAdmin);
  }

  static async grantAfterHoursWrite(
    admin: AdminUser,
    targetAdminId: string,
    request: GrantAfterHoursWriteRequest,
    context: AuditRequestContext = {},
  ): Promise<AdminResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can grant an after-hours write exception",
      );
    }

    const grantRequest = Validation.validate(
      AdminUserValidation.GRANT_AFTER_HOURS_WRITE,
      request,
    );

    const targetAdmin = await prismaClient.adminUser.findUnique({
      where: { id: targetAdminId },
    });

    if (!targetAdmin) {
      throw new ResponseError(404, "Admin not found");
    }

    if (targetAdmin.role !== AdminRole.DATABASE_ADMIN) {
      throw new ResponseError(
        400,
        "After-hours write exceptions only apply to Database Admin accounts",
      );
    }

    if (!targetAdmin.can_write_data) {
      throw new ResponseError(
        400,
        "This admin doesn't have can_write_data enabled — grant that first",
      );
    }

    const until = new Date(Date.now() + grantRequest.minutes * 60_000);

    const updatedAdmin = await prismaClient.adminUser.update({
      where: { id: targetAdminId },
      data: { after_hours_write_until: until },
    });

    await AuditService.record({
      action: AuditAction.PERMISSION_CHANGE,
      source: AuditSource.UI,
      entity_type: "AdminUser",
      entity_id: targetAdmin.id,
      admin_id: admin.id,
      old_values: {
        after_hours_write_until: targetAdmin.after_hours_write_until
          ? targetAdmin.after_hours_write_until.toISOString()
          : null,
      },
      new_values: {
        after_hours_write_until: until.toISOString(),
        granted_minutes: grantRequest.minutes,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toAdminResponse(updatedAdmin);
  }

  static async get(
    admin: AdminUser,
    request: GetAdminUserRequest,
  ): Promise<AdminResponse> {
    void admin;

    const targetAdmin = await prismaClient.adminUser.findUnique({
      where: { id: request.id },
    });
    if (!targetAdmin) {
      throw new ResponseError(404, "Admin not found");
    }

    return toAdminResponse(targetAdmin);
  }

  static async search(
    admin: AdminUser,
    request: SearchAdminUserRequest,
  ): Promise<Pageable<AdminResponse>> {
    void admin;

    const searchRequest = Validation.validate(
      AdminUserValidation.SEARCH,
      request,
    );

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const where = {
      OR: searchRequest.search
        ? [
            {
              full_name: {
                contains: searchRequest.search,
                mode: "insensitive" as const,
              },
            },
            {
              email: {
                contains: searchRequest.search,
                mode: "insensitive" as const,
              },
            },
          ]
        : undefined,
      role: searchRequest.role,
      is_active: searchRequest.is_active,
    };

    return paginate(searchRequest.page, searchRequest.size, {
      count: () => prismaClient.adminUser.count({ where }),
      findMany: () =>
        prismaClient.adminUser
          .findMany({
            where,
            take: searchRequest.size,
            skip,
            orderBy: buildAdminUserOrderBy(
              searchRequest.sort_by || "created_at",
              searchRequest.sort_order || "desc",
            ),
          })
          .then((admins) => admins.map(toAdminResponse)),
    });
  }
}

function buildAdminUserOrderBy(
  sortBy: AdminUserSortField,
  sortOrder: "asc" | "desc",
) {
  return { [sortBy]: sortOrder };
}
