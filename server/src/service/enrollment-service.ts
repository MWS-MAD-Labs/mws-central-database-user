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
  type BulkCreateEnrollmentRequest,
  type BulkCreateEnrollmentResponse,
  type BulkPromoteEnrollmentRequest,
  type BulkPromoteEnrollmentResponse,
  type CloseEnrollmentRequest,
  type CreateEnrollmentRequest,
  type EnrollmentResponse,
  type EnrollmentSortField,
  type GetEnrollmentHistoryRequest,
  type PromoteEnrollmentRequest,
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

function rethrowAsFriendlyEnrollmentConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("student_id") || fields?.includes("academic_year_id")) {
    throw new ResponseError(400, DUPLICATE_ENROLLMENT_MESSAGE);
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
  if (klass.status !== ClassStatus.ACTIVE) {
    throw new ResponseError(400, "Class is not active");
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
// - never at-or-below the student's current grade, unless is_retention is
//   set (repeating a year) - see PromoteEnrollmentRequest.is_retention
async function assertValidGradeProgression(
  studentId: string,
  gradeId: string,
  isRetention: boolean,
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

  if (!isRetention && grade.level <= student.current_grade.level) {
    throw new ResponseError(
      400,
      "Promotion must move to a higher grade than the student's current grade. Set is_retention with a reason to re-enroll in the same or a lower grade.",
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

    const academicYearId = await resolveActiveAcademicYearId(
      createRequest.academic_year_id,
    );

    const klass = await assertClassMatchesGrade(
      createRequest.class_id,
      student.current_grade_id,
      academicYearId,
    );

    const startDate = createRequest.start_date
      ? new Date(createRequest.start_date)
      : await resolveDefaultStartDate(academicYearId);

    await assertDateWithinAcademicYear(
      academicYearId,
      startDate,
      "Enrollment start date",
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
          },
        });

        await tx.student.update({
          where: { id: student.id },
          data: {
            current_class_id: klass.id,
            ...(student.status === StudentStatus.REGISTERED
              ? { status: StudentStatus.ACTIVE }
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
    );

    const klass = await assertClassMatchesGrade(
      promoteRequest.class_id,
      promoteRequest.grade_id,
      promoteRequest.academic_year_id,
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
    });
    if (!student) {
      throw new ResponseError(404, "Student not found");
    }

    const klass = await assertClassMatchesGrade(
      transferRequest.class_id,
      student.current_grade_id,
      existing.academic_year_id,
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
        data: { current_class_id: klass.id },
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
    });
    if (!existing) {
      throw new ResponseError(404, "Enrollment not found");
    }
    if (existing.enrollment_status !== EnrollmentStatus.ACTIVE) {
      throw new ResponseError(400, "Only an active enrollment can be closed");
    }

    const student = await prismaClient.student.findFirst({
      where: { id: closeRequest.student_id, deleted_at: null },
    });
    if (!student) {
      throw new ResponseError(404, "Student not found");
    }

    const endDate = closeRequest.end_date
      ? new Date(closeRequest.end_date)
      : now;

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
      // withdrawal into StudentStatus.WITHDRAWN.
      const remainingActive = await tx.studentClassEnrollment.findFirst({
        where: {
          student_id: student.id,
          enrollment_status: EnrollmentStatus.ACTIVE,
          deleted_at: null,
        },
      });

      await tx.student.update({
        where: { id: student.id },
        data: {
          current_class_id: null,
          ...(!remainingActive && student.status === StudentStatus.ACTIVE
            ? { status: StudentStatus[closeRequest.status] }
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

  static async remove(
    admin: AdminUser,
    request: RemoveEnrollmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete enrollment data",
      );
    }

    const deleteRequest = Validation.validate(
      EnrollmentValidation.DELETE,
      request,
    );

    const existing = await prismaClient.studentClassEnrollment.findFirst({
      where: { id: deleteRequest.id, student_id: deleteRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Enrollment not found");
    }
    if (existing.deleted_at !== null) {
      throw new ResponseError(400, "Enrollment is already deleted");
    }

    const student = await prismaClient.student.findUniqueOrThrow({
      where: { id: deleteRequest.student_id },
    });

    const deletedAt = now;
    await prismaClient.$transaction(async (tx) => {
      await tx.studentClassEnrollment.update({
        where: { id: existing.id },
        data: { deleted_at: deletedAt },
      });

      if (student.current_class_id === existing.class_id) {
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

      await AuditService.record(
        {
          action: AuditAction.DELETE_ENROLLMENT,
          source: AuditSource.UI,
          entity_type: "StudentClassEnrollment",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: toEnrollmentAuditSnapshot(existing),
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
