import {
  AcademicYearStatus,
  AdminRole,
  AuditAction,
  AuditSource,
  ClassStatus,
  EnrollmentStatus,
  Prisma,
  StudentEntryType,
  StudentStatus,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toBulkActionResponse,
  type BulkActionItemResponse,
} from "../model/bulk-action-model";
import { paginate, type Pageable } from "../model/page-model";
import {
  toEnrollmentAuditSnapshot,
  toEnrollmentResponse,
  type BulkCloseEnrollmentRequest,
  type BulkCloseEnrollmentResponse,
  type BulkCreateEnrollmentRequest,
  type BulkCreateEnrollmentResponse,
  type BulkPromoteEnrollmentRequest,
  type BulkPromoteEnrollmentResponse,
  type BulkReactivateEnrollmentRequest,
  type BulkReactivateEnrollmentResponse,
  type BulkRemoveEnrollmentRequest,
  type BulkRemoveEnrollmentResponse,
  type BulkTransferEnrollmentRequest,
  type BulkTransferEnrollmentResponse,
  type CloseEnrollmentRequest,
  type CreateEnrollmentRequest,
  type EnrollmentResponse,
  type EnrollmentSortField,
  type FixEnrollmentClassRequest,
  type GetEnrollmentHistoryRequest,
  type PreviewBackfillEntry,
  type PreviewBackfillRequest,
  type PreviewBackfillStep,
  type PromoteEnrollmentRequest,
  type ReactivateEnrollmentRequest,
  type RemoveEnrollmentRequest,
  type RestoreEnrollmentRequest,
  type SearchEnrollmentRequest,
  type SearchEnrollmentCandidatesRequest,
  type EnrollmentCandidatesResponse,
  type TransferEnrollmentRequest,
} from "../model/enrollment-model";
import { AuditService } from "./audit-service";
import {
  ageMismatchMessage,
  recordStudentMutation,
  tooFarAheadMessage,
} from "./student-service";
import { UNKNOWN_LEGACY_GRADE_NAME } from "../model/grade-model";
import { UNKNOWN_LEGACY_CLASS_PREFIX } from "../model/class-model";
import { assertCanWriteNow } from "../utils/office-hours";
import {
  assertCanManageEnrollments,
  assertCanViewStudentData,
  resolveStudentUnitScope,
  type AdminUserWithStudentScope,
} from "../utils/admin-permissions";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import { EnrollmentValidation } from "../validation/enrollment-validation";
import { Validation, yearsBetweenDates } from "../validation/validation";
import { PersonType } from "../generated/prisma/client";
import { toStudentResponse } from "../model/student-model";

const ENROLLMENT_INCLUDE = {
  class: true,
  academic_year: true,
  student: { include: { person: true } },
} as const;

const DUPLICATE_ENROLLMENT_MESSAGE =
  "This student already has an enrollment record for this academic year.";

// Maps the last enrollment's closing reason to student status.
const CLOSE_STATUS_TO_STUDENT_STATUS: Record<
  "COMPLETED" | "TRANSFERRED" | "WITHDRAWN",
  StudentStatus
> = {
  COMPLETED: StudentStatus.GRADUATED,
  TRANSFERRED: StudentStatus.TRANSFERRED,
  WITHDRAWN: StudentStatus.WITHDRAWN,
};

function rethrowAsFriendlyEnrollmentConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("student_id") || fields?.includes("academic_year_id")) {
    throw new ResponseError(400, DUPLICATE_ENROLLMENT_MESSAGE);
  }
  throw error;
}

async function recordUnauthorizedEnrollmentAction(
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
      reason: `blocked enrollment ${action}`,
      ...(classId ? { class_id: classId } : {}),
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

// Resolve the student name for enrollment audit labels.
async function resolveStudentFullName(studentId: string): Promise<string | undefined> {
  const student = await prismaClient.student.findUnique({
    where: { id: studentId },
    select: { person: { select: { full_name: true } } },
  });
  return student?.person.full_name;
}

// Database Admin enrollment writes are scoped to the class unit.
async function assertClassInAdminUnit(
  admin: AdminUser,
  klass: { id: string; grade: { unit_id: string | null } },
  action: string,
  actionLabel: string,
  context: AuditRequestContext,
): Promise<void> {
  if (admin.role !== AdminRole.DATABASE_ADMIN) return;
  if (klass.grade.unit_id === admin.unit_id) return;

  await recordUnauthorizedEnrollmentAction(admin, action, context, klass.id);
  throw new ResponseError(
    403,
    `Forbidden: You can only ${actionLabel} within your unit scope`,
  );
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
    assertCanManageEnrollments(admin);
    return assertCanWriteNow(admin, context, now);
  }
}

function bulkFailureMessage(error: unknown): string {
  if (error instanceof ResponseError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

// Capacity has no override; raise or clear the class capacity first.
async function assertClassHasCapacity(
  tx: Prisma.TransactionClient,
  classId: string,
  capacity: number,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM classes WHERE id = ${classId} FOR UPDATE`;

  const occupied = await tx.studentClassEnrollment.count({
    where: {
      class_id: classId,
      enrollment_status: EnrollmentStatus.ACTIVE,
      deleted_at: null,
    },
  });

  if (occupied >= capacity) {
    throw new ResponseError(
      400,
      `Class is at full capacity (${capacity} students). Increase the class's capacity first.`,
    );
  }
}

type BackfillStep = {
  grade: { id: string; name: string };
  academicYear: { id: string; name: string; start_date: Date; end_date: Date | null };
};

async function resolveUnknownLegacyClass(
  tx: Prisma.TransactionClient,
  academicYearId: string,
  grade: { id: string; name: string },
) {
  const name = `${UNKNOWN_LEGACY_CLASS_PREFIX} - ${grade.name}`;
  const existing = await tx.class.findFirst({
    where: { name, academic_year_id: academicYearId },
  });
  if (existing) return existing;
  return tx.class.create({
    data: {
      name,
      grade_id: grade.id,
      academic_year_id: academicYearId,
      status: ClassStatus.INACTIVE,
      capacity: null,
    },
  });
}

// Auto-backfill only an unambiguous PSB progression.
// Reject regressions and gaps that could include retention.
async function assertPsbFirstEnrollmentMatchesJoinGrade(
  student: {
    status: StudentStatus;
    entry_type: StudentEntryType;
    join_grade_id: string;
    join_academic_year_id: string;
    birth_date: Date;
  },
  classGradeId: string,
): Promise<BackfillStep[] | null> {
  if (student.status !== StudentStatus.REGISTERED) return null;
  if (student.entry_type !== StudentEntryType.PSB) return null;
  if (classGradeId === student.join_grade_id) return null;

  const [classGrade, joinGrade, joinAcademicYear] = await Promise.all([
    prismaClient.grade.findUnique({ where: { id: classGradeId } }),
    prismaClient.grade.findUnique({ where: { id: student.join_grade_id } }),
    prismaClient.academicYear.findUnique({
      where: { id: student.join_academic_year_id },
    }),
  ]);
  if (!classGrade || !joinGrade) {
    throw new ResponseError(400, "Invalid grade reference");
  }

  // First enrollment repeats the join-grade age check for externally written data.
  if (joinAcademicYear?.start_date) {
    const ageMismatchError = ageMismatchMessage({
      joinGrade,
      ageAtJoin: yearsBetweenDates(
        student.birth_date.toISOString(),
        joinAcademicYear.start_date.toISOString(),
      ),
    });
    if (ageMismatchError) {
      throw new ResponseError(400, ageMismatchError);
    }
  }

  if (
    classGrade.level < joinGrade.level &&
    joinGrade.name !== UNKNOWN_LEGACY_GRADE_NAME
  ) {
    throw new ResponseError(
      400,
      `This student's Join Grade is '${joinGrade.name}', but this enrollment would place them in '${classGrade.name}', a lower grade. A student's first enrollment can't be behind the grade they joined at.`,
    );
  }

  // Missing join-year dates cannot establish a progression bound.
  if (classGrade.level > joinGrade.level && joinAcademicYear?.start_date) {
    const [laterAcademicYears, intermediateGrades] = await Promise.all([
      prismaClient.academicYear.findMany({
        where: {
          start_date: { gt: joinAcademicYear.start_date },
          status: { not: AcademicYearStatus.UPCOMING },
        },
        orderBy: { start_date: "asc" },
      }),
      prismaClient.grade.findMany({
        where: { level: { gt: joinGrade.level, lte: classGrade.level } },
        orderBy: { level: "asc" },
      }),
    ]);

    const tooFarAheadError = tooFarAheadMessage({
      currentGrade: classGrade,
      joinGrade,
      joinAcademicYear,
      gradeStepCount: intermediateGrades.length,
      laterAcademicYearCount: laterAcademicYears.length,
    });
    if (tooFarAheadError) {
      throw new ResponseError(400, tooFarAheadError);
    }

    if (intermediateGrades.length < laterAcademicYears.length) {
      throw new ResponseError(
        400,
        `This student's Join Grade is '${joinGrade.name}', but this enrollment would place them in '${classGrade.name}' after ${laterAcademicYears.length} academic year(s) - that's fewer grade levels than years elapsed, meaning a retention happened somewhere in between. Which year isn't something this can infer safely, so back this student's history in through Historical Data first (year by year), then Promote them forward.`,
      );
    }

    // Backfill only the unambiguous annual steps before the requested enrollment.
    return [
      { grade: joinGrade, academicYear: joinAcademicYear },
      ...intermediateGrades.slice(0, -1).map((grade, index) => ({
        grade,
        academicYear: laterAcademicYears[index],
      })),
    ];
  }

  return null;
}

