import { ResponseError } from "../error/response-error";
import {
  AdminRole,
  AuditAction,
  AuditSource,
  DisciplinaryActionStatus,
  DisciplinaryActionType,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import { paginate, type Pageable } from "../model/page-model";
import {
  toDisciplinaryActionResponse,
  type CreateDisciplinaryActionRequest,
  type DisciplinaryActionResponse,
  type ListDisciplinaryActionsRequest,
  type ResolveDisciplinaryActionRequest,
  type RevokeDisciplinaryActionRequest,
  type UpdateDisciplinaryActionRequest,
} from "../model/disciplinary-action-model";
import { AuditService } from "./audit-service";
import { CheckExist } from "../utils/check-exist";
import { withLookupCache } from "../lib/lookup-cache";
import { assertCanWriteNow } from "../utils/office-hours";
import { Validation } from "../validation/validation";
import { DisciplinaryActionValidation } from "../validation/disciplinary-action-validation";
import {
  assertCanWriteUnit,
  canViewEmployeeDisciplinaryData,
  resolveEmployeeUnitScope,
  type AdminUserWithEmployeeScope,
} from "../utils/admin-permissions";

// Default validity is 180 days when the admin does not choose a duration.
const DEFAULT_VALIDITY_DAYS = 180;

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

async function recordUnauthorizedDisciplinaryAction(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
  entityId?: string,
): Promise<void> {
  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    entity_type: "EmployeeDisciplinaryAction",
    entity_id: entityId,
    new_values: {
      reason: `blocked disciplinary action ${action}`,
      ...(entityId ? { disciplinary_action_id: entityId } : {}),
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

// Exported so disciplinary-action-attachment-service.ts can reuse the same
// permission tier for attachment upload/delete/restore.
export async function assertCanManage(
  admin: AdminUser,
  employeeUnitId: string,
  action: string,
  context: AuditRequestContext,
  now: Date,
  entityId?: string,
): Promise<void> {
  if (!canViewEmployeeDisciplinaryData(admin)) {
    await recordUnauthorizedDisciplinaryAction(admin, action, context, entityId);
    throw new ResponseError(
      403,
      "Forbidden: Employee disciplinary data access is required",
    );
  }
  if (admin.role === AdminRole.SUPER_ADMIN) return;
  if (admin.role !== AdminRole.DATABASE_ADMIN || !admin.can_write_employee_data) {
    await recordUnauthorizedDisciplinaryAction(admin, action, context, entityId);
    throw new ResponseError(
      403,
      "Forbidden: Disciplinary actions require Database Admin employee write access",
    );
  }
  await assertCanWriteUnit(admin, employeeUnitId, "employee", {
    onDeny: () =>
      recordUnauthorizedDisciplinaryAction(admin, action, context, entityId),
    message: "Forbidden: This employee is outside your unit scope",
  });
  await assertCanWriteNow(admin, context, now);
}

export async function assertCanReadDisciplinaryData(
  admin: AdminUserWithEmployeeScope,
  employeeUnitId: string,
  action: string,
  context: AuditRequestContext = {},
  entityId?: string,
): Promise<void> {
  if (!canViewEmployeeDisciplinaryData(admin)) {
    await recordUnauthorizedDisciplinaryAction(admin, action, context, entityId);
    throw new ResponseError(
      403,
      "Forbidden: Employee disciplinary data access is required",
    );
  }
  const employeeUnitScope = resolveEmployeeUnitScope(admin);
  if (
    employeeUnitScope !== undefined &&
    !employeeUnitScope.includes(employeeUnitId)
  ) {
    await recordUnauthorizedDisciplinaryAction(admin, action, context, entityId);
    throw new ResponseError(404, "Employee not found");
  }
}

export class DisciplinaryActionService {
  static async list(
    admin: AdminUserWithEmployeeScope,
    request: ListDisciplinaryActionsRequest,
    context: AuditRequestContext = {},
  ): Promise<Pageable<DisciplinaryActionResponse>> {
    const listRequest = Validation.validate(
      DisciplinaryActionValidation.LIST,
      request,
    );
    const employee = await CheckExist.checkEmployeeExists(
      listRequest.employee_id,
    );

    await assertCanReadDisciplinaryData(
      admin,
      employee.unit_id,
      "list",
      context,
      listRequest.employee_id,
    );

    const where = { employee_id: listRequest.employee_id };
    const page = await paginate(listRequest.page, listRequest.size, {
      count: () => prismaClient.employeeDisciplinaryAction.count({ where }),
      findMany: () =>
        prismaClient.employeeDisciplinaryAction.findMany({
          where,
          include: { issued_by_admin: { select: { full_name: true } }, _count: { select: { attachments: { where: { deleted_at: null } } } } },
          orderBy: [{ issued_date: "desc" }, { id: "desc" }],
          skip: (listRequest.page - 1) * listRequest.size,
          take: listRequest.size,
        }),
    });

    return { ...page, data: page.data.map(toDisciplinaryActionResponse) };
  }

  // Masked-by-default on the client; this records the reveal for audit,
  // mirroring EmployeeService.recordPiiAccess.
  static async recordAccess(
    admin: AdminUserWithEmployeeScope,
    employeeId: string,
    context: AuditRequestContext = {},
  ): Promise<void> {
    const employee = await CheckExist.checkEmployeeExists(employeeId);
    await assertCanReadDisciplinaryData(
      admin,
      employee.unit_id,
      "access",
      context,
      employeeId,
    );

    // Deduplicate repeated reveals within the same viewing session.
    const { cached } = await withLookupCache(
      "employee-disciplinary-access",
      [admin.id, employeeId],
      async () => true,
    );

    if (!cached) {
      await AuditService.record({
        action: AuditAction.ACCESS_EMPLOYEE_DISCIPLINARY_DATA,
        source: AuditSource.UI,
        entity_type: "Employee",
        entity_id: employeeId,
        admin_id: admin.id,
        new_values: {
          resource: "EmployeeDisciplinaryData",
          full_name: employee.person.full_name,
        },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });
    }
  }

  // Resolve ST/SP level and expiry against issued_date for historical accuracy.
  static async create(
    admin: AdminUser,
    request: CreateDisciplinaryActionRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<DisciplinaryActionResponse> {
    const createRequest = Validation.validate(
      DisciplinaryActionValidation.CREATE,
      request,
    );
    const employee = await CheckExist.checkEmployeeExists(
      createRequest.employee_id,
    );
    await assertCanManage(admin, employee.unit_id, "issue", context, now);

    const issuedDate = createRequest.issued_date
      ? new Date(createRequest.issued_date)
      : now;
    const validUntil = addDays(
      issuedDate,
      createRequest.validity_days ?? DEFAULT_VALIDITY_DAYS,
    );

    const created = await prismaClient.$transaction(async (tx) => {
      // Resolve prior actions against the new action's issue date.
      const activeRows = await tx.employeeDisciplinaryAction.findMany({
        where: {
          employee_id: createRequest.employee_id,
          status: DisciplinaryActionStatus.ACTIVE,
        },
      });
      const staleIds = activeRows
        .filter((row) => row.valid_until <= issuedDate)
        .map((row) => row.id);
      if (staleIds.length > 0) {
        await tx.employeeDisciplinaryAction.updateMany({
          where: { id: { in: staleIds } },
          data: { status: DisciplinaryActionStatus.EXPIRED },
        });
      }
      const staleIdSet = new Set(staleIds);
      const currentlyActive = activeRows.filter((row) => !staleIdSet.has(row.id));
      const activeSt = currentlyActive.find(
        (row) => row.type === DisciplinaryActionType.SURAT_TEGURAN,
      );
      const activeSp = currentlyActive.find(
        (row) => row.type === DisciplinaryActionType.SURAT_PERINGATAN,
      );

      const idsToSupersede: string[] = [];
      let level: number;

      if (createRequest.type === DisciplinaryActionType.SURAT_PERINGATAN) {
        if (activeSp && activeSp.level >= 2) {
          throw new ResponseError(
            400,
            "This employee already has an active Reprimand Letter 2 - no further escalation is available.",
          );
        }
        level = activeSp ? activeSp.level + 1 : 1;
        if (activeSp) idsToSupersede.push(activeSp.id);
        // A newly-issued SP makes any still-active ST moot.
        if (activeSt) idsToSupersede.push(activeSt.id);
      } else {
        if (activeSp) {
          throw new ResponseError(
            400,
            "This employee has an active Reprimand Letter - a Warning Letter cannot be issued. Escalate to the next Reprimand Letter level instead.",
          );
        }
        if (activeSt && activeSt.level >= 2) {
          throw new ResponseError(
            400,
            "This employee already has an active Warning Letter 2 - issue a Reprimand Letter instead.",
          );
        }
        level = activeSt ? activeSt.level + 1 : 1;
        if (activeSt) idsToSupersede.push(activeSt.id);
      }

      if (idsToSupersede.length > 0) {
        await tx.employeeDisciplinaryAction.updateMany({
          where: { id: { in: idsToSupersede } },
          data: { status: DisciplinaryActionStatus.SUPERSEDED },
        });
      }

      const newAction = await tx.employeeDisciplinaryAction.create({
        data: {
          employee_id: createRequest.employee_id,
          type: createRequest.type,
          level,
          status: DisciplinaryActionStatus.ACTIVE,
          issued_date: issuedDate,
          valid_until: validUntil,
          reason: createRequest.reason,
          notes: createRequest.notes,
          issued_by_admin_id: admin.id,
        },
      });

      await AuditService.record(
        {
          action: AuditAction.ISSUE_DISCIPLINARY_ACTION,
          source: AuditSource.UI,
          entity_type: "EmployeeDisciplinaryAction",
          entity_id: newAction.id,
          admin_id: admin.id,
          new_values: {
            employee_id: newAction.employee_id,
            type: newAction.type,
            level: newAction.level,
            reason: newAction.reason,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return newAction;
    });

    const withAdmin = await prismaClient.employeeDisciplinaryAction.findUniqueOrThrow({
      where: { id: created.id },
      include: { issued_by_admin: { select: { full_name: true } }, _count: { select: { attachments: { where: { deleted_at: null } } } } },
    });
    return toDisciplinaryActionResponse(withAdmin);
  }

  // Text corrections preserve the original issuer and work in any status.
  static async update(
    admin: AdminUser,
    request: UpdateDisciplinaryActionRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<DisciplinaryActionResponse> {
    const updateRequest = Validation.validate(
      DisciplinaryActionValidation.UPDATE,
      request,
    );
    const employee = await CheckExist.checkEmployeeExists(
      updateRequest.employee_id,
    );
    await assertCanManage(
      admin,
      employee.unit_id,
      "update",
      context,
      now,
      updateRequest.id,
    );

    const existing = await prismaClient.employeeDisciplinaryAction.findFirst({
      where: { id: updateRequest.id, employee_id: updateRequest.employee_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Disciplinary action not found");
    }

    const updated = await prismaClient.$transaction(async (tx) => {
      const result = await tx.employeeDisciplinaryAction.update({
        where: { id: updateRequest.id },
        data: {
          reason: updateRequest.reason,
          notes: updateRequest.notes,
        },
      });
      await AuditService.record(
        {
          action: AuditAction.UPDATE_DISCIPLINARY_ACTION,
          source: AuditSource.UI,
          entity_type: "EmployeeDisciplinaryAction",
          entity_id: result.id,
          admin_id: admin.id,
          old_values: {
            ...(updateRequest.reason !== undefined && { reason: existing.reason }),
            ...(updateRequest.notes !== undefined && { notes: existing.notes }),
          },
          new_values: {
            ...(updateRequest.reason !== undefined && { reason: result.reason }),
            ...(updateRequest.notes !== undefined && { notes: result.notes }),
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return result;
    });

    const withAdmin = await prismaClient.employeeDisciplinaryAction.findUniqueOrThrow({
      where: { id: updated.id },
      include: { issued_by_admin: { select: { full_name: true } }, _count: { select: { attachments: { where: { deleted_at: null } } } } },
    });
    return toDisciplinaryActionResponse(withAdmin);
  }

  static async resolve(
    admin: AdminUser,
    request: ResolveDisciplinaryActionRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<DisciplinaryActionResponse> {
    const resolveRequest = Validation.validate(
      DisciplinaryActionValidation.RESOLVE,
      request,
    );
    const employee = await CheckExist.checkEmployeeExists(
      resolveRequest.employee_id,
    );
    await assertCanManage(
      admin,
      employee.unit_id,
      "resolve",
      context,
      now,
      resolveRequest.id,
    );

    const existing = await prismaClient.employeeDisciplinaryAction.findFirst({
      where: { id: resolveRequest.id, employee_id: resolveRequest.employee_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Disciplinary action not found");
    }
    if (existing.status !== DisciplinaryActionStatus.ACTIVE) {
      throw new ResponseError(
        400,
        `Only an active record can be resolved (this one is ${existing.status}).`,
      );
    }

    const updated = await prismaClient.$transaction(async (tx) => {
      const result = await tx.employeeDisciplinaryAction.update({
        where: { id: resolveRequest.id },
        data: {
          status: DisciplinaryActionStatus.RESOLVED,
          resolved_at: now,
          resolved_reason: resolveRequest.resolved_reason,
        },
      });
      await AuditService.record(
        {
          action: AuditAction.RESOLVE_DISCIPLINARY_ACTION,
          source: AuditSource.UI,
          entity_type: "EmployeeDisciplinaryAction",
          entity_id: result.id,
          admin_id: admin.id,
          old_values: { status: existing.status },
          new_values: { status: result.status },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return result;
    });

    const withAdmin = await prismaClient.employeeDisciplinaryAction.findUniqueOrThrow({
      where: { id: updated.id },
      include: { issued_by_admin: { select: { full_name: true } }, _count: { select: { attachments: { where: { deleted_at: null } } } } },
    });
    return toDisciplinaryActionResponse(withAdmin);
  }

  // Revoked actions remain auditable but no longer affect sequencing.
  static async revoke(
    admin: AdminUser,
    request: RevokeDisciplinaryActionRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<DisciplinaryActionResponse> {
    const revokeRequest = Validation.validate(
      DisciplinaryActionValidation.REVOKE,
      request,
    );
    const employee = await CheckExist.checkEmployeeExists(
      revokeRequest.employee_id,
    );
    await assertCanManage(
      admin,
      employee.unit_id,
      "revoke",
      context,
      now,
      revokeRequest.id,
    );

    const existing = await prismaClient.employeeDisciplinaryAction.findFirst({
      where: { id: revokeRequest.id, employee_id: revokeRequest.employee_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Disciplinary action not found");
    }
    if (existing.status === DisciplinaryActionStatus.REVOKED) {
      throw new ResponseError(400, "This record is already revoked");
    }

    const updated = await prismaClient.$transaction(async (tx) => {
      const result = await tx.employeeDisciplinaryAction.update({
        where: { id: revokeRequest.id },
        data: { status: DisciplinaryActionStatus.REVOKED },
      });
      await AuditService.record(
        {
          action: AuditAction.REVOKE_DISCIPLINARY_ACTION,
          source: AuditSource.UI,
          entity_type: "EmployeeDisciplinaryAction",
          entity_id: result.id,
          admin_id: admin.id,
          old_values: { status: existing.status },
          new_values: { status: result.status },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return result;
    });

    const withAdmin = await prismaClient.employeeDisciplinaryAction.findUniqueOrThrow({
      where: { id: updated.id },
      include: { issued_by_admin: { select: { full_name: true } }, _count: { select: { attachments: { where: { deleted_at: null } } } } },
    });
    return toDisciplinaryActionResponse(withAdmin);
  }

  // The timer expires active actions not already resolved during a later write.
  static async expirePastDueActions(now: Date = new Date()): Promise<number> {
    const pastDue = await prismaClient.employeeDisciplinaryAction.findMany({
      where: {
        status: DisciplinaryActionStatus.ACTIVE,
        valid_until: { lte: now },
      },
      select: { id: true },
    });
    if (pastDue.length === 0) return 0;

    await prismaClient.$transaction(async (tx) => {
      await tx.employeeDisciplinaryAction.updateMany({
        where: { id: { in: pastDue.map((row) => row.id) } },
        data: { status: DisciplinaryActionStatus.EXPIRED },
      });
      for (const row of pastDue) {
        await AuditService.record(
          {
            action: AuditAction.AUTO_EXPIRE_DISCIPLINARY_ACTION,
            source: AuditSource.SYSTEM,
            entity_type: "EmployeeDisciplinaryAction",
            entity_id: row.id,
            new_values: { status: DisciplinaryActionStatus.EXPIRED },
          },
          tx,
        );
      }
    });

    return pastDue.length;
  }
}
