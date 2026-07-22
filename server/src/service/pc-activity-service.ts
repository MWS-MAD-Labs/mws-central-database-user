import {
  AcademicYearStatus,
  AdminRole,
  AuditAction,
  AuditSource,
  EmployeeStatus,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toPCActivityAuditSnapshot,
  toPCActivityResponse,
  type CreatePCActivityRequest,
  type DeletePCActivityRequest,
  type GetPCActivityListRequest,
  type PCActivityResponse,
  type RestorePCActivityRequest,
  type UpdatePCActivityRequest,
} from "../model/pc-activity-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import { PCActivityValidation } from "../validation/pc-activity-validation";
import { Validation } from "../validation/validation";

const DUPLICATE_PC_ACTIVITY_MESSAGE =
  "This student already has a PC activity recorded for this day and academic year.";

function rethrowAsFriendlyPCActivityConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (
    fields?.includes("student_id") ||
    fields?.includes("day") ||
    fields?.includes("academic_year_id")
  ) {
    throw new ResponseError(400, DUPLICATE_PC_ACTIVITY_MESSAGE);
  }
  throw error;
}

function assertWriteAllowed(
  admin: AdminUser,
  context: AuditRequestContext,
  now: Date,
): Promise<void> | void {
  if (admin.role === AdminRole.VIEWER) {
    throw new ResponseError(403, "Forbidden: Viewer cannot modify data");
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    if (!admin.can_write_data) {
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to modify data",
      );
    }
    return assertCanWriteNow(admin, context, now);
  }
}

async function assertStudentExists(
  studentId: string,
  requireActive = false,
): Promise<void> {
  const student = await prismaClient.student.findFirst({
    where: {
      id: studentId,
      deleted_at: requireActive ? null : undefined,
    },
  });
  if (!student) {
    throw new ResponseError(404, "Student not found");
  }
}

async function resolveActiveAcademicYearId(
  academicYearId?: string,
): Promise<string> {
  if (academicYearId) return academicYearId;

  // DB enforces at most one ACTIVE row (academic_years_single_active_idx)
  const active = await prismaClient.academicYear.findFirst({
    where: { status: AcademicYearStatus.ACTIVE },
  });
  if (!active) {
    throw new ResponseError(
      400,
      "No active academic year found. Please specify academic_year_id explicitly.",
    );
  }
  return active.id;
}

async function assertMentorIsEligible(mentorId: string): Promise<void> {
  const mentor = await prismaClient.employee.findUnique({
    where: { id: mentorId },
    select: {
      status: true,
      deleted_at: true,
      job_level: { select: { is_teaching_role: true } },
    },
  });
  if (
    !mentor ||
    mentor.deleted_at !== null ||
    mentor.status !== EmployeeStatus.ACTIVE ||
    !mentor.job_level.is_teaching_role
  ) {
    throw new ResponseError(
      400,
      "Invalid mentor: referenced employee does not exist, is not active, or does not hold a teaching-eligible job level",
    );
  }
}

