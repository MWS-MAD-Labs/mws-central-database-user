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
  toMasterPCActivityAuditSnapshot,
  toMasterPCActivityResponse,
  toPCActivityAuditSnapshot,
  toPCActivityResponse,
  type CreateMasterPCActivityRequest,
  type CreatePCActivityRequest,
  type DeleteMasterPCActivityRequest,
  type DeletePCActivityRequest,
  type GetMasterPCActivityRequest,
  type GetPCActivityListRequest,
  type MasterPCActivityResponse,
  type PCActivityResponse,
  type RestorePCActivityRequest,
  type SearchMasterPCActivityRequest,
  type UpdateMasterPCActivityRequest,
  type UpdatePCActivityRequest,
} from "../model/pc-activity-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { assertStudentInAdminUnit } from "../utils/sensitive-data";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import {
  MasterPCActivityValidation,
  PCActivityValidation,
} from "../validation/pc-activity-validation";
import { Validation } from "../validation/validation";
import { paginate, type Pageable } from "../model/page-model";

const DUPLICATE_PC_ACTIVITY_MESSAGE =
  "This student already has a PC activity recorded for this day and academic year.";

// Exported so import preview can flag this ahead of time (reusing the exact
// wording) instead of only discovering it once commit tries to create the
// activity and hits resolveActiveAcademicYearId() below.
export const NO_ACTIVE_ACADEMIC_YEAR_MESSAGE =
  "No active academic year found. Please specify academic_year_id explicitly.";

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

async function assertWriteAllowed(
  admin: AdminUser,
  context: AuditRequestContext,
  now: Date,
  studentId?: string,
): Promise<void> {
  if (admin.role === AdminRole.VIEWER) {
    throw new ResponseError(403, "Forbidden: Viewer cannot modify data");
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    if (!admin.can_write_student_data) {
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to write student data",
      );
    }
    await assertCanWriteNow(admin, context, now);
    if (studentId) {
      await assertStudentInAdminUnit(admin, studentId, context);
    }
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
    throw new ResponseError(400, NO_ACTIVE_ACADEMIC_YEAR_MESSAGE);
  }
  return active.id;
}

// Returns the activity (rather than just asserting it exists) so callers
// can read default_mentor_id off it without a second round-trip.
async function getActivityOrThrow(
  activityId: string,
): Promise<{ id: string; default_mentor_id: string | null }> {
  const activity = await prismaClient.masterPCActivity.findUnique({
    where: { id: activityId },
    select: { id: true, default_mentor_id: true },
  });
  if (!activity) {
    throw new ResponseError(400, "Invalid PC activity: activity not found");
  }
  return activity;
}

