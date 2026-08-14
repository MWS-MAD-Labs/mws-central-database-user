import {
  AcademicYearStatus,
  AdminRole,
  AuditAction,
  AuditSource,
  ClassStatus,
  EnrollmentStatus,
  Prisma,
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
  type GetEnrollmentHistoryRequest,
  type PromoteEnrollmentRequest,
  type ReactivateEnrollmentRequest,
  type RemoveEnrollmentRequest,
  type RestoreEnrollmentRequest,
  type SearchEnrollmentRequest,
  type TransferEnrollmentRequest,
} from "../model/enrollment-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import { EnrollmentValidation } from "../validation/enrollment-validation";
import { Validation } from "../validation/validation";

const ENROLLMENT_INCLUDE = {
  class: true,
  academic_year: true,
  student: { include: { person: true } },
} as const;

const DUPLICATE_ENROLLMENT_MESSAGE =
  "This student already has an enrollment record for this academic year.";

// Reverse of student-service.ts's TERMINAL_STUDENT_STATUS_TO_ENROLLMENT_STATUS -
// what a student's own status becomes when their last active enrollment
// closes with each reason.
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
    new_values: {
      reason: `blocked enrollment ${action}`,
      ...(classId ? { class_id: classId } : {}),
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

// Every enrollment mutation ends up touching one particular class - this is
// the one place that decides whether a DATABASE_ADMIN is allowed to touch
// it. No-ops for SUPER_ADMIN/VIEWER (assertWriteAllowed already rejects
// VIEWER before this ever runs).
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
    if (!admin.can_write_data) {
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to modify data",
      );
    }
    return assertCanWriteNow(admin, context, now);
  }
}

function bulkFailureMessage(error: unknown): string {
  if (error instanceof ResponseError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

async function assertClassHasCapacity(
  tx: Prisma.TransactionClient,
  classId: string,
  capacity: number,
  admin: AdminUser,
  force = false,
): Promise<void> {
  if (force && admin.role === AdminRole.SUPER_ADMIN) {
    return;
  }

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
      `Class is at full capacity (${capacity} students). Only a Super Admin can override this with force.`,
    );
  }
}

