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
import { assertCanWriteNow } from "../utils/office-hours";
import { Validation } from "../validation/validation";
import { DisciplinaryActionValidation } from "../validation/disciplinary-action-validation";

// Falls back to this when the admin doesn't pick a duration - 6 months was
// the original one-size-fits-all rule; now it's just the default, the admin
// can pick a shorter or longer window per record (see validity_days).
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
  if (admin.role === AdminRole.VIEWER) {
    await recordUnauthorizedDisciplinaryAction(admin, action, context, entityId);
    throw new ResponseError(403, "Forbidden: Viewer cannot manage disciplinary actions");
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    if (!admin.can_write_data) {
      await recordUnauthorizedDisciplinaryAction(admin, action, context, entityId);
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to manage disciplinary actions",
      );
    }
    await assertCanWriteNow(admin, context, now);
    if (employeeUnitId !== admin.unit_id) {
      await recordUnauthorizedDisciplinaryAction(admin, action, context, entityId);
      throw new ResponseError(
        403,
        "Forbidden: This employee is outside your unit scope",
      );
    }
  }
}

export class DisciplinaryActionService {
  static async list(
    admin: AdminUser,
    request: ListDisciplinaryActionsRequest,
  ): Promise<DisciplinaryActionResponse[]> {
    const listRequest = Validation.validate(
      DisciplinaryActionValidation.LIST,
      request,
    );
    const employee = await CheckExist.checkEmployeeExists(
      listRequest.employee_id,
    );

    if (
      admin.role === AdminRole.DATABASE_ADMIN &&
      !admin.can_view_all_units &&
      employee.unit_id !== admin.unit_id
    ) {
      throw new ResponseError(404, "Employee not found");
    }

    const actions = await prismaClient.employeeDisciplinaryAction.findMany({
      where: { employee_id: listRequest.employee_id },
      include: { issued_by_admin: { select: { full_name: true } }, _count: { select: { attachments: { where: { deleted_at: null } } } } },
      orderBy: { issued_date: "desc" },
    });

    return actions.map(toDisciplinaryActionResponse);
  }

  // Creates a new ST/SP for an employee, resolving the level (1 or 2)
  // automatically from their current state rather than trusting a
  // caller-supplied level - see the module-level rules below.
  //
  // Rules:
  // - SURAT_PERINGATAN (SP): independent of ST. No active SP -> level 1.
  //   Active SP1 -> level 2 (escalation, SP1 superseded). Active SP2 ->
  //   rejected (already at the top). Issuing an SP also supersedes any
  //   currently active ST for this employee - the SP makes it moot.
  // - SURAT_TEGURAN (ST): rejected outright if the employee has an active
  //   SP (any level) - only SP escalation is allowed at that point. No
  //   active ST -> level 1. Active ST1 -> level 2 (escalation, ST1
  //   superseded). Active ST2 -> rejected (issue an SP instead).
  // - Each action's validity window (validity_days, default 180 = ~6
  //   months) counts from its own issued_date - past due ACTIVE rows are
  //   flipped to EXPIRED as part of resolving "currently active" state
  //   here, so a stale row from before the periodic sweep ran never gets
  //   treated as still active. "Past due" is checked against the new
  //   record's own issued_date, not real-world now - entering a backdated
  //   record (e.g. digitizing an old paper trail) must see whether the
  //   prior record was active as of that historical date, not today's.
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
      // Resolve any rows this employee has that are ACTIVE on paper but
      // already past valid_until - treat (and persist) them as EXPIRED
      // before evaluating sequencing, same "resolve on write" pattern as
      // employee auto-resign. Compared against issuedDate, not `now` -
      // backdating a historical record (issued_date in the past) must
      // check whether the prior record was still active as of THAT date,
      // not as of today. For the common case (no issued_date override),
      // issuedDate === now, so this is unchanged.
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

  // Corrects reason/notes text after the fact (e.g. a typo, or a reason
  // that needed clarifying) - not a status transition, so it works on a
  // record in any status, unlike resolve/revoke which only apply to ACTIVE.
  // issued_by_admin_id is left untouched - it records who originally issued
  // the letter, not who last edited it (that's in the audit log instead).
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

  // Marks a mistakenly-issued action as REVOKED - kept in the table (not
  // deleted) for the audit trail, but no longer counts toward sequencing/
  // escalation checks regardless of its status beforehand.
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

  // Called on a timer from src/index.ts, same pattern as
  // EmployeeService.autoResignPastDueEmployees - flips ACTIVE rows whose
  // valid_until has passed to EXPIRED. create() also resolves this
  // per-employee inline at write time, so this sweep only matters for
  // employees who haven't had a new action issued since expiry.
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
