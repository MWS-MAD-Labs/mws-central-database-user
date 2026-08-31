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
  ChangeAdminRoleRequest,
  DemoteSuperAdminRequest,
  GetAdminUserRequest,
  GrantAfterHoursWriteRequest,
  PromoteEmployeeRequest,
  SearchAdminUserRequest,
  SetCanViewAllUnitsRequest,
  SetCanViewEmployeePiiRequest,
  SetCanViewSensitiveData,
  SetCanWriteEmployeeDataRequest,
  SetCanWriteStudentDataRequest,
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
    new_values: {
      reason: `blocked admin user ${action}`,
      ...(targetAdminId ? { target_admin_id: targetAdminId } : {}),
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

export class AdminUserService {
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

    // A protected email's account can never be touched via this path - not
    // even re-promoting it back to Super Admin - and a *new* admin record
    // can only ever be created as Super Admin for a protected email, never
    // anything lower. Keeps the guarantee "protected == always Super Admin,
    // never anything else" true even before the account exists.
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
            ? { role: existingAdmin.role, is_active: existingAdmin.is_active }
            : undefined,
          new_values: { role: savedAdmin.role, is_active: savedAdmin.is_active },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return savedAdmin;
    });

    return toAdminResponse(resultAdmin);
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
          old_values: { role: targetAdmin.role, is_active: targetAdmin.is_active },
          new_values: {
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

    return toAdminResponse(updatedAdmin);
  }

  // Direct DATABASE_ADMIN <-> VIEWER toggle for an already-active admin - no
  // employee_id needed, unlike promoteEmployee (which requires a matching
  // Person.email and breaks once that email has drifted). Demoting to VIEWER
  // clears both write flags so a later re-promotion to DATABASE_ADMIN starts
  // with write access disabled again, same as a fresh promoteEmployee call.
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
            ? { can_write_employee_data: false, can_write_student_data: false }
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
            role: targetAdmin.role,
            can_write_employee_data: targetAdmin.can_write_employee_data,
            can_write_student_data: targetAdmin.can_write_student_data,
          },
          new_values: {
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

    return toAdminResponse(updatedAdmin);
  }

  // Separate from changeRole (which only ever toggles DATABASE_ADMIN <->
  // VIEWER) - demoting away from Super Admin is high-stakes enough to
  // deserve its own endpoint/audit action rather than widening that one's
  // scope. Guarded by the same protected-admin + last-active-Super-Admin
  // checks as demoteAdmin, plus a self-demote block for the same reason
  // demoteAdmin has one - don't let a Super Admin lock themselves out
  // mid-session.
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
            ? { can_write_employee_data: false, can_write_student_data: false }
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
            role: targetAdmin.role,
            can_write_employee_data: targetAdmin.can_write_employee_data,
            can_write_student_data: targetAdmin.can_write_student_data,
          },
          new_values: {
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

    return toAdminResponse(updatedAdmin);
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
        data: { can_view_sensitive_data: setRequest.can_view_sensitive_data },
      });

      await AuditService.record(
        {
          action: AuditAction.PERMISSION_CHANGE,
          source: AuditSource.UI,
          entity_type: "AdminUser",
          entity_id: targetAdmin.id,
          admin_id: admin.id,
          old_values: {
            can_view_sensitive_data: targetAdmin.can_view_sensitive_data,
          },
          new_values: {
            can_view_sensitive_data: savedAdmin.can_view_sensitive_data,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return savedAdmin;
    });

    return toAdminResponse(updatedAdmin);
  }

  // Bypasses unit-scoping on Student/Employee reads (search/list/get) only -
  // writes still respect the admin's own unit. Meant for roles that
  // legitimately need org-wide visibility (e.g. HR) without escalating them
  // to Super Admin just to see across units.
  static async setCanViewAllUnits(
    admin: AdminUser,
    targetAdminId: string,
    request: SetCanViewAllUnitsRequest,
    context: AuditRequestContext = {},
  ): Promise<AdminResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedAdminUserAction(
        admin,
        "set can_view_all_units",
        context,
        targetAdminId,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can change cross-unit visibility",
      );
    }

    const setRequest = Validation.validate(
      AdminUserValidation.SET_CAN_VIEW_ALL_UNITS,
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
      "set can_view_all_units",
      context,
    );

    if (targetAdmin.can_view_all_units === setRequest.can_view_all_units) {
      throw new ResponseError(
        400,
        `can_view_all_units is already ${setRequest.can_view_all_units}`,
      );
    }

    const updatedAdmin = await prismaClient.$transaction(async (tx) => {
      const savedAdmin = await tx.adminUser.update({
        where: { id: targetAdminId },
        data: { can_view_all_units: setRequest.can_view_all_units },
      });

      await AuditService.record(
        {
          action: AuditAction.PERMISSION_CHANGE,
          source: AuditSource.UI,
          entity_type: "AdminUser",
          entity_id: targetAdmin.id,
          admin_id: admin.id,
          old_values: { can_view_all_units: targetAdmin.can_view_all_units },
          new_values: { can_view_all_units: savedAdmin.can_view_all_units },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return savedAdmin;
    });

    return toAdminResponse(updatedAdmin);
  }

  // Deliberately separate from can_view_sensitive_data (student health/
  // consent data) - granting one must never silently unlock the other.
  // Gates employee NIK/NPWP/bank/BPJS on both read (get()) and write
  // (create()/update()).
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
        data: { can_view_employee_pii: setRequest.can_view_employee_pii },
      });

      await AuditService.record(
        {
          action: AuditAction.PERMISSION_CHANGE,
          source: AuditSource.UI,
          entity_type: "AdminUser",
          entity_id: targetAdmin.id,
          admin_id: admin.id,
          old_values: {
            can_view_employee_pii: targetAdmin.can_view_employee_pii,
          },
          new_values: {
            can_view_employee_pii: savedAdmin.can_view_employee_pii,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return savedAdmin;
    });

    return toAdminResponse(updatedAdmin);
  }

  // Denies writes to the Employee entity's own record (EmployeeService,
  // disciplinary actions, mutation history, employee photo) plus teacher
  // assignment in ClassService (assignTeacher/endTeacherAssignment/
  // reopenTeacherAssignment/removeTeacherAssignment/bulkMoveTeacherAssignments).
  // Plain Class CRUD is student-domain instead (a class exists to house
  // students) - see can_write_student_data. Deliberately separate from
  // can_write_student_data - granting HR domain access must never silently
  // unlock student writes and vice versa.
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
        data: { can_write_employee_data: setRequest.can_write_employee_data },
      });

      await AuditService.record(
        {
          action: AuditAction.PERMISSION_CHANGE,
          source: AuditSource.UI,
          entity_type: "AdminUser",
          entity_id: targetAdmin.id,
          admin_id: admin.id,
          old_values: {
            can_write_employee_data: targetAdmin.can_write_employee_data,
          },
          new_values: {
            can_write_employee_data: savedAdmin.can_write_employee_data,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return savedAdmin;
    });

    return toAdminResponse(updatedAdmin);
  }

  // Mirrors setCanWriteEmployeeData - denies writes to the Student entity's
  // own record and its sub-records (enrollment, health, consent, parent/
  // guardian, vaccine, PC activity, student photo) plus plain Class CRUD
  // (create/update/remove - a class exists to house students). Teacher
  // assignment inside ClassService is employee-domain instead - see
  // can_write_employee_data.
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
        data: { can_write_student_data: setRequest.can_write_student_data },
      });

      await AuditService.record(
        {
          action: AuditAction.PERMISSION_CHANGE,
          source: AuditSource.UI,
          entity_type: "AdminUser",
          entity_id: targetAdmin.id,
          admin_id: admin.id,
          old_values: {
            can_write_student_data: targetAdmin.can_write_student_data,
          },
          new_values: {
            can_write_student_data: savedAdmin.can_write_student_data,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return savedAdmin;
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
        },
        tx,
      );

      return savedAdmin;
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