export class PCActivityService {
  static async create(
    admin: AdminUser,
    request: CreatePCActivityRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<PCActivityResponse> {
    await assertWriteAllowed(admin, context, now);

    const createRequest = Validation.validate(
      PCActivityValidation.CREATE,
      request,
    );

    await assertStudentExists(createRequest.student_id, true);
    if (createRequest.mentor_id) {
      await assertMentorIsEligible(createRequest.mentor_id);
    }
    const academicYearId = await resolveActiveAcademicYearId(
      createRequest.academic_year_id,
    );

    let created;
    try {
      created = await prismaClient.passionConnectionActivity.create({
        data: {
          student_id: createRequest.student_id,
          day: createRequest.day,
          activity: createRequest.activity,
          mentor_id: createRequest.mentor_id,
          academic_year_id: academicYearId,
        },
      });
    } catch (error) {
      rethrowAsFriendlyPCActivityConflict(error);
    }

    await AuditService.record({
      action: AuditAction.CREATE_PC_ACTIVITY,
      source: AuditSource.UI,
      entity_type: "PassionConnectionActivity",
      entity_id: created.id,
      admin_id: admin.id,
      new_values: toPCActivityAuditSnapshot(created),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toPCActivityResponse(created);
  }

  static async update(
    admin: AdminUser,
    request: UpdatePCActivityRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<PCActivityResponse> {
    await assertWriteAllowed(admin, context, now);

    const updateRequest = Validation.validate(
      PCActivityValidation.UPDATE,
      request,
    );

    await assertStudentExists(updateRequest.student_id, true);

    const existing = await prismaClient.passionConnectionActivity.findFirst({
      where: { id: updateRequest.id, student_id: updateRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "PC activity not found");
    }
    if (existing.deleted_at !== null) {
      throw new ResponseError(
        400,
        "Cannot update a deleted PC activity. Restore it first.",
      );
    }

    if (updateRequest.mentor_id) {
      await assertMentorIsEligible(updateRequest.mentor_id);
    }

    const updated = await prismaClient.passionConnectionActivity.update({
      where: { id: existing.id },
      data: {
        activity: updateRequest.activity,
        mentor_id: updateRequest.mentor_id,
      },
    });

    await AuditService.record({
      action: AuditAction.UPDATE_PC_ACTIVITY,
      source: AuditSource.UI,
      entity_type: "PassionConnectionActivity",
      entity_id: updated.id,
      admin_id: admin.id,
      old_values: toPCActivityAuditSnapshot(existing),
      new_values: toPCActivityAuditSnapshot(updated),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toPCActivityResponse(updated);
  }

  static async remove(
    admin: AdminUser,
    request: DeletePCActivityRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete PC activity data",
      );
    }

    const deleteRequest = Validation.validate(
      PCActivityValidation.DELETE,
      request,
    );

    const existing = await prismaClient.passionConnectionActivity.findFirst({
      where: { id: deleteRequest.id, student_id: deleteRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "PC activity not found");
    }
    if (existing.deleted_at !== null) {
      throw new ResponseError(400, "PC activity is already deleted");
    }

    const deletedAt = new Date();
    await prismaClient.passionConnectionActivity.update({
      where: { id: existing.id },
      data: { deleted_at: deletedAt },
    });

    await AuditService.record({
      action: AuditAction.DELETE_PC_ACTIVITY,
      source: AuditSource.UI,
      entity_type: "PassionConnectionActivity",
      entity_id: existing.id,
      admin_id: admin.id,
      old_values: toPCActivityAuditSnapshot(existing),
      new_values: { deleted_at: deletedAt.toISOString() },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return true;
  }

  static async restore(
    admin: AdminUser,
    request: RestorePCActivityRequest,
    context: AuditRequestContext = {},
  ): Promise<PCActivityResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can restore PC activity data",
      );
    }

    const restoreRequest = Validation.validate(
      PCActivityValidation.RESTORE,
      request,
    );

    const existing = await prismaClient.passionConnectionActivity.findFirst({
      where: { id: restoreRequest.id, student_id: restoreRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "PC activity not found");
    }
    if (existing.deleted_at === null) {
      throw new ResponseError(
        400,
        "PC activity is not in the trash bin. It might be active or permanently deleted.",
      );
    }

    const restored = await prismaClient.passionConnectionActivity.update({
      where: { id: existing.id },
      data: { deleted_at: null },
    });

    await AuditService.record({
      action: AuditAction.UPDATE_PC_ACTIVITY,
      source: AuditSource.UI,
      entity_type: "PassionConnectionActivity",
      entity_id: restored.id,
      admin_id: admin.id,
      old_values: { deleted_at: existing.deleted_at.toISOString() },
      new_values: { deleted_at: null },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toPCActivityResponse(restored);
  }

  static async getList(
    admin: AdminUser,
    request: GetPCActivityListRequest,
  ): Promise<PCActivityResponse[]> {
    void admin;

    const listRequest = Validation.validate(
      PCActivityValidation.GET_LIST,
      request,
    );

    await assertStudentExists(listRequest.student_id);

    const activities = await prismaClient.passionConnectionActivity.findMany({
      where: {
        student_id: listRequest.student_id,
        deleted_at: listRequest.is_deleted ? { not: null } : null,
      },
      orderBy: { day: "asc" },
    });

    return activities.map(toPCActivityResponse);
  }
}
