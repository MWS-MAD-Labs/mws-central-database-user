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
  toPCActivityMasterAuditSnapshot,
  toPCActivityMasterResponse,
  toPCActivityResponse,
  type ClearPCActivityDefaultMentorRequest,
  type CreatePCActivityMasterRequest,
  type CreatePCActivityRequest,
  type DeletePCActivityMasterRequest,
  type DeletePCActivityRequest,
  type GetPCActivityListRequest,
  type GetPCActivityMasterRequest,
  type ListPCActivityDefaultMentorsBatchRequest,
  type ListPCActivityDefaultMentorsForEmployeeRequest,
  type ListPCActivityDefaultMentorsRequest,
  type PCActivityDefaultMentorResponse,
  type PCActivityMasterResponse,
  type PCActivityReassignmentPreviewItem,
  type PCActivityResponse,
  type PreviewPCActivityReassignmentRequest,
  type RestorePCActivityRequest,
  type SearchPCActivityMasterRequest,
  type SetPCActivityDefaultMentorRequest,
  type UpdatePCActivityMasterRequest,
  type UpdatePCActivityRequest,
} from "../model/pc-activity-model";
import { paginate, type Pageable } from "../model/page-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { assertStudentInAdminUnit } from "../utils/sensitive-data";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import {
  PCActivityDefaultMentorValidation,
  PCActivityMasterValidation,
  PCActivityValidation,
} from "../validation/pc-activity-validation";
import { Validation } from "../validation/validation";

const DUPLICATE_PC_ACTIVITY_MESSAGE =
  "This student already has a PC activity recorded for this day and academic year.";

// Import preview reuses this missing-active-year error.
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

