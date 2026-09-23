import {
  AdminRole,
  AuditAction,
  AuditSource,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
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

async function assertWriteAllowed(
  admin: AdminUser,
  internId: string,
  context: AuditRequestContext,
  now: Date,
) {
  if (admin.role === AdminRole.VIEWER) {
    throw new ResponseError(403, "Forbidden: Viewer cannot modify data");
  }
  const intern = await prismaClient.intern.findFirst({
    where: { id: internId, deleted_at: null },
    select: { unit_id: true },
  });
  if (!intern) throw new ResponseError(404, "Intern not found");
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    if (!admin.can_write_employee_data) {
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to write employee data",
      );
    }
    await assertCanWriteNow(admin, context, now);
    if (intern.unit_id !== admin.unit_id) {
      throw new ResponseError(403, "Forbidden: This intern is outside your unit scope");
    }
  }
}

export class InternMutationHistoryService {
  static async getHistory(
    admin: AdminUser,
    request: GetInternMutationHistoryRequest,
  ): Promise<InternMutationHistoryResponse[]> {
    const getRequest = Validation.validate(
      InternMutationHistoryValidation.GET,
      request,
    );
    const intern = await prismaClient.intern.findFirst({
      where: { id: getRequest.intern_id, deleted_at: null },
      select: { unit_id: true },
    });
    if (!intern) throw new ResponseError(404, "Intern not found");
    if (
      admin.role !== AdminRole.SUPER_ADMIN &&
      !admin.can_view_all_units &&
      intern.unit_id !== admin.unit_id
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
        const mentorships = await tx.pCActivityDefaultMentor.count({
          where: { intern_id: rollbackRequest.intern_id },
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
            field: current.field,
            history_id: current.id,
            full_name: intern.full_name,
          },
          new_values: {
            field: previous.field,
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
