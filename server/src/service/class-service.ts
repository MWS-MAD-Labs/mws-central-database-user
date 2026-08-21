import {
  AcademicYearStatus,
  AdminRole,
  AuditAction,
  AuditSource,
  ClassStatus,
  ClassTeacherRole,
  EmployeeStatus,
  EnrollmentStatus,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toClassAuditSnapshot,
  toClassTeacherAssignmentResponse,
  toEmployeeTeachingAssignmentResponse,
  toClassResponse,
  type AssignClassTeacherRequest,
  type ClassEnrollmentHistoryCounts,
  type ClassTeacherAssignmentResponse,
  type ClassTeacherAssignmentWithClass,
  type ClassTeacherAssignmentWithEmployee,
  type ClassResponse,
  type ClassSortField,
  type ClassWithRelations,
  type CreateClassRequest,
  type EmployeeTeachingAssignmentResponse,
  type DeleteClassRequest,
  type EndClassTeacherAssignmentRequest,
  type RemoveClassTeacherAssignmentRequest,
  type ReopenClassTeacherAssignmentRequest,
  type BulkMoveClassTeacherAssignmentRequest,
  type GetClassRequest,
  type SearchClassRequest,
  type UpdateClassRequest,
} from "../model/class-model";
import { paginate, type Pageable } from "../model/page-model";
import {
  toBulkActionResponse,
  type BulkActionItemResponse,
  type BulkActionResponse,
} from "../model/bulk-action-model";
import { AuditService } from "./audit-service";
import { ClassValidation } from "../validation/class-validation";
import { Validation } from "../validation/validation";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import { assertCanWriteNow } from "../utils/office-hours";

// Capacity override is gone (see assertClassHasCapacity in
// enrollment-service.ts) - a class created with no capacity at all would be
// uncappable by anyone. Applied only at create; an admin can still raise or
// null out capacity afterward via Update Class.
const DEFAULT_CLASS_CAPACITY = 30;

