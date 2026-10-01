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
  toEmployeeMutationHistoryResponse,
  type EmployeeMutationHistoryResponse,
  type GetEmployeeMutationHistoryRequest,
  type RollbackEmployeeMutationRequest,
} from "../model/employee-mutation-history-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { EmployeeMutationHistoryValidation } from "../validation/employee-mutation-history-validation";
import { Validation } from "../validation/validation";
import { assertJobPositionCapacity } from "../utils/job-position-capacity";
import {
  assertJobPositionJobLevelCompatibleByIds,
  assertJobPositionUnitCompatibleByIds,
  assertUnitJobLevelCompatibleByIds,
} from "../utils/employee-role-rules";

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
    entity_type: "Employee",
    entity_id: employeeId,
    new_values: {
      reason: `blocked employee mutation history ${action}`,
      employee_id: employeeId,
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

// Mutation rollback uses the standard employee write gate.
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
    const employee = await prismaClient.employee.findFirst({
      where: { id: employeeId, deleted_at: null },
      select: { unit_id: true },
    });
    if (!employee) throw new ResponseError(404, "Employee not found");
    await assertCanWriteUnit(admin, employee.unit_id, "employee", {
      onDeny: () => recordUnauthorizedAction(admin, action, context, employeeId),
      message: "Forbidden: This employee is outside your unit scope",
    });
  }
}

function mutationAuditValue(row: {
  field: string;
  unit_id: string | null;
  job_position_id: string | null;
  job_level_id: string | null;
  building_id: string | null;
  status: string | null;
  employment_type: string | null;
}) {
  const key = row.field.toLowerCase();
  return {
    field: row.field,
    [key === "unit" || key === "job_position" || key === "job_level" || key === "building"
      ? `${key}_id`
      : key]:
      row.unit_id ??
      row.job_position_id ??
      row.job_level_id ??
      row.building_id ??
      row.status ??
      row.employment_type,
  };
}

export class EmployeeMutationHistoryService {
  static async getHistory(
    admin: AdminUserWithEmployeeScope,
    request: GetEmployeeMutationHistoryRequest,
  ): Promise<EmployeeMutationHistoryResponse[]> {
    assertCanViewEmployeeData(admin);
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

    const employeeUnitScope = resolveEmployeeUnitScope(admin);
    if (
      employeeUnitScope !== undefined &&
      !employeeUnitScope.includes(employee.unit_id)
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

    // A rollback can restore an earlier unit: it must be inside the scope too.
    if (previous.unit_id !== null) {
      await assertCanWriteUnit(admin, previous.unit_id, "employee", {
        onDeny: () =>
          recordUnauthorizedAction(
            admin,
            "rollback destination",
            context,
            rollbackRequest.employee_id,
          ),
        message: "Forbidden: The unit this rollback restores is outside your unit scope",
      });
    }

    // Include the employee name as the audit entity label.
    const employee = await prismaClient.employee.findUnique({
      where: { id: rollbackRequest.employee_id },
      select: {
        unit_id: true,
        job_position_id: true,
        job_level_id: true,
        status: true,
        contract_end_date: true,
        last_working_date: true,
        person: { select: { full_name: true } },
      },
    });

    await prismaClient.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`employee-mutation:${rollbackRequest.employee_id}`}, 0))`;
      const nextUnitId = previous.unit_id ?? employee?.unit_id;
      const nextJobPositionId =
        previous.job_position_id ?? employee?.job_position_id;
      const nextJobLevelId = previous.job_level_id ?? employee?.job_level_id;
      const requestedStatus = previous.status ?? employee?.status;
      const nextStatus =
        requestedStatus &&
        ((employee?.last_working_date && employee.last_working_date <= now) ||
          (employee?.contract_end_date && employee.contract_end_date <= now))
          ? "RESIGNED"
          : requestedStatus;
      if (nextUnitId && nextJobPositionId && nextStatus) {
        if (nextJobLevelId) {
          await assertUnitJobLevelCompatibleByIds(nextUnitId, nextJobLevelId);
          await assertJobPositionJobLevelCompatibleByIds(
            nextJobPositionId,
            nextJobLevelId,
          );
        }
        await assertJobPositionUnitCompatibleByIds(
          nextJobPositionId,
          nextUnitId,
          tx,
        );
        await assertJobPositionCapacity(tx, {
          jobPositionId: nextJobPositionId,
          unitId: nextUnitId,
          employeeId: rollbackRequest.employee_id,
          occupiesSlot: ["ACTIVE", "ON_LEAVE"].includes(nextStatus),
        });
      }
      const changesAssignmentEligibility =
        (previous.unit_id !== null && previous.unit_id !== employee?.unit_id) ||
        (previous.job_position_id !== null &&
          previous.job_position_id !== employee?.job_position_id) ||
        (previous.status !== null && previous.status !== employee?.status);
      if (changesAssignmentEligibility) {
        const classAssignments = await tx.classTeacherAssignment.count({
          where: {
            employee_id: rollbackRequest.employee_id,
            end_date: null,
            deleted_at: null,
          },
        });
        const supportAssignments = await tx.studentSupportAssignment.count({
          where: {
            employee_id: rollbackRequest.employee_id,
            end_date: null,
            deleted_at: null,
          },
        });
        const mentorships = await tx.pcActivityRoomMentorAssignment.count({
          where: {
            employee_id: rollbackRequest.employee_id,
            end_date: null,
            deleted_at: null,
          },
        });
        const activeCount = classAssignments + supportAssignments + mentorships;
        if (activeCount > 0) {
          throw new ResponseError(
            400,
            `Cannot roll back this employee field while ${activeCount} active workforce assignment${activeCount === 1 ? "" : "s"} remain. End or reassign them first.`,
          );
        }
      }
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
          status: nextStatus ?? undefined,
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
          old_values: {
            ...mutationAuditValue(current),
            history_id: current.id,
            full_name: employee?.person.full_name ?? null,
          },
          new_values: {
            ...mutationAuditValue(previous),
            history_id: previous.id,
            full_name: employee?.person.full_name ?? null,
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
