import {
  AdminRole,
  AuditAction,
  AuditSource,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import {
  assertCanViewStudentData,
  resolveStudentUnitScope,
  type AdminUserWithStudentScope,
} from "../utils/admin-permissions";
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
  class: true,
  current_grade: true,
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
    entity_type: "Student",
    entity_id: studentId,
    new_values: {
      reason: `blocked student mutation history ${action}`,
      student_id: studentId,
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

// Mutation rollback uses the standard student write gate.
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
    admin: AdminUserWithStudentScope,
    request: GetStudentMutationHistoryRequest,
  ): Promise<StudentMutationHistoryResponse[]> {
    assertCanViewStudentData(admin);
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

    const studentUnitScope = resolveStudentUnitScope(admin);
    if (
      studentUnitScope !== undefined &&
      !studentUnitScope.includes(student.current_grade.unit_id)
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
    if (current.field === "CURRENT_CLASS") {
      throw new ResponseError(
        400,
        "Class changes can't be rolled back here - use Transfer to move the student back to a previous class.",
      );
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

    // Include the student name as the audit entity label.
    const student = await prismaClient.student.findUnique({
      where: { id: rollbackRequest.student_id },
      select: { person: { select: { full_name: true } } },
    });

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
          current_grade_id: previous.current_grade_id ?? undefined,
          // Restore the override reason tied to the historical value.
          grade_consistency_override_reason:
            previous.grade_consistency_override_reason,
        },
      });

      await AuditService.record(
        {
          action: AuditAction.ROLLBACK_STUDENT_MUTATION,
          source: AuditSource.UI,
          entity_type: "Student",
          entity_id: rollbackRequest.student_id,
          admin_id: admin.id,
          old_values: {
            field: current.field,
            history_id: current.id,
            full_name: student?.person.full_name ?? null,
          },
          new_values: {
            field: previous.field,
            history_id: previous.id,
            full_name: student?.person.full_name ?? null,
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