async function assertClassMatchesGrade(
  classId: string,
  gradeId: string,
  academicYearId: string,
) {
  const klass = await prismaClient.class.findUnique({
    where: { id: classId },
    include: { grade: true, additional_grades: { include: { grade: true } } },
  });

  if (!klass) {
    throw new ResponseError(404, "Class not found");
  }
  if (klass.academic_year_id !== academicYearId) {
    throw new ResponseError(
      400,
      "Class does not belong to the specified academic year",
    );
  }
  // Mixed-age classes accept their primary and additional grades.
  const allowedGradeIds = [
    klass.grade_id,
    ...klass.additional_grades.map((entry) => entry.grade_id),
  ];
  if (!allowedGradeIds.includes(gradeId)) {
    throw new ResponseError(
      400,
      "Class's grade does not match the student's grade",
    );
  }
  // Upcoming classes are valid targets; inactive classes are not.
  if (klass.status === ClassStatus.INACTIVE) {
    throw new ResponseError(400, "Class is not active");
  }

  return klass;
}

// Transfers enforce year and status but may correct the grade.
async function assertClassInAcademicYear(
  classId: string,
  academicYearId: string,
) {
  const klass = await prismaClient.class.findUnique({
    where: { id: classId },
    include: { grade: true, additional_grades: { include: { grade: true } } },
  });

  if (!klass) {
    throw new ResponseError(404, "Class not found");
  }
  if (klass.academic_year_id !== academicYearId) {
    throw new ResponseError(
      400,
      "Class does not belong to the specified academic year",
    );
  }
  if (klass.status === ClassStatus.INACTIVE) {
    throw new ResponseError(400, "Class is not active");
  }

  return klass;
}

// Enrollment cannot predate the student's join academic year.
async function assertEnrollmentYearNotBeforeJoinYear(
  joinAcademicYearId: string,
  targetAcademicYearId: string,
): Promise<void> {
  if (joinAcademicYearId === targetAcademicYearId) return;

  const [joinYear, targetYear] = await Promise.all([
    prismaClient.academicYear.findUnique({
      where: { id: joinAcademicYearId },
    }),
    prismaClient.academicYear.findUnique({
      where: { id: targetAcademicYearId },
    }),
  ]);
  if (!joinYear || !targetYear) {
    throw new ResponseError(400, "Invalid academic year");
  }
  if (targetYear.start_date < joinYear.start_date) {
    throw new ResponseError(
      400,
      `Enrollment academic year cannot be before the student's join year (${joinYear.name}).`,
    );
  }
}

// Legacy grade order must be chronological; equal grades allow retention.
async function assertGradeConsistentWithEnrollmentHistory(
  studentId: string,
  targetAcademicYearId: string,
  targetGrade: { name: string; level: number },
): Promise<void> {
  const targetYear = await prismaClient.academicYear.findUnique({
    where: { id: targetAcademicYearId },
  });
  if (!targetYear) {
    throw new ResponseError(400, "Invalid academic year");
  }

  const otherEnrollments = await prismaClient.studentClassEnrollment.findMany(
    {
      where: { student_id: studentId, deleted_at: null },
      include: { academic_year: true, grade: true },
    },
  );

  for (const other of otherEnrollments) {
    if (
      other.academic_year.start_date < targetYear.start_date &&
      other.grade.level > targetGrade.level
    ) {
      throw new ResponseError(
        400,
        `This would enroll the student in '${targetGrade.name}', but they're already on record in '${other.grade.name}' for the earlier ${other.academic_year.name}. Grade shouldn't go backward over time.`,
      );
    }
    if (
      other.academic_year.start_date > targetYear.start_date &&
      other.grade.level < targetGrade.level
    ) {
      throw new ResponseError(
        400,
        `This would enroll the student in '${targetGrade.name}', but they're already on record in '${other.grade.name}' for the later ${other.academic_year.name}. Grade shouldn't go backward over time.`,
      );
    }
  }
}

// Preserve terminal imports' final grade before rebuilding enrollment history.
const TERMINAL_STUDENT_STATUSES = new Set<StudentStatus>([
  StudentStatus.GRADUATED,
  StudentStatus.TRANSFERRED,
  StudentStatus.WITHDRAWN,
]);

// Historical backfill is only the first enrollment at the join grade and year.
async function assertLegacyEnrollmentIsFirstEver(
  studentId: string,
  targetAcademicYearId: string,
  targetGrade: { id: string; name: string },
): Promise<void> {
  const student = await prismaClient.student.findFirst({
    where: { id: studentId, deleted_at: null },
    include: { join_grade: true },
  });
  if (!student) {
    throw new ResponseError(404, "Student not found");
  }

  const anyEnrollment = await prismaClient.studentClassEnrollment.findFirst({
    where: { student_id: studentId, deleted_at: null },
  });
  if (anyEnrollment) {
    throw new ResponseError(
      400,
      "This student already has an enrollment on file - use Promote to carry them forward instead of backfilling again.",
    );
  }

  if (targetAcademicYearId !== student.join_academic_year_id) {
    throw new ResponseError(
      400,
      "Historical backfill only applies to the student's own join year - use Promote to carry them forward from their first enrollment instead.",
    );
  }

  if (targetGrade.id !== student.join_grade_id) {
    throw new ResponseError(
      400,
      `This is the student's first enrollment - it must be in their join grade ('${student.join_grade.name}'), not '${targetGrade.name}'.`,
    );
  }
}

