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
  toEmployeeMutationHistoryResponse,
  type EmployeeMutationHistoryResponse,
  type GetEmployeeMutationHistoryRequest,
  type RollbackEmployeeMutationRequest,
} from "../model/employee-mutation-history-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { assertEmployeeInAdminUnit } from "../utils/sensitive-data";
import { EmployeeMutationHistoryValidation } from "../validation/employee-mutation-history-validation";
import { Validation } from "../validation/validation";

const MUTATION_HISTORY_INCLUDE = {
  unit: true,
  job_position: true,
  job_level: true,
  building: true,
} as const;

async function recordUnauthorizedAction(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
  employeeId: string,
): Promise<void> {
  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    new_values: {
      reason: `blocked employee mutation history ${action}`,
      employee_id: employeeId,
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

// Same tier as a normal employee field edit - unit/job_position/job_level/
// building/status aren't PII (unlike NIK/NPWP/bank/BPJS), so this doesn't
// need can_view_employee_pii, just the standard write gate.
async function assertWriteAllowed(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
  now: Date,
  employeeId: string,
): Promise<void> {
  if (admin.role === AdminRole.VIEWER) {
    await recordUnauthorizedAction(admin, action, context, employeeId);
    throw new ResponseError(403, "Forbidden: Viewer cannot modify data");
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    if (!admin.can_write_employee_data) {
      await recordUnauthorizedAction(admin, action, context, employeeId);
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to write employee data",
      );
    }
    await assertCanWriteNow(admin, context, now);
    await assertEmployeeInAdminUnit(admin, employeeId, context);
  }
}

export class EmployeeMutationHistoryService {
  static async getHistory(
    admin: AdminUser,
    request: GetEmployeeMutationHistoryRequest,
  ): Promise<EmployeeMutationHistoryResponse[]> {
    const getRequest = Validation.validate(
      EmployeeMutationHistoryValidation.GET,
      request,
    );

    const employee = await prismaClient.employee.findFirst({
      where: { id: getRequest.employee_id, deleted_at: null },
      select: { unit_id: true },
    });
    if (!employee) {
      throw new ResponseError(404, "Employee not found");
    }

    if (
      admin.role !== AdminRole.SUPER_ADMIN &&
      !admin.can_view_all_units &&
      employee.unit_id !== admin.unit_id
    ) {
      throw new ResponseError(404, "Employee not found");
    }

    const rows = await prismaClient.employeeMutationHistory.findMany({
      where: { employee_id: getRequest.employee_id, deleted_at: null },
      include: MUTATION_HISTORY_INCLUDE,
      orderBy: [{ field: "asc" }, { start_date: "asc" }],
    });

    return rows.map(toEmployeeMutationHistoryResponse);
  }

  static async rollback(
    admin: AdminUser,
    request: RollbackEmployeeMutationRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    const rollbackRequest = Validation.validate(
      EmployeeMutationHistoryValidation.ROLLBACK,
      request,
    );

    await assertWriteAllowed(
      admin,
      "rollback",
      context,
      now,
      rollbackRequest.employee_id,
    );

    const current = await prismaClient.employeeMutationHistory.findFirst({
      where: {
        id: rollbackRequest.history_id,
        employee_id: rollbackRequest.employee_id,
        deleted_at: null,
      },
    });
    if (!current) {
      throw new ResponseError(404, "Mutation history record not found");
    }
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

    const previous = await prismaClient.employeeMutationHistory.findFirst({
      where: { id: current.previous_history_id, deleted_at: null },
    });
    if (!previous) {
      throw new ResponseError(
        400,
        "The record this would roll back to no longer exists",
      );
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.employeeMutationHistory.update({
        where: { id: current.id },
        data: { deleted_at: now },
      });

      const reactivated = await tx.employeeMutationHistory.updateMany({
        where: { id: previous.id, end_date: { not: null } },
        data: { end_date: null },
      });
      if (reactivated.count === 0) {
        throw new ResponseError(
          400,
          "The record this would roll back to is no longer available",
        );
      }

      await tx.employee.update({
        where: { id: rollbackRequest.employee_id },
        data: {
          unit_id: previous.unit_id ?? undefined,
          job_position_id: previous.job_position_id ?? undefined,
          job_level_id: previous.job_level_id ?? undefined,
          building_id: previous.building_id ?? undefined,
          status: previous.status ?? undefined,
          employment_type: previous.employment_type ?? undefined,
        },
      });

      await AuditService.record(
        {
          action: AuditAction.ROLLBACK_EMPLOYEE_MUTATION,
          source: AuditSource.UI,
          entity_type: "Employee",
          entity_id: rollbackRequest.employee_id,
          admin_id: admin.id,
          old_values: { field: current.field, history_id: current.id },
          new_values: { field: previous.field, history_id: previous.id },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    return true;
  }
}
