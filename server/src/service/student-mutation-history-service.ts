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
  toStudentMutationHistoryResponse,
  type StudentMutationHistoryResponse,
  type GetStudentMutationHistoryRequest,
  type RollbackStudentMutationRequest,
} from "../model/student-mutation-history-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { assertStudentInAdminUnit } from "../utils/sensitive-data";
import { StudentMutationHistoryValidation } from "../validation/student-mutation-history-validation";
import { Validation } from "../validation/validation";

const MUTATION_HISTORY_INCLUDE = {
  join_grade: true,
  join_academic_year: true,
} as const;

async function recordUnauthorizedAction(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
  studentId: string,
): Promise<void> {
  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    new_values: {
      reason: `blocked student mutation history ${action}`,
      student_id: studentId,
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

// Same tier as a normal student field edit - join_grade/join_academic_year/
// entry_type aren't sensitive/PII, so this doesn't need the sensitive-data
// gate, just the standard write gate.
async function assertWriteAllowed(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
  now: Date,
  studentId: string,
): Promise<void> {
  if (admin.role === AdminRole.VIEWER) {
    await recordUnauthorizedAction(admin, action, context, studentId);
    throw new ResponseError(403, "Forbidden: Viewer cannot modify data");
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    if (!admin.can_write_data) {
      await recordUnauthorizedAction(admin, action, context, studentId);
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to modify data",
      );
    }
    if (!admin.can_write_student_data) {
      await recordUnauthorizedAction(admin, action, context, studentId);
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to write student data",
      );
    }
    await assertCanWriteNow(admin, context, now);
    await assertStudentInAdminUnit(admin, studentId, context);
  }
}

export class StudentMutationHistoryService {
  static async getHistory(
    admin: AdminUser,
    request: GetStudentMutationHistoryRequest,
  ): Promise<StudentMutationHistoryResponse[]> {
    const getRequest = Validation.validate(
      StudentMutationHistoryValidation.GET,
      request,
    );

    const student = await prismaClient.student.findFirst({
      where: { id: getRequest.student_id, deleted_at: null },
      select: { current_grade: { select: { unit_id: true } } },
    });
    if (!student) {
      throw new ResponseError(404, "Student not found");
    }

    if (
      admin.role !== AdminRole.SUPER_ADMIN &&
      !admin.can_view_all_units &&
      student.current_grade.unit_id !== admin.unit_id
    ) {
      throw new ResponseError(404, "Student not found");
    }

    const rows = await prismaClient.studentMutationHistory.findMany({
      where: { student_id: getRequest.student_id, deleted_at: null },
      include: MUTATION_HISTORY_INCLUDE,
      orderBy: [{ field: "asc" }, { start_date: "asc" }],
    });

    return rows.map(toStudentMutationHistoryResponse);
  }

  static async rollback(
    admin: AdminUser,
    request: RollbackStudentMutationRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    const rollbackRequest = Validation.validate(
      StudentMutationHistoryValidation.ROLLBACK,
      request,
    );

    await assertWriteAllowed(
      admin,
      "rollback",
      context,
      now,
      rollbackRequest.student_id,
    );

    const current = await prismaClient.studentMutationHistory.findFirst({
      where: {
        id: rollbackRequest.history_id,
        student_id: rollbackRequest.student_id,
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

    const previous = await prismaClient.studentMutationHistory.findFirst({
      where: { id: current.previous_history_id, deleted_at: null },
    });
    if (!previous) {
      throw new ResponseError(
        400,
        "The record this would roll back to no longer exists",
      );
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.studentMutationHistory.update({
        where: { id: current.id },
        data: { deleted_at: now },
      });

      const reactivated = await tx.studentMutationHistory.updateMany({
        where: { id: previous.id, end_date: { not: null } },
        data: { end_date: null },
      });
      if (reactivated.count === 0) {
        throw new ResponseError(
          400,
          "The record this would roll back to is no longer available",
        );
      }

      await tx.student.update({
        where: { id: rollbackRequest.student_id },
        data: {
          join_grade_id: previous.join_grade_id ?? undefined,
          join_academic_year_id: previous.join_academic_year_id ?? undefined,
          entry_type: previous.entry_type ?? undefined,
        },
      });

      await AuditService.record(
        {
          action: AuditAction.ROLLBACK_STUDENT_MUTATION,
          source: AuditSource.UI,
          entity_type: "Student",
          entity_id: rollbackRequest.student_id,
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
