import { ResponseError } from "../error/response-error";
import {
  AdminRole,
  AuditAction,
  AuditSource,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { toAdminResponse, type AdminResponse } from "../model/auth-model";
import { headOfCarePersonIds, isHeadOfCare } from "../utils/change-request-approver";
import type {
  AdminUserSortField,
  ChangeAdminRoleRequest,
  DemoteSuperAdminRequest,
  GetAdminUserRequest,
  GrantAfterHoursWriteRequest,
  PromoteEmployeeRequest,
  SearchAdminUserRequest,
  SetCanViewAllStudentUnitsRequest,
  SetCanViewAllEmployeeUnitsRequest,
  SetCanApproveIdentifierChangesRequest,
  SetCanViewEmployeePiiRequest,
  SetCanViewEmployeeDisciplinaryDataRequest,
  SetCanViewSensitiveData,
  SetCanWriteEmployeeDataRequest,
  SetCanWriteStudentDataRequest,
  UpdateAdminPermissionsRequest,
} from "../model/admin-user-model";
import type { AuditRequestContext } from "../model/audit-log-model";
import { paginate, type Pageable } from "../model/page-model";
import { AuditService } from "./audit-service";
import { CheckExist } from "../utils/check-exist";
import {
  assertNotLastActiveSuperAdmin,
  assertNotProtectedAdmin,
  isProtectedSuperAdminEmail,
} from "../utils/protected-admin";
import { AdminUserValidation } from "../validation/admin-user-validation";
import { Validation } from "../validation/validation";
import {
  assertAcademicUnitIds,
  assertOperationalUnitIds,
} from "../utils/academic-units";

async function recordUnauthorizedAdminUserAction(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
  targetAdminId?: string,
): Promise<void> {
  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    entity_type: "AdminUser",
    entity_id: targetAdminId,
    new_values: {
      reason: `blocked admin user ${action}`,
      ...(targetAdminId ? { target_admin_id: targetAdminId } : {}),
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

export function normalizeAdminPermissions(
  targetAdmin: Pick<
    AdminUser,
    | "role"
    | "can_view_student_data"
    | "can_view_employee_data"
    | "can_view_employee_disciplinary_data"
  >,
  validated: UpdateAdminPermissionsRequest,
): UpdateAdminPermissionsRequest {
  const isViewer = targetAdmin.role === AdminRole.VIEWER;
  const revokeStudentDomain =
    targetAdmin.can_view_student_data && !validated.can_view_student_data;
  const revokeEmployeeDomain =
    targetAdmin.can_view_employee_data && !validated.can_view_employee_data;
  const data = {
    ...validated,
    can_view_student_data:
      !revokeStudentDomain &&
      (validated.can_view_student_data ||
        validated.can_view_sensitive_data ||
        validated.can_write_student_data ||
        validated.can_manage_enrollments),
    can_view_employee_data:
      !revokeEmployeeDomain &&
      (validated.can_view_employee_data ||
         validated.can_view_employee_pii ||
        validated.can_view_employee_disciplinary_data ||
         validated.can_write_employee_data ||
        validated.can_manage_teacher_assignments),
    can_write_student_data: isViewer ? false : validated.can_write_student_data,
    can_write_employee_data: isViewer ? false : validated.can_write_employee_data,
    can_manage_enrollments: isViewer ? false : validated.can_manage_enrollments,
    can_manage_teacher_assignments: isViewer
      ? false
      : validated.can_manage_teacher_assignments,
  };

  if (revokeStudentDomain || !data.can_view_student_data) {
    data.can_view_sensitive_data = false;
    data.can_write_student_data = false;
    data.can_manage_enrollments = false;
    data.can_view_all_student_units = false;
    data.student_view_unit_ids = [];
  }
  if (revokeEmployeeDomain || !data.can_view_employee_data) {
    data.can_view_employee_pii = false;
    data.can_view_employee_disciplinary_data = false;
    data.can_write_employee_data = false;
    data.can_manage_teacher_assignments = false;
    data.can_view_all_employee_units = false;
    data.employee_view_unit_ids = [];
  }
  // Widening to all units and picking specific units are mutually
  // exclusive - the custom list only means something once all-units is off.
  if (data.can_view_all_student_units) data.student_view_unit_ids = [];
  if (data.can_view_all_employee_units) data.employee_view_unit_ids = [];
  return data;
}

export class AdminUserService {
  static async setCanViewEmployeeDisciplinaryData(
    admin: AdminUser,
    targetAdminId: string,
    request: SetCanViewEmployeeDisciplinaryDataRequest,
    context: AuditRequestContext = {},
  ): Promise<AdminResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedAdminUserAction(
        admin,
        "set can_view_employee_disciplinary_data",
        context,
        targetAdminId,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can change employee disciplinary access",
      );
    }

    const setRequest = Validation.validate(
      AdminUserValidation.SET_CAN_VIEW_EMPLOYEE_DISCIPLINARY_DATA,
      request,
    );
    const targetAdmin = await prismaClient.adminUser.findUnique({
      where: { id: targetAdminId },
    });
    if (!targetAdmin) throw new ResponseError(404, "Admin not found");
    await assertNotProtectedAdmin(
      admin,
      targetAdmin,
      "set can_view_employee_disciplinary_data",
      context,
    );
    if (
      targetAdmin.can_view_employee_disciplinary_data ===
      setRequest.can_view_employee_disciplinary_data
    ) {
      throw new ResponseError(
        400,
        `can_view_employee_disciplinary_data is already ${setRequest.can_view_employee_disciplinary_data}`,
      );
    }

    const updatedAdmin = await prismaClient.$transaction(async (tx) => {
      const savedAdmin = await tx.adminUser.update({
        where: { id: targetAdminId },
        data: {
          can_view_employee_disciplinary_data:
            setRequest.can_view_employee_disciplinary_data,
          ...(setRequest.can_view_employee_disciplinary_data
            ? { can_view_employee_data: true }
            : {}),
        },
      });
      await AuditService.record(
        {
          action: AuditAction.PERMISSION_CHANGE,
          source: AuditSource.UI,
          entity_type: "AdminUser",
          entity_id: targetAdmin.id,
          admin_id: admin.id,
          old_values: {
            email: targetAdmin.email,
            can_view_employee_disciplinary_data:
              targetAdmin.can_view_employee_disciplinary_data,
          },
          new_values: {
            email: savedAdmin.email,
            can_view_employee_disciplinary_data:
              savedAdmin.can_view_employee_disciplinary_data,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return savedAdmin;
    });
    return await toAdminResponse(updatedAdmin);
  }

  static async updatePermissions(
    admin: AdminUser,
    targetAdminId: string,
    request: UpdateAdminPermissionsRequest,
    context: AuditRequestContext = {},
  ): Promise<AdminResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedAdminUserAction(
        admin,
        "update permissions",
        context,
        targetAdminId,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can change admin permissions",
      );
    }

    const targetAdmin = await prismaClient.adminUser.findUnique({
      where: { id: targetAdminId },
    });
    if (!targetAdmin) throw new ResponseError(404, "Admin not found");
    await assertNotProtectedAdmin(admin, targetAdmin, "update permissions", context);
    if (targetAdmin.role === AdminRole.SUPER_ADMIN) {
      throw new ResponseError(400, "Super Admin permissions cannot be customized");
    }

    const validated = Validation.validate(
      AdminUserValidation.UPDATE_PERMISSIONS,
      request,
    );
    const { student_view_unit_ids, employee_view_unit_ids, ...data } =
      normalizeAdminPermissions(targetAdmin, validated);

    const [oldStudentViewUnits, oldEmployeeViewUnits] = await Promise.all([
      prismaClient.adminUserStudentViewUnit.findMany({
        where: { admin_id: targetAdminId },
        select: { unit_id: true },
      }),
      prismaClient.adminUserEmployeeViewUnit.findMany({
        where: { admin_id: targetAdminId },
        select: { unit_id: true },
      }),
    ]);

    const updatedAdmin = await prismaClient.$transaction(async (tx) => {
      await assertAcademicUnitIds(
        tx,
        student_view_unit_ids,
        "student_view_unit_ids must contain existing academic units",
      );
      await assertOperationalUnitIds(
        tx,
        employee_view_unit_ids,
        "employee_view_unit_ids must contain existing operational units",
      );
      const savedAdmin = await tx.adminUser.update({
        where: { id: targetAdminId },
        data,
      });
      await tx.adminUserStudentViewUnit.deleteMany({ where: { admin_id: targetAdminId } });
      if (student_view_unit_ids.length > 0) {
        await tx.adminUserStudentViewUnit.createMany({
          data: student_view_unit_ids.map((unitId) => ({ admin_id: targetAdminId, unit_id: unitId })),
        });
      }
      await tx.adminUserEmployeeViewUnit.deleteMany({ where: { admin_id: targetAdminId } });
      if (employee_view_unit_ids.length > 0) {
        await tx.adminUserEmployeeViewUnit.createMany({
          data: employee_view_unit_ids.map((unitId) => ({ admin_id: targetAdminId, unit_id: unitId })),
        });
      }
      await AuditService.record(
        {
          action: AuditAction.PERMISSION_CHANGE,
          source: AuditSource.UI,
          entity_type: "AdminUser",
          entity_id: targetAdmin.id,
          admin_id: admin.id,
          old_values: {
            email: targetAdmin.email,
            can_view_student_data: targetAdmin.can_view_student_data,
            can_view_employee_data: targetAdmin.can_view_employee_data,
            can_view_employee_disciplinary_data:
              targetAdmin.can_view_employee_disciplinary_data,
            can_view_sensitive_data: targetAdmin.can_view_sensitive_data,
            can_view_employee_pii: targetAdmin.can_view_employee_pii,
            can_view_all_student_units: targetAdmin.can_view_all_student_units,
            can_view_all_employee_units: targetAdmin.can_view_all_employee_units,
            student_view_unit_ids: oldStudentViewUnits.map((row) => row.unit_id),
            employee_view_unit_ids: oldEmployeeViewUnits.map((row) => row.unit_id),
            can_write_student_data: targetAdmin.can_write_student_data,
            can_write_employee_data: targetAdmin.can_write_employee_data,
            can_manage_enrollments: targetAdmin.can_manage_enrollments,
            can_manage_teacher_assignments:
              targetAdmin.can_manage_teacher_assignments,
          },
          new_values: {
            email: savedAdmin.email,
            ...data,
            student_view_unit_ids,
            employee_view_unit_ids,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return savedAdmin;
    });

    return await toAdminResponse(updatedAdmin);
  }

  static async promoteEmployee(
    admin: AdminUser,
    request: PromoteEmployeeRequest,
    context: AuditRequestContext = {},
  ): Promise<AdminResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedAdminUserAction(admin, "promote", context);
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

    // Protected emails may only hold the Super Admin role.
    if (existingAdmin) {
      await assertNotProtectedAdmin(admin, existingAdmin, "promote", context);
    } else if (
      isProtectedSuperAdminEmail(employee.person.email) &&
      promoteRequest.role !== AdminRole.SUPER_ADMIN
    ) {
      await recordUnauthorizedAdminUserAction(admin, "promote", context);
      throw new ResponseError(
        403,
        "This email is reserved for a protected Super Admin account and can only be granted the Super Admin role",
      );
    }

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
      is_active: true,
      // Refresh the stable Person link on promotion.
      person_id: employee.person_id,
    };

    const resultAdmin = await prismaClient.$transaction(async (tx) => {
      const savedAdmin = existingAdmin
        ? await tx.adminUser.update({
            where: { id: existingAdmin.id },
            data: adminData,
          })
        : await tx.adminUser.create({
            data: { ...adminData, email: employee.person.email },
          });

      await AuditService.record(
        {
          action: AuditAction.ROLE_CHANGE,
          source: AuditSource.UI,
          entity_type: "AdminUser",
          entity_id: savedAdmin.id,
          admin_id: admin.id,
          old_values: existingAdmin
            ? {
                email: existingAdmin.email,
                role: existingAdmin.role,
                is_active: existingAdmin.is_active,
              }
            : undefined,
          new_values: {
            email: savedAdmin.email,
            role: savedAdmin.role,
            is_active: savedAdmin.is_active,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return savedAdmin;
    });

    return await toAdminResponse(resultAdmin);
  }

  static async demoteAdmin(
    admin: AdminUser,
    targetAdminId: string,
    context: AuditRequestContext = {},
  ): Promise<AdminResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedAdminUserAction(
        admin,
        "demote",
        context,
        targetAdminId,
      );
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

    await assertNotProtectedAdmin(admin, targetAdmin, "demote", context);
    await assertNotLastActiveSuperAdmin(targetAdmin);

    const updatedAdmin = await prismaClient.$transaction(async (tx) => {
      const savedAdmin = await tx.adminUser.update({
        where: { id: targetAdminId },
        data: {
          is_active: false,
          refresh_token_hash: null,
          refresh_token_exp: null,
        },
      });

      await AuditService.record(
        {
          action: AuditAction.ROLE_CHANGE,
          source: AuditSource.UI,
          entity_type: "AdminUser",
          entity_id: targetAdmin.id,
          admin_id: admin.id,
          old_values: {
            email: targetAdmin.email,
            role: targetAdmin.role,
            is_active: targetAdmin.is_active,
          },
          new_values: {
            email: savedAdmin.email,
            role: savedAdmin.role,
            is_active: savedAdmin.is_active,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return savedAdmin;
    });

    return await toAdminResponse(updatedAdmin);
  }

  // Viewer demotion clears both domain write permissions.
  static async changeRole(
    admin: AdminUser,
    targetAdminId: string,
    request: ChangeAdminRoleRequest,
    context: AuditRequestContext = {},
  ): Promise<AdminResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedAdminUserAction(
        admin,
        "change role",
        context,
        targetAdminId,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can change an admin's role",
      );
    }

    const changeRequest = Validation.validate(
      AdminUserValidation.CHANGE_ROLE,
      request,
    );

    const targetAdmin = await prismaClient.adminUser.findUnique({
      where: { id: targetAdminId },
    });

    if (!targetAdmin) {
      throw new ResponseError(404, "Admin not found");
    }

    await assertNotProtectedAdmin(admin, targetAdmin, "change role", context);

    if (!targetAdmin.is_active) {
      throw new ResponseError(
        400,
        "Admin is deactivated - reactivate before changing role",
      );
    }

    if (targetAdmin.role === AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        400,
        "Cannot change a Super Admin's role here - use demote-super-admin instead",
      );
    }

    if (targetAdmin.role === changeRequest.role) {
      throw new ResponseError(
        400,
        `Admin already has the ${changeRequest.role} role`,
      );
    }

    const demotingToViewer = changeRequest.role === AdminRole.VIEWER;

    const updatedAdmin = await prismaClient.$transaction(async (tx) => {
      const savedAdmin = await tx.adminUser.update({
        where: { id: targetAdminId },
        data: {
          role: changeRequest.role,
          ...(demotingToViewer
            ? {
                can_write_employee_data: false,
                can_write_student_data: false,
                can_manage_enrollments: false,
                can_manage_teacher_assignments: false,
                after_hours_write_until: null,
              }
            : {}),
        },
      });

      await AuditService.record(
        {
          action: AuditAction.ROLE_CHANGE,
          source: AuditSource.UI,
          entity_type: "AdminUser",
          entity_id: targetAdmin.id,
          admin_id: admin.id,
          old_values: {
            email: targetAdmin.email,
            role: targetAdmin.role,
            can_write_employee_data: targetAdmin.can_write_employee_data,
            can_write_student_data: targetAdmin.can_write_student_data,
            can_manage_enrollments: targetAdmin.can_manage_enrollments,
            can_manage_teacher_assignments:
              targetAdmin.can_manage_teacher_assignments,
            after_hours_write_until: targetAdmin.after_hours_write_until
              ? targetAdmin.after_hours_write_until.toISOString()
              : null,
          },
          new_values: {
            email: savedAdmin.email,
            role: savedAdmin.role,
            can_write_employee_data: savedAdmin.can_write_employee_data,
            can_write_student_data: savedAdmin.can_write_student_data,
            can_manage_enrollments: savedAdmin.can_manage_enrollments,
            can_manage_teacher_assignments:
              savedAdmin.can_manage_teacher_assignments,
            after_hours_write_until: savedAdmin.after_hours_write_until
              ? savedAdmin.after_hours_write_until.toISOString()
              : null,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return savedAdmin;
    });

    return await toAdminResponse(updatedAdmin);
  }

  // Super Admin demotion has separate lockout checks and audit handling.
  static async demoteSuperAdmin(
    admin: AdminUser,
    targetAdminId: string,
    request: DemoteSuperAdminRequest,
    context: AuditRequestContext = {},
  ): Promise<AdminResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedAdminUserAction(
        admin,
        "demote super admin",
        context,
        targetAdminId,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can demote another Super Admin",
      );
    }

    if (admin.id === targetAdminId) {
      throw new ResponseError(
        400,
        "You cannot demote your own Super Admin account",
      );
    }

    const demoteRequest = Validation.validate(
      AdminUserValidation.DEMOTE_SUPER_ADMIN,
      request,
    );

    const targetAdmin = await prismaClient.adminUser.findUnique({
      where: { id: targetAdminId },
    });

    if (!targetAdmin) {
      throw new ResponseError(404, "Admin not found");
    }

    if (targetAdmin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(400, "Admin is not a Super Admin");
    }

    if (!targetAdmin.is_active) {
      throw new ResponseError(
        400,
        "Admin is deactivated - reactivate before changing role",
      );
    }

    await assertNotProtectedAdmin(
      admin,
      targetAdmin,
      "demote super admin",
      context,
    );
    await assertNotLastActiveSuperAdmin(targetAdmin);

    const updatedAdmin = await prismaClient.$transaction(async (tx) => {
      const savedAdmin = await tx.adminUser.update({
        where: { id: targetAdminId },
        data: {
          role: demoteRequest.role,
          ...(demoteRequest.role === AdminRole.VIEWER
            ? {
                can_write_employee_data: false,
                can_write_student_data: false,
                can_manage_enrollments: false,
                can_manage_teacher_assignments: false,
                after_hours_write_until: null,
              }
            : {}),
        },
      });

      await AuditService.record(
        {
          action: AuditAction.ROLE_CHANGE,
          source: AuditSource.UI,
          entity_type: "AdminUser",
          entity_id: targetAdmin.id,
          admin_id: admin.id,
          old_values: {
            email: targetAdmin.email,
            role: targetAdmin.role,
            can_write_employee_data: targetAdmin.can_write_employee_data,
            can_write_student_data: targetAdmin.can_write_student_data,
          },
          new_values: {
            email: savedAdmin.email,
            role: savedAdmin.role,
            can_write_employee_data: savedAdmin.can_write_employee_data,
            can_write_student_data: savedAdmin.can_write_student_data,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return savedAdmin;
    });

    return await toAdminResponse(updatedAdmin);
  }

  static async setCanViewSensitiveData(
    admin: AdminUser,
    targetAdminId: string,
    request: SetCanViewSensitiveData,
    context: AuditRequestContext = {},
  ): Promise<AdminResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedAdminUserAction(
        admin,
        "set can_view_sensitive_data",
        context,
        targetAdminId,
      );
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

    await assertNotProtectedAdmin(
      admin,
      targetAdmin,
      "set can_view_sensitive_data",
      context,
    );

    if (
      targetAdmin.can_view_sensitive_data === setRequest.can_view_sensitive_data
    ) {
      throw new ResponseError(
        400,
        `can_view_sensitive_data is already ${setRequest.can_view_sensitive_data}`,
      );
    }

    const updatedAdmin = await prismaClient.$transaction(async (tx) => {
      const savedAdmin = await tx.adminUser.update({
        where: { id: targetAdminId },
        data: {
          can_view_sensitive_data: setRequest.can_view_sensitive_data,
          ...(setRequest.can_view_sensitive_data
            ? { can_view_student_data: true }
            : {}),
        },
      });

      await AuditService.record(
        {
          action: AuditAction.PERMISSION_CHANGE,
          source: AuditSource.UI,
          entity_type: "AdminUser",
          entity_id: targetAdmin.id,
          admin_id: admin.id,
          old_values: {
            email: targetAdmin.email,
            can_view_sensitive_data: targetAdmin.can_view_sensitive_data,
          },
          new_values: {
            email: savedAdmin.email,
            can_view_sensitive_data: savedAdmin.can_view_sensitive_data,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return savedAdmin;
    });

    return await toAdminResponse(updatedAdmin);
  }

  // Cross-unit visibility applies to reads only.
  static async setCanViewAllStudentUnits(
    admin: AdminUser,
    targetAdminId: string,
    request: SetCanViewAllStudentUnitsRequest,
    context: AuditRequestContext = {},
  ): Promise<AdminResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedAdminUserAction(
        admin,
        "set can_view_all_student_units",
        context,
        targetAdminId,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can change cross-unit visibility",
      );
    }

    const setRequest = Validation.validate(
      AdminUserValidation.SET_CAN_VIEW_ALL_STUDENT_UNITS,
      request,
    );

    const targetAdmin = await prismaClient.adminUser.findUnique({
      where: { id: targetAdminId },
    });

    if (!targetAdmin) {
      throw new ResponseError(404, "Admin not found");
    }

    await assertNotProtectedAdmin(
      admin,
      targetAdmin,
      "set can_view_all_student_units",
      context,
    );

    if (targetAdmin.can_view_all_student_units === setRequest.can_view_all_student_units) {
      throw new ResponseError(
        400,
        `can_view_all_student_units is already ${setRequest.can_view_all_student_units}`,
      );
    }

    const updatedAdmin = await prismaClient.$transaction(async (tx) => {
      const oldStudentViewUnits = await tx.adminUserStudentViewUnit.findMany({
        where: { admin_id: targetAdminId },
        select: { unit_id: true },
      });
      const savedAdmin = await tx.adminUser.update({
        where: { id: targetAdminId },
        data: { can_view_all_student_units: setRequest.can_view_all_student_units },
      });

      if (setRequest.can_view_all_student_units) {
        await tx.adminUserStudentViewUnit.deleteMany({
          where: { admin_id: targetAdminId },
        });
      }

      await AuditService.record(
        {
          action: AuditAction.PERMISSION_CHANGE,
          source: AuditSource.UI,
          entity_type: "AdminUser",
          entity_id: targetAdmin.id,
          admin_id: admin.id,
          old_values: {
            email: targetAdmin.email,
            can_view_all_student_units: targetAdmin.can_view_all_student_units,
            student_view_unit_ids: oldStudentViewUnits.map((row) => row.unit_id),
          },
          new_values: {
            email: savedAdmin.email,
            can_view_all_student_units: savedAdmin.can_view_all_student_units,
            student_view_unit_ids: [],
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return savedAdmin;
    });

    return await toAdminResponse(updatedAdmin);
  }

  static async setCanViewAllEmployeeUnits(
    admin: AdminUser,
    targetAdminId: string,
    request: SetCanViewAllEmployeeUnitsRequest,
    context: AuditRequestContext = {},
  ): Promise<AdminResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedAdminUserAction(
        admin,
        "set can_view_all_employee_units",
        context,
        targetAdminId,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can change cross-unit visibility",
      );
    }

    const setRequest = Validation.validate(
      AdminUserValidation.SET_CAN_VIEW_ALL_EMPLOYEE_UNITS,
      request,
    );

    const targetAdmin = await prismaClient.adminUser.findUnique({
      where: { id: targetAdminId },
    });

    if (!targetAdmin) {
      throw new ResponseError(404, "Admin not found");
    }

    await assertNotProtectedAdmin(
      admin,
      targetAdmin,
      "set can_view_all_employee_units",
      context,
    );

    if (targetAdmin.can_view_all_employee_units === setRequest.can_view_all_employee_units) {
      throw new ResponseError(
        400,
        `can_view_all_employee_units is already ${setRequest.can_view_all_employee_units}`,
      );
    }

    const updatedAdmin = await prismaClient.$transaction(async (tx) => {
      const oldEmployeeViewUnits = await tx.adminUserEmployeeViewUnit.findMany({
        where: { admin_id: targetAdminId },
        select: { unit_id: true },
      });
      const savedAdmin = await tx.adminUser.update({
        where: { id: targetAdminId },
        data: { can_view_all_employee_units: setRequest.can_view_all_employee_units },
      });

      if (setRequest.can_view_all_employee_units) {
        await tx.adminUserEmployeeViewUnit.deleteMany({
          where: { admin_id: targetAdminId },
        });
      }

      await AuditService.record(
        {
          action: AuditAction.PERMISSION_CHANGE,
          source: AuditSource.UI,
          entity_type: "AdminUser",
          entity_id: targetAdmin.id,
          admin_id: admin.id,
          old_values: {
            email: targetAdmin.email,
            can_view_all_employee_units: targetAdmin.can_view_all_employee_units,
            employee_view_unit_ids: oldEmployeeViewUnits.map((row) => row.unit_id),
          },
          new_values: {
            email: savedAdmin.email,
            can_view_all_employee_units: savedAdmin.can_view_all_employee_units,
            employee_view_unit_ids: [],
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return savedAdmin;
    });

    return await toAdminResponse(updatedAdmin);
  }

  // Employee PII access is separate from student sensitive-data access.
  // Only protected Super Admins pick who can approve identifier changes.
  static async setCanApproveIdentifierChanges(
    admin: AdminUser,
    targetAdminId: string,
    request: SetCanApproveIdentifierChangesRequest,
    context: AuditRequestContext = {},
  ): Promise<AdminResponse> {
    if (
      admin.role !== AdminRole.SUPER_ADMIN ||
      !isProtectedSuperAdminEmail(admin.email)
    ) {
      await recordUnauthorizedAdminUserAction(
        admin,
        "set can_approve_identifier_changes",
        context,
        targetAdminId,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only a protected Super Admin can choose approvers",
      );
    }

    const setRequest = Validation.validate(
      AdminUserValidation.SET_CAN_APPROVE_IDENTIFIER_CHANGES,
      request,
    );

    const targetAdmin = await prismaClient.adminUser.findUnique({
      where: { id: targetAdminId },
    });
    if (!targetAdmin) {
      throw new ResponseError(404, "Admin not found");
    }
    if (setRequest.can_approve_identifier_changes) {
      if (
        targetAdmin.role !== AdminRole.SUPER_ADMIN &&
        targetAdmin.role !== AdminRole.DATABASE_ADMIN
      ) {
        throw new ResponseError(
          400,
          "Only a Super Admin or Database Admin can be an approver",
        );
      }
      if (!(await isHeadOfCare(targetAdmin))) {
        throw new ResponseError(
          400,
          "Only an active Head of CARE can be a change request approver",
        );
      }
    }
    if (
      targetAdmin.can_approve_identifier_changes ===
      setRequest.can_approve_identifier_changes
    ) {
      throw new ResponseError(
        400,
        `can_approve_identifier_changes is already ${setRequest.can_approve_identifier_changes}`,
      );
    }

    const updatedAdmin = await prismaClient.$transaction(async (tx) => {
      const savedAdmin = await tx.adminUser.update({
        where: { id: targetAdminId },
        data: {
          can_approve_identifier_changes:
            setRequest.can_approve_identifier_changes,
        },
      });
      await AuditService.record(
        {
          action: AuditAction.PERMISSION_CHANGE,
          source: AuditSource.UI,
          entity_type: "AdminUser",
          entity_id: targetAdmin.id,
          admin_id: admin.id,
          old_values: {
            email: targetAdmin.email,
            can_approve_identifier_changes:
              targetAdmin.can_approve_identifier_changes,
          },
          new_values: {
            email: savedAdmin.email,
            can_approve_identifier_changes:
              savedAdmin.can_approve_identifier_changes,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return savedAdmin;
    });

    return await toAdminResponse(updatedAdmin);
  }

  static async setCanViewEmployeePii(
    admin: AdminUser,
    targetAdminId: string,
    request: SetCanViewEmployeePiiRequest,
    context: AuditRequestContext = {},
  ): Promise<AdminResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedAdminUserAction(
        admin,
        "set can_view_employee_pii",
        context,
        targetAdminId,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can change employee PII access",
      );
    }

    const setRequest = Validation.validate(
      AdminUserValidation.SET_CAN_VIEW_EMPLOYEE_PII,
      request,
    );

    const targetAdmin = await prismaClient.adminUser.findUnique({
      where: { id: targetAdminId },
    });

    if (!targetAdmin) {
      throw new ResponseError(404, "Admin not found");
    }

    await assertNotProtectedAdmin(
      admin,
      targetAdmin,
      "set can_view_employee_pii",
      context,
    );

    if (
      targetAdmin.can_view_employee_pii === setRequest.can_view_employee_pii
    ) {
      throw new ResponseError(
        400,
        `can_view_employee_pii is already ${setRequest.can_view_employee_pii}`,
      );
    }

    const updatedAdmin = await prismaClient.$transaction(async (tx) => {
      const savedAdmin = await tx.adminUser.update({
        where: { id: targetAdminId },
        data: {
          can_view_employee_pii: setRequest.can_view_employee_pii,
          ...(setRequest.can_view_employee_pii
            ? { can_view_employee_data: true }
            : {}),
        },
      });

      await AuditService.record(
        {
          action: AuditAction.PERMISSION_CHANGE,
          source: AuditSource.UI,
          entity_type: "AdminUser",
          entity_id: targetAdmin.id,
          admin_id: admin.id,
          old_values: {
            email: targetAdmin.email,
            can_view_employee_pii: targetAdmin.can_view_employee_pii,
          },
          new_values: {
            email: savedAdmin.email,
            can_view_employee_pii: savedAdmin.can_view_employee_pii,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return savedAdmin;
    });

    return await toAdminResponse(updatedAdmin);
  }

  // Employee and teacher-assignment writes use this domain permission.
  static async setCanWriteEmployeeData(
    admin: AdminUser,
    targetAdminId: string,
    request: SetCanWriteEmployeeDataRequest,
    context: AuditRequestContext = {},
  ): Promise<AdminResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedAdminUserAction(
        admin,
        "set can_write_employee_data",
        context,
        targetAdminId,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can change employee data write access",
      );
    }

    const setRequest = Validation.validate(
      AdminUserValidation.SET_CAN_WRITE_EMPLOYEE_DATA,
      request,
    );

    const targetAdmin = await prismaClient.adminUser.findUnique({
      where: { id: targetAdminId },
    });

    if (!targetAdmin) {
      throw new ResponseError(404, "Admin not found");
    }

    await assertNotProtectedAdmin(
      admin,
      targetAdmin,
      "set can_write_employee_data",
      context,
    );

    if (
      targetAdmin.can_write_employee_data ===
      setRequest.can_write_employee_data
    ) {
      throw new ResponseError(
        400,
        `can_write_employee_data is already ${setRequest.can_write_employee_data}`,
      );
    }

    const updatedAdmin = await prismaClient.$transaction(async (tx) => {
      const savedAdmin = await tx.adminUser.update({
        where: { id: targetAdminId },
        data: {
          can_write_employee_data: setRequest.can_write_employee_data,
          ...(setRequest.can_write_employee_data
            ? { can_view_employee_data: true }
            : {}),
        },
      });

      await AuditService.record(
        {
          action: AuditAction.PERMISSION_CHANGE,
          source: AuditSource.UI,
          entity_type: "AdminUser",
          entity_id: targetAdmin.id,
          admin_id: admin.id,
          old_values: {
            email: targetAdmin.email,
            can_write_employee_data: targetAdmin.can_write_employee_data,
          },
          new_values: {
            email: savedAdmin.email,
            can_write_employee_data: savedAdmin.can_write_employee_data,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return savedAdmin;
    });

    return await toAdminResponse(updatedAdmin);
  }

  // Student sub-record and class writes use this domain permission.
  static async setCanWriteStudentData(
    admin: AdminUser,
    targetAdminId: string,
    request: SetCanWriteStudentDataRequest,
    context: AuditRequestContext = {},
  ): Promise<AdminResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedAdminUserAction(
        admin,
        "set can_write_student_data",
        context,
        targetAdminId,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can change student data write access",
      );
    }

    const setRequest = Validation.validate(
      AdminUserValidation.SET_CAN_WRITE_STUDENT_DATA,
      request,
    );

    const targetAdmin = await prismaClient.adminUser.findUnique({
      where: { id: targetAdminId },
    });

    if (!targetAdmin) {
      throw new ResponseError(404, "Admin not found");
    }

    await assertNotProtectedAdmin(
      admin,
      targetAdmin,
      "set can_write_student_data",
      context,
    );

    if (
      targetAdmin.can_write_student_data === setRequest.can_write_student_data
    ) {
      throw new ResponseError(
        400,
        `can_write_student_data is already ${setRequest.can_write_student_data}`,
      );
    }

    const updatedAdmin = await prismaClient.$transaction(async (tx) => {
      const savedAdmin = await tx.adminUser.update({
        where: { id: targetAdminId },
        data: {
          can_write_student_data: setRequest.can_write_student_data,
          ...(setRequest.can_write_student_data
            ? { can_view_student_data: true }
            : {}),
        },
      });

      await AuditService.record(
        {
          action: AuditAction.PERMISSION_CHANGE,
          source: AuditSource.UI,
          entity_type: "AdminUser",
          entity_id: targetAdmin.id,
          admin_id: admin.id,
          old_values: {
            email: targetAdmin.email,
            can_write_student_data: targetAdmin.can_write_student_data,
          },
          new_values: {
            email: savedAdmin.email,
            can_write_student_data: savedAdmin.can_write_student_data,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return savedAdmin;
    });

    return await toAdminResponse(updatedAdmin);
  }

  static async grantAfterHoursWrite(
    admin: AdminUser,
    targetAdminId: string,
    request: GrantAfterHoursWriteRequest,
    context: AuditRequestContext = {},
  ): Promise<AdminResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedAdminUserAction(
        admin,
        "grant after-hours write",
        context,
        targetAdminId,
      );
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

    await assertNotProtectedAdmin(
      admin,
      targetAdmin,
      "grant after-hours write",
      context,
    );

    if (targetAdmin.role !== AdminRole.DATABASE_ADMIN) {
      throw new ResponseError(
        400,
        "After-hours write exceptions only apply to Database Admin accounts",
      );
    }

    if (
      !targetAdmin.can_write_employee_data &&
      !targetAdmin.can_write_student_data
    ) {
      throw new ResponseError(
        400,
        "This admin doesn't have any write access enabled (Write Employee Data / Write Student Data). Grant one of those first",
      );
    }

    const until = new Date(Date.now() + grantRequest.minutes * 60_000);

    const updatedAdmin = await prismaClient.$transaction(async (tx) => {
      const savedAdmin = await tx.adminUser.update({
        where: { id: targetAdminId },
        data: { after_hours_write_until: until },
      });

      await AuditService.record(
        {
          action: AuditAction.PERMISSION_CHANGE,
          source: AuditSource.UI,
          entity_type: "AdminUser",
          entity_id: targetAdmin.id,
          admin_id: admin.id,
          old_values: {
            email: targetAdmin.email,
            after_hours_write_until: targetAdmin.after_hours_write_until
              ? targetAdmin.after_hours_write_until.toISOString()
              : null,
          },
          new_values: {
            email: savedAdmin.email,
            after_hours_write_until: until.toISOString(),
            granted_minutes: grantRequest.minutes,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return savedAdmin;
    });

    return await toAdminResponse(updatedAdmin);
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

    return await toAdminResponse(targetAdmin);
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
            include: {
              student_view_units: { select: { unit_id: true } },
              employee_view_units: { select: { unit_id: true } },
            },
          })
          .then(async (admins) => {
            const headOfCare = await headOfCarePersonIds(
              admins.map((admin) => admin.person_id),
            );
            return Promise.all(
              admins.map((admin) =>
                toAdminResponse(
                  admin,
                  admin.person_id ? headOfCare.has(admin.person_id) : false,
                ),
              ),
            );
          }),
    });
  }
}

function buildAdminUserOrderBy(
  sortBy: AdminUserSortField,
  sortOrder: "asc" | "desc",
) {
  return { [sortBy]: sortOrder };
}
