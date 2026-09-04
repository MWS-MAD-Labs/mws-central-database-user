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
  toPCActivityMentorMutationHistoryResponse,
  type GetPCActivityMentorMutationHistoryRequest,
  type ListPCActivityMentorMutationHistoryForEmployeeRequest,
  type PCActivityMentorMutationHistoryResponse,
  type RollbackPCActivityMentorMutationRequest,
} from "../model/pc-activity-mentor-mutation-history-model";
import { AuditService } from "./audit-service";
import { PCActivityMentorMutationHistoryValidation } from "../validation/pc-activity-mentor-mutation-history-validation";
import { Validation } from "../validation/validation";

const HISTORY_INCLUDE = {
  activity: true,
  unit: true,
  mentor: { include: { person: true } },
} as const;

async function recordUnauthorizedAction(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
  activityId: string,
): Promise<void> {
  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    new_values: {
      reason: `blocked pc activity mentor mutation history ${action}`,
      activity_id: activityId,
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

export class PCActivityMentorMutationHistoryService {
  // Read is unauthenticated-beyond-login, same as
  // PCActivityDefaultMentorService.list() - no unit scoping, since a
  // default mentor is master data, not sensitive per-employee data.
  static async getHistory(
    admin: AdminUser,
    request: GetPCActivityMentorMutationHistoryRequest,
  ): Promise<PCActivityMentorMutationHistoryResponse[]> {
    const getRequest = Validation.validate(
      PCActivityMentorMutationHistoryValidation.GET,
      request,
    );

    // Same posture as PCActivityDefaultMentorService.list() - a
    // DATABASE_ADMIN without can_view_all_units only sees their own unit's
    // history, not every unit's mentor changes for this activity.
    const unitScope =
      admin.role === AdminRole.DATABASE_ADMIN && !admin.can_view_all_units
        ? admin.unit_id
        : undefined;

    const rows = await prismaClient.pCActivityMentorMutationHistory.findMany({
      where: {
        activity_id: getRequest.activity_id,
        deleted_at: null,
        ...(unitScope ? { unit_id: unitScope } : {}),
      },
      include: HISTORY_INCLUDE,
      orderBy: [{ unit: { name: "asc" } }, { start_date: "asc" }],
    });

    return rows.map(toPCActivityMentorMutationHistoryResponse);
  }

  // Every activity/unit this employee has ever been the default mentor for,
  // past and present - shown on their Employee detail page alongside
  // Teaching Assignments, same "read-only, past and present, with dates"
  // shape as that panel (unlike PCActivityDefaultMentorService.listForEmployee,
  // which only has current rows and no dates). Not unit-scoped, same as
  // getHistory() being read-only master data.
  static async listForEmployee(
    admin: AdminUser,
    request: ListPCActivityMentorMutationHistoryForEmployeeRequest,
  ): Promise<PCActivityMentorMutationHistoryResponse[]> {
    void admin;

    const listRequest = Validation.validate(
      PCActivityMentorMutationHistoryValidation.LIST_FOR_EMPLOYEE,
      request,
    );

    const rows = await prismaClient.pCActivityMentorMutationHistory.findMany({
      where: {
        mentor_id: listRequest.employee_id,
        deleted_at: null,
      },
      include: HISTORY_INCLUDE,
      orderBy: [{ activity: { name: "asc" } }, { start_date: "asc" }],
    });

    return rows.map(toPCActivityMentorMutationHistoryResponse);
  }

  static async rollback(
    admin: AdminUser,
    request: RollbackPCActivityMentorMutationRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedAction(
        admin,
        "rollback",
        context,
        request.activity_id,
      );
      throw new ResponseError(
        403,
        "Forbidden: Viewer cannot roll back a PC activity mentor change",
      );
    }

    const rollbackRequest = Validation.validate(
      PCActivityMentorMutationHistoryValidation.ROLLBACK,
      request,
    );

    const current = await prismaClient.pCActivityMentorMutationHistory.findFirst(
      {
        where: {
          id: rollbackRequest.history_id,
          activity_id: rollbackRequest.activity_id,
          deleted_at: null,
        },
      },
    );
    if (!current) {
      throw new ResponseError(404, "Mutation history record not found");
    }

    // Unit-locked, same as set()/clear() - a DATABASE_ADMIN can only roll
    // back a change within their own unit.
    if (
      admin.role === AdminRole.DATABASE_ADMIN &&
      current.unit_id !== admin.unit_id
    ) {
      await recordUnauthorizedAction(
        admin,
        "rollback",
        context,
        rollbackRequest.activity_id,
      );
      throw new ResponseError(
        403,
        "Forbidden: You can only roll back a change within your own unit",
      );
    }

    if (current.end_date !== null) {
      throw new ResponseError(
        400,
        "Only the current, active record for a unit can be rolled back",
      );
    }
    if (!current.previous_history_id) {
      throw new ResponseError(
        400,
        "This is the earliest record for this unit - there is nothing to roll back to",
      );
    }

    const previous = await prismaClient.pCActivityMentorMutationHistory.findFirst(
      { where: { id: current.previous_history_id, deleted_at: null } },
    );
    if (!previous) {
      throw new ResponseError(
        400,
        "The record this would roll back to no longer exists",
      );
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.pCActivityMentorMutationHistory.update({
        where: { id: current.id },
        data: { deleted_at: now },
      });

      const reactivated = await tx.pCActivityMentorMutationHistory.updateMany(
        {
          where: { id: previous.id, end_date: { not: null } },
          data: { end_date: null },
        },
      );
      if (reactivated.count === 0) {
        throw new ResponseError(
          400,
          "The record this would roll back to is no longer available",
        );
      }

      // Live PCActivityDefaultMentor row mirrors previous.mentor_id - null
      // means the rollback target itself was "no mentor" (a previously
      // recorded clear()), so the live row gets deleted rather than updated
      // to a null mentor_id (mentor_id is required on that model).
      if (previous.mentor_id) {
        await tx.pCActivityDefaultMentor.upsert({
          where: {
            activity_id_unit_id: {
              activity_id: rollbackRequest.activity_id,
              unit_id: current.unit_id,
            },
          },
          create: {
            activity_id: rollbackRequest.activity_id,
            unit_id: current.unit_id,
            mentor_id: previous.mentor_id,
          },
          update: { mentor_id: previous.mentor_id },
        });
      } else {
        await tx.pCActivityDefaultMentor.deleteMany({
          where: {
            activity_id: rollbackRequest.activity_id,
            unit_id: current.unit_id,
          },
        });
      }

      await AuditService.record(
        {
          action: AuditAction.ROLLBACK_PC_ACTIVITY_MENTOR_MUTATION,
          source: AuditSource.UI,
          entity_type: "PCActivityDefaultMentor",
          entity_id: rollbackRequest.activity_id,
          admin_id: admin.id,
          old_values: { unit_id: current.unit_id, history_id: current.id },
          new_values: { unit_id: previous.unit_id, history_id: previous.id },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    return true;
  }
}