async function assertClassMatchesGrade(
  classId: string,
  gradeId: string,
  academicYearId: string,
) {
  const klass = await prismaClient.class.findUnique({
    where: { id: classId },
    include: { grade: true },
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
  if (klass.grade_id !== gradeId) {
    throw new ResponseError(
      400,
      "Class's grade does not match the student's grade",
    );
  }
  // UPCOMING is allowed alongside ACTIVE - a class being prepared ahead of
  // its academic year starting is still a valid enrollment/promotion
  // target (that's the point of the status), only INACTIVE is not.
  if (klass.status === ClassStatus.INACTIVE) {
    throw new ResponseError(400, "Class is not active");
  }

  return klass;
}

// transfer() moves a student sideways within the same academic year - a
// lateral class change or a grade correction, not a promotion - so only the
// academic year and active status are enforced here, deliberately not the
// grade (unlike assertClassMatchesGrade, which promote()/create() still use).
async function assertClassInAcademicYear(
  classId: string,
  academicYearId: string,
) {
  const klass = await prismaClient.class.findUnique({
    where: { id: classId },
    include: { grade: true },
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

// Backfilling a historical enrollment - the class is very likely INACTIVE
// (classes get cascade-deactivated when their academic year stops being
// ACTIVE, see AcademicYearService.update) and the student's current grade
// has usually moved on since then, so neither of assertClassMatchesGrade's
// checks apply here. Still confirms the class actually belongs to the
// academic year the caller says it does.
async function resolveClassForLegacyEnrollment(
  classId: string,
  academicYearId: string,
) {
  const klass = await prismaClient.class.findUnique({
    where: { id: classId },
    include: { grade: true },
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

// Covers both grade-progression rules for a promotion in one pass:
// - never below the grade the student originally joined at (always enforced)
// - a normal promotion must move to a strictly higher grade
// - is_retention (repeating a year) must stay in the *same* grade - never
//   higher (that's just a normal promotion), never lower (not naturally
//   reachable by "not moving up") - and must land in a later academic year
//   than the enrollment being retained, never the current one, since
//   staying in the same class in the same year isn't a retention at all.
async function assertValidGradeProgression(
  studentId: string,
  gradeId: string,
  isRetention: boolean,
  sourceAcademicYearId: string,
  targetAcademicYearId: string,
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

  if (isRetention) {
    if (grade.level !== student.current_grade.level) {
      throw new ResponseError(
        400,
        "Retention must re-enroll in the same grade as the student's current grade. Use a normal promotion to change grades.",
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
        "Retention must move to a later academic year than the student's current enrollment.",
      );
    }
  } else if (grade.level <= student.current_grade.level) {
    throw new ResponseError(
      400,
      "Promotion must move to a higher grade than the student's current grade. Set is_retention with a reason to re-enroll in the same grade in a later academic year.",
    );
  }
}

// Enrollment start_date / promote effective_date default to the academic
// year's own start_date (now a required field) rather than today - a batch
// of enrollments/promotions for a new year should land on the year's actual
// start, not whatever day the admin happened to click the button. Callers
// can still override with an explicit date (e.g. a mid-year PSB admission).
async function resolveDefaultStartDate(academicYearId: string): Promise<Date> {
  const academicYear = await prismaClient.academicYear.findUnique({
    where: { id: academicYearId },
  });
  if (!academicYear) {
    throw new ResponseError(400, "Invalid academic year");
  }
  return academicYear.start_date;
}

// Enrollment dates are keyed to a specific academic year row (see §9.3 -
// "Kelas apa yang aktif untuk tahun ajaran saat ini?"), so a start/end date
// that falls outside that year's own calendar range is almost always a data
// entry mistake (wrong year picked, or a lazy "today" default instead of the
// term's real start). Years without dates set yet skip the check.
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
  if (!academicYear.end_date) {
    return;
  }
  if (date < academicYear.start_date || date > academicYear.end_date) {
    throw new ResponseError(
      400,
      `${fieldLabel} must fall within ${academicYear.name}'s date range (${academicYear.start_date.toISOString().slice(0, 10)} to ${academicYear.end_date.toISOString().slice(0, 10)})`,
    );
  }
}

// close()'s end_date defaults to today when the admin leaves it blank, but
// "today" can fall entirely outside the enrollment's own academic year (e.g.
// closing out a year-old or future-dated record long after the fact) -
// defaulting to an out-of-range date would make assertDateWithinAcademicYear
// reject a date the admin never actually supplied. Clamp into range instead;
// an explicit end_date is still validated for real against the range. The
// floor is the later of the academic year's start and the enrollment's own
// start_date (a mid-year admission starts after the year itself does), so
// the clamped default never trips the separate "end date before start date"
// check right after this.
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
    });
    if (!student) {
      throw new ResponseError(404, "Student not found");
    }

    const isLegacy = Boolean(createRequest.is_legacy);

    // Zod's refine already guarantees academic_year_id is set when is_legacy
    // is true, so the "!" here is provably safe.
    const academicYearId = isLegacy
      ? createRequest.academic_year_id!
      : await resolveActiveAcademicYearId(createRequest.academic_year_id);

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

    const enrollmentStatus = isLegacy
      ? (createRequest.status ?? EnrollmentStatus.COMPLETED)
      : EnrollmentStatus.ACTIVE;

    const endDate =
      isLegacy && createRequest.end_date
        ? new Date(createRequest.end_date)
        : null;
    if (endDate) {
      if (endDate < startDate) {
        throw new ResponseError(
          400,
          "End date cannot be before the enrollment's start date",
        );
      }
      await assertDateWithinAcademicYear(
        academicYearId,
        endDate,
        "Enrollment end date",
      );
    }

    let createdId: string;
    try {
      createdId = await prismaClient.$transaction(async (tx) => {
        if (!isLegacy && klass.capacity !== null) {
          await assertClassHasCapacity(
            tx,
            klass.id,
            klass.capacity,
            admin,
            createRequest.force,
          );
        }

        const created = await tx.studentClassEnrollment.create({
          data: {
            student_id: student.id,
            academic_year_id: academicYearId,
            class_id: klass.id,
            grade_level: klass.grade.name,
            class_name_snapshot: klass.name,
            start_date: startDate,
            enrollment_status: enrollmentStatus,
            end_date: endDate,
          },
        });

        // A legacy/historical row is a backfilled record, not the student's
        // live standing - don't let it touch their current class or status.
        if (!isLegacy) {
          await tx.student.update({
            where: { id: student.id },
            data: {
              current_class_id: klass.id,
              ...(student.status === StudentStatus.REGISTERED
                ? { status: StudentStatus.ACTIVE }
                : {}),
            },
          });
        }

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
            new_values: toEnrollmentAuditSnapshot(enrollmentForAudit),
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

    await assertValidGradeProgression(
      promoteRequest.student_id,
      promoteRequest.grade_id,
      Boolean(promoteRequest.is_retention),
      existing.academic_year_id,
      promoteRequest.academic_year_id,
    );

    const klass = await assertClassMatchesGrade(
      promoteRequest.class_id,
      promoteRequest.grade_id,
      promoteRequest.academic_year_id,
    );

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
          await assertClassHasCapacity(
            tx,
            klass.id,
            klass.capacity,
            admin,
            promoteRequest.force,
          );
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
            grade_level: klass.grade.name,
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
            old_values: toEnrollmentAuditSnapshot(existing),
            new_values: toEnrollmentAuditSnapshot(createdForAudit),
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
      include: { join_grade: true },
    });
    if (!student) {
      throw new ResponseError(404, "Student not found");
    }

    const klass = await assertClassInAcademicYear(
      transferRequest.class_id,
      existing.academic_year_id,
    );

    if (klass.grade.level < student.join_grade.level) {
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

    await prismaClient.$transaction(async (tx) => {
      if (klass.capacity !== null) {
        await assertClassHasCapacity(
          tx,
          klass.id,
          klass.capacity,
          admin,
          transferRequest.force,
        );
      }

      const updated = await tx.studentClassEnrollment.updateMany({
        where: { id: existing.id, enrollment_status: EnrollmentStatus.ACTIVE },
        data: {
          class_id: klass.id,
          class_name_snapshot: klass.name,
          grade_level: klass.grade.name,
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
        data: { current_class_id: klass.id, current_grade_id: klass.grade_id },
      });

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
          old_values: toEnrollmentAuditSnapshot(existing),
          new_values: toEnrollmentAuditSnapshot(updatedForAudit),
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

    await assertClassInAdminUnit(
      admin,
      existing.class,
      "close",
      "close enrollments in classes",
      context,
    );

    const student = await prismaClient.student.findFirst({
      where: { id: closeRequest.student_id, deleted_at: null },
    });
    if (!student) {
      throw new ResponseError(404, "Student not found");
    }

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

      // ACTIVE requires an active enrollment (see assertStudentCanBecomeActive
      // in student-service.ts) - if this was the last one, the student can't
      // stay ACTIVE. Mirror the enrollment's own closing status rather than
      // guessing: a transfer closes into StudentStatus.TRANSFERRED, a
      // withdrawal into StudentStatus.WITHDRAWN, completion (graduation)
      // into StudentStatus.GRADUATED. Can't index StudentStatus by
      // closeRequest.status directly here - COMPLETED/GRADUATED don't share
      // a name the way TRANSFERRED/WITHDRAWN do.
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
          old_values: toEnrollmentAuditSnapshot(existing),
          new_values: toEnrollmentAuditSnapshot(updatedForAudit),
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

  // Soft-deletes an enrollment. When it has a promoted_from_enrollment_id
  // (this was created by promote()), also reactivates the enrollment it was
  // promoted from, atomically - "Rollback" and "Drop" used to be two
  // separate actions differing only in that one condition; this is both of
  // them, deciding which behavior applies on its own.
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

    // Not required to exist - a hard-deleted or otherwise vanished target
    // just falls back to a plain drop below (nothing sensible left to roll
    // back to), rather than failing the whole request.
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
    });

    const deletedAt = now;
    await prismaClient.$transaction(async (tx) => {
      if (promotedFrom && promotedFrom.class.capacity !== null) {
        await assertClassHasCapacity(
          tx,
          promotedFrom.class.id,
          promotedFrom.class.capacity,
          admin,
          deleteRequest.force,
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
            current_grade_id: promotedFrom.class.grade.id,
            status: StudentStatus.ACTIVE,
            graduation_grade: null,
            leave_year: null,
          },
        });
      } else if (student.current_class_id === existing.class_id) {
        // Deleting an ACTIVE enrollment record (an administrative undo, not
        // a withdrawal/transfer) can leave the student with zero active
        // enrollments, which ACTIVE requires (assertStudentCanBecomeActive
        // in student-service.ts). Unlike close(), there's no "reason" to
        // map to (TRANSFERRED/WITHDRAWN) here, this was a mistake being
        // corrected, so fall back to REGISTERED, the same state a student
        // is in before their first enrollment.
        let nextStatus: StudentStatus | undefined;
        if (
          existing.enrollment_status === EnrollmentStatus.ACTIVE &&
          student.status === StudentStatus.ACTIVE
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
          old_values: toEnrollmentAuditSnapshot(existing),
          new_values: rolledBack
            ? toEnrollmentAuditSnapshot(auditTarget)
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

  // Undoes a mistaken close (e.g. graduated by accident) - flips the same
  // enrollment row back to ACTIVE instead of creating a new one, so it
  // never touches the (student_id, academic_year_id) unique index the way
  // a fresh create() would.
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
    });
    if (!student) {
      throw new ResponseError(404, "Student not found");
    }
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
          admin,
          reactivateRequest.force,
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
          old_values: toEnrollmentAuditSnapshot(existing),
          new_values: toEnrollmentAuditSnapshot(updatedForAudit),
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
    admin: AdminUser,
    request: GetEnrollmentHistoryRequest,
  ): Promise<EnrollmentResponse[]> {
    void admin;

    const historyRequest = Validation.validate(
      EnrollmentValidation.GET_HISTORY,
      request,
    );

    const student = await prismaClient.student.findUnique({
      where: { id: historyRequest.student_id },
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

    return enrollments.map(toEnrollmentResponse);
  }

  static async search(
    admin: AdminUser,
    request: SearchEnrollmentRequest,
  ): Promise<Pageable<EnrollmentResponse>> {
    void admin;

    const searchRequest = Validation.validate(
      EnrollmentValidation.SEARCH,
      request,
    );

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const where = {
      student_id: searchRequest.student_id,
      class_id: searchRequest.class_id,
      academic_year_id: searchRequest.academic_year_id,
      enrollment_status: searchRequest.status,
      deleted_at: searchRequest.is_deleted ? { not: null } : null,
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
          .then((enrollments) => enrollments.map(toEnrollmentResponse)),
    });
  }
}

function buildEnrollmentOrderBy(
  sortBy: EnrollmentSortField,
  sortOrder: "asc" | "desc",
) {
  return { [sortBy]: sortOrder };
}