// Return the student name for the audit snapshot.
async function assertStudentExists(
  studentId: string,
  requireActive = false,
): Promise<string> {
  const student = await prismaClient.student.findFirst({
    where: {
      id: studentId,
      deleted_at: requireActive ? null : undefined,
    },
    include: { person: { select: { full_name: true } } },
  });
  if (!student) {
    throw new ResponseError(404, "Student not found");
  }
  return student.person.full_name;
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

// Empty activity units allow assignments from every unit.
async function assertActivityAllowsUnit(
  activityId: string,
  studentId: string,
): Promise<void> {
  const activity = await prismaClient.masterPCActivity.findUnique({
    where: { id: activityId },
    include: { units: { include: { unit: true } } },
  });
  if (!activity || activity.units.length === 0) return;

  const student = await prismaClient.student.findUnique({
    where: { id: studentId },
    select: { current_grade: { select: { unit_id: true } } },
  });
  const unitId = student?.current_grade.unit_id;

  if (!unitId || !activity.units.some((u) => u.unit_id === unitId)) {
    throw new ResponseError(
      400,
      `PC activity "${activity.name}" is only available to: ${activity.units.map((u) => u.unit.name).join(", ")}`,
    );
  }
}

// Resolve mentors live from the activity and student's current unit.
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

// Mentor eligibility uses employee.unit_id; placement scopes do not widen access.
export async function assertMentorIsEligible(
  mentorId: string,
  targetUnitId: string,
): Promise<void> {
  const mentor = await prismaClient.employee.findUnique({
    where: { id: mentorId },
    select: {
      status: true,
      deleted_at: true,
      unit_id: true,
      unit: { select: { name: true } },
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

  if (mentor.unit_id !== targetUnitId) {
    throw new ResponseError(
      400,
      `Invalid mentor: employee is in unit "${mentor.unit.name}", not the target unit`,
    );
  }
}

// Replace the open mentor history row and link its predecessor.
// A null mentor records a reversible clear.
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

    const studentFullName = await assertStudentExists(
      createRequest.student_id,
      true,
    );
    await assertActivityExists(createRequest.activity_id);
    await assertActivityAllowsUnit(
      createRequest.activity_id,
      createRequest.student_id,
    );
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
            new_values: toPCActivityAuditSnapshot(newActivity, studentFullName),
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

  // Reassignment closes the old row and creates one active replacement.
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

    const studentFullName = await assertStudentExists(
      updateRequest.student_id,
      true,
    );

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
      await assertActivityAllowsUnit(
        updateRequest.activity_id,
        updateRequest.student_id,
      );
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
            old_values: toPCActivityAuditSnapshot(existing, studentFullName),
            new_values: toPCActivityAuditSnapshot(newActivity, studentFullName),
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

    const studentFullName = await assertStudentExists(deleteRequest.student_id);

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
          old_values: toPCActivityAuditSnapshot(existing, studentFullName),
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

    // Do not restore history into an occupied student, day, and year slot.
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

// Default mentor writes are Super Admin only; reads are available to admins.
export class PCActivityDefaultMentorService {
  static async list(
    admin: AdminUser,
    request: ListPCActivityDefaultMentorsRequest,
  ): Promise<PCActivityDefaultMentorResponse[]> {
    const listRequest = Validation.validate(
      PCActivityDefaultMentorValidation.LIST,
      request,
    );

    await assertActivityExists(listRequest.activity_id);

    // Database Admin reads are limited to their unit.
    const unitScope =
      admin.role === AdminRole.DATABASE_ADMIN && !admin.can_view_all_units
        ? admin.unit_id
        : undefined;

    const rows = await prismaClient.pCActivityDefaultMentor.findMany({
      where: {
        activity_id: listRequest.activity_id,
        ...(unitScope ? { unit_id: unitScope } : {}),
      },
      include: { activity: true, unit: true, mentor: { include: { person: true, unit: true } } },
      orderBy: { unit: { name: "asc" } },
    });

    return rows.map(toPCActivityDefaultMentorResponse);
  }

  // Batch default mentor lookups for the activity page.
  static async listBatch(
    admin: AdminUser,
    request: ListPCActivityDefaultMentorsBatchRequest,
  ): Promise<PCActivityDefaultMentorResponse[]> {
    const listRequest = Validation.validate(
      PCActivityDefaultMentorValidation.LIST_BATCH,
      request,
    );

    const unitScope =
      admin.role === AdminRole.DATABASE_ADMIN && !admin.can_view_all_units
        ? admin.unit_id
        : undefined;

    const rows = await prismaClient.pCActivityDefaultMentor.findMany({
      where: {
        activity_id: { in: listRequest.activity_ids },
        ...(unitScope ? { unit_id: unitScope } : {}),
      },
      include: { activity: true, unit: true, mentor: { include: { person: true, unit: true } } },
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
      include: { activity: true, unit: true, mentor: { include: { person: true, unit: true } } },
      orderBy: [{ activity: { name: "asc" } }, { unit: { name: "asc" } }],
    });

    return rows.map(toPCActivityDefaultMentorResponse);
  }

  // Upsert one default mentor per activity and unit.
  static async set(
    admin: AdminUser,
    request: SetPCActivityDefaultMentorRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<PCActivityDefaultMentorResponse> {
    if (admin.role === AdminRole.VIEWER) {
      throw new ResponseError(
        403,
        "Forbidden: Viewer cannot set a PC activity's default mentor",
      );
    }

    const setRequest = Validation.validate(
      PCActivityDefaultMentorValidation.SET,
      request,
    );

    // Unit-locked, same as Employee/Student writes - a DATABASE_ADMIN can
    // only set the default mentor for their own unit, never another one.
    if (
      admin.role === AdminRole.DATABASE_ADMIN &&
      setRequest.unit_id !== admin.unit_id
    ) {
      throw new ResponseError(
        403,
        "Forbidden: You can only set a default mentor within your own unit",
      );
    }

    await assertActivityExists(setRequest.activity_id);
    const unit = await prismaClient.masterUnit.findUnique({
      where: { id: setRequest.unit_id },
    });
    if (!unit) {
      throw new ResponseError(400, "Invalid unit: unit not found");
    }
    await assertMentorIsEligible(setRequest.mentor_id, setRequest.unit_id);

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
        include: { activity: true, unit: true, mentor: { include: { person: true, unit: true } } },
      });
    return toPCActivityDefaultMentorResponse(withRelations);
  }

  static async clear(
    admin: AdminUser,
    request: ClearPCActivityDefaultMentorRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    if (admin.role === AdminRole.VIEWER) {
      throw new ResponseError(
        403,
        "Forbidden: Viewer cannot clear a PC activity's default mentor",
      );
    }

    const clearRequest = Validation.validate(
      PCActivityDefaultMentorValidation.CLEAR,
      request,
    );

    if (
      admin.role === AdminRole.DATABASE_ADMIN &&
      clearRequest.unit_id !== admin.unit_id
    ) {
      throw new ResponseError(
        403,
        "Forbidden: You can only clear a default mentor within your own unit",
      );
    }

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

// Write only deduplicated unit IDs confirmed by the database.
async function resolveActivityUnitIds(unitIds: string[]): Promise<string[]> {
  if (unitIds.length === 0) return [];
  const units = await prismaClient.masterUnit.findMany({
    where: { id: { in: unitIds } },
    select: { id: true },
  });
  if (units.length !== new Set(unitIds).size) {
    throw new ResponseError(400, "One or more units were not found");
  }
  return units.map((unit) => unit.id);
}

const PC_ACTIVITY_MASTER_WITH_UNITS_INCLUDE = {
  units: { include: { unit: true } },
} as const;

function rethrowAsFriendlyPCActivityMasterConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("name")) {
    throw new ResponseError(400, "A PC activity with this name already exists");
  }
  throw error;
}

// PC activity master data supports optional unit scope.
export class PCActivityMasterService {
  static async create(
    admin: AdminUser,
    request: CreatePCActivityMasterRequest,
    context: AuditRequestContext = {},
  ): Promise<PCActivityMasterResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can create a PC activity",
      );
    }

    const createRequest = Validation.validate(
      PCActivityMasterValidation.CREATE,
      request,
    );

    const existing = await prismaClient.masterPCActivity.findUnique({
      where: { name: createRequest.name },
    });
    if (existing) {
      throw new ResponseError(400, "A PC activity with this name already exists");
    }

    const unitIds = await resolveActivityUnitIds(createRequest.unit_ids ?? []);

    let newActivityId: string;
    try {
      newActivityId = await prismaClient.$transaction(async (tx) => {
        const created = await tx.masterPCActivity.create({
          data: { name: createRequest.name },
        });

        if (unitIds.length > 0) {
          await tx.masterPCActivityUnit.createMany({
            data: unitIds.map((unitId) => ({
              activity_id: created.id,
              unit_id: unitId,
            })),
          });
        }

        await AuditService.record(
          {
            action: AuditAction.CREATE_MASTER_DATA,
            source: AuditSource.UI,
            entity_type: "MasterPCActivity",
            entity_id: created.id,
            admin_id: admin.id,
            new_values: toPCActivityMasterAuditSnapshot({
              name: created.name,
              unit_ids: unitIds,
            }),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return created.id;
      });
    } catch (error) {
      rethrowAsFriendlyPCActivityMasterConflict(error);
    }

    const activity = await prismaClient.masterPCActivity.findUniqueOrThrow({
      where: { id: newActivityId },
      include: PC_ACTIVITY_MASTER_WITH_UNITS_INCLUDE,
    });

    return toPCActivityMasterResponse(activity);
  }

  static async update(
    admin: AdminUser,
    request: UpdatePCActivityMasterRequest,
    context: AuditRequestContext = {},
  ): Promise<PCActivityMasterResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can update a PC activity",
      );
    }

    const updateRequest = Validation.validate(
      PCActivityMasterValidation.UPDATE,
      request,
    );

    const existing = await prismaClient.masterPCActivity.findUnique({
      where: { id: updateRequest.id },
      include: PC_ACTIVITY_MASTER_WITH_UNITS_INCLUDE,
    });
    if (!existing) {
      throw new ResponseError(404, "PC activity not found");
    }
    const existingUnitIds = existing.units.map((u) => u.unit_id);

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

    const requestedUnitIds = updateRequest.unit_ids;
    let nextUnitIds: string[] | undefined;
    if (requestedUnitIds !== undefined) {
      nextUnitIds = await resolveActivityUnitIds(requestedUnitIds);

      // Unit-scope narrowing cannot orphan active student assignments.
      if (nextUnitIds.length > 0) {
        const mismatchedAssignmentCount =
          await prismaClient.passionConnectionActivity.count({
            where: {
              activity_id: existing.id,
              deleted_at: null,
              student: {
                current_grade: { unit_id: { notIn: nextUnitIds } },
              },
            },
          });
        if (mismatchedAssignmentCount > 0) {
          throw new ResponseError(
            400,
            `Cannot change this PC activity's units: ${mismatchedAssignmentCount} student assignment(s) are in a unit outside the new selection. Reassign them first.`,
          );
        }
      }
    }

    try {
      await prismaClient.$transaction(async (tx) => {
        const updated = await tx.masterPCActivity.update({
          where: { id: updateRequest.id },
          data: { name: updateRequest.name },
        });

        if (nextUnitIds !== undefined) {
          await tx.masterPCActivityUnit.deleteMany({
            where: { activity_id: existing.id },
          });
          if (nextUnitIds.length > 0) {
            await tx.masterPCActivityUnit.createMany({
              data: nextUnitIds.map((unitId) => ({
                activity_id: existing.id,
                unit_id: unitId,
              })),
            });
          }
        }

        await AuditService.record(
          {
            action: AuditAction.UPDATE_MASTER_DATA,
            source: AuditSource.UI,
            entity_type: "MasterPCActivity",
            entity_id: updated.id,
            admin_id: admin.id,
            old_values: toPCActivityMasterAuditSnapshot({
              name: existing.name,
              unit_ids: existingUnitIds,
            }),
            new_values: toPCActivityMasterAuditSnapshot({
              name: updated.name,
              unit_ids: nextUnitIds ?? existingUnitIds,
            }),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );
      });
    } catch (error) {
      rethrowAsFriendlyPCActivityMasterConflict(error);
    }

    const activity = await prismaClient.masterPCActivity.findUniqueOrThrow({
      where: { id: updateRequest.id },
      include: PC_ACTIVITY_MASTER_WITH_UNITS_INCLUDE,
    });

    return toPCActivityMasterResponse(activity);
  }

  static async remove(
    admin: AdminUser,
    request: DeletePCActivityMasterRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete a PC activity",
      );
    }

    const deleteRequest = Validation.validate(
      PCActivityMasterValidation.DELETE,
      request,
    );

    const existing = await prismaClient.masterPCActivity.findUnique({
      where: { id: deleteRequest.id },
      include: PC_ACTIVITY_MASTER_WITH_UNITS_INCLUDE,
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
          old_values: toPCActivityMasterAuditSnapshot({
            name: existing.name,
            unit_ids: existing.units.map((u) => u.unit_id),
          }),
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
    request: GetPCActivityMasterRequest,
  ): Promise<PCActivityMasterResponse> {
    void admin;

    const activity = await prismaClient.masterPCActivity.findUnique({
      where: { id: request.id },
      include: PC_ACTIVITY_MASTER_WITH_UNITS_INCLUDE,
    });
    if (!activity) {
      throw new ResponseError(404, "PC activity not found");
    }

    return toPCActivityMasterResponse(activity);
  }

  static async search(
    admin: AdminUser,
    request: SearchPCActivityMasterRequest,
  ): Promise<Pageable<PCActivityMasterResponse>> {
    void admin;

    const searchRequest = Validation.validate(
      PCActivityMasterValidation.SEARCH,
      request,
    );

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const where = {
      name: searchRequest.search
        ? { contains: searchRequest.search, mode: "insensitive" as const }
        : undefined,
    };

    return paginate(searchRequest.page, searchRequest.size, {
      count: () => prismaClient.masterPCActivity.count({ where }),
      findMany: () =>
        prismaClient.masterPCActivity
          .findMany({
            where,
            take: searchRequest.size,
            skip,
            orderBy: { [searchRequest.sort_by || "name"]: searchRequest.sort_order || "asc" },
            include: PC_ACTIVITY_MASTER_WITH_UNITS_INCLUDE,
          })
          .then((activities) => activities.map(toPCActivityMasterResponse)),
    });
  }

  // Return students displaced by a proposed scope reduction.
  static async previewReassignmentImpact(
    admin: AdminUser,
    request: PreviewPCActivityReassignmentRequest,
  ): Promise<Pageable<PCActivityReassignmentPreviewItem>> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can preview PC activity reassignment impact",
      );
    }

    const previewRequest = Validation.validate(
      PCActivityMasterValidation.PREVIEW_REASSIGNMENT,
      request,
    );

    const existing = await prismaClient.masterPCActivity.findUnique({
      where: { id: previewRequest.id },
    });
    if (!existing) {
      throw new ResponseError(404, "PC activity not found");
    }

    // Empty unit_ids means "any unit" (widening) - nobody can ever be
    // "outside" an unrestricted set, so there's nothing to preview.
    if (previewRequest.unit_ids.length === 0) {
      return {
        data: [],
        paging: {
          size: previewRequest.size,
          current_page: previewRequest.page,
          total_page: 0,
          total_item: 0,
        },
      };
    }

    const where = {
      activity_id: previewRequest.id,
      deleted_at: null,
      student: {
        current_grade: { unit_id: { notIn: previewRequest.unit_ids } },
      },
    };
    const skip = (previewRequest.page - 1) * previewRequest.size;

    return paginate(previewRequest.page, previewRequest.size, {
      count: () => prismaClient.passionConnectionActivity.count({ where }),
      findMany: () =>
        prismaClient.passionConnectionActivity
          .findMany({
            where,
            take: previewRequest.size,
            skip,
            include: {
              student: {
                include: { person: true, current_grade: { include: { unit: true } } },
              },
            },
            orderBy: { student: { person: { full_name: "asc" } } },
          })
          .then((rows) =>
            rows.map((row) => ({
              student_id: row.student_id,
              full_name: row.student.person.full_name,
              // Legacy grades may have no unit despite the preceding filter.
              unit_name: row.student.current_grade.unit?.name ?? "-",
              day: row.day,
            })),
          ),
    });
  }
}
