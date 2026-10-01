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
  type Prisma,
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
  type BulkEndClassTeacherAssignmentRequest,
  type BulkRemoveClassTeacherAssignmentRequest,
  type BulkReopenClassTeacherAssignmentRequest,
  type BulkUpdateClassTeacherAssignmentStartDateRequest,
  type ClassTeacherCandidateResponse,
  type GetClassRequest,
  type SearchClassRequest,
  type SearchClassTeacherCandidatesRequest,
  type UpdateClassTeacherAssignmentStartDateRequest,
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
import {
  assertCanManageTeacherAssignments,
  assertCanViewAcademicData,
  assertCanViewEmployeeData,
  canViewEmployeeData,
  resolveAcademicUnitScope,
  resolveEmployeeUnitScope,
  type AdminUserWithAcademicScope,
  type AdminUserWithEmployeeScope,
} from "../utils/admin-permissions";
import { lockInternWorkforce } from "../utils/intern-workforce-lock";

// New classes require capacity; updates may raise or clear it.
const DEFAULT_CLASS_CAPACITY = 30;

function bulkFailureMessage(error: unknown): string {
  if (error instanceof ResponseError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

async function classAssignmentWorkforceAuditValues(
  employeeId?: string | null,
  internId?: string | null,
) {
  if (employeeId) {
    const employee = await prismaClient.employee.findUniqueOrThrow({
      where: { id: employeeId },
      include: { person: true },
    });
    return {
      member_type: "EMPLOYEE",
      member_id: employee.id,
      member_name: employee.person.full_name,
      employee_id: employee.id,
      intern_id: null,
    };
  }

  const intern = await prismaClient.intern.findUniqueOrThrow({
    where: { id: internId! },
  });
  return {
    member_type: "INTERN",
    member_id: intern.id,
    member_name: intern.full_name,
    employee_id: null,
    intern_id: intern.id,
  };
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
    entity_type: "Class",
    entity_id: classId,
    new_values: {
      reason: `blocked class ${action}`,
      ...(classId ? { class_id: classId } : {}),
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

// Class CRUD uses student permission; teacher assignments use employee permission.
// Database Admin access is limited to the class grade's unit.
function assertDatabaseAdminCanWriteClass(
  admin: AdminUser,
  domain: "student" | "employee",
): void {
  const allowed =
    domain === "student"
      ? admin.can_write_student_data
      : admin.can_write_employee_data;
  if (!allowed) {
    throw new ResponseError(
      403,
      `Forbidden: You don't have permission to write ${domain} data`,
    );
  }
}

const CLASS_INCLUDE = {
  grade: { include: { unit: true } },
  additional_grades: { include: { grade: true } },
  academic_year: true,
  // Count all roles; subject teachers have no per-employee cap.
  teacher_assignments: {
    where: {
      role: {
        in: [
          ClassTeacherRole.HOMEROOM,
          ClassTeacherRole.SUPPORTING_HOMEROOM,
          ClassTeacherRole.SUBJECT_TEACHER,
        ] as ClassTeacherRole[],
      },
      // Ended assignments are filtered by date in toClassResponse, so one that
      // ends in the future (a carry-over) still shows until it actually ends.
      deleted_at: null,
    },
    include: { employee: { include: { person: true } }, intern: true },
    orderBy: { start_date: "asc" as const },
  },
} as const;

// Allowed class states: ACTIVE year = any; UPCOMING = UPCOMING/INACTIVE; COMPLETED = INACTIVE.
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

// Active classes cannot close before the shared transition window.
const CLASS_STATUS_TRANSITION_WINDOW_DAYS = 30;

function assertClassLeavingActiveNotTooEarly(
  academicYear: { name: string; end_date: Date | null } | null,
  now: Date,
): void {
  if (!academicYear?.end_date) return;

  const daysUntilEnd =
    (academicYear.end_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (daysUntilEnd > CLASS_STATUS_TRANSITION_WINDOW_DAYS) {
    throw new ResponseError(
      400,
      `Too early to move this class out of Active - "${academicYear.name}" doesn't end until ${academicYear.end_date.toISOString().slice(0, 10)}. This opens ${CLASS_STATUS_TRANSITION_WINDOW_DAYS} days before the academic year ends.`,
    );
  }
}

// A cross-year promotion only makes sense once the source year is actually
// ending; a same-year move has no such window (it's how a teacher gets
// reassigned mid-semester, which can happen any time).
function assertTeacherPromotionNotTooEarly(
  academicYear: { name: string; end_date: Date | null },
  now: Date,
): void {
  if (!academicYear.end_date) return;

  const daysUntilEnd =
    (academicYear.end_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (daysUntilEnd > CLASS_STATUS_TRANSITION_WINDOW_DAYS) {
    throw new ResponseError(
      400,
      `Too early to promote - "${academicYear.name}" doesn't end until ${academicYear.end_date.toISOString().slice(0, 10)}. Promotion opens ${CLASS_STATUS_TRANSITION_WINDOW_DAYS} days before an academic year ends.`,
    );
  }
}

// Confirmation may override active roster checks, not the date gate.
async function assertClassHasNoActiveOccupants(
  classId: string,
  confirmed: boolean | undefined,
): Promise<void> {
  if (confirmed) return;

  const [activeEnrollmentCount, activeTeacherCount] = await Promise.all([
    prismaClient.studentClassEnrollment.count({
      where: {
        class_id: classId,
        enrollment_status: EnrollmentStatus.ACTIVE,
        deleted_at: null,
      },
    }),
    prismaClient.classTeacherAssignment.count({
      where: { class_id: classId, end_date: null, deleted_at: null },
    }),
  ]);

  if (activeEnrollmentCount === 0 && activeTeacherCount === 0) return;

  const parts: string[] = [];
  if (activeEnrollmentCount > 0) {
    parts.push(`${activeEnrollmentCount} active student(s)`);
  }
  if (activeTeacherCount > 0) {
    parts.push(`${activeTeacherCount} active teacher assignment(s)`);
  }

  throw new ResponseError(
    400,
    `Cannot change status: this class still has ${parts.join(" and ")}. Promote/transfer/close the students and end the teacher assignments first, or set confirm_unresolved_occupants to proceed anyway.`,
  );
}

type ClassEnrollmentCounts = {
  active: number;
  history: ClassEnrollmentHistoryCounts;
};

// Group all enrollment statuses in one query.
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
  roomScopeCount: number;
};

// Count all enrollment FKs and teacher history before delete.
async function getClassDeleteBlockers(
  classIds: string[],
): Promise<Map<string, ClassDeleteBlockers>> {
  const map = new Map<string, ClassDeleteBlockers>();
  for (const id of classIds) {
    map.set(id, {
      currentStudentCount: 0,
      enrollmentCount: 0,
      teacherAssignmentCount: 0,
      roomScopeCount: 0,
    });
  }
  if (classIds.length === 0) return map;

  const [studentGroups, enrollmentGroups, teacherAssignmentGroups, roomScopeGroups] =
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
      prismaClient.pcActivityRoomClass.groupBy({
        by: ["class_id"],
        where: { class_id: { in: classIds }, room: { deleted_at: null } },
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
  for (const group of roomScopeGroups) {
    map.get(group.class_id)!.roomScopeCount = group._count._all;
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

async function assertWorkforceMemberIsActive(
  tx: Prisma.TransactionClient,
  employeeId: string | undefined,
  internId: string | undefined,
  role: ClassTeacherRole,
  now: Date,
): Promise<void> {
  if (internId) {
    if (role === ClassTeacherRole.HOMEROOM) {
      throw new ResponseError(
        400,
        "Interns cannot be assigned as the primary homeroom teacher. Use Supporting Homeroom.",
      );
    }
    const intern = await tx.intern.findUnique({
      where: { id: internId },
      select: {
        status: true,
        deleted_at: true,
        end_date: true,
        job_position: { select: { name: true, is_teaching_position: true } },
      },
    });
    if (
      !intern ||
      intern.deleted_at ||
      intern.status !== "ACTIVE" ||
      intern.end_date <= now ||
      !intern.job_position.is_teaching_position
    ) {
      throw new ResponseError(
        400,
        "Invalid intern: the intern must be active, current, and teaching-eligible.",
      );
    }
    if (
      role === ClassTeacherRole.SUBJECT_TEACHER &&
      NON_SUBJECT_TEACHING_POSITIONS.has(
        intern.job_position.name.trim().toLowerCase(),
      )
    ) {
      throw new ResponseError(
        400,
        `Invalid teacher: intern's job position ("${intern.job_position.name}") is not a subject-teaching position.`,
      );
    }
    return;
  }
  if (!employeeId)
    throw new ResponseError(400, "A workforce member is required");
  const teacher = await tx.employee.findUnique({
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

// Teacher and class units must match; a missing class unit fails closed.
async function assertTeacherUnitMatchesClass(
  tx: Prisma.TransactionClient,
  employeeId: string | undefined,
  internId: string | undefined,
  classId: string,
): Promise<void> {
  const teacher = employeeId
    ? await tx.employee.findUnique({
        where: { id: employeeId },
        select: { unit_id: true },
      })
    : null;
  const intern = internId
    ? await tx.intern.findUnique({
        where: { id: internId },
        select: { unit_id: true },
      })
    : null;
  const klass = await tx.class.findUnique({
    where: { id: classId },
    select: { grade: { select: { unit_id: true, name: true } } },
  });

  if (!klass?.grade.unit_id) {
    throw new ResponseError(
      400,
      `Cannot assign teacher: this class's grade ("${klass?.grade.name ?? "unknown"}") has no unit configured.`,
    );
  }
  if ((teacher?.unit_id ?? intern?.unit_id) !== klass.grade.unit_id) {
    throw new ResponseError(
      400,
      "Invalid teacher: employee's unit does not match this class's unit.",
    );
  }
}

// Subject teachers exclude Homeroom and Special Education positions.
const NON_SUBJECT_TEACHING_POSITIONS = new Set([
  "homeroom teacher",
  "special education teacher",
]);

// Homeroom roles require the Homeroom Teacher position.
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

// Homeroom roles are capped once per employee and year; subject roles are not.
const ROLE_CAPPED_PER_TEACHER_PER_YEAR = new Set<ClassTeacherRole>([
  ClassTeacherRole.HOMEROOM,
  ClassTeacherRole.SUPPORTING_HOMEROOM,
]);

function assertAssignmentStartDate(
  startDate: Date,
  academicYear: { name: string; start_date: Date; end_date: Date | null },
  now: Date,
  allowFuture = false,
): void {
  if (
    startDate < academicYear.start_date ||
    (academicYear.end_date && startDate > academicYear.end_date)
  ) {
    throw new ResponseError(
      400,
      `Start date must fall within ${academicYear.name}'s date range`,
    );
  }
  if (!allowFuture && startDate > now) {
    throw new ResponseError(400, "Start date cannot be in the future");
  }
}

async function assertTeacherNotAlreadyAssignedThisRoleElsewhere(
  tx: Prisma.TransactionClient,
  employeeId: string | undefined,
  internId: string | undefined,
  academicYearId: string,
  role: ClassTeacherRole,
): Promise<void> {
  const conflicting = await tx.classTeacherAssignment.findFirst({
    where: {
      employee_id: employeeId,
      intern_id: internId,
      role,
      end_date: null,
      deleted_at: null,
      class: { academic_year_id: academicYearId },
    },
  });
  if (conflicting) {
    throw new ResponseError(
      400,
      `This workforce member already holds an active ${role} assignment in another class this academic year.`,
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
      assertDatabaseAdminCanWriteClass(admin, "student");
      await assertCanWriteNow(admin, context, now);
    }

    const createRequest = Validation.validate(ClassValidation.CREATE, request);

    const primaryGrade = await prismaClient.grade.findUnique({
      where: { id: createRequest.grade_id },
      select: { unit_id: true },
    });

    if (admin.role === AdminRole.DATABASE_ADMIN) {
      if (!primaryGrade || primaryGrade.unit_id !== admin.unit_id) {
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

    // Dedupe and drop anything that just repeats the primary grade - a class
    // isn't "mixed" if its "additional" grade is the same one it already has.
    const additionalGradeIds = [
      ...new Set(createRequest.additional_grade_ids ?? []),
    ].filter((id) => id !== createRequest.grade_id);
    if (additionalGradeIds.length > 0) {
      const additionalGrades = await prismaClient.grade.findMany({
        where: { id: { in: additionalGradeIds } },
        select: { id: true, unit_id: true },
      });
      if (additionalGrades.length !== additionalGradeIds.length) {
        throw new ResponseError(
          400,
          "One or more additional grades were not found",
        );
      }
      // All grades in a mixed-age class must share one unit.
      if (
        additionalGrades.some(
          (grade) => grade.unit_id !== primaryGrade?.unit_id,
        )
      ) {
        throw new ResponseError(
          400,
          "Additional grades must be in the same unit as the class's primary grade",
        );
      }
    }

    const targetYear = await prismaClient.academicYear.findUnique({
      where: { id: createRequest.academic_year_id },
      select: { status: true, name: true },
    });
    // Default status follows the target academic year.
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

    let klassId: string;
    try {
      klassId = await prismaClient.$transaction(async (tx) => {
        // Fetch nested relations after the transaction to avoid connection races.
        const created = await tx.class.create({
          data: {
            name: createRequest.name,
            grade_id: createRequest.grade_id,
            academic_year_id: createRequest.academic_year_id,
            status: effectiveStatus,
            capacity: createRequest.capacity ?? DEFAULT_CLASS_CAPACITY,
          },
        });

        if (additionalGradeIds.length > 0) {
          await tx.classAdditionalGrade.createMany({
            data: additionalGradeIds.map((grade_id) => ({
              class_id: created.id,
              grade_id,
            })),
          });
        }

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

        return created.id;
      });
    } catch (error) {
      rethrowAsFriendlyClassConflict(error);
    }

    const klass = await prismaClient.class.findUniqueOrThrow({
      where: { id: klassId },
      include: CLASS_INCLUDE,
    });

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
      assertDatabaseAdminCanWriteClass(admin, "student");
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

    // Reuse the changed primary grade for scope and mixed-age validation.
    const primaryGradeChanging =
      updateRequest.grade_id !== undefined &&
      updateRequest.grade_id !== existing.grade_id;
    const nextPrimaryGrade = primaryGradeChanging
      ? await prismaClient.grade.findUnique({
          where: { id: updateRequest.grade_id },
          select: { unit_id: true },
        })
      : null;

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
      if (
        primaryGradeChanging &&
        (!nextPrimaryGrade || nextPrimaryGrade.unit_id !== admin.unit_id)
      ) {
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

    // Omission preserves additional grades; an array replaces them.
    let additionalGradeIds: string[] | undefined;
    if (updateRequest.additional_grade_ids !== undefined) {
      const nextGradeId = updateRequest.grade_id ?? existing.grade_id;
      additionalGradeIds = [
        ...new Set(updateRequest.additional_grade_ids),
      ].filter((id) => id !== nextGradeId);
    } else if (primaryGradeChanging) {
      // Remove the new primary grade from the existing additional set.
      const existingAdditional =
        await prismaClient.classAdditionalGrade.findMany({
          where: { class_id: existing.id },
          select: { grade_id: true },
        });
      if (existingAdditional.length > 0) {
        additionalGradeIds = existingAdditional
          .map((entry) => entry.grade_id)
          .filter((id) => id !== updateRequest.grade_id);
      }
    }

    if (additionalGradeIds && additionalGradeIds.length > 0) {
      const additionalGrades = await prismaClient.grade.findMany({
        where: { id: { in: additionalGradeIds } },
        select: { id: true, unit_id: true },
      });
      if (additionalGrades.length !== additionalGradeIds.length) {
        throw new ResponseError(
          400,
          "One or more additional grades were not found",
        );
      }
      // All grades in a mixed-age class must share one unit.
      const primaryUnitId = primaryGradeChanging
        ? nextPrimaryGrade?.unit_id
        : existing.grade.unit_id;
      if (additionalGrades.some((grade) => grade.unit_id !== primaryUnitId)) {
        throw new ResponseError(
          400,
          "Additional grades must be in the same unit as the class's primary grade",
        );
      }
    }

    // End mismatched teacher assignments before moving a class between units.
    if (
      updateRequest.grade_id &&
      updateRequest.grade_id !== existing.grade_id
    ) {
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
      const mismatchedAssignments =
        await prismaClient.classTeacherAssignment.findMany({
          where: {
            class_id: existing.id,
            end_date: null,
            deleted_at: null,
            employee: { unit_id: { not: nextGrade.unit_id } },
          },
          include: { employee: { include: { person: true } }, intern: true },
        });
      if (mismatchedAssignments.length > 0) {
        const names = mismatchedAssignments
          .map(
            (assignment) =>
              assignment.employee?.person.full_name ??
              assignment.intern?.full_name ??
              "Unknown",
          )
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
      // Enrollment history locks the class academic year.
      const enrollmentCount = await prismaClient.studentClassEnrollment.count({
        where: { class_id: existing.id, deleted_at: null },
      });
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

    const nextAcademicYear = await prismaClient.academicYear.findUnique({
      where: { id: nextAcademicYearId },
      select: { status: true, name: true, end_date: true },
    });

    // Leaving active applies the hard date gate and overridable roster gate.
    const leavingActive =
      existing.status === ClassStatus.ACTIVE &&
      updateRequest.status !== undefined &&
      updateRequest.status !== ClassStatus.ACTIVE;
    if (leavingActive) {
      assertClassLeavingActiveNotTooEarly(nextAcademicYear, now);
      await assertClassHasNoActiveOccupants(
        existing.id,
        updateRequest.confirm_unresolved_occupants,
      );
    }

    await assertClassStatusMatchesAcademicYear(
      updateRequest.status ?? existing.status,
      nextAcademicYearId,
      nextAcademicYear,
    );

    let klassId: string;
    try {
      klassId = await prismaClient.$transaction(async (tx) => {
        // Bare write, no include - see the same note in create() above.
        const updated = await tx.class.update({
          where: { id: updateRequest.id },
          data: {
            name: updateRequest.name,
            grade_id: updateRequest.grade_id,
            academic_year_id: updateRequest.academic_year_id,
            status: updateRequest.status,
            capacity: updateRequest.capacity,
          },
        });

        if (additionalGradeIds !== undefined) {
          await tx.classAdditionalGrade.deleteMany({
            where: { class_id: updated.id },
          });
          if (additionalGradeIds.length > 0) {
            await tx.classAdditionalGrade.createMany({
              data: additionalGradeIds.map((grade_id) => ({
                class_id: updated.id,
                grade_id,
              })),
            });
          }
        }

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

        return updated.id;
      });
    } catch (error) {
      rethrowAsFriendlyClassConflict(error);
    }

    const klass = await prismaClient.class.findUniqueOrThrow({
      where: { id: klassId },
      include: CLASS_INCLUDE,
    });

    const counts = await getClassEnrollmentCounts(klass.id);
    const blockers = (await getClassDeleteBlockers([klass.id])).get(klass.id)!;
    const response = toClassResponse(
      klass,
      counts.active,
      counts.history,
      blockers.currentStudentCount > 0 ||
        blockers.enrollmentCount > 0 ||
        blockers.teacherAssignmentCount > 0 ||
        blockers.roomScopeCount > 0,
    );
    if (!canViewEmployeeData(admin)) {
      response.homeroom_teachers = [];
      response.supporting_homeroom_teachers = [];
      response.subject_teachers = [];
    }
    return response;
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

    const { currentStudentCount, enrollmentCount, teacherAssignmentCount, roomScopeCount } = (
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
    if (roomScopeCount > 0) {
      usages.push(`${roomScopeCount} PC activity room(s) scoped to this class`);
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
    admin: AdminUserWithAcademicScope,
    request: GetClassRequest,
  ): Promise<ClassResponse> {
    assertCanViewAcademicData(admin);
    const klass = await prismaClient.class.findUnique({
      where: { id: request.id },
      include: CLASS_INCLUDE,
    });
    if (!klass) {
      throw new ResponseError(404, "Class not found");
    }

    const unitScope = resolveAcademicUnitScope(admin);
    if (unitScope !== undefined && !unitScope.includes(klass.grade.unit_id)) {
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
        blockers.teacherAssignmentCount > 0 ||
        blockers.roomScopeCount > 0,
    );
  }

  // Return every teacher role and its history for the class.
  static async getTeacherAssignments(
    admin: AdminUserWithEmployeeScope,
    request: GetClassRequest,
  ): Promise<ClassTeacherAssignmentResponse[]> {
    assertCanViewEmployeeData(admin);
    const klass = await prismaClient.class.findUnique({
      where: { id: request.id },
      include: { grade: { select: { unit_id: true } } },
    });
    if (!klass) {
      throw new ResponseError(404, "Class not found");
    }
    const unitScope = resolveEmployeeUnitScope(admin);
    if (unitScope !== undefined && !unitScope.includes(klass.grade.unit_id)) {
      throw new ResponseError(404, "Class not found");
    }

    const assignments: ClassTeacherAssignmentWithEmployee[] =
      await prismaClient.classTeacherAssignment.findMany({
        where: { class_id: request.id, deleted_at: null },
        include: { employee: { include: { person: true } }, intern: true },
        orderBy: { start_date: "desc" },
      });

    return assignments.map(toClassTeacherAssignmentResponse);
  }

  static async searchTeacherCandidates(
    admin: AdminUserWithEmployeeScope,
    request: SearchClassTeacherCandidatesRequest,
    now: Date = new Date(),
  ): Promise<Pageable<ClassTeacherCandidateResponse>> {
    assertCanViewEmployeeData(admin);
    const searchRequest = Validation.validate(
      ClassValidation.SEARCH_TEACHER_CANDIDATES,
      request,
    );
    const klass = await prismaClient.class.findUnique({
      where: { id: searchRequest.class_id },
      include: { grade: true },
    });
    if (!klass) throw new ResponseError(404, "Class not found");
    const unitScope = resolveEmployeeUnitScope(admin);
    if (unitScope !== undefined && !unitScope.includes(klass.grade.unit_id)) {
      throw new ResponseError(404, "Class not found");
    }

    const capped = ROLE_CAPPED_PER_TEACHER_PER_YEAR.has(searchRequest.role);
    const search = searchRequest.search?.trim();
    const [employees, interns] = await Promise.all([
      prismaClient.employee.findMany({
        where: {
          deleted_at: null,
          status: EmployeeStatus.ACTIVE,
          unit_id: klass.grade.unit_id,
          job_level: { is_teaching_role: true },
          ...(searchRequest.role === ClassTeacherRole.HOMEROOM ||
          searchRequest.role === ClassTeacherRole.SUPPORTING_HOMEROOM
            ? { job_position: { name: { equals: "Homeroom Teacher", mode: "insensitive" } } }
            : {
                job_position: {
                  is_teaching_position: true,
                  name: { notIn: ["Homeroom Teacher", "Special Education Teacher"] },
                },
              }),
          ...(search
            ? {
                OR: [
                  { employee_id: { contains: search, mode: "insensitive" } },
                  { person: { full_name: { contains: search, mode: "insensitive" } } },
                  { person: { email: { contains: search, mode: "insensitive" } } },
                ],
              }
            : {}),
          ...(capped
            ? {
                class_assignments: {
                  none: {
                    role: searchRequest.role,
                    end_date: null,
                    deleted_at: null,
                    class: { academic_year_id: klass.academic_year_id },
                  },
                },
              }
            : {}),
        },
        include: { person: true, job_position: true },
      }),
      searchRequest.role === ClassTeacherRole.HOMEROOM
        ? Promise.resolve([])
        : prismaClient.intern.findMany({
            where: {
              deleted_at: null,
              status: "ACTIVE",
              end_date: { gt: now },
              unit_id: klass.grade.unit_id,
              job_position: {
                is_teaching_position: true,
                ...(searchRequest.role === ClassTeacherRole.SUBJECT_TEACHER
                  ? { name: { notIn: ["Homeroom Teacher", "Special Education Teacher"] } }
                  : {}),
              },
              ...(search
                ? {
                    OR: [
                      { full_name: { contains: search, mode: "insensitive" } },
                      { email: { contains: search, mode: "insensitive" } },
                    ],
                  }
                : {}),
              ...(capped
                ? {
                    class_assignments: {
                      none: {
                        role: searchRequest.role,
                        end_date: null,
                        deleted_at: null,
                        class: { academic_year_id: klass.academic_year_id },
                      },
                    },
                  }
                : {}),
            },
            include: { job_position: true },
          }),
    ]);

    const candidates: ClassTeacherCandidateResponse[] = [
      ...employees.map((employee) => ({
        id: employee.id,
        type: "EMPLOYEE" as const,
        employee_id: employee.employee_id,
        full_name: employee.person.full_name,
        email: employee.person.email,
        unit_id: employee.unit_id,
        job_position: employee.job_position.name,
      })),
      ...interns.map((intern) => ({
        id: intern.id,
        type: "INTERN" as const,
        employee_id: null,
        full_name: intern.full_name,
        email: intern.email,
        unit_id: intern.unit_id,
        job_position: intern.job_position.name,
      })),
    ].sort((a, b) =>
      a.full_name.localeCompare(b.full_name, undefined, { sensitivity: "base" }),
    );
    const start = (searchRequest.page - 1) * searchRequest.size;
    return {
      data: candidates.slice(start, start + searchRequest.size),
      paging: {
        size: searchRequest.size,
        current_page: searchRequest.page,
        total_page: Math.ceil(candidates.length / searchRequest.size),
        total_item: candidates.length,
      },
    };
  }

  // Return the employee's teaching history across academic years.
  static async getEmployeeTeachingAssignments(
    admin: AdminUserWithEmployeeScope,
    employeeId: string,
  ): Promise<EmployeeTeachingAssignmentResponse[]> {
    assertCanViewEmployeeData(admin);

    const employee = await prismaClient.employee.findFirst({
      where: { id: employeeId, deleted_at: null },
      select: { unit_id: true },
    });
    if (!employee) {
      throw new ResponseError(404, "Employee not found");
    }
    const unitScope = resolveEmployeeUnitScope(admin);
    if (unitScope !== undefined && !unitScope.includes(employee.unit_id)) {
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

  // Return the intern's teaching history across academic years.
  static async getInternTeachingAssignments(
    admin: AdminUserWithEmployeeScope,
    internId: string,
  ): Promise<EmployeeTeachingAssignmentResponse[]> {
    assertCanViewEmployeeData(admin);
    const intern = await prismaClient.intern.findFirst({
      where: { id: internId, deleted_at: null },
      select: { unit_id: true },
    });
    if (!intern) {
      throw new ResponseError(404, "Intern not found");
    }
    const unitScope = resolveEmployeeUnitScope(admin);
    if (unitScope !== undefined && !unitScope.includes(intern.unit_id)) {
      throw new ResponseError(404, "Intern not found");
    }

    const assignments: ClassTeacherAssignmentWithClass[] =
      await prismaClient.classTeacherAssignment.findMany({
        where: { intern_id: internId, deleted_at: null },
        include: { class: { include: { grade: true, academic_year: true } } },
        orderBy: { start_date: "desc" },
      });

    return assignments.map(toEmployeeTeachingAssignmentResponse);
  }

  // Homeroom roles have per-employee yearly caps; subject teachers do not.
  static async assignTeacher(
    admin: AdminUser,
    request: AssignClassTeacherRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
    allowFutureStart = false,
  ): Promise<ClassTeacherAssignmentResponse> {
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedClassAction(admin, "assign teacher", context);
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }
    if (admin.role === AdminRole.DATABASE_ADMIN) {
      assertCanManageTeacherAssignments(admin);
      await assertCanWriteNow(admin, context, now);
    }

    const assignRequest = Validation.validate(
      ClassValidation.ASSIGN_TEACHER,
      request,
    );

    const klass = await prismaClient.class.findUnique({
      where: { id: assignRequest.class_id },
      include: { grade: { select: { unit_id: true } }, academic_year: true },
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

    if (
      assignRequest.employee_id &&
      (assignRequest.role === ClassTeacherRole.HOMEROOM ||
        assignRequest.role === ClassTeacherRole.SUPPORTING_HOMEROOM)
    ) {
      await assertHasHomeroomPosition(assignRequest.employee_id);
    } else if (
      assignRequest.employee_id &&
      assignRequest.role === ClassTeacherRole.SUBJECT_TEACHER
    ) {
      await assertHasSubjectTeacherPosition(assignRequest.employee_id);
    }

    const workforceAuditValues = await classAssignmentWorkforceAuditValues(
      assignRequest.employee_id,
      assignRequest.intern_id,
    );
    const startDate = assignRequest.start_date
      ? new Date(assignRequest.start_date)
      : klass.academic_year.start_date;
    assertAssignmentStartDate(
      startDate,
      klass.academic_year,
      now,
      allowFutureStart,
    );

    const createdId = await prismaClient.$transaction(async (tx) => {
      if (assignRequest.intern_id) {
        await lockInternWorkforce(tx, assignRequest.intern_id);
      }
      await assertWorkforceMemberIsActive(
        tx,
        assignRequest.employee_id,
        assignRequest.intern_id,
        assignRequest.role,
        now,
      );
      await assertTeacherUnitMatchesClass(
        tx,
        assignRequest.employee_id,
        assignRequest.intern_id,
        assignRequest.class_id,
      );
      if (ROLE_CAPPED_PER_TEACHER_PER_YEAR.has(assignRequest.role)) {
        await assertTeacherNotAlreadyAssignedThisRoleElsewhere(
          tx,
          assignRequest.employee_id,
          assignRequest.intern_id,
          klass.academic_year_id,
          assignRequest.role,
        );
      }
      const duplicate = await tx.classTeacherAssignment.findFirst({
        where: {
          class_id: assignRequest.class_id,
          employee_id: assignRequest.employee_id,
          intern_id: assignRequest.intern_id,
          role: assignRequest.role,
          subject: assignRequest.subject ?? null,
          end_date: null,
          deleted_at: null,
        },
      });
      if (duplicate) {
        throw new ResponseError(
          400,
          "This workforce member already has an active assignment with this exact role/subject for this class.",
        );
      }
      const created = await tx.classTeacherAssignment.create({
        data: {
          class_id: assignRequest.class_id,
          employee_id: assignRequest.employee_id,
          intern_id: assignRequest.intern_id,
          role: assignRequest.role,
          subject: assignRequest.subject,
          start_date: startDate,
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
            ...workforceAuditValues,
            role: created.role,
            subject: created.subject,
            start_date: created.start_date.toISOString(),
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
        include: { employee: { include: { person: true } }, intern: true },
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
      await recordUnauthorizedClassAction(
        admin,
        "end teacher assignment",
        context,
      );
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }
    if (admin.role === AdminRole.DATABASE_ADMIN) {
      assertCanManageTeacherAssignments(admin);
      await assertCanWriteNow(admin, context, now);
    }

    const endRequest = Validation.validate(
      ClassValidation.END_TEACHER_ASSIGNMENT,
      request,
    );

    const existing = await prismaClient.classTeacherAssignment.findFirst({
      where: {
        id: endRequest.id,
        class_id: endRequest.class_id,
        deleted_at: null,
      },
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
      if (
        existing.employee_id &&
        (existing.role === ClassTeacherRole.HOMEROOM ||
          existing.role === ClassTeacherRole.SUPPORTING_HOMEROOM)
      ) {
        await assertHasHomeroomPosition(existing.employee_id);
      } else if (
        existing.employee_id &&
        existing.role === ClassTeacherRole.SUBJECT_TEACHER
      ) {
        await assertHasSubjectTeacherPosition(existing.employee_id);
      }
      throw new ResponseError(
        403,
        "Forbidden: This class is outside your unit scope",
      );
    }

    const endDate = endRequest.end_date ? new Date(endRequest.end_date) : now;
    if (endDate < existing.start_date) {
      throw new ResponseError(
        400,
        "End date cannot be before the assignment's start date",
      );
    }
    const workforceAuditValues = await classAssignmentWorkforceAuditValues(
      existing.employee_id,
      existing.intern_id,
    );

    await prismaClient.$transaction(async (tx) => {
      const updated = await tx.classTeacherAssignment.update({
        where: { id: existing.id },
        data: { end_date: endDate },
      });

      await AuditService.record(
        {
          action: AuditAction.END_CLASS_TEACHER_ASSIGNMENT,
          source: AuditSource.UI,
          entity_type: "ClassTeacherAssignment",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: { ...workforceAuditValues, end_date: null },
          new_values: {
            ...workforceAuditValues,
            end_date: updated.end_date?.toISOString() ?? null,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const updated = await prismaClient.classTeacherAssignment.findUniqueOrThrow(
      {
        where: { id: existing.id },
        include: { employee: { include: { person: true } }, intern: true },
      },
    );

    return toClassTeacherAssignmentResponse(updated);
  }

  static async updateTeacherAssignmentStartDate(
    admin: AdminUser,
    request: UpdateClassTeacherAssignmentStartDateRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<ClassTeacherAssignmentResponse> {
    if (admin.role === AdminRole.VIEWER) {
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }
    if (admin.role === AdminRole.DATABASE_ADMIN) {
      assertCanManageTeacherAssignments(admin);
      await assertCanWriteNow(admin, context, now);
    }
    const updateRequest = Validation.validate(
      ClassValidation.UPDATE_TEACHER_ASSIGNMENT_START_DATE,
      request,
    );
    const existing = await prismaClient.classTeacherAssignment.findFirst({
      where: {
        id: updateRequest.id,
        class_id: updateRequest.class_id,
        deleted_at: null,
      },
      include: {
        class: { include: { grade: true, academic_year: true } },
        employee: { include: { person: true } },
        intern: true,
      },
    });
    if (!existing) throw new ResponseError(404, "Teacher assignment not found");
    if (
      admin.role === AdminRole.DATABASE_ADMIN &&
      existing.class.grade.unit_id !== admin.unit_id
    ) {
      throw new ResponseError(403, "Forbidden: This class is outside your unit scope");
    }
    const startDate = new Date(updateRequest.start_date);
    assertAssignmentStartDate(startDate, existing.class.academic_year, now);
    if (existing.end_date && startDate > existing.end_date) {
      throw new ResponseError(400, "Start date cannot be after the assignment's end date");
    }
    const workforceAuditValues = await classAssignmentWorkforceAuditValues(
      existing.employee_id,
      existing.intern_id,
    );
    await prismaClient.$transaction(async (tx) => {
      await tx.classTeacherAssignment.update({
        where: { id: existing.id },
        data: { start_date: startDate },
      });
      await AuditService.record(
        {
          action: AuditAction.UPDATE_CLASS_TEACHER_ASSIGNMENT,
          source: AuditSource.UI,
          entity_type: "ClassTeacherAssignment",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: {
            class_id: existing.class_id,
            ...workforceAuditValues,
            role: existing.role,
            subject: existing.subject,
            start_date: existing.start_date.toISOString(),
            end_date: existing.end_date?.toISOString() ?? null,
          },
          new_values: {
            class_id: existing.class_id,
            ...workforceAuditValues,
            role: existing.role,
            subject: existing.subject,
            start_date: startDate.toISOString(),
            end_date: existing.end_date?.toISOString() ?? null,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });
    return toClassTeacherAssignmentResponse({ ...existing, start_date: startDate });
  }

  static async bulkUpdateTeacherAssignmentStartDates(
    admin: AdminUser,
    request: BulkUpdateClassTeacherAssignmentStartDateRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkActionResponse<ClassTeacherAssignmentResponse>> {
    const bulkRequest = Validation.validate(
      ClassValidation.BULK_UPDATE_TEACHER_ASSIGNMENT_START_DATE,
      request,
    );
    const items: BulkActionItemResponse<ClassTeacherAssignmentResponse>[] = [];
    for (const id of bulkRequest.assignment_ids) {
      try {
        const data = await ClassService.updateTeacherAssignmentStartDate(
          admin,
          {
            id,
            class_id: bulkRequest.class_id,
            start_date: bulkRequest.start_date,
          },
          context,
          now,
        );
        items.push({ id, status: "SUCCESS", data });
      } catch (error) {
        items.push({ id, status: "FAILED", error: bulkFailureMessage(error) });
      }
    }
    return toBulkActionResponse(items);
  }

  // "Roll a teacher forward" - e.g. this year's Homeroom Teacher for Grade
  // Non-atomic bulk move using the normal assign/end checks per teacher.
  static async bulkMoveTeacherAssignments(
    admin: AdminUser,
    request: BulkMoveClassTeacherAssignmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkActionResponse<ClassTeacherAssignmentResponse>> {
    // Reject unauthorized batches before processing individual items.
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
      assertCanManageTeacherAssignments(admin);
      await assertCanWriteNow(admin, context, now);
    }

    const bulkRequest = Validation.validate(
      ClassValidation.BULK_MOVE_TEACHER_ASSIGNMENTS,
      request,
    );

    const [sourceClass, targetClass] = await Promise.all([
      prismaClient.class.findUnique({
        where: { id: bulkRequest.class_id },
        include: { academic_year: true },
      }),
      prismaClient.class.findUnique({
        where: { id: bulkRequest.target_class_id },
        include: { academic_year: true },
      }),
    ]);
    if (!sourceClass || !targetClass) {
      throw new ResponseError(404, "Source or target class not found");
    }
    if (sourceClass.id === targetClass.id) {
      throw new ResponseError(400, "Target class must be different from the current class");
    }
    const sourceStartYear = Number(
      sourceClass.academic_year.name.match(/^(\d{4})\//)?.[1],
    );
    const targetStartYear = Number(
      targetClass.academic_year.name.match(/^(\d{4})\//)?.[1],
    );
    if (
      !Number.isInteger(sourceStartYear) ||
      !Number.isInteger(targetStartYear) ||
      (targetStartYear !== sourceStartYear && targetStartYear !== sourceStartYear + 1)
    ) {
      throw new ResponseError(
        400,
        "Teacher assignments can only be moved to a class in the same academic year, or promoted to a class in the next academic year",
      );
    }
    // Same-year moves (a mid-semester reassignment) have no date gate.
    // Only a cross-year promotion needs to wait until the source year is
    // actually ending.
    if (targetStartYear === sourceStartYear + 1) {
      assertTeacherPromotionNotTooEarly(sourceClass.academic_year, now);
    }

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

        const targetStartDate =
          targetStartYear === sourceStartYear
            ? now
            : targetClass.academic_year.start_date;
        const created = await ClassService.assignTeacher(
          admin,
          {
            class_id: bulkRequest.target_class_id,
            ...(existing.employee_id
              ? { employee_id: existing.employee_id }
              : { intern_id: existing.intern_id ?? undefined }),
            role: existing.role,
            subject: existing.subject ?? undefined,
            start_date: targetStartDate.toISOString(),
          },
          context,
          now,
          targetStartYear === sourceStartYear + 1,
        );

        await ClassService.endTeacherAssignment(
          admin,
          {
            id: existing.id,
            class_id: existing.class_id,
            end_date: targetStartDate.toISOString(),
          },
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

  static async bulkEndTeacherAssignments(
    admin: AdminUser,
    request: BulkEndClassTeacherAssignmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkActionResponse<ClassTeacherAssignmentResponse>> {
    // Reject unauthorized batches before processing individual items.
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedClassAction(
        admin,
        "bulk end teacher assignments",
        context,
        request.class_id,
      );
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }
    if (admin.role === AdminRole.DATABASE_ADMIN) {
      assertCanManageTeacherAssignments(admin);
      await assertCanWriteNow(admin, context, now);
    }

    const bulkRequest = Validation.validate(
      ClassValidation.BULK_END_TEACHER_ASSIGNMENTS,
      request,
    );

    const items: BulkActionItemResponse<ClassTeacherAssignmentResponse>[] = [];

    for (const assignmentId of bulkRequest.assignment_ids) {
      try {
        const updated = await ClassService.endTeacherAssignment(
          admin,
          {
            id: assignmentId,
            class_id: bulkRequest.class_id,
            end_date: bulkRequest.end_date,
          },
          context,
          now,
        );
        items.push({ id: assignmentId, status: "SUCCESS", data: updated });
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

  // Mistake correction soft-deletes open or ended assignments.
  static async removeTeacherAssignment(
    admin: AdminUser,
    request: RemoveClassTeacherAssignmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<void> {
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedClassAction(
        admin,
        "remove teacher assignment",
        context,
      );
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }
    if (admin.role === AdminRole.DATABASE_ADMIN) {
      assertCanManageTeacherAssignments(admin);
      await assertCanWriteNow(admin, context, now);
    }

    const removeRequest = Validation.validate(
      ClassValidation.REMOVE_TEACHER_ASSIGNMENT,
      request,
    );

    const existing = await prismaClient.classTeacherAssignment.findFirst({
      where: {
        id: removeRequest.id,
        class_id: removeRequest.class_id,
        deleted_at: null,
      },
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
    const workforceAuditValues = await classAssignmentWorkforceAuditValues(
      existing.employee_id,
      existing.intern_id,
    );

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
            ...workforceAuditValues,
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

  static async bulkRemoveTeacherAssignments(
    admin: AdminUser,
    request: BulkRemoveClassTeacherAssignmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkActionResponse<null>> {
    // Reject unauthorized batches before processing individual items.
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedClassAction(
        admin,
        "bulk remove teacher assignments",
        context,
        request.class_id,
      );
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }
    if (admin.role === AdminRole.DATABASE_ADMIN) {
      assertCanManageTeacherAssignments(admin);
      await assertCanWriteNow(admin, context, now);
    }

    const bulkRequest = Validation.validate(
      ClassValidation.BULK_REMOVE_TEACHER_ASSIGNMENTS,
      request,
    );

    const items: BulkActionItemResponse<null>[] = [];

    for (const assignmentId of bulkRequest.assignment_ids) {
      try {
        await ClassService.removeTeacherAssignment(
          admin,
          { id: assignmentId, class_id: bulkRequest.class_id },
          context,
          now,
        );
        items.push({ id: assignmentId, status: "SUCCESS", data: null });
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

  // Reopening clears an accidental assignment end.
  static async reopenTeacherAssignment(
    admin: AdminUser,
    request: ReopenClassTeacherAssignmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<ClassTeacherAssignmentResponse> {
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedClassAction(
        admin,
        "reopen teacher assignment",
        context,
      );
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }
    if (admin.role === AdminRole.DATABASE_ADMIN) {
      assertCanManageTeacherAssignments(admin);
      await assertCanWriteNow(admin, context, now);
    }

    const reopenRequest = Validation.validate(
      ClassValidation.REOPEN_TEACHER_ASSIGNMENT,
      request,
    );

    const existing = await prismaClient.classTeacherAssignment.findFirst({
      where: {
        id: reopenRequest.id,
        class_id: reopenRequest.class_id,
        deleted_at: null,
      },
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

    const workforceAuditValues = await classAssignmentWorkforceAuditValues(
      existing.employee_id,
      existing.intern_id,
    );

    await prismaClient.$transaction(async (tx) => {
      if (existing.intern_id) {
        await lockInternWorkforce(tx, existing.intern_id);
      }
      await assertWorkforceMemberIsActive(
        tx,
        existing.employee_id ?? undefined,
        existing.intern_id ?? undefined,
        existing.role,
        now,
      );
      await assertTeacherUnitMatchesClass(
        tx,
        existing.employee_id ?? undefined,
        existing.intern_id ?? undefined,
        existing.class_id,
      );
      if (ROLE_CAPPED_PER_TEACHER_PER_YEAR.has(existing.role)) {
        await assertTeacherNotAlreadyAssignedThisRoleElsewhere(
          tx,
          existing.employee_id ?? undefined,
          existing.intern_id ?? undefined,
          existing.class.academic_year_id,
          existing.role,
        );
      }
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
          old_values: {
            ...workforceAuditValues,
            end_date: existing.end_date?.toISOString() ?? null,
          },
          new_values: {
            ...workforceAuditValues,
            end_date: updated.end_date?.toISOString() ?? null,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const updated = await prismaClient.classTeacherAssignment.findUniqueOrThrow(
      {
        where: { id: existing.id },
        include: { employee: { include: { person: true } }, intern: true },
      },
    );

    return toClassTeacherAssignmentResponse(updated);
  }

  static async bulkReopenTeacherAssignments(
    admin: AdminUser,
    request: BulkReopenClassTeacherAssignmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkActionResponse<ClassTeacherAssignmentResponse>> {
    // Reject unauthorized batches before processing individual items.
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedClassAction(
        admin,
        "bulk reopen teacher assignments",
        context,
        request.class_id,
      );
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }
    if (admin.role === AdminRole.DATABASE_ADMIN) {
      assertCanManageTeacherAssignments(admin);
      await assertCanWriteNow(admin, context, now);
    }

    const bulkRequest = Validation.validate(
      ClassValidation.BULK_REOPEN_TEACHER_ASSIGNMENTS,
      request,
    );

    const items: BulkActionItemResponse<ClassTeacherAssignmentResponse>[] = [];

    for (const assignmentId of bulkRequest.assignment_ids) {
      try {
        const updated = await ClassService.reopenTeacherAssignment(
          admin,
          { id: assignmentId, class_id: bulkRequest.class_id },
          context,
          now,
        );
        items.push({ id: assignmentId, status: "SUCCESS", data: updated });
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

  static async search(
    admin: AdminUserWithAcademicScope,
    request: SearchClassRequest,
  ): Promise<Pageable<ClassResponse>> {
    assertCanViewAcademicData(admin);
    const searchRequest = Validation.validate(ClassValidation.SEARCH, request);

    const unitScope = resolveAcademicUnitScope(admin);

    const skip = (searchRequest.page - 1) * searchRequest.size;
    // Grade filtering matches primary and additional grades.
    const where: Prisma.ClassWhereInput = {
      name: searchRequest.search
        ? { contains: searchRequest.search, mode: "insensitive" as const }
        : undefined,
      academic_year_id: searchRequest.academic_year_id,
      status: searchRequest.status,
      ...(unitScope ? { grade: { unit_id: { in: unitScope } } } : {}),
      ...(searchRequest.grade_id
        ? {
            OR: [
              { grade_id: searchRequest.grade_id },
              {
                additional_grades: {
                  some: { grade_id: searchRequest.grade_id },
                },
              },
            ],
          }
        : {}),
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
              blockers.teacherAssignmentCount > 0 ||
        blockers.roomScopeCount > 0,
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
