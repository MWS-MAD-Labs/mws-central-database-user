import {
  AcademicYearStatus,
  AdminRole,
  AuditAction,
  AuditSource,
  EmployeeStatus,
  Prisma,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toPCActivityAuditSnapshot,
  toPCActivityDefaultMentorAuditSnapshot,
  toPCActivityDefaultMentorResponse,
  toPCActivityResponse,
  type ClearPCActivityDefaultMentorRequest,
  type CreatePCActivityRequest,
  type DeletePCActivityRequest,
  type GetPCActivityListRequest,
  type ListPCActivityDefaultMentorsBatchRequest,
  type ListPCActivityDefaultMentorsForEmployeeRequest,
  type ListPCActivityDefaultMentorsRequest,
  type PCActivityDefaultMentorResponse,
  type PCActivityResponse,
  type RestorePCActivityRequest,
  type SetPCActivityDefaultMentorRequest,
  type UpdatePCActivityRequest,
} from "../model/pc-activity-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { assertStudentInAdminUnit } from "../utils/sensitive-data";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import {
  PCActivityDefaultMentorValidation,
  PCActivityValidation,
} from "../validation/pc-activity-validation";
import { Validation } from "../validation/validation";

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

async function assertActivityExists(activityId: string): Promise<void> {
  const activity = await prismaClient.masterPCActivity.findUnique({
    where: { id: activityId },
  });
  if (!activity) {
    throw new ResponseError(400, "Invalid PC activity: activity not found");
  }
}

// The mentor shown for an assignment - always resolved live from the
// student's current unit (via current_grade, same resolution
// assertStudentInAdminUnit uses) against PCActivityDefaultMentor, never
// stored on PassionConnectionActivity itself. Not settable or overridable
// per assignment - it's a relation, not a snapshot, so re-pointing a
// unit's default mentor in Master Data immediately changes what every
// existing assignment for that activity/unit shows. Returns null when the
// student's grade has no unit, or no default is set for that pair.
async function resolveMentorForActivity(
  activityId: string,
  studentId: string,
): Promise<{ id: string; name: string } | null> {
  const student = await prismaClient.student.findUnique({
    where: { id: studentId },
    select: { current_grade: { select: { unit_id: true } } },
  });
  const unitId = student?.current_grade.unit_id;
  if (!unitId) return null;

  const defaultMentor = await prismaClient.pCActivityDefaultMentor.findUnique({
    where: { activity_id_unit_id: { activity_id: activityId, unit_id: unitId } },
    include: { mentor: { include: { person: true } } },
  });
  if (!defaultMentor) return null;
  return { id: defaultMentor.mentor_id, name: defaultMentor.mentor.person.full_name };
}

// Exported for PCActivityDefaultMentorService below - a default mentor row
// needs the exact same eligibility check as a per-student assignment's
// mentor_id.
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