function bulkFailureMessage(error: unknown): string {
  if (error instanceof ResponseError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

async function recordUnauthorizedClassAction(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
  classId?: string,
): Promise<void> {
  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    new_values: {
      reason: `blocked class ${action}`,
      ...(classId ? { class_id: classId } : {}),
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

// Database Admin can manage classes, but only within their own unit - a
// Junior High admin can't touch a Kindergarten class. Grade is the only
// place a class's unit is recorded (see Grade.unit_id).
function assertDatabaseAdminCanWriteClass(
  admin: AdminUser,
): void {
  if (!admin.can_write_data) {
    throw new ResponseError(
      403,
      "Forbidden: You don't have permission to write data",
    );
  }
}

const CLASS_INCLUDE = {
  grade: true,
  academic_year: true,
  // All three roles - subject teachers have no per-employee cap (unlike
  // HOMEROOM/SUPPORTING_HOMEROOM, see ROLE_CAPPED_PER_TEACHER_PER_YEAR),
  // but the list response still needs a count for the "+N Subject" badge.
  teacher_assignments: {
    where: {
      role: {
        in: [
          ClassTeacherRole.HOMEROOM,
          ClassTeacherRole.SUPPORTING_HOMEROOM,
          ClassTeacherRole.SUBJECT_TEACHER,
        ] as ClassTeacherRole[],
      },
      end_date: null,
      deleted_at: null,
    },
    include: { employee: { include: { person: true } } },
    orderBy: { start_date: "asc" as const },
  },
} as const;

// A class's status must stay plausible for its academic year's own status:
// - ACTIVE year: class can be ACTIVE, INACTIVE, or UPCOMING (e.g. next
//   year's classes being prepared ahead of time while this year is live)
// - UPCOMING year: class can be UPCOMING or INACTIVE, never ACTIVE - a
//   class can't be "live" before its own year has started
// - COMPLETED year: class can only be INACTIVE
// Deactivating ACTIVE classes when a year stops being ACTIVE, and
// activating UPCOMING/INACTIVE ones when a year starts, are handled
// separately (cascade in AcademicYearService.update); this only guards
// against setting a class status that contradicts its year, on the class
// side. Accepts an already-fetched year to avoid a duplicate lookup when
// the caller needs the year for other reasons too (e.g. create()'s
// smart default).
async function assertClassStatusMatchesAcademicYear(
  status: ClassStatus,
  academicYearId: string,
  prefetchedYear?: { status: AcademicYearStatus; name: string } | null,
): Promise<void> {
  if (status === ClassStatus.INACTIVE) return;

  const academicYear =
    prefetchedYear !== undefined
      ? prefetchedYear
      : await prismaClient.academicYear.findUnique({
          where: { id: academicYearId },
          select: { status: true, name: true },
        });
  if (!academicYear) return;

  if (
    status === ClassStatus.ACTIVE &&
    academicYear.status !== AcademicYearStatus.ACTIVE
  ) {
    throw new ResponseError(
      400,
      `Cannot set class to ACTIVE: academic year "${academicYear.name}" is ${academicYear.status}, not ACTIVE.`,
    );
  }
  if (
    status === ClassStatus.UPCOMING &&
    academicYear.status === AcademicYearStatus.COMPLETED
  ) {
    throw new ResponseError(
      400,
      `Cannot set class to UPCOMING: academic year "${academicYear.name}" is COMPLETED.`,
    );
  }
}

type ClassEnrollmentCounts = {
  active: number;
  history: ClassEnrollmentHistoryCounts;
};

// Single groupBy covering every status, so callers who want the active count
// alongside the transferred/withdrawn/completed breakdown (see ClassesPanel.jsx)
// don't have to issue two separate queries.
async function getClassEnrollmentCounts(
  classId: string,
): Promise<ClassEnrollmentCounts> {
  const groups = await prismaClient.studentClassEnrollment.groupBy({
    by: ["enrollment_status"],
    where: { class_id: classId, deleted_at: null },
    _count: { _all: true },
  });
  return classEnrollmentCountsFromGroups(groups);
}

type ClassDeleteBlockers = {
  currentStudentCount: number;
  enrollmentCount: number;
  teacherAssignmentCount: number;
};

// Same three counts ClassService.remove() rejects on, batched across
// however many class ids are asked for - one call for a single class
// (get/remove), one call for a whole page (search), instead of a query per
// row. enrollmentCount deliberately has no deleted_at filter, unlike
// getClassEnrollmentCounts above: a soft-deleted enrollment row still holds
// the FK to Class and still blocks a real delete. teacherAssignmentCount is
// the same story, but for a different reason - ClassTeacherAssignment's FK
// to Class is ON DELETE CASCADE (not RESTRICT like enrollments), so nothing
// stops a raw delete from silently wiping every teacher's history on this
// class. This check exists purely to force a conscious reassign/remove
// first, matching the same "referenced by X" pattern as students.
async function getClassDeleteBlockers(
  classIds: string[],
): Promise<Map<string, ClassDeleteBlockers>> {
  const map = new Map<string, ClassDeleteBlockers>();
  for (const id of classIds) {
    map.set(id, {
      currentStudentCount: 0,
      enrollmentCount: 0,
      teacherAssignmentCount: 0,
    });
  }
  if (classIds.length === 0) return map;

  const [studentGroups, enrollmentGroups, teacherAssignmentGroups] =
    await Promise.all([
      prismaClient.student.groupBy({
        by: ["current_class_id"],
        where: { current_class_id: { in: classIds } },
        _count: { _all: true },
      }),
      prismaClient.studentClassEnrollment.groupBy({
        by: ["class_id"],
        where: { class_id: { in: classIds } },
        _count: { _all: true },
      }),
      prismaClient.classTeacherAssignment.groupBy({
        by: ["class_id"],
        where: { class_id: { in: classIds } },
        _count: { _all: true },
      }),
    ]);

  for (const group of studentGroups) {
    if (!group.current_class_id) continue;
    map.get(group.current_class_id)!.currentStudentCount = group._count._all;
  }
  for (const group of enrollmentGroups) {
    map.get(group.class_id)!.enrollmentCount = group._count._all;
  }
  for (const group of teacherAssignmentGroups) {
    map.get(group.class_id)!.teacherAssignmentCount = group._count._all;
  }
  return map;
}

function classEnrollmentCountsFromGroups(
  groups: { enrollment_status: EnrollmentStatus; _count: { _all: number } }[],
): ClassEnrollmentCounts {
  const history: ClassEnrollmentHistoryCounts = {
    transferred: 0,
    withdrawn: 0,
    completed: 0,
  };
  let active = 0;
  for (const group of groups) {
    if (group.enrollment_status === EnrollmentStatus.ACTIVE) {
      active = group._count._all;
    } else if (group.enrollment_status === EnrollmentStatus.TRANSFERRED) {
      history.transferred = group._count._all;
    } else if (group.enrollment_status === EnrollmentStatus.WITHDRAWN) {
      history.withdrawn = group._count._all;
    } else if (group.enrollment_status === EnrollmentStatus.COMPLETED) {
      history.completed = group._count._all;
    }
  }
  return { active, history };
}

// Shared by every teacher role (homeroom, supporting, subject) - all of
// them need an active, teaching-eligible employee, regardless of how many
// classes that employee ends up assigned to.
async function assertTeacherIsActive(employeeId: string): Promise<void> {
  const teacher = await prismaClient.employee.findUnique({
    where: { id: employeeId },
    select: {
      status: true,
      deleted_at: true,
      job_level: { select: { is_teaching_role: true } },
    },
  });
  if (
    !teacher ||
    teacher.deleted_at !== null ||
    teacher.status !== EmployeeStatus.ACTIVE ||
    !teacher.job_level.is_teaching_role
  ) {
    throw new ResponseError(
      400,
      "Invalid teacher: referenced employee does not exist, is not active, or does not hold a teaching-eligible job level",
    );
  }
}

// A teacher can only be assigned to a class whose grade belongs to their
// own unit (e.g. a Junior High employee can't homeroom a Kindergarten
// class). Fails closed if the class's grade has no unit configured -
// that's a data-quality gap, not an exemption.
async function assertTeacherUnitMatchesClass(
  employeeId: string,
  classId: string,
): Promise<void> {
  const [teacher, klass] = await Promise.all([
    prismaClient.employee.findUnique({
      where: { id: employeeId },
      select: { unit_id: true },
    }),
    prismaClient.class.findUnique({
      where: { id: classId },
      select: { grade: { select: { unit_id: true, name: true } } },
    }),
  ]);

  if (!klass?.grade.unit_id) {
    throw new ResponseError(
      400,
      `Cannot assign teacher: this class's grade ("${klass?.grade.name ?? "unknown"}") has no unit configured.`,
    );
  }
  if (teacher?.unit_id !== klass.grade.unit_id) {
    throw new ResponseError(
      400,
      "Invalid teacher: employee's unit does not match this class's unit.",
    );
  }
}

// Real job position names are plain "<Subject> Teacher" (e.g. "Coding
// Teacher", "Music Teacher"), not a "Subject Teacher - <subject>" pattern -
// so eligibility for SUBJECT_TEACHER is everyone with a teaching position
// EXCEPT the two that are structurally something else: "Homeroom Teacher"
// (its own role) and "Special Education Teacher" (its own per-student
// assignment system, see student-support-assignment-service.ts).
const NON_SUBJECT_TEACHING_POSITIONS = new Set([
  "homeroom teacher",
  "special education teacher",
]);

// HOMEROOM/SUPPORTING_HOMEROOM eligibility isn't just "any teaching job
// level" (assertTeacherIsActive above only checks that much) - it's
// specifically the "Homeroom Teacher" position. A Math Teacher or SE
// Teacher holding a teaching job level shouldn't be pickable for either
// role, only someone whose actual job position is homeroom.
async function assertHasHomeroomPosition(employeeId: string): Promise<void> {
  const teacher = await prismaClient.employee.findUnique({
    where: { id: employeeId },
    select: { job_position: { select: { name: true } } },
  });
  if (teacher?.job_position.name.trim().toLowerCase() !== "homeroom teacher") {
    throw new ResponseError(
      400,
      `Invalid teacher: employee's job position ("${teacher?.job_position.name ?? "unknown"}") must be "Homeroom Teacher" for this role.`,
    );
  }
}

async function assertHasSubjectTeacherPosition(
  employeeId: string,
): Promise<void> {
  const teacher = await prismaClient.employee.findUnique({
    where: { id: employeeId },
    select: {
      job_position: { select: { name: true, is_teaching_position: true } },
    },
  });
  if (
    !teacher?.job_position.is_teaching_position ||
    NON_SUBJECT_TEACHING_POSITIONS.has(
      teacher.job_position.name.trim().toLowerCase(),
    )
  ) {
    throw new ResponseError(
      400,
      `Invalid teacher: employee's job position ("${teacher?.job_position.name ?? "unknown"}") is not a subject-teaching position.`,
    );
  }
}

const DUPLICATE_CLASS_NAME_MESSAGE =
  "A class with this name already exists for this academic year";

// HOMEROOM and SUPPORTING_HOMEROOM: one employee can only hold one active
// assignment of that role per academic year (across all classes).
// SUBJECT_TEACHER has no such cap - one teacher can teach several
// classes/grades at once (e.g. a Music teacher across grades 3-5).
const ROLE_CAPPED_PER_TEACHER_PER_YEAR = new Set<ClassTeacherRole>([
  ClassTeacherRole.HOMEROOM,
  ClassTeacherRole.SUPPORTING_HOMEROOM,
]);

async function assertTeacherNotAlreadyAssignedThisRoleElsewhere(
  employeeId: string,
  academicYearId: string,
  role: ClassTeacherRole,
): Promise<void> {
  const conflicting = await prismaClient.classTeacherAssignment.findFirst({
    where: {
      employee_id: employeeId,
      role,
      end_date: null,
      deleted_at: null,
      class: { academic_year_id: academicYearId },
    },
  });
  if (conflicting) {
    throw new ResponseError(
      400,
      `This employee already holds an active ${role} assignment in another class this academic year.`,
    );
  }
}

function rethrowAsFriendlyClassConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("name")) {
    throw new ResponseError(400, DUPLICATE_CLASS_NAME_MESSAGE);
  }
  throw error;
}

export class ClassService {
  static async create(
    admin: AdminUser,
    request: CreateClassRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<ClassResponse> {
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedClassAction(admin, "create", context);
      throw new ResponseError(403, "Forbidden: Viewer cannot create data");
    }
    if (admin.role === AdminRole.DATABASE_ADMIN) {
      assertDatabaseAdminCanWriteClass(admin);
      await assertCanWriteNow(admin, context, now);
    }

    const createRequest = Validation.validate(ClassValidation.CREATE, request);

    if (admin.role === AdminRole.DATABASE_ADMIN) {
      const grade = await prismaClient.grade.findUnique({
        where: { id: createRequest.grade_id },
        select: { unit_id: true },
      });
      if (!grade || grade.unit_id !== admin.unit_id) {
        await recordUnauthorizedClassAction(admin, "create", context);
        throw new ResponseError(
          403,
          "Forbidden: You can only create classes within your unit scope",
        );
      }
    }

    const duplicate = await prismaClient.class.findFirst({
      where: {
        name: createRequest.name,
        academic_year_id: createRequest.academic_year_id,
      },
    });
    if (duplicate) {
      throw new ResponseError(
        400,
        "A class with this name already exists for this academic year",
      );
    }

    const targetYear = await prismaClient.academicYear.findUnique({
      where: { id: createRequest.academic_year_id },
      select: { status: true, name: true },
    });
    // No explicit status given - default to whatever's actually plausible
    // for the target year, instead of always ACTIVE. Prepping a class ahead
    // of time for an UPCOMING year would otherwise always need an explicit
    // status: "INACTIVE"/"UPCOMING" or it 400s against the matrix below.
    const effectiveStatus =
      createRequest.status ??
      (targetYear?.status === AcademicYearStatus.ACTIVE
        ? ClassStatus.ACTIVE
        : targetYear?.status === AcademicYearStatus.UPCOMING
          ? ClassStatus.UPCOMING
          : ClassStatus.INACTIVE);

    await assertClassStatusMatchesAcademicYear(
      effectiveStatus,
      createRequest.academic_year_id,
      targetYear,
    );

    let klass: ClassWithRelations;
    try {
      klass = await prismaClient.$transaction(async (tx) => {
        const created = await tx.class.create({
          data: {
            name: createRequest.name,
            grade_id: createRequest.grade_id,
            academic_year_id: createRequest.academic_year_id,
            status: effectiveStatus,
            capacity: createRequest.capacity ?? DEFAULT_CLASS_CAPACITY,
          },
          include: CLASS_INCLUDE,
        });

        await AuditService.record(
          {
            action: AuditAction.CREATE_CLASS,
            source: AuditSource.UI,
            entity_type: "Class",
            entity_id: created.id,
            admin_id: admin.id,
            new_values: toClassAuditSnapshot(created),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return created;
      });
    } catch (error) {
      rethrowAsFriendlyClassConflict(error);
    }

    return toClassResponse(klass, 0);
  }

  static async update(
    admin: AdminUser,
    request: UpdateClassRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<ClassResponse> {
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedClassAction(admin, "update", context);
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }
    if (admin.role === AdminRole.DATABASE_ADMIN) {
      assertDatabaseAdminCanWriteClass(admin);
      await assertCanWriteNow(admin, context, now);
    }

    const updateRequest = Validation.validate(ClassValidation.UPDATE, request);

    const existing = await prismaClient.class.findUnique({
      where: { id: updateRequest.id },
      include: { grade: { select: { unit_id: true } } },
    });
    if (!existing) {
      throw new ResponseError(404, "Class not found");
    }

    if (admin.role === AdminRole.DATABASE_ADMIN) {
      if (existing.grade.unit_id !== admin.unit_id) {
        await recordUnauthorizedClassAction(
          admin,
          "update",
          context,
          existing.id,
        );
        throw new ResponseError(
          403,
          "Forbidden: This class is outside your unit scope",
        );
      }
      if (updateRequest.grade_id) {
        const nextGrade = await prismaClient.grade.findUnique({
          where: { id: updateRequest.grade_id },
          select: { unit_id: true },
        });
        if (!nextGrade || nextGrade.unit_id !== admin.unit_id) {
          await recordUnauthorizedClassAction(
            admin,
            "update",
            context,
            existing.id,
          );
          throw new ResponseError(
            403,
            "Forbidden: You can only move a class to a grade within your unit scope",
          );
        }
      }
    }

    // Teacher assignments (any role) are only valid within the class's own
    // unit (see assertTeacherUnitMatchesClass, checked at assign time) - a
    // grade change can silently move a class into a different unit (e.g.
    // Elementary -> Junior High), leaving its current teachers assigned to
    // a class outside their own unit. Same lock-once-populated approach as
    // the academic_year_id check below: block the change and make the admin
    // end the mismatched assignments first, rather than silently ending
    // them here without anyone noticing.
    if (updateRequest.grade_id && updateRequest.grade_id !== existing.grade_id) {
      const nextGrade = await prismaClient.grade.findUnique({
        where: { id: updateRequest.grade_id },
        select: { unit_id: true, name: true },
      });
      if (!nextGrade?.unit_id) {
        throw new ResponseError(
          400,
          `Cannot change grade: "${nextGrade?.name ?? "unknown"}" has no unit configured.`,
        );
      }
      const mismatchedAssignments = await prismaClient.classTeacherAssignment.findMany({
        where: {
          class_id: existing.id,
          end_date: null,
          deleted_at: null,
          employee: { unit_id: { not: nextGrade.unit_id } },
        },
        include: { employee: { include: { person: true } } },
      });
      if (mismatchedAssignments.length > 0) {
        const names = mismatchedAssignments
          .map((assignment) => assignment.employee.person.full_name)
          .join(", ");
        throw new ResponseError(
          400,
          `Cannot change grade: ${mismatchedAssignments.length} active teacher assignment(s) (${names}) would no longer match the new grade's unit. End those assignments first.`,
        );
      }
    }

    const nextName = updateRequest.name ?? existing.name;
    const nextAcademicYearId =
      updateRequest.academic_year_id ?? existing.academic_year_id;

    if (nextAcademicYearId !== existing.academic_year_id) {
      // Every enrollment tied to this class snapshots academic_year_id at
      // create time (see EnrollmentService). Moving the class to a
      // different year afterward leaves those rows pointing at a year the
      // class no longer actually belongs to - breaks the (student_id,
      // academic_year_id) uniqueness check, date-range validation on
      // promote/transfer/close, and any reporting filtered by year. Once a
      // class has ever had an enrollment (active or historical), its year
      // is locked; an empty class can still be corrected freely.
      const enrollmentCount = await prismaClient.studentClassEnrollment.count(
        { where: { class_id: existing.id, deleted_at: null } },
      );
      if (enrollmentCount > 0) {
        throw new ResponseError(
          400,
          `Cannot change academic year: this class has ${enrollmentCount} enrollment record(s).`,
        );
      }
    }

    if (
      nextName !== existing.name ||
      nextAcademicYearId !== existing.academic_year_id
    ) {
      const duplicate = await prismaClient.class.findFirst({
        where: {
          name: nextName,
          academic_year_id: nextAcademicYearId,
          id: { not: updateRequest.id },
        },
      });
      if (duplicate) {
        throw new ResponseError(
          400,
          "A class with this name already exists for this academic year",
        );
      }
    }

    await assertClassStatusMatchesAcademicYear(
      updateRequest.status ?? existing.status,
      nextAcademicYearId,
    );

    let klass: ClassWithRelations;
    try {
      klass = await prismaClient.$transaction(async (tx) => {
        const updated = await tx.class.update({
          where: { id: updateRequest.id },
          data: {
            name: updateRequest.name,
            grade_id: updateRequest.grade_id,
            academic_year_id: updateRequest.academic_year_id,
            status: updateRequest.status,
            capacity: updateRequest.capacity,
          },
          include: CLASS_INCLUDE,
        });

        await AuditService.record(
          {
            action: AuditAction.UPDATE_CLASS,
            source: AuditSource.UI,
            entity_type: "Class",
            entity_id: updated.id,
            admin_id: admin.id,
            old_values: toClassAuditSnapshot(existing),
            new_values: toClassAuditSnapshot(updated),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return updated;
      });
    } catch (error) {
      rethrowAsFriendlyClassConflict(error);
    }

    const counts = await getClassEnrollmentCounts(klass.id);
    const blockers = (await getClassDeleteBlockers([klass.id])).get(klass.id)!;
    return toClassResponse(
      klass,
      counts.active,
      counts.history,
      blockers.currentStudentCount > 0 ||
        blockers.enrollmentCount > 0 ||
        blockers.teacherAssignmentCount > 0,
    );
  }

  static async remove(
    admin: AdminUser,
    request: DeleteClassRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete a class",
      );
    }

    const deleteRequest = Validation.validate(ClassValidation.DELETE, request);

    const existing = await prismaClient.class.findUnique({
      where: { id: deleteRequest.id },
    });
    if (!existing) {
      throw new ResponseError(404, "Class not found");
    }

    const { currentStudentCount, enrollmentCount, teacherAssignmentCount } = (
      await getClassDeleteBlockers([deleteRequest.id])
    ).get(deleteRequest.id)!;

    const usages: string[] = [];
    if (currentStudentCount > 0) {
      usages.push(`${currentStudentCount} student(s) currently assigned`);
    }
    if (enrollmentCount > 0) {
      usages.push(`${enrollmentCount} enrollment(s)`);
    }
    if (teacherAssignmentCount > 0) {
      usages.push(`${teacherAssignmentCount} teacher assignment(s)`);
    }

    if (usages.length > 0) {
      throw new ResponseError(
        400,
        `Cannot delete: this class is still referenced by ${usages.join(", ")}. Reassign or remove those first.`,
      );
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.class.delete({
        where: { id: deleteRequest.id },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_CLASS,
          source: AuditSource.UI,
          entity_type: "Class",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: toClassAuditSnapshot(existing),
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
    request: GetClassRequest,
  ): Promise<ClassResponse> {
    void admin;

    const klass = await prismaClient.class.findUnique({
      where: { id: request.id },
      include: CLASS_INCLUDE,
    });
    if (!klass) {
      throw new ResponseError(404, "Class not found");
    }

    const counts = await getClassEnrollmentCounts(klass.id);
    const blockers = (await getClassDeleteBlockers([klass.id])).get(klass.id)!;
    return toClassResponse(
      klass,
      counts.active,
      counts.history,
      blockers.currentStudentCount > 0 ||
        blockers.enrollmentCount > 0 ||
        blockers.teacherAssignmentCount > 0,
    );
  }

  // Returns every teacher assignment for the class - homeroom (history),
  // supporting homeroom, and subject teacher rows all live in the same
  // table now, distinguished by `role`.
  static async getTeacherAssignments(
    admin: AdminUser,
    request: GetClassRequest,
  ): Promise<ClassTeacherAssignmentResponse[]> {
    void admin;

    const klass = await prismaClient.class.findUnique({
      where: { id: request.id },
    });
    if (!klass) {
      throw new ResponseError(404, "Class not found");
    }

    const assignments: ClassTeacherAssignmentWithEmployee[] =
      await prismaClient.classTeacherAssignment.findMany({
        where: { class_id: request.id, deleted_at: null },
        include: { employee: { include: { person: true } } },
        orderBy: { start_date: "desc" },
      });

    return assignments.map(toClassTeacherAssignmentResponse);
  }

  // Reverse direction of getTeacherAssignments - which classes has this
  // employee taught, across every academic year. Read-only, same
  // unrestricted access as the class-side query (teaching assignments
  // aren't sensitive data).
  static async getEmployeeTeachingAssignments(
    admin: AdminUser,
    employeeId: string,
  ): Promise<EmployeeTeachingAssignmentResponse[]> {
    void admin;

    const employee = await prismaClient.employee.findFirst({
      where: { id: employeeId, deleted_at: null },
    });
    if (!employee) {
      throw new ResponseError(404, "Employee not found");
    }

    const assignments: ClassTeacherAssignmentWithClass[] =
      await prismaClient.classTeacherAssignment.findMany({
        where: { employee_id: employeeId, deleted_at: null },
        include: { class: { include: { grade: true, academic_year: true } } },
        orderBy: { start_date: "desc" },
      });

    return assignments.map(toEmployeeTeachingAssignmentResponse);
  }

  // Adds a HOMEROOM, SUPPORTING_HOMEROOM or SUBJECT_TEACHER assignment. A
  // class can have several simultaneously active assignments of any role;
  // see ROLE_CAPPED_PER_TEACHER_PER_YEAR for the per-employee cap that
  // still applies to HOMEROOM/SUPPORTING_HOMEROOM but not SUBJECT_TEACHER.
  static async assignTeacher(
    admin: AdminUser,
    request: AssignClassTeacherRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<ClassTeacherAssignmentResponse> {
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedClassAction(admin, "assign teacher", context);
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }
    if (admin.role === AdminRole.DATABASE_ADMIN) {
      assertDatabaseAdminCanWriteClass(admin);
      await assertCanWriteNow(admin, context, now);
    }

    const assignRequest = Validation.validate(
      ClassValidation.ASSIGN_TEACHER,
      request,
    );

    const klass = await prismaClient.class.findUnique({
      where: { id: assignRequest.class_id },
      include: { grade: { select: { unit_id: true } } },
    });
    if (!klass) {
      throw new ResponseError(404, "Class not found");
    }

    if (
      admin.role === AdminRole.DATABASE_ADMIN &&
      klass.grade.unit_id !== admin.unit_id
    ) {
      await recordUnauthorizedClassAction(
        admin,
        "assign teacher",
        context,
        klass.id,
      );
      throw new ResponseError(
        403,
        "Forbidden: This class is outside your unit scope",
      );
    }

    await assertTeacherIsActive(assignRequest.employee_id);
    await assertTeacherUnitMatchesClass(
      assignRequest.employee_id,
      assignRequest.class_id,
    );

    if (
      assignRequest.role === ClassTeacherRole.HOMEROOM ||
      assignRequest.role === ClassTeacherRole.SUPPORTING_HOMEROOM
    ) {
      await assertHasHomeroomPosition(assignRequest.employee_id);
    } else if (assignRequest.role === ClassTeacherRole.SUBJECT_TEACHER) {
      await assertHasSubjectTeacherPosition(assignRequest.employee_id);
    }

    if (ROLE_CAPPED_PER_TEACHER_PER_YEAR.has(assignRequest.role)) {
      await assertTeacherNotAlreadyAssignedThisRoleElsewhere(
        assignRequest.employee_id,
        klass.academic_year_id,
        assignRequest.role,
      );
    }

    const duplicate = await prismaClient.classTeacherAssignment.findFirst({
      where: {
        class_id: assignRequest.class_id,
        employee_id: assignRequest.employee_id,
        role: assignRequest.role,
        subject: assignRequest.subject ?? null,
        end_date: null,
        deleted_at: null,
      },
    });
    if (duplicate) {
      throw new ResponseError(
        400,
        "This employee already has an active assignment with this exact role/subject for this class.",
      );
    }

    const createdId = await prismaClient.$transaction(async (tx) => {
      const created = await tx.classTeacherAssignment.create({
        data: {
          class_id: assignRequest.class_id,
          employee_id: assignRequest.employee_id,
          role: assignRequest.role,
          subject: assignRequest.subject,
        },
      });

      await AuditService.record(
        {
          action: AuditAction.ASSIGN_CLASS_TEACHER,
          source: AuditSource.UI,
          entity_type: "ClassTeacherAssignment",
          entity_id: created.id,
          admin_id: admin.id,
          new_values: {
            class_id: created.class_id,
            employee_id: created.employee_id,
            role: created.role,
            subject: created.subject,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return created.id;
    });

    const withEmployee =
      await prismaClient.classTeacherAssignment.findUniqueOrThrow({
        where: { id: createdId },
        include: { employee: { include: { person: true } } },
      });

    return toClassTeacherAssignmentResponse(withEmployee);
  }

  static async endTeacherAssignment(
    admin: AdminUser,
    request: EndClassTeacherAssignmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<ClassTeacherAssignmentResponse> {
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedClassAction(admin, "end teacher assignment", context);
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }
    if (admin.role === AdminRole.DATABASE_ADMIN) {
      assertDatabaseAdminCanWriteClass(admin);
      await assertCanWriteNow(admin, context, now);
    }

    const endRequest = Validation.validate(
      ClassValidation.END_TEACHER_ASSIGNMENT,
      request,
    );

    const existing = await prismaClient.classTeacherAssignment.findFirst({
      where: { id: endRequest.id, class_id: endRequest.class_id, deleted_at: null },
      include: { class: { include: { grade: { select: { unit_id: true } } } } },
    });
    if (!existing) {
      throw new ResponseError(404, "Teacher assignment not found");
    }
    if (existing.end_date !== null) {
      throw new ResponseError(400, "This assignment has already ended");
    }

    if (
      admin.role === AdminRole.DATABASE_ADMIN &&
      existing.class.grade.unit_id !== admin.unit_id
    ) {
      await recordUnauthorizedClassAction(
        admin,
        "end teacher assignment",
        context,
        existing.class_id,
      );
      throw new ResponseError(
        403,
        "Forbidden: This class is outside your unit scope",
      );
    }

    await prismaClient.$transaction(async (tx) => {
      const updated = await tx.classTeacherAssignment.update({
        where: { id: existing.id },
        data: { end_date: new Date() },
      });

      await AuditService.record(
        {
          action: AuditAction.END_CLASS_TEACHER_ASSIGNMENT,
          source: AuditSource.UI,
          entity_type: "ClassTeacherAssignment",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: { end_date: null },
          new_values: { end_date: updated.end_date?.toISOString() ?? null },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const updated = await prismaClient.classTeacherAssignment.findUniqueOrThrow({
      where: { id: existing.id },
      include: { employee: { include: { person: true } } },
    });

    return toClassTeacherAssignmentResponse(updated);
  }

  // "Roll a teacher forward" - e.g. this year's Homeroom Teacher for Grade
  // 7A moving to next year's Grade 8A. Each assignment goes through the
  // exact same assignTeacher()/endTeacherAssignment() single-item paths
  // (so unit/position/capacity/duplicate checks all still apply on the
  // target class), just looped with a per-item result instead of one
  // request per teacher. Non-atomic across items and across the two steps,
  // matching every other bulk action in this codebase - a failure on one
  // teacher (or on ending the old assignment after the new one succeeded)
  // is reported per-item rather than rolling back the whole batch.
  static async bulkMoveTeacherAssignments(
    admin: AdminUser,
    request: BulkMoveClassTeacherAssignmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkActionResponse<ClassTeacherAssignmentResponse>> {
    // Same top-level gate assignTeacher()/endTeacherAssignment() each do -
    // hoisted here so a VIEWER (or an out-of-unit DATABASE_ADMIN) gets one
    // real 403 instead of every item in the batch failing individually.
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedClassAction(
        admin,
        "bulk move teacher assignments",
        context,
        request.class_id,
      );
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }
    if (admin.role === AdminRole.DATABASE_ADMIN) {
      assertDatabaseAdminCanWriteClass(admin);
      await assertCanWriteNow(admin, context, now);
    }

    const bulkRequest = Validation.validate(
      ClassValidation.BULK_MOVE_TEACHER_ASSIGNMENTS,
      request,
    );

    const items: BulkActionItemResponse<ClassTeacherAssignmentResponse>[] = [];

    for (const assignmentId of bulkRequest.assignment_ids) {
      try {
        const existing = await prismaClient.classTeacherAssignment.findFirst({
          where: {
            id: assignmentId,
            class_id: bulkRequest.class_id,
            deleted_at: null,
          },
        });
        if (!existing) {
          throw new ResponseError(404, "Teacher assignment not found");
        }

        const created = await ClassService.assignTeacher(
          admin,
          {
            class_id: bulkRequest.target_class_id,
            employee_id: existing.employee_id,
            role: existing.role,
            subject: existing.subject ?? undefined,
          },
          context,
          now,
        );

        await ClassService.endTeacherAssignment(
          admin,
          { id: existing.id, class_id: existing.class_id },
          context,
          now,
        );

        items.push({ id: assignmentId, status: "SUCCESS", data: created });
      } catch (error) {
        items.push({
          id: assignmentId,
          status: "FAILED",
          error: bulkFailureMessage(error),
        });
      }
    }

    return toBulkActionResponse(items);
  }

  // For mistake corrections (wrong employee/class assigned), not for closing
  // a legitimately-finished assignment - that's endTeacherAssignment. Soft-deletes
  // regardless of whether the assignment is currently open or already ended.
  static async removeTeacherAssignment(
    admin: AdminUser,
    request: RemoveClassTeacherAssignmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<void> {
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedClassAction(admin, "remove teacher assignment", context);
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }
    if (admin.role === AdminRole.DATABASE_ADMIN) {
      assertDatabaseAdminCanWriteClass(admin);
      await assertCanWriteNow(admin, context, now);
    }

    const removeRequest = Validation.validate(
      ClassValidation.REMOVE_TEACHER_ASSIGNMENT,
      request,
    );

    const existing = await prismaClient.classTeacherAssignment.findFirst({
      where: { id: removeRequest.id, class_id: removeRequest.class_id, deleted_at: null },
      include: { class: { include: { grade: { select: { unit_id: true } } } } },
    });
    if (!existing) {
      throw new ResponseError(404, "Teacher assignment not found");
    }

    if (
      admin.role === AdminRole.DATABASE_ADMIN &&
      existing.class.grade.unit_id !== admin.unit_id
    ) {
      await recordUnauthorizedClassAction(
        admin,
        "remove teacher assignment",
        context,
        existing.class_id,
      );
      throw new ResponseError(
        403,
        "Forbidden: This class is outside your unit scope",
      );
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.classTeacherAssignment.update({
        where: { id: existing.id },
        data: { deleted_at: new Date() },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_CLASS_TEACHER_ASSIGNMENT,
          source: AuditSource.UI,
          entity_type: "ClassTeacherAssignment",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: {
            employee_id: existing.employee_id,
            role: existing.role,
            subject: existing.subject,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });
  }

  // Undoes an accidental End click - clears end_date on an already-ended
  // assignment. Distinct from removeTeacherAssignment: this is for "I ended
  // the wrong one," not "I assigned the wrong employee/class entirely."
  static async reopenTeacherAssignment(
    admin: AdminUser,
    request: ReopenClassTeacherAssignmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<ClassTeacherAssignmentResponse> {
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedClassAction(admin, "reopen teacher assignment", context);
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }
    if (admin.role === AdminRole.DATABASE_ADMIN) {
      assertDatabaseAdminCanWriteClass(admin);
      await assertCanWriteNow(admin, context, now);
    }

    const reopenRequest = Validation.validate(
      ClassValidation.REOPEN_TEACHER_ASSIGNMENT,
      request,
    );

    const existing = await prismaClient.classTeacherAssignment.findFirst({
      where: { id: reopenRequest.id, class_id: reopenRequest.class_id, deleted_at: null },
      include: { class: { include: { grade: { select: { unit_id: true } } } } },
    });
    if (!existing) {
      throw new ResponseError(404, "Teacher assignment not found");
    }
    if (existing.end_date === null) {
      throw new ResponseError(400, "This assignment has not ended");
    }

    if (
      admin.role === AdminRole.DATABASE_ADMIN &&
      existing.class.grade.unit_id !== admin.unit_id
    ) {
      await recordUnauthorizedClassAction(
        admin,
        "reopen teacher assignment",
        context,
        existing.class_id,
      );
      throw new ResponseError(
        403,
        "Forbidden: This class is outside your unit scope",
      );
    }

    if (ROLE_CAPPED_PER_TEACHER_PER_YEAR.has(existing.role)) {
      await assertTeacherNotAlreadyAssignedThisRoleElsewhere(
        existing.employee_id,
        existing.class.academic_year_id,
        existing.role,
      );
    }

    await prismaClient.$transaction(async (tx) => {
      const updated = await tx.classTeacherAssignment.update({
        where: { id: existing.id },
        data: { end_date: null },
      });

      await AuditService.record(
        {
          action: AuditAction.REOPEN_CLASS_TEACHER_ASSIGNMENT,
          source: AuditSource.UI,
          entity_type: "ClassTeacherAssignment",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: { end_date: existing.end_date?.toISOString() ?? null },
          new_values: { end_date: updated.end_date?.toISOString() ?? null },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const updated = await prismaClient.classTeacherAssignment.findUniqueOrThrow({
      where: { id: existing.id },
      include: { employee: { include: { person: true } } },
    });

    return toClassTeacherAssignmentResponse(updated);
  }

  static async search(
    admin: AdminUser,
    request: SearchClassRequest,
  ): Promise<Pageable<ClassResponse>> {
    void admin;

    const searchRequest = Validation.validate(ClassValidation.SEARCH, request);

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const where = {
      name: searchRequest.search
        ? { contains: searchRequest.search, mode: "insensitive" as const }
        : undefined,
      grade_id: searchRequest.grade_id,
      academic_year_id: searchRequest.academic_year_id,
      status: searchRequest.status,
    };

    return paginate(searchRequest.page, searchRequest.size, {
      count: () => prismaClient.class.count({ where }),
      findMany: async () => {
        const classes = await prismaClient.class.findMany({
          where,
          include: CLASS_INCLUDE,
          take: searchRequest.size,
          skip,
          orderBy: buildClassOrderBy(
            searchRequest.sort_by || "created_at",
            searchRequest.sort_order || "desc",
          ),
        });
        if (classes.length === 0) return [];

        const groups = await prismaClient.studentClassEnrollment.groupBy({
          by: ["class_id", "enrollment_status"],
          where: {
            class_id: { in: classes.map((klass) => klass.id) },
            deleted_at: null,
          },
          _count: { _all: true },
        });
        const groupsByClassId = new Map<
          string,
          { enrollment_status: EnrollmentStatus; _count: { _all: number } }[]
        >();
        for (const group of groups) {
          const existing = groupsByClassId.get(group.class_id) ?? [];
          existing.push(group);
          groupsByClassId.set(group.class_id, existing);
        }
        const blockersByClassId = await getClassDeleteBlockers(
          classes.map((klass) => klass.id),
        );
        return classes.map((klass) => {
          const counts = classEnrollmentCountsFromGroups(
            groupsByClassId.get(klass.id) ?? [],
          );
          const blockers = blockersByClassId.get(klass.id)!;
          return toClassResponse(
            klass,
            counts.active,
            counts.history,
            blockers.currentStudentCount > 0 ||
        blockers.enrollmentCount > 0 ||
        blockers.teacherAssignmentCount > 0,
          );
        });
      },
    });
  }
}

function buildClassOrderBy(sortBy: ClassSortField, sortOrder: "asc" | "desc") {
  if (sortBy === "grade_level") {
    return { grade: { level: sortOrder } };
  }
  return { [sortBy]: sortOrder };
}
