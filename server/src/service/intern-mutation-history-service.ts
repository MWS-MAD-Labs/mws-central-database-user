import {
  AdminRole,
  AuditAction,
  AuditSource,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import {
  assertCanViewEmployeeData,
  assertCanWriteUnit,
  resolveEmployeeUnitScope,
  type AdminUserWithEmployeeScope,
} from "../utils/admin-permissions";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toInternMutationHistoryResponse,
  type GetInternMutationHistoryRequest,
  type InternMutationHistoryResponse,
  type RollbackInternMutationRequest,
} from "../model/intern-mutation-history-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { InternMutationHistoryValidation } from "../validation/intern-mutation-history-validation";
import { Validation } from "../validation/validation";
import { lockInternWorkforce } from "../utils/intern-workforce-lock";
import { assertJobPositionCapacity } from "../utils/job-position-capacity";
import { assertJobPositionUnitCompatibleByIds } from "../utils/employee-role-rules";

const INCLUDE = { unit: true, job_position: true, building: true } as const;

async function recordUnauthorizedAction(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
  internId: string,
): Promise<void> {
  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    entity_type: "Intern",
    entity_id: internId,
    new_values: {
      reason: `blocked intern mutation history ${action}`,
      intern_id: internId,
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

async function assertWriteAllowed(
  admin: AdminUser,
  internId: string,
  context: AuditRequestContext,
  now: Date,
) {
  if (admin.role === AdminRole.VIEWER) {
    await recordUnauthorizedAction(admin, "rollback", context, internId);
    throw new ResponseError(403, "Forbidden: Viewer cannot modify data");
  }
  const intern = await prismaClient.intern.findFirst({
    where: { id: internId, deleted_at: null },
    select: { unit_id: true },
  });
  if (!intern) throw new ResponseError(404, "Intern not found");
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    if (!admin.can_write_employee_data) {
      await recordUnauthorizedAction(admin, "rollback", context, internId);
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to write employee data",
      );
    }
    await assertCanWriteNow(admin, context, now);
    await assertCanWriteUnit(admin, intern.unit_id, "employee", {
      onDeny: () => recordUnauthorizedAction(admin, "rollback", context, internId),
      message: "Forbidden: This intern is outside your unit scope",
    });
  }
}

function mutationAuditValue(row: {
  field: string;
  unit_id: string | null;
  job_position_id: string | null;
  building_id: string | null;
  status: string | null;
}) {
  const key = row.field.toLowerCase();
  return {
    field: row.field,
    [key === "unit" || key === "job_position" || key === "building"
      ? `${key}_id`
      : key]:
      row.unit_id ?? row.job_position_id ?? row.building_id ?? row.status,
  };
}

export class InternMutationHistoryService {
  static async getHistory(
    admin: AdminUserWithEmployeeScope,
    request: GetInternMutationHistoryRequest,
  ): Promise<InternMutationHistoryResponse[]> {
    assertCanViewEmployeeData(admin);
    const getRequest = Validation.validate(
      InternMutationHistoryValidation.GET,
      request,
    );
    const intern = await prismaClient.intern.findFirst({
      where: { id: getRequest.intern_id, deleted_at: null },
      select: { unit_id: true },
    });
    if (!intern) throw new ResponseError(404, "Intern not found");
    const internUnitScope = resolveEmployeeUnitScope(admin);
    if (
      internUnitScope !== undefined &&
      !internUnitScope.includes(intern.unit_id)
    ) {
      throw new ResponseError(404, "Intern not found");
    }
    const rows = await prismaClient.internMutationHistory.findMany({
      where: { intern_id: getRequest.intern_id, deleted_at: null },
      include: INCLUDE,
      orderBy: [{ field: "asc" }, { start_date: "asc" }],
    });
    return rows.map(toInternMutationHistoryResponse);
  }