// Exported for PCActivityMasterService (master-data-service.ts) - a master
// activity's default_mentor_id needs the exact same eligibility check as a
// per-student assignment's mentor_id.
export async function assertMentorIsEligible(mentorId: string): Promise<void> {
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
    await assertWriteAllowed(admin, context, now, request.student_id);

    const createRequest = Validation.validate(
      PCActivityValidation.CREATE,
      request,
    );

    await assertStudentExists(createRequest.student_id, true);
    const activity = await getActivityOrThrow(createRequest.activity_id);
    if (createRequest.mentor_id) {
      await assertMentorIsEligible(createRequest.mentor_id);
    }
    // Only a starting suggestion for a brand-new assignment - an explicit
    // mentor_id always wins, and this never overrides one already on file
    // (see update() below, which leaves mentor_id untouched unless asked).
    const mentorId = createRequest.mentor_id ?? activity.default_mentor_id ?? undefined;
    const academicYearId = await resolveActiveAcademicYearId(
      createRequest.academic_year_id,
    );

    let createdId;
    try {
      createdId = await prismaClient.$transaction(async (tx) => {
        const newActivity = await tx.passionConnectionActivity.create({
          data: {
            student_id: createRequest.student_id,
            day: createRequest.day,
            activity_id: createRequest.activity_id,
            mentor_id: mentorId,
            academic_year_id: academicYearId,
          },
        });

        await AuditService.record(
          {
            action: AuditAction.CREATE_PC_ACTIVITY,
            source: AuditSource.UI,
            entity_type: "PassionConnectionActivity",
            entity_id: newActivity.id,
            admin_id: admin.id,
            new_values: toPCActivityAuditSnapshot(newActivity),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return newActivity.id;
      });
    } catch (error) {
      rethrowAsFriendlyPCActivityConflict(error);
    }

    const created = await prismaClient.passionConnectionActivity.findUniqueOrThrow({
      where: { id: createdId },
      include: { activity: true },
    });
    return toPCActivityResponse(created);
  }

  // Closes the current row (soft-delete) and creates a new one, rather than
  // editing activity_id/mentor_id in place - mirrors StudentSupportAssignment
  // (SE)'s assign()/end() pattern, so a mentor/activity reassignment leaves
  // a queryable trail (getList({ is_deleted: true }) - same "Show Deleted"
  // toggle the UI already has) instead of only a generic AuditLog snapshot.
  // Safe under the partial unique index (student_id, day, academic_year_id)
  // WHERE deleted_at IS NULL - only the new row is ever "active" at once.
  static async update(
    admin: AdminUser,
    request: UpdatePCActivityRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<PCActivityResponse> {
    await assertWriteAllowed(admin, context, now, request.student_id);

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

    const nextActivityId = updateRequest.activity_id ?? existing.activity_id;
    const nextMentorId =
      updateRequest.mentor_id !== undefined
        ? updateRequest.mentor_id
        : existing.mentor_id;

    if (updateRequest.activity_id) {
      await getActivityOrThrow(updateRequest.activity_id);
    }
    if (nextMentorId) {
      await assertMentorIsEligible(nextMentorId);
    }

    if (
      nextActivityId === existing.activity_id &&
      nextMentorId === existing.mentor_id
    ) {
      throw new ResponseError(
        400,
        "No changes to apply - activity and mentor are already set to these values",
      );
    }

    let newId: string;
    try {
      newId = await prismaClient.$transaction(async (tx) => {
        await tx.passionConnectionActivity.update({
          where: { id: existing.id },
          data: { deleted_at: now },
        });

        const newActivity = await tx.passionConnectionActivity.create({
          data: {
            student_id: existing.student_id,
            day: existing.day,
            activity_id: nextActivityId,
            mentor_id: nextMentorId,
            academic_year_id: existing.academic_year_id,
          },
        });

        await AuditService.record(
          {
            action: AuditAction.UPDATE_PC_ACTIVITY,
            source: AuditSource.UI,
            entity_type: "PassionConnectionActivity",
            entity_id: newActivity.id,
            admin_id: admin.id,
            old_values: toPCActivityAuditSnapshot(existing),
            new_values: toPCActivityAuditSnapshot(newActivity),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return newActivity.id;
      });
    } catch (error) {
      rethrowAsFriendlyPCActivityConflict(error);
    }

    const updated = await prismaClient.passionConnectionActivity.findUniqueOrThrow({
      where: { id: newId },
      include: { activity: true },
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
    await prismaClient.$transaction(async (tx) => {
      await tx.passionConnectionActivity.update({
        where: { id: existing.id },
        data: { deleted_at: deletedAt },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_PC_ACTIVITY,
          source: AuditSource.UI,
          entity_type: "PassionConnectionActivity",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: toPCActivityAuditSnapshot(existing),
          new_values: { deleted_at: deletedAt.toISOString() },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
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

    // update() now closes-and-recreates on every reassignment (see above),
    // so the trash bin can hold several past rows for the same
    // (student, day, academic_year) - restoring one while a newer row is
    // already active for that same slot hits the partial unique index.
    try {
      await prismaClient.$transaction(async (tx) => {
        const restoredActivity = await tx.passionConnectionActivity.update({
          where: { id: existing.id },
          data: { deleted_at: null },
        });

        await AuditService.record(
          {
            action: AuditAction.UPDATE_PC_ACTIVITY,
            source: AuditSource.UI,
            entity_type: "PassionConnectionActivity",
            entity_id: restoredActivity.id,
            admin_id: admin.id,
            old_values: {
              // deleted_at !== null already checked above - TS narrowing
              // doesn't cross this closure boundary, hence the assertion.
              deleted_at: existing.deleted_at!.toISOString(),
            },
            new_values: { deleted_at: null },
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );
      });
    } catch (error) {
      rethrowAsFriendlyPCActivityConflict(error);
    }

    const restored = await prismaClient.passionConnectionActivity.findUniqueOrThrow({
      where: { id: existing.id },
      include: { activity: true },
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
      include: { activity: true },
      orderBy: { day: "asc" },
    });

    return activities.map(toPCActivityResponse);
  }
}

function rethrowAsFriendlyMasterPCActivityConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("name")) {
    throw new ResponseError(400, "A PC activity with this name already exists");
  }
  throw error;
}

// Master-data catalog (Master Data > PC Activities) - bespoke rather than
// built on createSimpleMasterDataService (simple-master-data-service.ts)
// since default_mentor_id needs the same eligibility check as a
// per-student assignment's mentor_id, which that generic {name}-only
// factory has no room for.
export class PCActivityMasterService {
  static async create(
    admin: AdminUser,
    request: CreateMasterPCActivityRequest,
    context: AuditRequestContext = {},
  ): Promise<MasterPCActivityResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can create a PC activity",
      );
    }

    const createRequest = Validation.validate(
      MasterPCActivityValidation.CREATE,
      request,
    );

    const existing = await prismaClient.masterPCActivity.findUnique({
      where: { name: createRequest.name },
    });
    if (existing) {
      throw new ResponseError(
        400,
        "A PC activity with this name already exists",
      );
    }
    if (createRequest.default_mentor_id) {
      await assertMentorIsEligible(createRequest.default_mentor_id);
    }

    let entity;
    try {
      entity = await prismaClient.$transaction(async (tx) => {
        const newEntity = await tx.masterPCActivity.create({
          data: {
            name: createRequest.name,
            default_mentor_id: createRequest.default_mentor_id,
          },
        });

        await AuditService.record(
          {
            action: AuditAction.CREATE_MASTER_DATA,
            source: AuditSource.UI,
            entity_type: "MasterPCActivity",
            entity_id: newEntity.id,
            admin_id: admin.id,
            new_values: toMasterPCActivityAuditSnapshot(newEntity),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return newEntity;
      });
    } catch (error) {
      rethrowAsFriendlyMasterPCActivityConflict(error);
    }

    return toMasterPCActivityResponse(entity);
  }

  static async update(
    admin: AdminUser,
    request: UpdateMasterPCActivityRequest,
    context: AuditRequestContext = {},
  ): Promise<MasterPCActivityResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can update a PC activity",
      );
    }

    const updateRequest = Validation.validate(
      MasterPCActivityValidation.UPDATE,
      request,
    );

    const existing = await prismaClient.masterPCActivity.findUnique({
      where: { id: updateRequest.id },
    });
    if (!existing) {
      throw new ResponseError(404, "PC activity not found");
    }

    if (updateRequest.name && updateRequest.name !== existing.name) {
      const duplicate = await prismaClient.masterPCActivity.findUnique({
        where: { name: updateRequest.name },
      });
      if (duplicate) {
        throw new ResponseError(
          400,
          "A PC activity with this name already exists",
        );
      }
    }

    const nextDefaultMentorId =
      updateRequest.default_mentor_id !== undefined
        ? updateRequest.default_mentor_id
        : existing.default_mentor_id;
    if (nextDefaultMentorId) {
      await assertMentorIsEligible(nextDefaultMentorId);
    }

    let entity;
    try {
      entity = await prismaClient.$transaction(async (tx) => {
        const updatedEntity = await tx.masterPCActivity.update({
          where: { id: updateRequest.id },
          data: {
            name: updateRequest.name,
            default_mentor_id: nextDefaultMentorId,
          },
        });

        await AuditService.record(
          {
            action: AuditAction.UPDATE_MASTER_DATA,
            source: AuditSource.UI,
            entity_type: "MasterPCActivity",
            entity_id: updatedEntity.id,
            admin_id: admin.id,
            old_values: toMasterPCActivityAuditSnapshot(existing),
            new_values: toMasterPCActivityAuditSnapshot(updatedEntity),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return updatedEntity;
      });
    } catch (error) {
      rethrowAsFriendlyMasterPCActivityConflict(error);
    }

    return toMasterPCActivityResponse(entity);
  }

  static async remove(
    admin: AdminUser,
    request: DeleteMasterPCActivityRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete a PC activity",
      );
    }

    const deleteRequest = Validation.validate(
      MasterPCActivityValidation.DELETE,
      request,
    );

    const existing = await prismaClient.masterPCActivity.findUnique({
      where: { id: deleteRequest.id },
    });
    if (!existing) {
      throw new ResponseError(404, "PC activity not found");
    }

    const referencedCount = await prismaClient.passionConnectionActivity.count(
      { where: { activity_id: deleteRequest.id } },
    );
    if (referencedCount > 0) {
      throw new ResponseError(
        400,
        `Cannot delete: this PC activity is still referenced by ${referencedCount} PC activity record(s). Reassign or remove those first.`,
      );
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.masterPCActivity.delete({ where: { id: deleteRequest.id } });

      await AuditService.record(
        {
          action: AuditAction.DELETE_MASTER_DATA,
          source: AuditSource.UI,
          entity_type: "MasterPCActivity",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: toMasterPCActivityAuditSnapshot(existing),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    return true;
  }

  static async get(
    admin: AdminUser,
    request: GetMasterPCActivityRequest,
  ): Promise<MasterPCActivityResponse> {
    void admin;

    const entity = await prismaClient.masterPCActivity.findUnique({
      where: { id: request.id },
    });
    if (!entity) {
      throw new ResponseError(404, "PC activity not found");
    }

    return toMasterPCActivityResponse(entity);
  }

  static async search(
    admin: AdminUser,
    request: SearchMasterPCActivityRequest,
  ): Promise<Pageable<MasterPCActivityResponse>> {
    void admin;

    const searchRequest = Validation.validate(
      MasterPCActivityValidation.SEARCH,
      request,
    );

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const where = {
      name: searchRequest.search
        ? { contains: searchRequest.search, mode: "insensitive" as const }
        : undefined,
    };
    const orderBy = {
      [searchRequest.sort_by || "name"]: searchRequest.sort_order || "asc",
    };

    return paginate(searchRequest.page, searchRequest.size, {
      count: () => prismaClient.masterPCActivity.count({ where }),
      findMany: () =>
        prismaClient.masterPCActivity
          .findMany({ where, take: searchRequest.size, skip, orderBy })
          .then((entities) => entities.map(toMasterPCActivityResponse)),
    });
  }
}
