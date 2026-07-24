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
import { paginate, type Pageable } from "../model/page-model";
import {
  toEnrollmentAuditSnapshot,
  toEnrollmentResponse,
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

async function assertGradeNotBelowJoinGrade(
  studentId: string,
  gradeId: string,
) {
  const student = await prismaClient.student.findFirst({
    where: { id: studentId, deleted_at: null },
    include: { join_grade: true },
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
      : now;

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

        const enrollmentForAudit =
          await tx.studentClassEnrollment.findUniqueOrThrow({
            where: { id: created.id },
            include: ENROLLMENT_INCLUDE,
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

    await assertGradeNotBelowJoinGrade(
      promoteRequest.student_id,
      promoteRequest.grade_id,
    );

    const klass = await assertClassMatchesGrade(
      promoteRequest.class_id,
      promoteRequest.grade_id,
      promoteRequest.academic_year_id,
    );

    const effectiveDate = promoteRequest.effective_date
      ? new Date(promoteRequest.effective_date)
      : now;

    if (existing.start_date && effectiveDate < existing.start_date) {
      throw new ResponseError(
        400,
        "Effective date cannot be before the current enrollment's start date",
      );
    }

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
          },
        });

        await tx.student.update({
          where: { id: promoteRequest.student_id },
          data: {
            current_grade_id: promoteRequest.grade_id,
            current_class_id: klass.id,
          },
        });

        const createdForAudit =
          await tx.studentClassEnrollment.findUniqueOrThrow({
            where: { id: newEnrollment.id },
            include: ENROLLMENT_INCLUDE,
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

      const updatedForAudit =
        await tx.studentClassEnrollment.findUniqueOrThrow({
          where: { id: existing.id },
          include: ENROLLMENT_INCLUDE,
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

      const updatedForAudit =
        await tx.studentClassEnrollment.findUniqueOrThrow({
          where: { id: existing.id },
          include: ENROLLMENT_INCLUDE,
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
