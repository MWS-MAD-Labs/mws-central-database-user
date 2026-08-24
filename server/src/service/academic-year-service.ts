import {
  AcademicYearStatus,
  AdminRole,
  AuditAction,
  AuditSource,
  ClassStatus,
  EnrollmentStatus,
  Prisma,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toAcademicYearAuditSnapshot,
  toAcademicYearResponse,
  type AcademicYearResponse,
  type AcademicYearSortField,
  type CreateAcademicYearRequest,
  type DeleteAcademicYearRequest,
  type GetAcademicYearRequest,
  type GetUnresolvedEnrollmentCountRequest,
  type SearchAcademicYearRequest,
  type UnresolvedEnrollmentCountResponse,
  type UpdateAcademicYearRequest,
} from "../model/academic-year-model";
import { paginate, type Pageable } from "../model/page-model";
import { AuditService } from "./audit-service";
import { AcademicYearValidation } from "../validation/academic-year-validation";
import { Validation } from "../validation/validation";

const SINGLE_ACTIVE_ACADEMIC_YEAR_MESSAGE =
  "Another academic year is already active. Complete or reassign it before activating this one.";

// How many calendar years off from `name`'s start year we tolerate for
// ACTIVE - +1 covers marking next year active a bit early / this year
// active a bit late, without letting something like "2028/2029" go ACTIVE
// while it's still 2026.
const ACTIVE_YEAR_TOLERANCE = 1;

// Mirrors enrollment-service.ts's PROMOTE_WINDOW_DAYS - same underlying
// concern (don't transition a year out of its current phase before it's
// actually close to being over/starting), applied to the year itself
// instead of a single student's enrollment.
const STATUS_TRANSITION_WINDOW_DAYS = 30;

