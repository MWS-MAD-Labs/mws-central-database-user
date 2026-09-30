import {
  AcademicYearStatus,
  AdminRole,
  AuditAction,
  AuditSource,
  EmployeeStatus,
  InternStatus,
  type PCDay,
  PcActivityAssignmentStatus,
  Prisma,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import { lockInternWorkforce } from "../utils/intern-workforce-lock";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toPCActivityAuditSnapshot,
  toPCActivityMasterAuditSnapshot,
  toPCActivityMasterResponse,
  toPCActivityResponse,
  type CreatePCActivityMasterRequest,
  type CreatePCActivityRequest,
  type DeletePCActivityMasterRequest,
  type DeletePCActivityRequest,
  type GetPCActivityListRequest,
  type GetPCActivityMasterRequest,
  type PCActivityMentorSummary,
  type PCActivityMasterResponse,
  type PCActivityResponse,
  type RestorePCActivityRequest,
  type SearchPCActivityMasterRequest,
  type UpdatePCActivityMasterRequest,
  type UpdatePCActivityRequest,
} from "../model/pc-activity-model";
import { paginate, type Pageable } from "../model/page-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { assertStudentInAdminUnit } from "../utils/sensitive-data";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import {
  PCActivityMasterValidation,
  PCActivityValidation,
} from "../validation/pc-activity-validation";
import { Validation } from "../validation/validation";

const DUPLICATE_PC_ACTIVITY_MESSAGE =
  "This student already has an active PC activity on this day for the academic year.";

// Import preview reuses this missing-active-year error.
export const NO_ACTIVE_ACADEMIC_YEAR_MESSAGE =
  "No active academic year found. Please specify academic_year_id explicitly.";

export const MAX_ROOM_STUDENTS = 100;

// ACTIVE + SCHEDULED both occupy a slot. Exported so pc-activity-room-service.ts
// can reuse it for moveStudent/reopenStudentAssignment - lives here (not
// there) to avoid a circular import, since that file already imports
// PCActivityService from this one.
export async function assertRoomStudentCapacity(
  tx: Prisma.TransactionClient,
  roomId: string,
  excludeAssignmentId?: string,
): Promise<void> {
  const count = await tx.passionConnectionActivity.count({
    where: {
      room_id: roomId,
      status: { in: [PcActivityAssignmentStatus.ACTIVE, PcActivityAssignmentStatus.SCHEDULED] },
      deleted_at: null,
      ...(excludeAssignmentId ? { id: { not: excludeAssignmentId } } : {}),
    },
  });
  if (count >= MAX_ROOM_STUDENTS) {
    throw new ResponseError(
      400,
      `This room already has the maximum of ${MAX_ROOM_STUDENTS} students`,
    );
  }
}

function rethrowAsFriendlyPCActivityConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("student_id") || fields?.includes("academic_year_id")) {
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

// Empty activity units allow assignments from every unit. Shared by the
// per-student flow (resolves the unit from the student's current grade)
// and the class-first flow (already has the class's unit in hand).
export async function assertActivityAllowsUnitId(
  activityId: string,
  unitId: string | null | undefined,
): Promise<void> {
  const activity = await prismaClient.masterPCActivity.findUnique({
    where: { id: activityId },
    include: { units: { include: { unit: true } } },
  });
  if (!activity || activity.units.length === 0) return;

  if (!unitId || !activity.units.some((u) => u.unit_id === unitId)) {
    throw new ResponseError(
      400,
      `PC activity "${activity.name}" is only available to: ${activity.units.map((u) => u.unit.name).join(", ")}`,
    );
  }
}

async function assertActivityAllowsUnit(
  activityId: string,
  studentId: string,
): Promise<void> {
  const student = await prismaClient.student.findUnique({
    where: { id: studentId },
    select: { current_grade: { select: { unit_id: true } } },
  });
  await assertActivityAllowsUnitId(activityId, student?.current_grade.unit_id);
}

// Every currently active mentor on a room - a room can have more than
// one. Empty for a null roomId (legacy, unscoped assignment).
async function resolveRoomMentors(
  roomId: string | null,
): Promise<PCActivityMentorSummary[]> {
  if (!roomId) return [];
  const assignments = await prismaClient.pcActivityRoomMentorAssignment.findMany({
    where: { room_id: roomId, status: "ACTIVE", deleted_at: null },
    include: { employee: { include: { person: true } }, intern: true },
  });
  return assignments.map((assignment) =>
    assignment.employee
      ? {
          id: assignment.employee.id,
          name: assignment.employee.person.full_name,
          type: "EMPLOYEE" as const,
        }
      : {
          id: assignment.intern!.id,
          name: assignment.intern!.full_name,
          type: "INTERN" as const,
        },
  );
}

type MentorWorkforceTarget = {
  employeeId: string | null;
  internId: string | null;
};

// Eligibility is gated by is_pc_mentor_eligible, checked independently of
// is_teaching_role/is_teaching_position - a non-teaching staff member can
// qualify as a PC mentor without being flagged as teaching staff.
// targetUnitIds accepts a set since a room can span multiple units; the
// old single-unit default-mentor flow just passes a one-element array.
export async function assertMentorIsEligible(
  tx: Prisma.TransactionClient,
  mentorId: string | undefined,
  internId: string | undefined,
  targetUnitIds: string[],
  now: Date,
): Promise<MentorWorkforceTarget> {
  if (mentorId) {
    const mentor = await tx.employee.findUnique({
      where: { id: mentorId },
      select: {
        status: true,
        deleted_at: true,
        unit_id: true,
        unit: { select: { name: true } },
        is_pc_mentor_eligible: true,
        pc_mentor_units: { select: { unit_id: true, unit: { select: { name: true } } } },
      },
    });
    if (
      !mentor ||
      mentor.deleted_at !== null ||
      mentor.status !== EmployeeStatus.ACTIVE ||
      !mentor.is_pc_mentor_eligible
    ) {
      throw new ResponseError(
        400,
        "Invalid mentor: referenced employee does not exist, is not active, or is not enabled as a PC mentor",
      );
    }

    assertMentorUnitScopeAllows(
      { id: mentor.unit_id, name: mentor.unit.name },
      mentor.pc_mentor_units.map((row) => ({ id: row.unit_id, name: row.unit.name })),
      targetUnitIds,
    );
    return { employeeId: mentorId, internId: null };
  }

  const intern = await tx.intern.findUnique({
    where: { id: internId! },
    include: {
      unit: true,
      job_position: true,
      pc_mentor_units: { select: { unit_id: true, unit: { select: { name: true } } } },
    },
  });
  if (
    !intern ||
    intern.deleted_at !== null ||
    intern.status !== InternStatus.ACTIVE ||
    intern.end_date <= now ||
    !intern.is_pc_mentor_eligible
  ) {
    throw new ResponseError(
      400,
      "Invalid mentor: referenced intern does not exist, is inactive or expired, or is not enabled as a PC mentor",
    );
  }
  assertMentorUnitScopeAllows(
    { id: intern.unit_id, name: intern.unit.name },
    intern.pc_mentor_units.map((row) => ({ id: row.unit_id, name: row.unit.name })),
    targetUnitIds,
  );
  return { employeeId: null, internId: intern.id };
}

// Deliberately the opposite default from unit-scoping elsewhere in this
// codebase (e.g. MasterJobLevelUnit): an empty pc_mentor_units list means
// "their own unit only" (today's unchanged behavior), not "any unit" -
// widening a mentor's reach across units is always an explicit opt-in.
function assertMentorUnitScopeAllows(
  homeUnit: { id: string; name: string },
  scopedUnits: { id: string; name: string }[],
  targetUnitIds: string[],
): void {
  const allowedUnits = scopedUnits.length > 0 ? scopedUnits : [homeUnit];
  const missingUnitIds = targetUnitIds.filter(
    (targetUnitId) => !allowedUnits.some((unit) => unit.id === targetUnitId),
  );
  if (missingUnitIds.length === 0) return;
  throw new ResponseError(
    400,
    `Invalid mentor: must be eligible for every target room unit. Allowed scope: ${allowedUnits.map((unit) => `"${unit.name}"`).join(", ")}`,
  );
}

export type PCActivityCreateSource = "ROOM" | "IMPORT_LEGACY";

export class PCActivityService {
  static async create(
    admin: AdminUser,
    request: CreatePCActivityRequest,
    source: PCActivityCreateSource,
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
    if (source === "ROOM" && !createRequest.room_id) {
      throw new ResponseError(400, "Room assignment creation requires room_id");
    }
    if (source === "IMPORT_LEGACY" && createRequest.room_id) {
      throw new ResponseError(400, "Legacy import cannot create a room assignment");
    }

    let academicYearId = createRequest.academic_year_id;

    let room: {
      id: string;
      activity_id: string;
      academic_year_id: string;
      day: typeof createRequest.day;
      start_date: Date;
      end_date: Date;
      deleted_at: Date | null;
      units: { unit_id: string }[];
      grades: { grade_id: string }[];
      classes: { class_id: string }[];
    } | null = null;
    if (createRequest.room_id) {
      room = await prismaClient.pcActivityRoom.findUnique({
        where: { id: createRequest.room_id },
        select: {
          id: true,
          activity_id: true,
          academic_year_id: true,
          day: true,
          start_date: true,
          end_date: true,
          deleted_at: true,
          units: { select: { unit_id: true } },
          grades: { select: { grade_id: true } },
          classes: { select: { class_id: true } },
        },
      });
      if (!room || room.deleted_at !== null) {
        throw new ResponseError(400, "PC Activity room not found");
      }
      academicYearId = room.academic_year_id;
      if (
        room.activity_id !== createRequest.activity_id ||
        (createRequest.academic_year_id !== undefined &&
          room.academic_year_id !== createRequest.academic_year_id) ||
        room.day !== createRequest.day
      ) {
        throw new ResponseError(400, "PC Activity assignment does not match the selected room");
      }
      if (now < room.start_date || now >= room.end_date) {
        throw new ResponseError(400, "Students can only be assigned during the room period");
      }
      const eligibleEnrollment = await prismaClient.studentClassEnrollment.findFirst({
        where: {
          student_id: createRequest.student_id,
          academic_year_id: room.academic_year_id,
          enrollment_status: "ACTIVE",
          deleted_at: null,
          ...(room.classes.length > 0
            ? { class_id: { in: room.classes.map((entry) => entry.class_id) } }
            : {}),
          grade: {
            unit_id: { in: room.units.map((entry) => entry.unit_id) },
            ...(room.grades.length > 0
              ? { id: { in: room.grades.map((entry) => entry.grade_id) } }
              : {}),
          },
          student: { status: "ACTIVE", deleted_at: null },
        },
        select: { id: true },
      });
      if (!eligibleEnrollment) {
        throw new ResponseError(
          400,
          "Student is not eligible for this room's unit/grade/class scope",
        );
      }
    } else {
      await assertActivityExists(createRequest.activity_id);
      await assertActivityAllowsUnit(
        createRequest.activity_id,
        createRequest.student_id,
      );
      academicYearId = await resolveActiveAcademicYearId(academicYearId);
    }

    if (!academicYearId) {
      throw new ResponseError(400, NO_ACTIVE_ACADEMIC_YEAR_MESSAGE);
    }

    let createdId;
    try {
      createdId = await prismaClient.$transaction(async (tx) => {
        if (room) {
          await assertRoomStudentCapacity(tx, room.id);
        }
        const startDate = now;
        const expiresAt = room?.end_date ?? null;
        const newActivity = await tx.passionConnectionActivity.create({
          data: {
            student_id: createRequest.student_id,
            day: room?.day ?? createRequest.day,
            activity_id: room?.activity_id ?? createRequest.activity_id,
            academic_year_id: academicYearId,
            room_id: room?.id,
            start_date: startDate,
            expires_at: expiresAt,
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
      include: { activity: true, room: true },
    });
    const mentors = await resolveRoomMentors(created.room_id);
    return toPCActivityResponse(created, mentors);
  }

  // Tags an unattached legacy row (room_id null) with a room, when the row's
  // activity+day already matches the room exactly - nothing about the
  // assignment itself changes, so this is a plain patch, not a supersede.
  // Used by pc-activity-room-service.ts's bulkAssignStudents for the
  // "legacy match" case instead of create(), which would fail against the
  // one-row-per-student/year/day unique index.
  static async attachLegacyAssignmentToRoom(
    admin: AdminUser,
    studentId: string,
    room: { id: string; activity_id: string; academic_year_id: string; day: PCDay },
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<PCActivityResponse> {
    await assertWriteAllowed(admin, context, now, studentId);

    const studentFullName = await assertStudentExists(studentId, true);

    const existing = await prismaClient.passionConnectionActivity.findFirst({
      where: {
        student_id: studentId,
        deleted_at: null,
        status: { in: [PcActivityAssignmentStatus.ACTIVE, PcActivityAssignmentStatus.SCHEDULED] },
        academic_year_id: room.academic_year_id,
        day: room.day,
        activity_id: room.activity_id,
        room_id: null,
      },
    });
    if (!existing) {
      throw new ResponseError(
        400,
        "No matching legacy PC activity found for this student, activity, and day",
      );
    }

    const updated = await prismaClient.$transaction(async (tx) => {
      await assertRoomStudentCapacity(tx, room.id);
      const row = await tx.passionConnectionActivity.update({
        where: { id: existing.id },
        data: { room_id: room.id },
      });

      await AuditService.record(
        {
          action: AuditAction.UPDATE_PC_ACTIVITY,
          source: AuditSource.UI,
          entity_type: "PassionConnectionActivity",
          entity_id: row.id,
          admin_id: admin.id,
          old_values: toPCActivityAuditSnapshot(existing, studentFullName),
          new_values: toPCActivityAuditSnapshot(row, studentFullName),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return row;
    });

    const attached = await prismaClient.passionConnectionActivity.findUniqueOrThrow({
      where: { id: updated.id },
      include: { activity: true, room: true },
    });
    const mentors = await resolveRoomMentors(attached.room_id);
    return toPCActivityResponse(attached, mentors);
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
      include: { activity: true, room: true },
    });
    const mentors = await resolveRoomMentors(updated.room_id);
    return toPCActivityResponse(updated, mentors);
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

    // Do not restore history into an occupied student and year slot.
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
      include: { activity: true, room: true },
    });
    const mentors = await resolveRoomMentors(restored.room_id);
    return toPCActivityResponse(restored, mentors);
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
      include: { activity: true, room: true },
      orderBy: { day: "asc" },
    });

    return Promise.all(
      activities.map(async (activity) => {
        const mentors = await resolveRoomMentors(activity.room_id);
        return toPCActivityResponse(activity, mentors);
      }),
    );
  }
}


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

    let newActivityId: string;
    try {
      newActivityId = await prismaClient.$transaction(async (tx) => {
        const created = await tx.masterPCActivity.create({
          data: { name: createRequest.name },
        });

        await AuditService.record(
          {
            action: AuditAction.CREATE_MASTER_DATA,
            source: AuditSource.UI,
            entity_type: "MasterPCActivity",
            entity_id: created.id,
            admin_id: admin.id,
            new_values: toPCActivityMasterAuditSnapshot({
              name: created.name,
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

    try {
      await prismaClient.$transaction(async (tx) => {
        const updated = await tx.masterPCActivity.update({
          where: { id: updateRequest.id },
          data: { name: updateRequest.name },
        });

        await AuditService.record(
          {
            action: AuditAction.UPDATE_MASTER_DATA,
            source: AuditSource.UI,
            entity_type: "MasterPCActivity",
            entity_id: updated.id,
            admin_id: admin.id,
            old_values: toPCActivityMasterAuditSnapshot({
              name: existing.name,
            }),
            new_values: toPCActivityMasterAuditSnapshot({
              name: updated.name,
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
                })
          .then((activities) => activities.map(toPCActivityMasterResponse)),
    });
  }

}