// Historical backfill checks class year, but not current class status or grade.
async function resolveClassForLegacyEnrollment(
  classId: string,
  academicYearId: string,
) {
  const klass = await prismaClient.class.findUnique({
    where: { id: classId },
    include: { grade: true, additional_grades: { include: { grade: true } } },
  });

  if (!klass) {
    throw new ResponseError(404, "Class not found");
  }
  if (klass.academic_year_id !== academicYearId) {
    throw new ResponseError(
      400,
      "Class does not belong to the specified academic year",
    );
  }

  return klass;
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

// Promotion opens near the end of the source academic year.
const PROMOTE_WINDOW_DAYS = 30;

// Enforce chronological promotion, grade progression, retention, and the promotion window.
async function assertValidGradeProgression(
  studentId: string,
  gradeId: string,
  isRetention: boolean,
  sourceAcademicYearId: string,
  targetAcademicYearId: string,
  confirmGradeSkip: boolean,
  now: Date,
) {
  const student = await prismaClient.student.findFirst({
    where: { id: studentId, deleted_at: null },
    include: { join_grade: true, current_grade: true },
  });
  if (!student) {
    throw new ResponseError(404, "Student not found");
  }

  const grade = await prismaClient.grade.findUnique({
    where: { id: gradeId },
  });
  if (!grade) {
    throw new ResponseError(400, "Invalid grade: grade not found");
  }

  if (grade.level < student.join_grade.level) {
    throw new ResponseError(
      400,
      "Current grade cannot be lower than the grade the student joined at",
    );
  }

  const [sourceYear, targetYear] = await Promise.all([
    prismaClient.academicYear.findUnique({
      where: { id: sourceAcademicYearId },
    }),
    prismaClient.academicYear.findUnique({
      where: { id: targetAcademicYearId },
    }),
  ]);
  if (!sourceYear || !targetYear) {
    throw new ResponseError(400, "Invalid academic year");
  }
  if (targetYear.start_date <= sourceYear.start_date) {
    throw new ResponseError(
      400,
      "Promotion must move to a later academic year than the student's current enrollment.",
    );
  }

  // Promotion must target the immediately next academic year.
  const interveningYear = await prismaClient.academicYear.findFirst({
    where: {
      start_date: { gt: sourceYear.start_date, lt: targetYear.start_date },
    },
  });
  if (interveningYear) {
    throw new ResponseError(
      400,
      `Promotion must move to the immediately next academic year - '${interveningYear.name}' comes before '${targetYear.name}'.`,
    );
  }

  if (sourceYear.end_date) {
    const daysUntilSourceYearEnds =
      (sourceYear.end_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysUntilSourceYearEnds > PROMOTE_WINDOW_DAYS) {
      throw new ResponseError(
        400,
        `Too early to promote - '${sourceYear.name}' doesn't end until ${sourceYear.end_date.toISOString().slice(0, 10)}. Promotion opens ${PROMOTE_WINDOW_DAYS} days before an academic year ends.`,
      );
    }
  }

  if (isRetention) {
    if (grade.level !== student.current_grade.level) {
      throw new ResponseError(
        400,
        "Retention must re-enroll in the same grade as the student's current grade. Use a normal promotion to change grades.",
      );
    }
  } else if (grade.level <= student.current_grade.level) {
    throw new ResponseError(
      400,
      "Promotion must move to a higher grade than the student's current grade. Set is_retention with a reason to re-enroll in the same grade in a later academic year.",
    );
  } else if (grade.level > student.current_grade.level + 1 && !confirmGradeSkip) {
    throw new ResponseError(
      400,
      `This promotion skips from '${student.current_grade.name}' straight to '${grade.name}', more than one grade level ahead. Set confirm_grade_skip if this is intentional.`,
    );
  }
}

// Enrollment dates default to the academic-year start, not today.
async function resolveDefaultStartDate(academicYearId: string): Promise<Date> {
  const academicYear = await prismaClient.academicYear.findUnique({
    where: { id: academicYearId },
  });
  if (!academicYear) {
    throw new ResponseError(400, "Invalid academic year");
  }
  return academicYear.start_date;
}

// Enrollment dates must stay within dated academic-year boundaries.
// Graduation uses the same non-overridable end window as promotion.
async function assertGraduationNotTooEarly(
  academicYearId: string,
  now: Date,
): Promise<void> {
  const academicYear = await prismaClient.academicYear.findUnique({
    where: { id: academicYearId },
    select: { name: true, end_date: true },
  });
  if (!academicYear?.end_date) return;

  const daysUntilYearEnds =
    (academicYear.end_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (daysUntilYearEnds > PROMOTE_WINDOW_DAYS) {
    throw new ResponseError(
      400,
      `Too early to graduate - '${academicYear.name}' doesn't end until ${academicYear.end_date.toISOString().slice(0, 10)}. Graduation opens ${PROMOTE_WINDOW_DAYS} days before an academic year ends.`,
    );
  }
}

async function assertDateWithinAcademicYear(
  academicYearId: string,
  date: Date,
  fieldLabel: string,
) {
  const academicYear = await prismaClient.academicYear.findUnique({
    where: { id: academicYearId },
  });
  if (!academicYear) {
    throw new ResponseError(400, "Invalid academic year");
  }
  if (
    date < academicYear.start_date ||
    (academicYear.end_date && date > academicYear.end_date)
  ) {
    throw new ResponseError(
      400,
      `${fieldLabel} must fall within ${academicYear.name}'s date range (${academicYear.start_date.toISOString().slice(0, 10)} to ${academicYear.end_date?.toISOString().slice(0, 10) ?? "open-ended"})`,
    );
  }
}

// Clamp a default close date to the enrollment and academic-year range.
async function resolveDefaultCloseEndDate(
  academicYearId: string,
  enrollmentStartDate: Date | null,
  now: Date,
): Promise<Date> {
  const academicYear = await prismaClient.academicYear.findUnique({
    where: { id: academicYearId },
  });
  if (!academicYear) return now;
  const floor =
    enrollmentStartDate && enrollmentStartDate > academicYear.start_date
      ? enrollmentStartDate
      : academicYear.start_date;
  if (now < floor) return floor;
  if (academicYear.end_date && now > academicYear.end_date) {
    return academicYear.end_date;
  }
  return now;
}

export class EnrollmentService {
  static async searchCandidates(
    admin: AdminUserWithStudentScope,
    request: SearchEnrollmentCandidatesRequest,
  ): Promise<EnrollmentCandidatesResponse> {
    assertCanViewStudentData(admin);
    const searchRequest = Validation.validate(
      EnrollmentValidation.SEARCH_CANDIDATES,
      request,
    );
    const klass = await prismaClient.class.findUnique({
      where: { id: searchRequest.class_id },
      include: { grade: true, additional_grades: true },
    });
    if (!klass) throw new ResponseError(404, "Class not found");
    const unitScope = resolveStudentUnitScope(admin);
    if (unitScope !== undefined && !unitScope.includes(klass.grade.unit_id)) {
      throw new ResponseError(404, "Class not found");
    }
    const allowedGradeIds = [
      klass.grade_id,
      ...klass.additional_grades.map((entry) => entry.grade_id),
    ];
    if (searchRequest.grade_id && !allowedGradeIds.includes(searchRequest.grade_id)) {
      throw new ResponseError(400, "Grade is not accepted by this class");
    }
    const gradeIds = searchRequest.grade_id
      ? [searchRequest.grade_id]
      : allowedGradeIds;
    const studentWhere: Prisma.StudentWhereInput = searchRequest.is_legacy
      ? {
          deleted_at: null,
          join_academic_year_id: klass.academic_year_id,
          join_grade_id: { in: gradeIds },
          enrollments: { none: { deleted_at: null } },
        }
      : {
          deleted_at: null,
          status: { in: [StudentStatus.REGISTERED, StudentStatus.ACTIVE] },
          current_grade_id: { in: gradeIds },
          current_class_id: null,
          enrollments: {
            none: {
              academic_year_id: klass.academic_year_id,
              deleted_at: null,
            },
          },
        };
    const search = searchRequest.search?.trim();
    const where: Prisma.PersonWhereInput = {
      person_type: PersonType.STUDENT,
      student: studentWhere,
      ...(search
        ? {
            OR: [
              { full_name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { student: { nis: { contains: search, mode: "insensitive" } } },
              { student: { legacy_nis: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const skip = (searchRequest.page - 1) * searchRequest.size;
    const [totalItem, persons, activeCount] = await Promise.all([
      prismaClient.person.count({ where }),
      prismaClient.person.findMany({
        where,
        take: searchRequest.size,
        skip,
        orderBy: { full_name: "asc" },
        include: {
          student: {
            include: {
              current_grade: true,
              join_grade: true,
              current_class: true,
              _count: { select: { enrollments: true } },
            },
          },
        },
      }),
      prismaClient.studentClassEnrollment.count({
        where: {
          class_id: klass.id,
          enrollment_status: EnrollmentStatus.ACTIVE,
          deleted_at: null,
        },
      }),
    ]);
    return {
      data: persons.map((person) => toStudentResponse(person)),
      paging: {
        size: searchRequest.size,
        current_page: searchRequest.page,
        total_page: Math.ceil(totalItem / searchRequest.size),
        total_item: totalItem,
      },
      meta: {
        capacity: klass.capacity,
        active_enrollment_count: activeCount,
        available_seats:
          klass.capacity === null ? null : Math.max(klass.capacity - activeCount, 0),
      },
    };
  }

  static async create(
    admin: AdminUser,
    request: CreateEnrollmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<EnrollmentResponse> {
    await assertWriteAllowed(admin, context, now);

    const createRequest = Validation.validate(
      EnrollmentValidation.CREATE,
      request,
    );

    const student = await prismaClient.student.findFirst({
      where: { id: createRequest.student_id, deleted_at: null },
      include: { person: { select: { birth_date: true, full_name: true } } },
    });
    if (!student) {
      throw new ResponseError(404, "Student not found");
    }
    const studentFullName = student.person.full_name;

    const isLegacy = Boolean(createRequest.is_legacy);

    // A legacy seed must be promoted before adding a normal enrollment.
    if (!isLegacy) {
      const existingLegacyActiveEnrollment =
        await prismaClient.studentClassEnrollment.findFirst({
          where: {
            student_id: student.id,
            is_legacy: true,
            enrollment_status: EnrollmentStatus.ACTIVE,
            deleted_at: null,
          },
        });
      if (existingLegacyActiveEnrollment) {
        throw new ResponseError(
          400,
          "This student already has a Historical Data enrollment on file. Use Promote to carry them forward from there instead of creating a new one.",
        );
      }
    }

    // Zod's refine already guarantees academic_year_id is set when is_legacy
    // is true, so the "!" here is provably safe.
    const academicYearId = isLegacy
      ? createRequest.academic_year_id!
      : await resolveActiveAcademicYearId(createRequest.academic_year_id);

    await assertEnrollmentYearNotBeforeJoinYear(
      student.join_academic_year_id,
      academicYearId,
    );

    const klass = isLegacy
      ? await resolveClassForLegacyEnrollment(
          createRequest.class_id,
          academicYearId,
        )
      : await assertClassMatchesGrade(
          createRequest.class_id,
          student.current_grade_id,
          academicYearId,
        );

    // Mixed-age enrollment grade comes from the validated student grade.
    const targetGradeId = isLegacy ? klass.grade_id : student.current_grade_id;
    const targetGrade =
      klass.grade_id === targetGradeId
        ? klass.grade
        : klass.additional_grades.find((entry) => entry.grade_id === targetGradeId)!
            .grade;

    let backfillSteps: BackfillStep[] | null = null;
    if (!isLegacy) {
      backfillSteps = await assertPsbFirstEnrollmentMatchesJoinGrade(
        { ...student, birth_date: student.person.birth_date },
        targetGradeId,
      );
    } else {
      await assertLegacyEnrollmentIsFirstEver(
        student.id,
        academicYearId,
        klass.grade,
      );
    }

    await assertGradeConsistentWithEnrollmentHistory(
      student.id,
      academicYearId,
      targetGrade,
    );

    await assertClassInAdminUnit(
      admin,
      klass,
      "create",
      "enroll students into classes",
      context,
    );

    const startDate = createRequest.start_date
      ? new Date(createRequest.start_date)
      : await resolveDefaultStartDate(academicYearId);

    await assertDateWithinAcademicYear(
      academicYearId,
      startDate,
      "Enrollment start date",
    );

    // Backfill becomes the active starting point for later promotions.
    const enrollmentStatus = EnrollmentStatus.ACTIVE;

    // Snapshot a terminal student's final grade before resetting to the join grade.
    let graduationGradeSnapshot: string | undefined;
    if (TERMINAL_STUDENT_STATUSES.has(student.status) && !student.graduation_grade) {
      const priorCurrentGrade = await prismaClient.grade.findUnique({
        where: { id: student.current_grade_id },
      });
      graduationGradeSnapshot = priorCurrentGrade?.name;
    }

    let createdId: string;
    try {
      createdId = await prismaClient.$transaction(async (tx) => {
        if (!isLegacy && klass.capacity !== null) {
          await assertClassHasCapacity(tx, klass.id, klass.capacity);
        }

        // Backfill each unambiguous skipped year into a placeholder class.
        let previousEnrollmentId: string | undefined;
        if (backfillSteps && backfillSteps.length > 0) {
          for (let i = 0; i < backfillSteps.length; i++) {
            const step = backfillSteps[i];
            const stepClass = await resolveUnknownLegacyClass(
              tx,
              step.academicYear.id,
              step.grade,
            );
            const nextStepStart =
              i + 1 < backfillSteps.length
                ? backfillSteps[i + 1].academicYear.start_date
                : startDate;
            const backfilled = await tx.studentClassEnrollment.create({
              data: {
                student_id: student.id,
                academic_year_id: step.academicYear.id,
                class_id: stepClass.id,
                grade_id: step.grade.id,
                grade_level: step.grade.name,
                class_name_snapshot: stepClass.name,
                start_date: step.academicYear.start_date,
                enrollment_status: EnrollmentStatus.COMPLETED,
                end_date: nextStepStart,
                promoted_from_enrollment_id: previousEnrollmentId,
              },
            });

            const backfilledForAudit =
              await tx.studentClassEnrollment.findUniqueOrThrow({
                where: { id: backfilled.id },
              });
            await AuditService.record(
              {
                action:
                  i === 0
                    ? AuditAction.CREATE_ENROLLMENT
                    : AuditAction.PROMOTE_STUDENT,
                source: AuditSource.UI,
                entity_type: "StudentClassEnrollment",
                entity_id: backfilledForAudit.id,
                admin_id: admin.id,
                new_values: toEnrollmentAuditSnapshot(backfilledForAudit, studentFullName),
                ip_address: context.ip_address,
                user_agent: context.user_agent,
              },
              tx,
            );

            previousEnrollmentId = backfilled.id;
          }
        }

        const created = await tx.studentClassEnrollment.create({
          data: {
            student_id: student.id,
            academic_year_id: academicYearId,
            class_id: klass.id,
            grade_id: targetGradeId,
            grade_level: targetGrade.name,
            class_name_snapshot: klass.name,
            start_date: startDate,
            enrollment_status: enrollmentStatus,
            end_date: null,
            is_legacy: isLegacy,
            promoted_from_enrollment_id: previousEnrollmentId,
          },
        });

        await tx.student.update({
          where: { id: student.id },
          data: {
            current_class_id: klass.id,
            current_grade_id: targetGradeId,
            ...(student.status === StudentStatus.REGISTERED
              ? { status: StudentStatus.ACTIVE }
              : {}),
            ...(graduationGradeSnapshot
              ? { graduation_grade: graduationGradeSnapshot }
              : {}),
          },
        });

        // no include - a nested include here races on the tx's single pg
        // connection, and the audit snapshot only needs raw enrollment fields
        const enrollmentForAudit =
          await tx.studentClassEnrollment.findUniqueOrThrow({
            where: { id: created.id },
          });

        await AuditService.record(
          {
            action: AuditAction.CREATE_ENROLLMENT,
            source: AuditSource.UI,
            entity_type: "StudentClassEnrollment",
            entity_id: enrollmentForAudit.id,
            admin_id: admin.id,
            new_values: toEnrollmentAuditSnapshot(enrollmentForAudit, studentFullName),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return created.id;
      });
    } catch (error) {
      rethrowAsFriendlyEnrollmentConflict(error);
    }

    // fetched separately - write + nested include races on the pg client
    const enrollment =
      await prismaClient.studentClassEnrollment.findUniqueOrThrow({
        where: { id: createdId },
        include: ENROLLMENT_INCLUDE,
      });

    return toEnrollmentResponse(enrollment);
  }

  // Preview the backfill that create() would perform.
  static async previewBackfill(
    admin: AdminUser,
    request: PreviewBackfillRequest,
    context: AuditRequestContext = {},
  ): Promise<PreviewBackfillEntry[]> {
    await assertWriteAllowed(admin, context, new Date());

    const previewRequest = Validation.validate(
      EnrollmentValidation.PREVIEW_BACKFILL,
      request,
    );

    const academicYearId = await resolveActiveAcademicYearId(
      previewRequest.academic_year_id,
    );

    const klass = await prismaClient.class.findUnique({
      where: { id: previewRequest.class_id },
      include: { grade: true, additional_grades: { include: { grade: true } } },
    });
    if (!klass) {
      throw new ResponseError(404, "Class not found");
    }
    if (klass.academic_year_id !== academicYearId) {
      return [];
    }
    if (klass.status === ClassStatus.INACTIVE) {
      return [];
    }
    await assertClassInAdminUnit(
      admin,
      klass,
      "preview",
      "preview enrollments",
      context,
    );

    const allowedGradeIds = [
      klass.grade_id,
      ...klass.additional_grades.map((entry) => entry.grade_id),
    ];

    const students = await prismaClient.student.findMany({
      where: {
        id: { in: previewRequest.student_ids },
        deleted_at: null,
        status: StudentStatus.REGISTERED,
        entry_type: StudentEntryType.PSB,
      },
      include: { person: true },
    });

    // Reuse placeholder lookups per academic year and grade.
    const placeholderClassIdCache = new Map<string, string | null>();
    async function lookupPlaceholderClassId(
      academicYearId: string,
      gradeName: string,
    ): Promise<string | null> {
      const cacheKey = `${academicYearId}:${gradeName}`;
      if (placeholderClassIdCache.has(cacheKey)) {
        return placeholderClassIdCache.get(cacheKey)!;
      }
      const existing = await prismaClient.class.findFirst({
        where: {
          academic_year_id: academicYearId,
          name: `${UNKNOWN_LEGACY_CLASS_PREFIX} - ${gradeName}`,
        },
      });
      placeholderClassIdCache.set(cacheKey, existing?.id ?? null);
      return existing?.id ?? null;
    }

    const entries: PreviewBackfillEntry[] = [];
    for (const student of students) {
      if (!allowedGradeIds.includes(student.current_grade_id)) continue;

      let backfillSteps: BackfillStep[] | null;
      try {
        backfillSteps = await assertPsbFirstEnrollmentMatchesJoinGrade(
          { ...student, birth_date: student.person.birth_date },
          student.current_grade_id,
        );
      } catch {
        // Blocked case (too far ahead / ambiguous retention) - the real
        // create() call reports this per-student, nothing to preview here.
        continue;
      }

      if (backfillSteps && backfillSteps.length > 0) {
        const steps: PreviewBackfillStep[] = [];
        for (const step of backfillSteps) {
          steps.push({
            grade_id: step.grade.id,
            grade_name: step.grade.name,
            academic_year_id: step.academicYear.id,
            academic_year_name: step.academicYear.name,
            placeholder_class_id: await lookupPlaceholderClassId(
              step.academicYear.id,
              step.grade.name,
            ),
          });
        }
        entries.push({
          student_id: student.id,
          full_name: student.person.full_name,
          steps,
        });
      }
    }

    return entries;
  }

  static async bulkCreate(
    admin: AdminUser,
    request: BulkCreateEnrollmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkCreateEnrollmentResponse> {
    await assertWriteAllowed(admin, context, now);

    const bulkRequest = Validation.validate(
      EnrollmentValidation.BULK_CREATE,
      request,
    );

    const { student_ids: studentIds, ...createPayload } = bulkRequest;
    const items: BulkActionItemResponse<EnrollmentResponse>[] = [];

    for (const studentId of studentIds) {
      try {
        const data = await EnrollmentService.create(
          admin,
          {
            ...createPayload,
            student_id: studentId,
          },
          context,
          now,
        );
        items.push({ id: studentId, status: "SUCCESS", data });
      } catch (error) {
        items.push({
          id: studentId,
          status: "FAILED",
          error: bulkFailureMessage(error),
        });
      }
    }

    return toBulkActionResponse(items);
  }

  static async promote(
    admin: AdminUser,
    request: PromoteEnrollmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<EnrollmentResponse> {
    await assertWriteAllowed(admin, context, now);

    const promoteRequest = Validation.validate(
      EnrollmentValidation.PROMOTE,
      request,
    );

    const existing = await prismaClient.studentClassEnrollment.findFirst({
      where: {
        id: promoteRequest.id,
        student_id: promoteRequest.student_id,
      },
    });
    if (!existing) {
      throw new ResponseError(404, "Enrollment not found");
    }
    if (existing.enrollment_status !== EnrollmentStatus.ACTIVE) {
      throw new ResponseError(400, "Only an active enrollment can be promoted");
    }

    const studentFullName = await resolveStudentFullName(promoteRequest.student_id);

    await assertValidGradeProgression(
      promoteRequest.student_id,
      promoteRequest.grade_id,
      Boolean(promoteRequest.is_retention),
      existing.academic_year_id,
      promoteRequest.academic_year_id,
      Boolean(promoteRequest.confirm_grade_skip),
      now,
    );

    const klass = await assertClassMatchesGrade(
      promoteRequest.class_id,
      promoteRequest.grade_id,
      promoteRequest.academic_year_id,
    );
    const targetGrade =
      klass.grade_id === promoteRequest.grade_id
        ? klass.grade
        : klass.additional_grades.find(
            (entry) => entry.grade_id === promoteRequest.grade_id,
          )!.grade;

    await assertClassInAdminUnit(
      admin,
      klass,
      "promote",
      "promote students into classes",
      context,
    );

    const effectiveDate = promoteRequest.effective_date
      ? new Date(promoteRequest.effective_date)
      : await resolveDefaultStartDate(promoteRequest.academic_year_id);

    if (existing.start_date && effectiveDate < existing.start_date) {
      throw new ResponseError(
        400,
        "Effective date cannot be before the current enrollment's start date",
      );
    }

    await assertDateWithinAcademicYear(
      promoteRequest.academic_year_id,
      effectiveDate,
      "Effective date",
    );

    let createdId: string;
    try {
      createdId = await prismaClient.$transaction(async (tx) => {
        if (klass.capacity !== null) {
          await assertClassHasCapacity(tx, klass.id, klass.capacity);
        }

        const closed = await tx.studentClassEnrollment.updateMany({
          where: {
            id: existing.id,
            enrollment_status: EnrollmentStatus.ACTIVE,
          },
          data: {
            enrollment_status: EnrollmentStatus.COMPLETED,
            end_date: effectiveDate,
          },
        });
        if (closed.count === 0) {
          throw new ResponseError(
            400,
            "Only an active enrollment can be promoted",
          );
        }

        const newEnrollment = await tx.studentClassEnrollment.create({
          data: {
            student_id: promoteRequest.student_id,
            academic_year_id: promoteRequest.academic_year_id,
            class_id: klass.id,
            grade_id: promoteRequest.grade_id,
            grade_level: targetGrade.name,
            class_name_snapshot: klass.name,
            start_date: effectiveDate,
            is_retention: Boolean(promoteRequest.is_retention),
            retention_reason: promoteRequest.retention_reason,
            promoted_from_enrollment_id: existing.id,
          },
        });

        await tx.student.update({
          where: { id: promoteRequest.student_id },
          data: {
            current_grade_id: promoteRequest.grade_id,
            current_class_id: klass.id,
          },
        });

        // no include - a nested include here races on the tx's single pg
        // connection, and the audit snapshot only needs raw enrollment fields
        const createdForAudit =
          await tx.studentClassEnrollment.findUniqueOrThrow({
            where: { id: newEnrollment.id },
          });

        await AuditService.record(
          {
            action: AuditAction.PROMOTE_STUDENT,
            source: AuditSource.UI,
            entity_type: "StudentClassEnrollment",
            entity_id: createdForAudit.id,
            admin_id: admin.id,
            old_values: toEnrollmentAuditSnapshot(existing, studentFullName),
            new_values: toEnrollmentAuditSnapshot(createdForAudit, studentFullName),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return newEnrollment.id;
      });
    } catch (error) {
      rethrowAsFriendlyEnrollmentConflict(error);
    }

    const created = await prismaClient.studentClassEnrollment.findUniqueOrThrow(
      { where: { id: createdId }, include: ENROLLMENT_INCLUDE },
    );

    return toEnrollmentResponse(created);
  }

  static async bulkPromote(
    admin: AdminUser,
    request: BulkPromoteEnrollmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkPromoteEnrollmentResponse> {
    await assertWriteAllowed(admin, context, now);

    const bulkRequest = Validation.validate(
      EnrollmentValidation.BULK_PROMOTE,
      request,
    );

    const { enrollment_ids: enrollmentIds, ...promotePayload } = bulkRequest;
    const items: BulkActionItemResponse<EnrollmentResponse>[] = [];

    for (const id of enrollmentIds) {
      try {
        const enrollment = await prismaClient.studentClassEnrollment.findUnique({
          where: { id },
          select: { student_id: true },
        });

        if (!enrollment) {
          throw new ResponseError(404, "Enrollment not found");
        }

        const data = await EnrollmentService.promote(
          admin,
          {
            ...promotePayload,
            id,
            student_id: enrollment.student_id,
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

  static async transfer(
    admin: AdminUser,
    request: TransferEnrollmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<EnrollmentResponse> {
    await assertWriteAllowed(admin, context, now);

    const transferRequest = Validation.validate(
      EnrollmentValidation.TRANSFER,
      request,
    );

    const existing = await prismaClient.studentClassEnrollment.findFirst({
      where: {
        id: transferRequest.id,
        student_id: transferRequest.student_id,
      },
      include: { class: { include: { grade: true } } },
    });
    if (!existing) {
      throw new ResponseError(404, "Enrollment not found");
    }
    if (existing.enrollment_status !== EnrollmentStatus.ACTIVE) {
      throw new ResponseError(
        400,
        "Only an active enrollment can be transferred",
      );
    }

    const student = await prismaClient.student.findFirst({
      where: { id: transferRequest.student_id, deleted_at: null },
      include: { join_grade: true, person: { select: { full_name: true } } },
    });
    if (!student) {
      throw new ResponseError(404, "Student not found");
    }
    const studentFullName = student.person.full_name;

    const klass = await assertClassInAcademicYear(
      transferRequest.class_id,
      existing.academic_year_id,
    );

    if (existing.class_id === klass.id) {
      throw new ResponseError(
        400,
        "Student is already enrolled in this class",
      );
    }

    // Transfer changes class, not grade. Additional grades are allowed.
    const targetGrade =
      klass.grade_id === student.current_grade_id
        ? klass.grade
        : klass.additional_grades.find(
            (entry) => entry.grade_id === student.current_grade_id,
          )?.grade;
    if (!targetGrade) {
      throw new ResponseError(
        400,
        "Transfer only moves a student between classes in the same grade. To change grade, use Promote; to correct a mistaken enrollment, remove it and re-enroll.",
      );
    }

    if (targetGrade.level < student.join_grade.level) {
      throw new ResponseError(
        400,
        "Current grade cannot be lower than the grade the student joined at",
      );
    }

    await assertClassInAdminUnit(
      admin,
      klass,
      "transfer",
      "move students between classes",
      context,
    );

    const effectiveDate = transferRequest.effective_date
      ? new Date(transferRequest.effective_date)
      : now;
    await assertDateWithinAcademicYear(
      existing.academic_year_id,
      effectiveDate,
      "Effective date",
    );
    if (existing.start_date && effectiveDate < existing.start_date) {
      throw new ResponseError(
        400,
        "Effective date cannot be before the enrollment's start date",
      );
    }
    if (effectiveDate > now) {
      throw new ResponseError(400, "Effective date cannot be in the future");
    }

    await prismaClient.$transaction(async (tx) => {
      if (klass.capacity !== null) {
        await assertClassHasCapacity(tx, klass.id, klass.capacity);
      }

      const updated = await tx.studentClassEnrollment.updateMany({
        where: { id: existing.id, enrollment_status: EnrollmentStatus.ACTIVE },
        data: {
          class_id: klass.id,
          class_name_snapshot: klass.name,
          grade_id: targetGrade.id,
          grade_level: targetGrade.name,
        },
      });
      if (updated.count === 0) {
        throw new ResponseError(
          400,
          "Only an active enrollment can be transferred",
        );
      }

      await tx.student.update({
        where: { id: student.id },
        data: { current_class_id: klass.id, current_grade_id: targetGrade.id },
      });

      // transfer() updates the enrollment row in place instead of closing it
      // and creating a new one (unlike promote), so it's the only enrollment
      // mutation with no history trail of its own - record it here instead.
      await recordStudentMutation(
        tx,
        student.id,
        { field: "CURRENT_CLASS", class_id: klass.id },
        effectiveDate,
        {
          value: { field: "CURRENT_CLASS", class_id: existing.class_id },
          since: existing.start_date ?? existing.created_at,
        },
      );

      // no include - a nested include here races on the tx's single pg
      // connection, and the audit snapshot only needs raw enrollment fields
      const updatedForAudit =
        await tx.studentClassEnrollment.findUniqueOrThrow({
          where: { id: existing.id },
        });

      await AuditService.record(
        {
          action: AuditAction.TRANSFER_STUDENT_CLASS,
          source: AuditSource.UI,
          entity_type: "StudentClassEnrollment",
          entity_id: updatedForAudit.id,
          admin_id: admin.id,
          old_values: toEnrollmentAuditSnapshot(existing, studentFullName),
          new_values: toEnrollmentAuditSnapshot(updatedForAudit, studentFullName),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const updated = await prismaClient.studentClassEnrollment.findUniqueOrThrow(
      { where: { id: existing.id }, include: ENROLLMENT_INCLUDE },
    );

    return toEnrollmentResponse(updated);
  }

  // Replace only a placeholder class; grade and academic year stay unchanged.
  static async fixPlaceholderClass(
    admin: AdminUser,
    request: FixEnrollmentClassRequest,
    context: AuditRequestContext = {},
  ): Promise<EnrollmentResponse> {
    await assertWriteAllowed(admin, context, new Date());

    const fixRequest = Validation.validate(
      EnrollmentValidation.FIX_CLASS,
      request,
    );

    const existing = await prismaClient.studentClassEnrollment.findFirst({
      where: {
        id: fixRequest.id,
        student_id: fixRequest.student_id,
        deleted_at: null,
      },
      include: { class: true },
    });
    if (!existing) {
      throw new ResponseError(404, "Enrollment not found");
    }
    if (!existing.class.name.startsWith(UNKNOWN_LEGACY_CLASS_PREFIX)) {
      throw new ResponseError(
        400,
        "This enrollment isn't a placeholder record. Use Transfer instead to move a real class.",
      );
    }

    const newClass = await prismaClient.class.findUnique({
      where: { id: fixRequest.class_id },
      include: { grade: true, additional_grades: { include: { grade: true } } },
    });
    if (!newClass) {
      throw new ResponseError(404, "Class not found");
    }
    if (newClass.name.startsWith(UNKNOWN_LEGACY_CLASS_PREFIX)) {
      throw new ResponseError(
        400,
        "Pick a real class, not another placeholder.",
      );
    }
    if (newClass.academic_year_id !== existing.academic_year_id) {
      throw new ResponseError(
        400,
        "The new class must be in the same academic year as this enrollment.",
      );
    }
    const allowedGradeIds = [
      newClass.grade_id,
      ...newClass.additional_grades.map((entry) => entry.grade_id),
    ];
    if (!allowedGradeIds.includes(existing.grade_id)) {
      throw new ResponseError(
        400,
        `The new class doesn't teach '${existing.grade_level}', the grade this enrollment is recorded at.`,
      );
    }

    await assertClassInAdminUnit(
      admin,
      newClass,
      "fix",
      "fix placeholder classes",
      context,
    );

    const studentFullName = await resolveStudentFullName(fixRequest.student_id);

    await prismaClient.$transaction(async (tx) => {
      if (
        existing.enrollment_status === EnrollmentStatus.ACTIVE &&
        newClass.capacity !== null
      ) {
        await assertClassHasCapacity(tx, newClass.id, newClass.capacity);
      }

      await tx.studentClassEnrollment.update({
        where: { id: existing.id },
        data: { class_id: newClass.id, class_name_snapshot: newClass.name },
      });

      // Update the student's current pointer only for the live enrollment.
      if (existing.enrollment_status === EnrollmentStatus.ACTIVE) {
        await tx.student.update({
          where: { id: fixRequest.student_id },
          data: { current_class_id: newClass.id },
        });
      }

      const updatedForAudit =
        await tx.studentClassEnrollment.findUniqueOrThrow({
          where: { id: existing.id },
        });

      await AuditService.record(
        {
          action: AuditAction.FIX_ENROLLMENT_CLASS,
          source: AuditSource.UI,
          entity_type: "StudentClassEnrollment",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: toEnrollmentAuditSnapshot(existing, studentFullName),
          new_values: toEnrollmentAuditSnapshot(updatedForAudit, studentFullName),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const updated = await prismaClient.studentClassEnrollment.findUniqueOrThrow(
      { where: { id: existing.id }, include: ENROLLMENT_INCLUDE },
    );

    return toEnrollmentResponse(updated);
  }

  static async bulkTransfer(
    admin: AdminUser,
    request: BulkTransferEnrollmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkTransferEnrollmentResponse> {
    await assertWriteAllowed(admin, context, now);

    const bulkRequest = Validation.validate(
      EnrollmentValidation.BULK_TRANSFER,
      request,
    );

    const { enrollment_ids: enrollmentIds, ...transferPayload } = bulkRequest;
    const items: BulkActionItemResponse<EnrollmentResponse>[] = [];

    for (const id of enrollmentIds) {
      try {
        const enrollment = await prismaClient.studentClassEnrollment.findUnique({
          where: { id },
          select: { student_id: true },
        });

        if (!enrollment) {
          throw new ResponseError(404, "Enrollment not found");
        }

        const data = await EnrollmentService.transfer(
          admin,
          {
            ...transferPayload,
            id,
            student_id: enrollment.student_id,
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

  static async close(
    admin: AdminUser,
    request: CloseEnrollmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<EnrollmentResponse> {
    await assertWriteAllowed(admin, context, now);

    const closeRequest = Validation.validate(
      EnrollmentValidation.CLOSE,
      request,
    );

    const existing = await prismaClient.studentClassEnrollment.findFirst({
      where: { id: closeRequest.id, student_id: closeRequest.student_id },
      include: { class: { include: { grade: true } } },
    });
    if (!existing) {
      throw new ResponseError(404, "Enrollment not found");
    }
    if (existing.enrollment_status !== EnrollmentStatus.ACTIVE) {
      throw new ResponseError(400, "Only an active enrollment can be closed");
    }

    if (closeRequest.status === "COMPLETED") {
      await assertGraduationNotTooEarly(existing.academic_year_id, now);
    }

    await assertClassInAdminUnit(
      admin,
      existing.class,
      "close",
      "close enrollments in classes",
      context,
    );

    const student = await prismaClient.student.findFirst({
      where: { id: closeRequest.student_id, deleted_at: null },
      include: { person: { select: { full_name: true } } },
    });
    if (!student) {
      throw new ResponseError(404, "Student not found");
    }
    const studentFullName = student.person.full_name;

    const endDate = closeRequest.end_date
      ? new Date(closeRequest.end_date)
      : await resolveDefaultCloseEndDate(
          existing.academic_year_id,
          existing.start_date,
          now,
        );

    if (existing.start_date && endDate < existing.start_date) {
      throw new ResponseError(
        400,
        "End date cannot be before the enrollment's start date",
      );
    }

    await assertDateWithinAcademicYear(
      existing.academic_year_id,
      endDate,
      "End date",
    );

    await prismaClient.$transaction(async (tx) => {
      const updated = await tx.studentClassEnrollment.updateMany({
        where: { id: existing.id, enrollment_status: EnrollmentStatus.ACTIVE },
        data: {
          enrollment_status: closeRequest.status,
          end_date: endDate,
        },
      });
      if (updated.count === 0) {
        throw new ResponseError(400, "Only an active enrollment can be closed");
      }

      // The last active enrollment determines the student's terminal status.
      const remainingActive = await tx.studentClassEnrollment.findFirst({
        where: {
          student_id: student.id,
          enrollment_status: EnrollmentStatus.ACTIVE,
          deleted_at: null,
        },
      });

      const becomesTerminal =
        !remainingActive && student.status === StudentStatus.ACTIVE;
      const nextStudentStatus = CLOSE_STATUS_TO_STUDENT_STATUS[closeRequest.status];

      await tx.student.update({
        where: { id: student.id },
        data: {
          current_class_id: null,
          ...(becomesTerminal ? { status: nextStudentStatus } : {}),
          // graduation_grade/leave_year only make sense once the student is
          // actually becoming GRADUATED, not just this one enrollment record.
          ...(becomesTerminal && nextStudentStatus === StudentStatus.GRADUATED
            ? {
                graduation_grade: closeRequest.graduation_grade,
                leave_year: closeRequest.leave_year,
              }
            : {}),
        },
      });

      // no include - a nested include here races on the tx's single pg
      // connection, and the audit snapshot only needs raw enrollment fields
      const updatedForAudit =
        await tx.studentClassEnrollment.findUniqueOrThrow({
          where: { id: existing.id },
        });

      await AuditService.record(
        {
          action: AuditAction.WITHDRAW_STUDENT_ENROLLMENT,
          source: AuditSource.UI,
          entity_type: "StudentClassEnrollment",
          entity_id: updatedForAudit.id,
          admin_id: admin.id,
          old_values: toEnrollmentAuditSnapshot(existing, studentFullName),
          new_values: toEnrollmentAuditSnapshot(updatedForAudit, studentFullName),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const updated = await prismaClient.studentClassEnrollment.findUniqueOrThrow(
      { where: { id: existing.id }, include: ENROLLMENT_INCLUDE },
    );

    return toEnrollmentResponse(updated);
  }

  static async bulkClose(
    admin: AdminUser,
    request: BulkCloseEnrollmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkCloseEnrollmentResponse> {
    await assertWriteAllowed(admin, context, now);

    const bulkRequest = Validation.validate(
      EnrollmentValidation.BULK_CLOSE,
      request,
    );

    const { enrollment_ids: enrollmentIds, ...closePayload } = bulkRequest;
    const items: BulkActionItemResponse<EnrollmentResponse>[] = [];

    for (const id of enrollmentIds) {
      try {
        const enrollment = await prismaClient.studentClassEnrollment.findUnique({
          where: { id },
          select: { student_id: true },
        });

        if (!enrollment) {
          throw new ResponseError(404, "Enrollment not found");
        }

        const data = await EnrollmentService.close(
          admin,
          {
            ...closePayload,
            id,
            student_id: enrollment.student_id,
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

  // Removing a promoted enrollment reactivates its predecessor atomically.
  static async remove(
    admin: AdminUser,
    request: RemoveEnrollmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    await assertWriteAllowed(admin, context, now);

    const deleteRequest = Validation.validate(
      EnrollmentValidation.DELETE,
      request,
    );

    const existing = await prismaClient.studentClassEnrollment.findFirst({
      where: { id: deleteRequest.id, student_id: deleteRequest.student_id },
      include: { class: { include: { grade: true } } },
    });
    if (!existing) {
      throw new ResponseError(404, "Enrollment not found");
    }
    if (existing.deleted_at !== null) {
      throw new ResponseError(400, "Enrollment is already deleted");
    }

    await assertClassInAdminUnit(
      admin,
      existing.class,
      "remove",
      "remove enrollments in classes",
      context,
    );

    // A missing predecessor falls back to a plain drop.
    const promotedFrom = existing.promoted_from_enrollment_id
      ? await prismaClient.studentClassEnrollment.findFirst({
          where: { id: existing.promoted_from_enrollment_id, deleted_at: null },
          include: { class: { include: { grade: true } } },
        })
      : null;
    if (promotedFrom) {
      await assertClassInAdminUnit(
        admin,
        promotedFrom.class,
        "remove",
        "remove enrollments in classes",
        context,
      );
    }

    const student = await prismaClient.student.findUniqueOrThrow({
      where: { id: deleteRequest.student_id },
      include: { person: { select: { full_name: true } } },
    });
    const studentFullName = student.person.full_name;

    const deletedAt = now;
    await prismaClient.$transaction(async (tx) => {
      if (promotedFrom && promotedFrom.class.capacity !== null) {
        await assertClassHasCapacity(
          tx,
          promotedFrom.class.id,
          promotedFrom.class.capacity,
        );
      }

      await tx.studentClassEnrollment.update({
        where: { id: existing.id },
        data: { deleted_at: deletedAt },
      });

      let rolledBack = false;
      if (promotedFrom) {
        const reactivated = await tx.studentClassEnrollment.updateMany({
          where: {
            id: promotedFrom.id,
            enrollment_status: { not: EnrollmentStatus.ACTIVE },
          },
          data: { enrollment_status: EnrollmentStatus.ACTIVE, end_date: null },
        });
        if (reactivated.count === 0) {
          throw new ResponseError(
            400,
            "The enrollment this was promoted from is no longer available to reactivate.",
          );
        }
        rolledBack = true;

        await tx.student.update({
          where: { id: student.id },
          data: {
            current_class_id: promotedFrom.class_id,
            // Restore the enrollment grade, not the mixed-age class primary grade.
            current_grade_id: promotedFrom.grade_id,
            status: StudentStatus.ACTIVE,
            graduation_grade: null,
            leave_year: null,
          },
        });
      } else if (student.current_class_id === existing.class_id) {
        // Dropping the last active enrollment returns active or inactive students to registered.
        let nextStatus: StudentStatus | undefined;
        if (
          existing.enrollment_status === EnrollmentStatus.ACTIVE &&
          (student.status === StudentStatus.ACTIVE ||
            student.status === StudentStatus.INACTIVE)
        ) {
          const remainingActive = await tx.studentClassEnrollment.findFirst({
            where: {
              student_id: student.id,
              enrollment_status: EnrollmentStatus.ACTIVE,
              deleted_at: null,
              NOT: { id: existing.id },
            },
          });
          if (!remainingActive) {
            nextStatus = StudentStatus.REGISTERED;
          }
        }

        await tx.student.update({
          where: { id: student.id },
          data: {
            current_class_id: null,
            ...(nextStatus ? { status: nextStatus } : {}),
          },
        });
      }

      const auditTarget = rolledBack
        ? await tx.studentClassEnrollment.findUniqueOrThrow({
            where: { id: promotedFrom!.id },
          })
        : existing;

      await AuditService.record(
        {
          action: rolledBack
            ? AuditAction.ROLLBACK_PROMOTE_ENROLLMENT
            : AuditAction.DELETE_ENROLLMENT,
          source: AuditSource.UI,
          entity_type: "StudentClassEnrollment",
          entity_id: auditTarget.id,
          admin_id: admin.id,
          old_values: toEnrollmentAuditSnapshot(existing, studentFullName),
          new_values: rolledBack
            ? toEnrollmentAuditSnapshot(auditTarget, studentFullName)
            : { deleted_at: deletedAt.toISOString() },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    return true;
  }

  static async bulkRemove(
    admin: AdminUser,
    request: BulkRemoveEnrollmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkRemoveEnrollmentResponse> {
    await assertWriteAllowed(admin, context, now);

    const bulkRequest = Validation.validate(
      EnrollmentValidation.BULK_DELETE,
      request,
    );

    const { enrollment_ids: enrollmentIds, ...removePayload } = bulkRequest;
    const items: BulkActionItemResponse<boolean>[] = [];

    for (const id of enrollmentIds) {
      try {
        const enrollment = await prismaClient.studentClassEnrollment.findUnique({
          where: { id },
          select: { student_id: true },
        });

        if (!enrollment) {
          throw new ResponseError(404, "Enrollment not found");
        }

        const data = await EnrollmentService.remove(
          admin,
          {
            ...removePayload,
            id,
            student_id: enrollment.student_id,
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

  static async restore(
    admin: AdminUser,
    request: RestoreEnrollmentRequest,
    context: AuditRequestContext = {},
  ): Promise<EnrollmentResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can restore enrollment data",
      );
    }

    const restoreRequest = Validation.validate(
      EnrollmentValidation.RESTORE,
      request,
    );

    const existing = await prismaClient.studentClassEnrollment.findFirst({
      where: { id: restoreRequest.id, student_id: restoreRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Enrollment not found");
    }
    if (existing.deleted_at === null) {
      throw new ResponseError(
        400,
        "Enrollment is not in the trash bin. It might be active or permanently deleted.",
      );
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.studentClassEnrollment.update({
        where: { id: existing.id },
        data: { deleted_at: null },
      });

      await AuditService.record(
        {
          action: AuditAction.RESTORE_ENROLLMENT,
          source: AuditSource.UI,
          entity_type: "StudentClassEnrollment",
          entity_id: existing.id,
          admin_id: admin.id,
          // Narrowed above (deleted_at === null already threw), but TS
          // narrowing doesn't cross this closure boundary.
          old_values: { deleted_at: existing.deleted_at!.toISOString() },
          new_values: { deleted_at: null },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const restored =
      await prismaClient.studentClassEnrollment.findUniqueOrThrow({
        where: { id: existing.id },
        include: ENROLLMENT_INCLUDE,
      });

    return toEnrollmentResponse(restored);
  }

  // Reopen the existing row to preserve its academic-year unique slot.
  static async reactivate(
    admin: AdminUser,
    request: ReactivateEnrollmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<EnrollmentResponse> {
    await assertWriteAllowed(admin, context, now);

    const reactivateRequest = Validation.validate(
      EnrollmentValidation.REACTIVATE,
      request,
    );

    const existing = await prismaClient.studentClassEnrollment.findFirst({
      where: {
        id: reactivateRequest.id,
        student_id: reactivateRequest.student_id,
        deleted_at: null,
      },
      include: { class: { include: { grade: true } } },
    });
    if (!existing) {
      throw new ResponseError(404, "Enrollment not found");
    }
    if (existing.enrollment_status === EnrollmentStatus.ACTIVE) {
      throw new ResponseError(400, "This enrollment is already active");
    }

    await assertClassInAdminUnit(
      admin,
      existing.class,
      "reactivate",
      "reactivate enrollments in classes",
      context,
    );

    const student = await prismaClient.student.findFirst({
      where: { id: reactivateRequest.student_id, deleted_at: null },
      include: { person: { select: { full_name: true } } },
    });
    if (!student) {
      throw new ResponseError(404, "Student not found");
    }
    const studentFullName = student.person.full_name;
    if (
      student.current_class_id &&
      student.current_class_id !== existing.class_id
    ) {
      throw new ResponseError(
        400,
        "This student already has an active enrollment in another class. Close that enrollment first.",
      );
    }
    if (existing.class.status === ClassStatus.INACTIVE) {
      throw new ResponseError(400, "Class is not active");
    }

    await prismaClient.$transaction(async (tx) => {
      if (existing.class.capacity !== null) {
        await assertClassHasCapacity(
          tx,
          existing.class.id,
          existing.class.capacity,
        );
      }

      const updated = await tx.studentClassEnrollment.updateMany({
        where: {
          id: existing.id,
          enrollment_status: { not: EnrollmentStatus.ACTIVE },
        },
        data: { enrollment_status: EnrollmentStatus.ACTIVE, end_date: null },
      });
      if (updated.count === 0) {
        throw new ResponseError(400, "This enrollment is already active");
      }

      await tx.student.update({
        where: { id: student.id },
        data: {
          current_class_id: existing.class_id,
          status: StudentStatus.ACTIVE,
          // Stale leftovers from whatever closed this enrollment in the
          // first place - no longer accurate once it's active again.
          graduation_grade: null,
          leave_year: null,
        },
      });

      const updatedForAudit =
        await tx.studentClassEnrollment.findUniqueOrThrow({
          where: { id: existing.id },
        });

      await AuditService.record(
        {
          action: AuditAction.REACTIVATE_ENROLLMENT,
          source: AuditSource.UI,
          entity_type: "StudentClassEnrollment",
          entity_id: updatedForAudit.id,
          admin_id: admin.id,
          old_values: toEnrollmentAuditSnapshot(existing, studentFullName),
          new_values: toEnrollmentAuditSnapshot(updatedForAudit, studentFullName),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const reactivated =
      await prismaClient.studentClassEnrollment.findUniqueOrThrow({
        where: { id: existing.id },
        include: ENROLLMENT_INCLUDE,
      });

    return toEnrollmentResponse(reactivated);
  }

  static async bulkReactivate(
    admin: AdminUser,
    request: BulkReactivateEnrollmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkReactivateEnrollmentResponse> {
    await assertWriteAllowed(admin, context, now);

    const bulkRequest = Validation.validate(
      EnrollmentValidation.BULK_REACTIVATE,
      request,
    );

    const { enrollment_ids: enrollmentIds, ...reactivatePayload } = bulkRequest;
    const items: BulkActionItemResponse<EnrollmentResponse>[] = [];

    for (const id of enrollmentIds) {
      try {
        const enrollment = await prismaClient.studentClassEnrollment.findUnique({
          where: { id },
          select: { student_id: true },
        });

        if (!enrollment) {
          throw new ResponseError(404, "Enrollment not found");
        }

        const data = await EnrollmentService.reactivate(
          admin,
          {
            ...reactivatePayload,
            id,
            student_id: enrollment.student_id,
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

  static async getHistory(
    admin: AdminUserWithStudentScope,
    request: GetEnrollmentHistoryRequest,
  ): Promise<EnrollmentResponse[]> {
    assertCanViewStudentData(admin);

    const historyRequest = Validation.validate(
      EnrollmentValidation.GET_HISTORY,
      request,
    );

    const studentUnitScope = resolveStudentUnitScope(admin);
    const student = await prismaClient.student.findFirst({
      where: {
        id: historyRequest.student_id,
        ...(studentUnitScope !== undefined
          ? { current_grade: { unit_id: { in: studentUnitScope } } }
          : {}),
      },
    });
    if (!student) {
      throw new ResponseError(404, "Student not found");
    }

    const enrollments = await prismaClient.studentClassEnrollment.findMany({
      where: {
        student_id: historyRequest.student_id,
        deleted_at: historyRequest.is_deleted ? { not: null } : null,
      },
      include: ENROLLMENT_INCLUDE,
      orderBy: { academic_year: { start_date: "desc" } },
    });

    return enrollments.map((enrollment) => toEnrollmentResponse(enrollment));
  }

  static async search(
    admin: AdminUserWithStudentScope,
    request: SearchEnrollmentRequest,
  ): Promise<Pageable<EnrollmentResponse>> {
    assertCanViewStudentData(admin);

    const searchRequest = Validation.validate(
      EnrollmentValidation.SEARCH,
      request,
    );

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const studentUnitScope = resolveStudentUnitScope(admin);
    const where = {
      student_id: searchRequest.student_id,
      class_id: searchRequest.class_id,
      grade_id: searchRequest.grade_id,
      academic_year_id: searchRequest.academic_year_id,
      enrollment_status: searchRequest.status,
      deleted_at: searchRequest.is_deleted ? { not: null } : null,
      ...(studentUnitScope !== undefined
        ? { grade: { unit_id: { in: studentUnitScope } } }
        : {}),
    };

    return paginate(searchRequest.page, searchRequest.size, {
      count: () => prismaClient.studentClassEnrollment.count({ where }),
      findMany: () =>
        prismaClient.studentClassEnrollment
          .findMany({
            where,
            include: ENROLLMENT_INCLUDE,
            take: searchRequest.size,
            skip,
            orderBy: buildEnrollmentOrderBy(
              searchRequest.sort_by || "created_at",
              searchRequest.sort_order || "desc",
            ),
          })
          .then(async (enrollments) => {
            const studentIds = [
              ...new Set(enrollments.map((enrollment) => enrollment.student_id)),
            ];
            const flaggedIds =
              await findStudentIdsWithPlaceholderClass(studentIds);
            return enrollments.map((enrollment) =>
              toEnrollmentResponse(
                enrollment,
                flaggedIds.has(enrollment.student_id),
              ),
            );
          }),
    });
  }
}

function buildEnrollmentOrderBy(
  sortBy: EnrollmentSortField,
  sortOrder: "asc" | "desc",
) {
  return { [sortBy]: sortOrder };
}

// Batch placeholder-class checks for the current page.
async function findStudentIdsWithPlaceholderClass(
  studentIds: string[],
): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const rows = await prismaClient.studentClassEnrollment.findMany({
    where: {
      student_id: { in: studentIds },
      deleted_at: null,
      class: { name: { startsWith: UNKNOWN_LEGACY_CLASS_PREFIX } },
    },
    select: { student_id: true },
    distinct: ["student_id"],
  });
  return new Set(rows.map((row) => row.student_id));
}