  static async rollback(
    admin: AdminUser,
    request: RollbackInternMutationRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    const rollbackRequest = Validation.validate(
      InternMutationHistoryValidation.ROLLBACK,
      request,
    );
    await assertWriteAllowed(admin, rollbackRequest.intern_id, context, now);
    const current = await prismaClient.internMutationHistory.findFirst({
      where: {
        id: rollbackRequest.history_id,
        intern_id: rollbackRequest.intern_id,
        deleted_at: null,
      },
    });
    if (!current) throw new ResponseError(404, "Mutation history record not found");
    if (current.end_date !== null) {
      throw new ResponseError(
        400,
        "Only the current, active record for a field can be rolled back",
      );
    }
    if (!current.previous_history_id) {
      throw new ResponseError(
        400,
        "This is the earliest record for this field - there is nothing to roll back to",
      );
    }
    const previous = await prismaClient.internMutationHistory.findFirst({
      where: { id: current.previous_history_id, deleted_at: null },
    });
    if (!previous) {
      throw new ResponseError(400, "The record this would roll back to no longer exists");
    }
    const intern = await prismaClient.intern.findUnique({
      where: { id: rollbackRequest.intern_id },
      select: {
        full_name: true,
        unit_id: true,
        job_position_id: true,
        status: true,
        end_date: true,
      },
    });
    if (!intern) throw new ResponseError(404, "Intern not found");
    // A rollback can restore an earlier unit: it must be inside the scope too.
    if (previous.unit_id !== null && previous.unit_id !== intern.unit_id) {
      await assertCanWriteUnit(admin, previous.unit_id, "employee", {
        onDeny: () =>
          recordUnauthorizedAction(
            admin,
            "rollback destination",
            context,
            rollbackRequest.intern_id,
          ),
        message: "Forbidden: The unit this rollback restores is outside your unit scope",
      });
    }

    const changesEligibility =
      (previous.unit_id !== null && previous.unit_id !== intern.unit_id) ||
      (previous.job_position_id !== null &&
        previous.job_position_id !== intern.job_position_id) ||
      (previous.status !== null && previous.status !== intern.status);
    await prismaClient.$transaction(async (tx) => {
      await lockInternWorkforce(tx, rollbackRequest.intern_id);
      const nextUnitId = previous.unit_id ?? intern.unit_id;
      const nextJobPositionId =
        previous.job_position_id ?? intern.job_position_id;
      const requestedStatus = previous.status ?? intern.status;
      const nextStatus =
        requestedStatus === "ACTIVE" && intern.end_date <= now
          ? "COMPLETED"
          : requestedStatus;
      await assertJobPositionUnitCompatibleByIds(
        nextJobPositionId,
        nextUnitId,
        tx,
      );
      await assertJobPositionCapacity(tx, {
        jobPositionId: nextJobPositionId,
        unitId: nextUnitId,
        internId: rollbackRequest.intern_id,
        occupiesSlot: nextStatus === "ACTIVE",
      });
      if (changesEligibility) {
        const classAssignments = await tx.classTeacherAssignment.count({
          where: {
            intern_id: rollbackRequest.intern_id,
            end_date: null,
            deleted_at: null,
          },
        });
        const supportAssignments = await tx.studentSupportAssignment.count({
          where: {
            intern_id: rollbackRequest.intern_id,
            end_date: null,
            deleted_at: null,
          },
        });
        const mentorships = await tx.pcActivityRoomMentorAssignment.count({
          where: {
            intern_id: rollbackRequest.intern_id,
            end_date: null,
            deleted_at: null,
          },
        });
        const activeCount = classAssignments + supportAssignments + mentorships;
        if (activeCount > 0) {
          throw new ResponseError(
            400,
            `Cannot roll back this intern field while ${activeCount} active workforce assignment${activeCount === 1 ? "" : "s"} remain. End or reassign them first.`,
          );
        }
      }
      await tx.internMutationHistory.update({
        where: { id: current.id },
        data: { deleted_at: now },
      });
      const reactivated = await tx.internMutationHistory.updateMany({
        where: { id: previous.id, end_date: { not: null } },
        data: { end_date: null },
      });
      if (reactivated.count === 0) {
        throw new ResponseError(
          400,
          "The record this would roll back to is no longer available",
        );
      }
      await tx.intern.update({
        where: { id: rollbackRequest.intern_id },
        data: {
          unit_id: previous.unit_id ?? undefined,
          job_position_id: previous.job_position_id ?? undefined,
          building_id: previous.building_id ?? undefined,
          status: nextStatus,
        },
      });
      await AuditService.record(
        {
          action: AuditAction.ROLLBACK_INTERN_MUTATION,
          source: AuditSource.UI,
          entity_type: "Intern" as const,
          entity_id: rollbackRequest.intern_id,
          admin_id: admin.id,
          old_values: {
            ...mutationAuditValue(current),
            history_id: current.id,
            full_name: intern.full_name,
          },
          new_values: {
            ...mutationAuditValue(previous),
            history_id: previous.id,
            full_name: intern.full_name,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });
    return true;
  }
}