// Closes the currently-open row (if any) for this (activity, unit) and
// opens a new one linked to it via previous_history_id - mirrors
// recordEmployeeMutation() in employee-service.ts exactly, just without the
// per-field branching (a mentor assignment only ever has one "field").
// mentorId: null records a clear() - the assignment ended with nobody
// mentoring, still a real state worth an entry (and something rollback can
// undo back to a real mentor).
async function recordPCActivityMentorMutation(
  tx: Prisma.TransactionClient,
  activityId: string,
  unitId: string,
  mentorId: string | null,
  startDate: Date,
): Promise<void> {
  const previous = await tx.pCActivityMentorMutationHistory.findFirst({
    where: {
      activity_id: activityId,
      unit_id: unitId,
      end_date: null,
      deleted_at: null,
    },
  });

  if (previous) {
    await tx.pCActivityMentorMutationHistory.update({
      where: { id: previous.id },
      data: { end_date: startDate },
    });
  }

  await tx.pCActivityMentorMutationHistory.create({
    data: {
      activity_id: activityId,
      unit_id: unitId,
      mentor_id: mentorId,
      start_date: startDate,
      end_date: null,
      previous_history_id: previous?.id ?? null,
    },
  });
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
    await assertActivityExists(createRequest.activity_id);
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
    const mentor = await resolveMentorForActivity(
      created.activity_id,
      created.student_id,
    );
    return toPCActivityResponse(created, mentor);
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

    if (updateRequest.activity_id) {
      await assertActivityExists(updateRequest.activity_id);
    }

    if (nextActivityId === existing.activity_id) {
      throw new ResponseError(
        400,
        "No changes to apply - activity is already set to this value",
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
    const mentor = await resolveMentorForActivity(
      updated.activity_id,
      updated.student_id,
    );
    return toPCActivityResponse(updated, mentor);
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
    const mentor = await resolveMentorForActivity(
      restored.activity_id,
      restored.student_id,
    );
    return toPCActivityResponse(restored, mentor);
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

    return Promise.all(
      activities.map(async (activity) => {
        const mentor = await resolveMentorForActivity(
          activity.activity_id,
          activity.student_id,
        );
        return toPCActivityResponse(activity, mentor);
      }),
    );
  }
}

// Master Data > PC Activities > Manage Mentors - per-unit default mentor
// rows for one activity. SUPER_ADMIN gate matches every other master-data
// mutation in the app; list is open to any admin session, same as
// PCActivityService.getList above.
export class PCActivityDefaultMentorService {
  static async list(
    admin: AdminUser,
    request: ListPCActivityDefaultMentorsRequest,
  ): Promise<PCActivityDefaultMentorResponse[]> {
    void admin;

    const listRequest = Validation.validate(
      PCActivityDefaultMentorValidation.LIST,
      request,
    );

    await assertActivityExists(listRequest.activity_id);

    const rows = await prismaClient.pCActivityDefaultMentor.findMany({
      where: { activity_id: listRequest.activity_id },
      include: { activity: true, unit: true, mentor: { include: { person: true } } },
      orderBy: { unit: { name: "asc" } },
    });

    return rows.map(toPCActivityDefaultMentorResponse);
  }

  // One query for however many activities are on the current Master Data
  // page (e.g. the "Mentor" column) - a per-row list() call each would
  // hit this same table N times for the same page load.
  static async listBatch(
    admin: AdminUser,
    request: ListPCActivityDefaultMentorsBatchRequest,
  ): Promise<PCActivityDefaultMentorResponse[]> {
    void admin;

    const listRequest = Validation.validate(
      PCActivityDefaultMentorValidation.LIST_BATCH,
      request,
    );

    const rows = await prismaClient.pCActivityDefaultMentor.findMany({
      where: { activity_id: { in: listRequest.activity_ids } },
      include: { activity: true, unit: true, mentor: { include: { person: true } } },
      orderBy: { unit: { name: "asc" } },
    });

    return rows.map(toPCActivityDefaultMentorResponse);
  }

  // Every (activity, unit) an employee is the default mentor for - shown
  // on their Employee detail page, alongside Teaching Assignments.
  static async listForEmployee(
    admin: AdminUser,
    request: ListPCActivityDefaultMentorsForEmployeeRequest,
  ): Promise<PCActivityDefaultMentorResponse[]> {
    void admin;

    const listRequest = Validation.validate(
      PCActivityDefaultMentorValidation.LIST_FOR_EMPLOYEE,
      request,
    );

    const rows = await prismaClient.pCActivityDefaultMentor.findMany({
      where: { mentor_id: listRequest.employee_id },
      include: { activity: true, unit: true, mentor: { include: { person: true } } },
      orderBy: [{ activity: { name: "asc" } }, { unit: { name: "asc" } }],
    });

    return rows.map(toPCActivityDefaultMentorResponse);
  }

  // Upsert by (activity_id, unit_id) - one call sets or replaces that
  // unit's default mentor, matching a single row in the "Manage Mentors"
  // table just picking a mentor from a dropdown.
  static async set(
    admin: AdminUser,
    request: SetPCActivityDefaultMentorRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<PCActivityDefaultMentorResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can set a PC activity's default mentor",
      );
    }

    const setRequest = Validation.validate(
      PCActivityDefaultMentorValidation.SET,
      request,
    );

    await assertActivityExists(setRequest.activity_id);
    const unit = await prismaClient.masterUnit.findUnique({
      where: { id: setRequest.unit_id },
    });
    if (!unit) {
      throw new ResponseError(400, "Invalid unit: unit not found");
    }
    await assertMentorIsEligible(setRequest.mentor_id);

    const existing = await prismaClient.pCActivityDefaultMentor.findUnique({
      where: {
        activity_id_unit_id: {
          activity_id: setRequest.activity_id,
          unit_id: setRequest.unit_id,
        },
      },
    });

    const saved = await prismaClient.$transaction(async (tx) => {
      const row = await tx.pCActivityDefaultMentor.upsert({
        where: {
          activity_id_unit_id: {
            activity_id: setRequest.activity_id,
            unit_id: setRequest.unit_id,
          },
        },
        create: {
          activity_id: setRequest.activity_id,
          unit_id: setRequest.unit_id,
          mentor_id: setRequest.mentor_id,
        },
        update: { mentor_id: setRequest.mentor_id },
      });

      await recordPCActivityMentorMutation(
        tx,
        setRequest.activity_id,
        setRequest.unit_id,
        setRequest.mentor_id,
        now,
      );

      await AuditService.record(
        {
          action: existing
            ? AuditAction.UPDATE_MASTER_DATA
            : AuditAction.CREATE_MASTER_DATA,
          source: AuditSource.UI,
          entity_type: "PCActivityDefaultMentor",
          entity_id: row.id,
          admin_id: admin.id,
          old_values: existing
            ? toPCActivityDefaultMentorAuditSnapshot(existing)
            : undefined,
          new_values: toPCActivityDefaultMentorAuditSnapshot(row),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return row;
    });

    const withRelations =
      await prismaClient.pCActivityDefaultMentor.findUniqueOrThrow({
        where: { id: saved.id },
        include: { activity: true, unit: true, mentor: { include: { person: true } } },
      });
    return toPCActivityDefaultMentorResponse(withRelations);
  }

  static async clear(
    admin: AdminUser,
    request: ClearPCActivityDefaultMentorRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can clear a PC activity's default mentor",
      );
    }

    const clearRequest = Validation.validate(
      PCActivityDefaultMentorValidation.CLEAR,
      request,
    );

    const existing = await prismaClient.pCActivityDefaultMentor.findUnique({
      where: {
        activity_id_unit_id: {
          activity_id: clearRequest.activity_id,
          unit_id: clearRequest.unit_id,
        },
      },
    });
    if (!existing) {
      throw new ResponseError(
        404,
        "No default mentor set for this activity/unit",
      );
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.pCActivityDefaultMentor.delete({ where: { id: existing.id } });

      await recordPCActivityMentorMutation(
        tx,
        clearRequest.activity_id,
        clearRequest.unit_id,
        null,
        now,
      );

      await AuditService.record(
        {
          action: AuditAction.DELETE_MASTER_DATA,
          source: AuditSource.UI,
          entity_type: "PCActivityDefaultMentor",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: toPCActivityDefaultMentorAuditSnapshot(existing),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    return true;
  }
}
