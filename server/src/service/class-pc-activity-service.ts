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
  toBulkActionResponse,
  type BulkActionItemResponse,
  type BulkActionResponse,
} from "../model/bulk-action-model";
import {
  toClassPcActivityOfferingResponse,
  type AssignClassPcActivityRequest,
  type BulkEnrollClassPcActivityStudentsRequest,
  type ClassPcActivityEnrolledStudentResponse,
  type ClassPcActivityOfferingResponse,
  type ClassPcActivityRosterStatusResponse,
  type ListClassPcActivitiesRequest,
  type ListEnrolledStudentsClassPcActivityRequest,
  type RemoveClassPcActivityRequest,
  type RosterStatusClassPcActivityRequest,
} from "../model/class-pc-activity-model";
import type { PCActivityResponse } from "../model/pc-activity-model";
import { ClassPcActivityValidation } from "../validation/class-pc-activity-validation";
import { Validation } from "../validation/validation";
import { AuditService } from "./audit-service";
import { PCActivityService, assertActivityAllowsUnitId, resolveMentorForActivityUnit } from "./pc-activity-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { getUniqueConstraintFields } from "../utils/prisma-error";

function bulkFailureMessage(error: unknown): string {
  if (error instanceof ResponseError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

async function assertWriteAllowed(
  admin: AdminUser,
  context: AuditRequestContext,
  now: Date,
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
  }
}

async function findClassWithUnit(classId: string) {
  const klass = await prismaClient.class.findUnique({
    where: { id: classId },
    include: { grade: { select: { unit_id: true } } },
  });
  if (!klass) {
    throw new ResponseError(404, "Class not found");
  }
  return klass;
}

function assertClassInAdminUnit(admin: AdminUser, unitId: string): void {
  if (admin.role === AdminRole.DATABASE_ADMIN && unitId !== admin.unit_id) {
    throw new ResponseError(
      403,
      "Forbidden: This class is outside your unit scope",
    );
  }
}

const OFFERING_INCLUDE = {
  activity: true,
  // Includes the student's current_class_id so the response can count only
  // students still on this offering's own roster - a student who's moved
  // to another class keeps an active row (surfaced, never auto-removed,
  // see listEnrolledStudents' still_on_roster) but shouldn't inflate the
  // headline count shown on the offering card.
  student_links: {
    where: { deleted_at: null },
    select: { id: true, student: { select: { current_class_id: true } } },
  },
} as const;

export class ClassPcActivityService {
  static async list(
    admin: AdminUser,
    request: ListClassPcActivitiesRequest,
  ): Promise<ClassPcActivityOfferingResponse[]> {
    const klass = await findClassWithUnit(request.class_id);
    assertClassInAdminUnit(admin, klass.grade.unit_id);

    const offerings = await prismaClient.classPassionConnectionActivity.findMany({
      where: { class_id: request.class_id, deleted_at: null },
      include: OFFERING_INCLUDE,
      orderBy: { created_at: "asc" },
    });

    const responses: ClassPcActivityOfferingResponse[] = [];
    for (const offering of offerings) {
      const mentor = await resolveMentorForActivityUnit(
        offering.activity_id,
        klass.grade.unit_id,
      );
      responses.push(toClassPcActivityOfferingResponse(offering, mentor));
    }
    return responses;
  }

  static async assign(
    admin: AdminUser,
    request: AssignClassPcActivityRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<ClassPcActivityOfferingResponse> {
    await assertWriteAllowed(admin, context, now);

    const assignRequest = Validation.validate(
      ClassPcActivityValidation.ASSIGN,
      request,
    );

    const klass = await findClassWithUnit(assignRequest.class_id);
    assertClassInAdminUnit(admin, klass.grade.unit_id);

    const activity = await prismaClient.masterPCActivity.findUnique({
      where: { id: assignRequest.activity_id },
    });
    if (!activity) {
      throw new ResponseError(400, "Invalid PC activity: activity not found");
    }
    await assertActivityAllowsUnitId(assignRequest.activity_id, klass.grade.unit_id);

    const academicYearId =
      assignRequest.academic_year_id ?? klass.academic_year_id;

    let createdId: string;
    try {
      createdId = await prismaClient.$transaction(async (tx) => {
        const offering = await tx.classPassionConnectionActivity.create({
          data: {
            class_id: assignRequest.class_id,
            activity_id: assignRequest.activity_id,
            academic_year_id: academicYearId,
            day: assignRequest.day,
            created_by: admin.id,
          },
        });

        await AuditService.record(
          {
            action: AuditAction.CREATE_CLASS_PC_ACTIVITY,
            source: AuditSource.UI,
            entity_type: "ClassPassionConnectionActivity",
            entity_id: offering.id,
            admin_id: admin.id,
            new_values: {
              class_id: offering.class_id,
              activity_id: offering.activity_id,
              academic_year_id: offering.academic_year_id,
              day: offering.day,
            },
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return offering.id;
      });
    } catch (error) {
      const fields = getUniqueConstraintFields(error);
      if (fields?.includes("class_id")) {
        throw new ResponseError(
          400,
          "This activity is already registered for this class on this day and academic year.",
        );
      }
      throw error;
    }

    const created = await prismaClient.classPassionConnectionActivity.findUniqueOrThrow({
      where: { id: createdId },
      include: OFFERING_INCLUDE,
    });
    const mentor = await resolveMentorForActivityUnit(created.activity_id, klass.grade.unit_id);
    return toClassPcActivityOfferingResponse(created, mentor);
  }

  static async remove(
    admin: AdminUser,
    request: RemoveClassPcActivityRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<void> {
    await assertWriteAllowed(admin, context, now);

    const removeRequest = Validation.validate(
      ClassPcActivityValidation.REMOVE,
      request,
    );

    const klass = await findClassWithUnit(removeRequest.class_id);
    assertClassInAdminUnit(admin, klass.grade.unit_id);

    const existing = await prismaClient.classPassionConnectionActivity.findFirst({
      where: { id: removeRequest.id, class_id: removeRequest.class_id, deleted_at: null },
      include: { student_links: { where: { deleted_at: null }, select: { id: true } } },
    });
    if (!existing) {
      throw new ResponseError(404, "Class PC activity not found");
    }
    if (existing.student_links.length > 0) {
      throw new ResponseError(
        400,
        "Remove enrolled students from this activity before removing it from the class.",
      );
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.classPassionConnectionActivity.update({
        where: { id: existing.id },
        data: { deleted_at: now },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_CLASS_PC_ACTIVITY,
          source: AuditSource.UI,
          entity_type: "ClassPassionConnectionActivity",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: { class_id: existing.class_id, activity_id: existing.activity_id },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });
  }

  static async bulkEnrollStudents(
    admin: AdminUser,
    request: BulkEnrollClassPcActivityStudentsRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkActionResponse<PCActivityResponse>> {
    await assertWriteAllowed(admin, context, now);

    const bulkRequest = Validation.validate(
      ClassPcActivityValidation.BULK_ENROLL_STUDENTS,
      request,
    );

    const klass = await findClassWithUnit(bulkRequest.class_id);
    assertClassInAdminUnit(admin, klass.grade.unit_id);

    const offering = await prismaClient.classPassionConnectionActivity.findFirst({
      where: { id: bulkRequest.class_activity_id, class_id: bulkRequest.class_id, deleted_at: null },
    });
    if (!offering) {
      throw new ResponseError(404, "Class PC activity not found");
    }

    // Restrict enrollment to students currently on this class's roster.
    const rosterStudentIds = new Set(
      (
        await prismaClient.student.findMany({
          where: { current_class_id: bulkRequest.class_id, deleted_at: null, status: "ACTIVE" },
          select: { id: true },
        })
      ).map((student) => student.id),
    );

    const items: BulkActionItemResponse<PCActivityResponse>[] = [];
    for (const studentId of bulkRequest.student_ids) {
      try {
        if (!rosterStudentIds.has(studentId)) {
          throw new ResponseError(400, "Student is not on this class's roster");
        }
        const created = await PCActivityService.create(
          admin,
          {
            student_id: studentId,
            day: offering.day,
            activity_id: offering.activity_id,
            academic_year_id: offering.academic_year_id,
            class_activity_id: offering.id,
          },
          context,
          now,
        );
        items.push({ id: studentId, status: "SUCCESS", data: created });
      } catch (error) {
        items.push({ id: studentId, status: "FAILED", error: bulkFailureMessage(error) });
      }
    }

    const response = toBulkActionResponse(items);
    await AuditService.record({
      action: AuditAction.BULK_ENROLL_CLASS_PC_ACTIVITY,
      source: AuditSource.UI,
      entity_type: "ClassPassionConnectionActivity",
      entity_id: offering.id,
      admin_id: admin.id,
      new_values: {
        class_id: bulkRequest.class_id,
        success_count: response.success_count,
        failed_count: response.failed_count,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });
    return response;
  }

  static async rosterStatus(
    admin: AdminUser,
    request: RosterStatusClassPcActivityRequest,
  ): Promise<ClassPcActivityRosterStatusResponse[]> {
    const klass = await findClassWithUnit(request.class_id);
    assertClassInAdminUnit(admin, klass.grade.unit_id);

    const offering = await prismaClient.classPassionConnectionActivity.findFirst({
      where: { id: request.class_activity_id, class_id: request.class_id, deleted_at: null },
    });
    if (!offering) {
      throw new ResponseError(404, "Class PC activity not found");
    }

    const rosterStudentIds = (
      await prismaClient.student.findMany({
        where: { current_class_id: request.class_id, deleted_at: null, status: "ACTIVE" },
        select: { id: true },
      })
    ).map((student) => student.id);

    const activityRows = await prismaClient.passionConnectionActivity.findMany({
      where: {
        student_id: { in: rosterStudentIds },
        deleted_at: null,
        academic_year_id: offering.academic_year_id,
      },
      include: { activity: { select: { name: true } } },
    });
    const rowsByStudentId = new Map<string, typeof activityRows>();
    for (const row of activityRows) {
      const existing = rowsByStudentId.get(row.student_id) ?? [];
      existing.push(row);
      rowsByStudentId.set(row.student_id, existing);
    }

    return rosterStudentIds.map((studentId) => {
      const rows = rowsByStudentId.get(studentId) ?? [];
      const alreadyEnrolled = rows.some((row) => row.class_activity_id === offering.id);
      // One active PC activity per student per academic year - any other
      // active row this year is a conflict, regardless of day.
      const conflict = rows.find((row) => row.class_activity_id !== offering.id);
      return {
        student_id: studentId,
        already_enrolled: alreadyEnrolled,
        other_activity: conflict
          ? {
              activity_name: conflict.activity.name,
              day: conflict.day,
              class_activity_id: conflict.class_activity_id,
            }
          : null,
      };
    });
  }

  static async listEnrolledStudents(
    admin: AdminUser,
    request: ListEnrolledStudentsClassPcActivityRequest,
  ): Promise<ClassPcActivityEnrolledStudentResponse[]> {
    const klass = await findClassWithUnit(request.class_id);
    assertClassInAdminUnit(admin, klass.grade.unit_id);

    const offering = await prismaClient.classPassionConnectionActivity.findFirst({
      where: { id: request.class_activity_id, class_id: request.class_id, deleted_at: null },
    });
    if (!offering) {
      throw new ResponseError(404, "Class PC activity not found");
    }

    const rows = await prismaClient.passionConnectionActivity.findMany({
      where: { class_activity_id: offering.id },
      include: { student: { include: { person: { select: { full_name: true } } } } },
      orderBy: [{ deleted_at: "asc" }, { created_at: "asc" }],
    });

    return rows.map((row) => ({
      id: row.id,
      student_id: row.student_id,
      student_name: row.student.person.full_name,
      nis: row.student.nis,
      day: row.day,
      deleted_at: row.deleted_at?.toISOString() ?? null,
      still_on_roster: row.student.current_class_id === offering.class_id,
    }));
  }
}