function assertActivationNotTooEarly(
  existing: { name: string; start_date: Date },
  now: Date,
): void {
  const daysUntilStart =
    (existing.start_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (daysUntilStart > STATUS_TRANSITION_WINDOW_DAYS) {
    throw new ResponseError(
      400,
      `Too early to activate '${existing.name}' - it doesn't start until ${existing.start_date.toISOString().slice(0, 10)}. Activation opens ${STATUS_TRANSITION_WINDOW_DAYS} days before an academic year starts.`,
    );
  }
}

// Skipped when end_date isn't set - it's an optional field (see
// AcademicYearDialog.jsx) and a year without one shouldn't block completion.
function assertCompletionNotTooEarly(
  existing: { name: string; end_date: Date | null },
  now: Date,
): void {
  if (!existing.end_date) return;

  const daysUntilEnd =
    (existing.end_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (daysUntilEnd > STATUS_TRANSITION_WINDOW_DAYS) {
    throw new ResponseError(
      400,
      `Too early to mark '${existing.name}' as Completed - it doesn't end until ${existing.end_date.toISOString().slice(0, 10)}. Completion opens ${STATUS_TRANSITION_WINDOW_DAYS} days before an academic year ends.`,
    );
  }
}

function assertActiveYearIsReasonable(name: string): void {
  const match = name.match(/^(\d{4})\/\d{4}$/);
  if (!match) return; // format already enforced by validation - defensive only

  const startYear = Number(match[1]);
  const currentYear = new Date().getFullYear();

  if (Math.abs(currentYear - startYear) > ACTIVE_YEAR_TOLERANCE) {
    throw new ResponseError(
      400,
      `"${name}" doesn't look like the current academic year (today is ${currentYear}). Double-check the name, or use UPCOMING/COMPLETED instead of ACTIVE.`,
    );
  }
}

// start_date/end_date are meant to bound the school year `name` names -
// e.g. "2026/2027" should run roughly within calendar 2026 to calendar
// 2027, not start in 2025 and end in 2030. Tied directly to the two years
// already encoded in the (now strictly formatted) name.
function assertDatesMatchName(
  name: string,
  startDate: Date | null | undefined,
  endDate: Date | null | undefined,
): void {
  const match = name.match(/^(\d{4})\/(\d{4})$/);
  if (!match) return; // format already enforced by validation - defensive only

  const [, yearOneStr, yearTwoStr] = match;
  const yearOne = Number(yearOneStr);
  const yearTwo = Number(yearTwoStr);

  if (startDate && startDate.getFullYear() !== yearOne) {
    throw new ResponseError(
      400,
      `start_date must fall within ${yearOne} to match academic year "${name}"`,
    );
  }
  if (endDate && endDate.getFullYear() !== yearTwo) {
    throw new ResponseError(
      400,
      `end_date must fall within ${yearTwo} to match academic year "${name}"`,
    );
  }
}

// "Previous"/"next" are derived from the name itself (e.g. "2027/2028"'s
// previous is "2026/2027") rather than from dates, since names are now
// strictly sequential. Only checks against a neighbor that actually exists
// and actually has the relevant date set - doesn't require a full run of
// consecutive years to be present.
async function assertNoOverlapWithAdjacentYears(
  name: string,
  startDate: Date | null | undefined,
  endDate: Date | null | undefined,
  excludeId?: string,
): Promise<void> {
  const match = name.match(/^(\d{4})\/(\d{4})$/);
  if (!match) return; // format already enforced by validation - defensive only

  const yearOne = Number(match[1]);
  const yearTwo = Number(match[2]);

  if (startDate) {
    const previous = await prismaClient.academicYear.findFirst({
      where: {
        name: `${yearOne - 1}/${yearOne}`,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (previous?.end_date && previous.end_date > startDate) {
      throw new ResponseError(
        400,
        `start_date overlaps with academic year "${previous.name}", which ends ${previous.end_date.toISOString().slice(0, 10)}`,
      );
    }
  }

  if (endDate) {
    const next = await prismaClient.academicYear.findFirst({
      where: {
        name: `${yearTwo}/${yearTwo + 1}`,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (next?.start_date && next.start_date < endDate) {
      throw new ResponseError(
        400,
        `end_date overlaps with academic year "${next.name}", which starts ${next.start_date.toISOString().slice(0, 10)}`,
      );
    }
  }
}

async function countActiveEnrollmentsInYear(
  academicYearId: string,
): Promise<number> {
  return prismaClient.studentClassEnrollment.count({
    where: {
      enrollment_status: EnrollmentStatus.ACTIVE,
      deleted_at: null,
      class: { academic_year_id: academicYearId },
    },
  });
}

// Mirrors countActiveEnrollmentsInYear above, same year-wide scope - leaving
// ACTIVE cascade-ends every open teacher assignment in the classes it
// deactivates (see update()'s cascade), so this needs the same warn-first
// treatment as students.
async function countActiveTeacherAssignmentsInYear(
  academicYearId: string,
): Promise<number> {
  return prismaClient.classTeacherAssignment.count({
    where: {
      end_date: null,
      deleted_at: null,
      class: { academic_year_id: academicYearId },
    },
  });
}

function isSingleActiveConstraintViolation(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }
  const meta = error.meta as Record<string, unknown> | undefined;
  const driverAdapterError = meta?.driverAdapterError as
    | { cause?: { constraint?: { fields?: string[] } } }
    | undefined;
  const fields = driverAdapterError?.cause?.constraint?.fields ?? [];
  return meta?.modelName === "AcademicYear" && fields.includes("status");
}

export class AcademicYearService {
  static async create(
    admin: AdminUser,
    request: CreateAcademicYearRequest,
    context: AuditRequestContext = {},
  ): Promise<AcademicYearResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can create an academic year",
      );
    }

    const createRequest = Validation.validate(
      AcademicYearValidation.CREATE,
      request,
    );

    const existing = await prismaClient.academicYear.findUnique({
      where: { name: createRequest.name },
    });
    if (existing) {
      throw new ResponseError(
        400,
        "An academic year with this name already exists",
      );
    }

    const createStartDate = new Date(createRequest.start_date);
    const createEndDate = createRequest.end_date
      ? new Date(createRequest.end_date)
      : null;

    assertDatesMatchName(createRequest.name, createStartDate, createEndDate);
    await assertNoOverlapWithAdjacentYears(
      createRequest.name,
      createStartDate,
      createEndDate,
    );

    if (createRequest.status === AcademicYearStatus.ACTIVE) {
      assertActiveYearIsReasonable(createRequest.name);

      const academicYearActive = await prismaClient.academicYear.findFirst({
        where: {
          status: AcademicYearStatus.ACTIVE,
        },
      });

      if (academicYearActive) {
        throw new ResponseError(400, SINGLE_ACTIVE_ACADEMIC_YEAR_MESSAGE);
      }
    }

    let year;
    try {
      year = await prismaClient.$transaction(async (tx) => {
        const newYear = await tx.academicYear.create({
          data: {
            name: createRequest.name,
            start_date: createStartDate,
            end_date: createRequest.end_date
              ? new Date(createRequest.end_date)
              : undefined,
            status: createRequest.status,
          },
        });

        await AuditService.record(
          {
            action: AuditAction.CREATE_ACADEMIC_YEAR,
            source: AuditSource.UI,
            entity_type: "AcademicYear",
            entity_id: newYear.id,
            admin_id: admin.id,
            new_values: toAcademicYearAuditSnapshot(newYear),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return newYear;
      });
    } catch (error) {
      if (isSingleActiveConstraintViolation(error)) {
        throw new ResponseError(400, SINGLE_ACTIVE_ACADEMIC_YEAR_MESSAGE);
      }
      throw error;
    }

    return toAcademicYearResponse(year);
  }

  static async update(
    admin: AdminUser,
    request: UpdateAcademicYearRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<AcademicYearResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can update an academic year",
      );
    }

    const updateRequest = Validation.validate(
      AcademicYearValidation.UPDATE,
      request,
    );

    const existing = await prismaClient.academicYear.findUnique({
      where: { id: updateRequest.id },
    });
    if (!existing) {
      throw new ResponseError(404, "Academic year not found");
    }

    if (updateRequest.name && updateRequest.name !== existing.name) {
      const duplicate = await prismaClient.academicYear.findUnique({
        where: { name: updateRequest.name },
      });
      if (duplicate) {
        throw new ResponseError(
          400,
          "An academic year with this name already exists",
        );
      }
    }

    // Resolved *after* this update's own date edits (not existing's stale
    // ones) - an admin correcting a wrong end_date in the same save that
    // marks a year Completed should be judged against the corrected date.
    const nextStart = updateRequest.start_date
      ? new Date(updateRequest.start_date)
      : existing.start_date;
    const nextEnd = updateRequest.end_date
      ? new Date(updateRequest.end_date)
      : existing.end_date;
    if (nextStart && nextEnd && nextStart >= nextEnd) {
      throw new ResponseError(400, "start_date must be before end_date");
    }
    const effectiveName = updateRequest.name ?? existing.name;

    // Hard block, no override - checked before the softer (overridable)
    // enrollment check below, mirroring enrollment-service.ts's Promote gate.
    if (
      existing.status === AcademicYearStatus.ACTIVE &&
      updateRequest.status === AcademicYearStatus.COMPLETED
    ) {
      assertCompletionNotTooEarly(
        { name: effectiveName, end_date: nextEnd },
        now,
      );
    }

    // Leaving ACTIVE cascade-deactivates this year's classes below - if
    // students still have an active enrollment, or teachers an active
    // assignment, in one of them, that's about to silently strand students
    // and end assignments with no warning. Block unless explicitly confirmed.
    if (
      existing.status === AcademicYearStatus.ACTIVE &&
      updateRequest.status !== undefined &&
      updateRequest.status !== AcademicYearStatus.ACTIVE &&
      !updateRequest.confirm_unresolved_enrollments
    ) {
      const [activeEnrollmentCount, activeTeacherAssignmentCount] =
        await Promise.all([
          countActiveEnrollmentsInYear(existing.id),
          countActiveTeacherAssignmentsInYear(existing.id),
        ]);
      if (activeEnrollmentCount > 0 || activeTeacherAssignmentCount > 0) {
        const parts: string[] = [];
        if (activeEnrollmentCount > 0) {
          parts.push(`${activeEnrollmentCount} student(s) still have an active enrollment`);
        }
        if (activeTeacherAssignmentCount > 0) {
          parts.push(`${activeTeacherAssignmentCount} teacher(s) still have an active assignment`);
        }
        throw new ResponseError(
          400,
          `${parts.join(" and ")} in this academic year's classes. Promote/transfer/close the students and end the teacher assignments first, or set confirm_unresolved_enrollments to proceed anyway (this will also end those teacher assignments).`,
        );
      }
    }

    if (updateRequest.status === AcademicYearStatus.ACTIVE) {
      assertActiveYearIsReasonable(effectiveName);

      // Checked after the name-tolerance sanity check above (coarser, so it
      // reports first) and only when actually leaving UPCOMING - re-saving
      // a year that's already ACTIVE isn't "activating" it.
      if (existing.status === AcademicYearStatus.UPCOMING) {
        assertActivationNotTooEarly(
          { name: effectiveName, start_date: nextStart },
          now,
        );
      }

      const academicYearActive = await prismaClient.academicYear.findFirst({
        where: {
          status: AcademicYearStatus.ACTIVE,
          id: { not: updateRequest.id },
        },
      });

      if (academicYearActive) {
        throw new ResponseError(400, SINGLE_ACTIVE_ACADEMIC_YEAR_MESSAGE);
      }
    }

    assertDatesMatchName(effectiveName, nextStart, nextEnd);
    await assertNoOverlapWithAdjacentYears(
      effectiveName,
      nextStart,
      nextEnd,
      updateRequest.id,
    );

    let year;
    try {
      year = await prismaClient.$transaction(async (tx) => {
        const updatedYear = await tx.academicYear.update({
          where: { id: updateRequest.id },
          data: {
            name: updateRequest.name,
            start_date: updateRequest.start_date
              ? new Date(updateRequest.start_date)
              : undefined,
            end_date: updateRequest.end_date
              ? new Date(updateRequest.end_date)
              : undefined,
            status: updateRequest.status,
          },
        });

        // A year that isn't ACTIVE has no business leaving live classes
        // behind - deactivate them in the same transaction. Checked on the
        // resulting status alone (not "did this request transition it out
        // of ACTIVE"), so any stray ACTIVE class gets cleaned up on the next
        // edit no matter how it got there (e.g. a year skipping straight
        // from UPCOMING to COMPLETED). A COMPLETED year also has no business
        // with UPCOMING classes (that status only makes sense while the
        // year is still ahead of or currently live) - those get swept up
        // too, but only on COMPLETED, since UPCOMING classes are still
        // perfectly valid while their own year is UPCOMING. The updateMany
        // is a no-op when nothing needs fixing, so this is safe to run
        // unconditionally.
        let deactivatedClassCount = 0;
        // Every teacher assignment still open (end_date null) in a class
        // this cascade is about to deactivate has no business staying open
        // either - the class it's teaching in is no longer live. Ended the
        // same way a manual "End" would (see ClassService.endTeacherAssignment),
        // including its own per-assignment audit record, so it shows up in
        // that assignment's own history instead of only as a rolled-up
        // count on the year's audit entry.
        let endedTeacherAssignmentCount = 0;
        if (updatedYear.status !== AcademicYearStatus.ACTIVE) {
          const staleStatuses =
            updatedYear.status === AcademicYearStatus.COMPLETED
              ? [ClassStatus.ACTIVE, ClassStatus.UPCOMING]
              : [ClassStatus.ACTIVE];
          const sweptClasses = await tx.class.findMany({
            where: {
              academic_year_id: updatedYear.id,
              status: { in: staleStatuses },
            },
            select: { id: true },
          });
          const sweptClassIds = sweptClasses.map((klass) => klass.id);

          if (sweptClassIds.length > 0) {
            const result = await tx.class.updateMany({
              where: { id: { in: sweptClassIds } },
              data: { status: ClassStatus.INACTIVE },
            });
            deactivatedClassCount = result.count;

            const openAssignments = await tx.classTeacherAssignment.findMany({
              where: {
                class_id: { in: sweptClassIds },
                end_date: null,
                deleted_at: null,
              },
              select: { id: true },
            });
            if (openAssignments.length > 0) {
              await tx.classTeacherAssignment.updateMany({
                where: { id: { in: openAssignments.map((a) => a.id) } },
                data: { end_date: now },
              });
              for (const assignment of openAssignments) {
                await AuditService.record(
                  {
                    action: AuditAction.END_CLASS_TEACHER_ASSIGNMENT,
                    source: AuditSource.UI,
                    entity_type: "ClassTeacherAssignment",
                    entity_id: assignment.id,
                    admin_id: admin.id,
                    old_values: { end_date: null },
                    new_values: { end_date: now.toISOString() },
                    ip_address: context.ip_address,
                    user_agent: context.user_agent,
                  },
                  tx,
                );
              }
              endedTeacherAssignmentCount = openAssignments.length;
            }
          }
        }

        // The other direction is never automatic - a class may be INACTIVE
        // for reasons unrelated to the year (e.g. merged/disbanded), so
        // activating the year must not silently reactivate it. Only bulk-
        // activate classes when explicitly requested via activate_classes.
        // Includes UPCOMING classes alongside INACTIVE ones - those are
        // exactly the ones prepared ahead of time for this year, and should
        // go live the same way a plain INACTIVE class would.
        let activatedClassCount = 0;
        if (
          updatedYear.status === AcademicYearStatus.ACTIVE &&
          updateRequest.activate_classes
        ) {
          const result = await tx.class.updateMany({
            where: {
              academic_year_id: updatedYear.id,
              status: { in: [ClassStatus.INACTIVE, ClassStatus.UPCOMING] },
            },
            data: { status: ClassStatus.ACTIVE },
          });
          activatedClassCount = result.count;
        }

        await AuditService.record(
          {
            action: AuditAction.UPDATE_ACADEMIC_YEAR,
            source: AuditSource.UI,
            entity_type: "AcademicYear",
            entity_id: updatedYear.id,
            admin_id: admin.id,
            old_values: toAcademicYearAuditSnapshot(existing),
            new_values: {
              ...toAcademicYearAuditSnapshot(updatedYear),
              ...(deactivatedClassCount > 0
                ? { cascaded_classes_deactivated: deactivatedClassCount }
                : {}),
              ...(activatedClassCount > 0
                ? { cascaded_classes_activated: activatedClassCount }
                : {}),
              ...(endedTeacherAssignmentCount > 0
                ? {
                    cascaded_teacher_assignments_ended:
                      endedTeacherAssignmentCount,
                  }
                : {}),
            },
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return updatedYear;
      });
    } catch (error) {
      if (isSingleActiveConstraintViolation(error)) {
        throw new ResponseError(400, SINGLE_ACTIVE_ACADEMIC_YEAR_MESSAGE);
      }
      throw error;
    }

    return toAcademicYearResponse(year);
  }
  static async remove(
    admin: AdminUser,
    request: DeleteAcademicYearRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete an academic year",
      );
    }

    const deleteRequest = Validation.validate(
      AcademicYearValidation.DELETE,
      request,
    );

    const existing = await prismaClient.academicYear.findUnique({
      where: { id: deleteRequest.id },
    });
    if (!existing) {
      throw new ResponseError(404, "Academic year not found");
    }

    const [classCount, enrollmentCount, studentJoinCount] = await Promise.all([
      prismaClient.class.count({
        where: { academic_year_id: deleteRequest.id },
      }),
      prismaClient.studentClassEnrollment.count({
        where: { academic_year_id: deleteRequest.id },
      }),
      prismaClient.student.count({
        where: { join_academic_year_id: deleteRequest.id },
      }),
    ]);

    const usages: string[] = [];
    if (classCount > 0) usages.push(`${classCount} class(es)`);
    if (enrollmentCount > 0) usages.push(`${enrollmentCount} enrollment(s)`);
    if (studentJoinCount > 0) {
      usages.push(`${studentJoinCount} student(s) who joined in this year`);
    }

    if (usages.length > 0) {
      throw new ResponseError(
        400,
        `Cannot delete: this academic year is still referenced by ${usages.join(", ")}. Reassign or remove those first.`,
      );
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.academicYear.delete({
        where: { id: deleteRequest.id },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_ACADEMIC_YEAR,
          source: AuditSource.UI,
          entity_type: "AcademicYear",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: toAcademicYearAuditSnapshot(existing),
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
    request: GetAcademicYearRequest,
  ): Promise<AcademicYearResponse> {
    void admin;

    const year = await prismaClient.academicYear.findUnique({
      where: { id: request.id },
    });
    if (!year) {
      throw new ResponseError(404, "Academic year not found");
    }

    return toAcademicYearResponse(year);
  }

  // Lets the UI show a real count before an ACTIVE -> COMPLETED/UPCOMING
  // move (see update()'s own guard, which this mirrors) - a confirmation
  // dialog with "12 students" is a lot more actionable than a plain
  // yes/no prompt.
  static async getUnresolvedEnrollmentCount(
    admin: AdminUser,
    request: GetUnresolvedEnrollmentCountRequest,
  ): Promise<UnresolvedEnrollmentCountResponse> {
    void admin;

    const year = await prismaClient.academicYear.findUnique({
      where: { id: request.id },
    });
    if (!year) {
      throw new ResponseError(404, "Academic year not found");
    }

    const [groupedEnrollments, groupedTeacherAssignments] = await Promise.all(
      [
        prismaClient.studentClassEnrollment.groupBy({
          by: ["class_id"],
          where: {
            enrollment_status: EnrollmentStatus.ACTIVE,
            deleted_at: null,
            class: { academic_year_id: year.id },
          },
          _count: { _all: true },
        }),
        prismaClient.classTeacherAssignment.groupBy({
          by: ["class_id"],
          where: {
            end_date: null,
            deleted_at: null,
            class: { academic_year_id: year.id },
          },
          _count: { _all: true },
        }),
      ],
    );

    const studentCountByClassId = new Map(
      groupedEnrollments.map((row) => [row.class_id, row._count._all]),
    );
    const teacherCountByClassId = new Map(
      groupedTeacherAssignments.map((row) => [row.class_id, row._count._all]),
    );
    const classIds = [
      ...new Set([
        ...studentCountByClassId.keys(),
        ...teacherCountByClassId.keys(),
      ]),
    ];

    const classes = await prismaClient.class.findMany({
      where: { id: { in: classIds } },
      include: { grade: true },
    });
    const classById = new Map(classes.map((klass) => [klass.id, klass]));

    const classEntries = classIds
      .map((classId) => {
        const klass = classById.get(classId);
        return {
          class_id: classId,
          class_name: klass?.name ?? "Unknown class",
          grade_name: klass?.grade.name ?? "Unknown grade",
          active_student_count: studentCountByClassId.get(classId) ?? 0,
          active_teacher_assignment_count:
            teacherCountByClassId.get(classId) ?? 0,
        };
      })
      .sort((a, b) => a.class_name.localeCompare(b.class_name));

    return {
      active_enrollment_count: classEntries.reduce(
        (sum, entry) => sum + entry.active_student_count,
        0,
      ),
      active_teacher_assignment_count: classEntries.reduce(
        (sum, entry) => sum + entry.active_teacher_assignment_count,
        0,
      ),
      class_count: classEntries.length,
      classes: classEntries,
    };
  }

  static async search(
    admin: AdminUser,
    request: SearchAcademicYearRequest,
  ): Promise<Pageable<AcademicYearResponse>> {
    void admin;

    const searchRequest = Validation.validate(
      AcademicYearValidation.SEARCH,
      request,
    );

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const where = {
      name: searchRequest.search
        ? { contains: searchRequest.search, mode: "insensitive" as const }
        : undefined,
      status: searchRequest.status,
    };

    return paginate(searchRequest.page, searchRequest.size, {
      count: () => prismaClient.academicYear.count({ where }),
      findMany: () =>
        prismaClient.academicYear
          .findMany({
            where,
            take: searchRequest.size,
            skip,
            orderBy: buildAcademicYearOrderBy(
              searchRequest.sort_by || "start_date",
              searchRequest.sort_order || "desc",
            ),
          })
          .then((years) => years.map(toAcademicYearResponse)),
    });
  }
}

function buildAcademicYearOrderBy(
  sortBy: AcademicYearSortField,
  sortOrder: "asc" | "desc",
) {
  return { [sortBy]: sortOrder };
}
