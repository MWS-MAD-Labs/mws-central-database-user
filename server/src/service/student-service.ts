import { ResponseError } from "../error/response-error";
import {
  AcademicYearStatus,
  AdminRole,
  AuditAction,
  AuditSource,
  EnrollmentStatus,
  PersonType,
  Prisma,
  StudentStatus,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import { paginate, type Pageable } from "../model/page-model";
import {
  toBulkActionResponse,
  type BulkActionItemResponse,
  type BulkIdsRequest,
} from "../model/bulk-action-model";
import {
  buildStudentOrderBy,
  toStudentAuditSnapshot,
  toStudentDetailResponse,
  toStudentResponse,
  type BulkStudentResponse,
  type CreateStudentRequest,
  type GetStudentRequest,
  type ReissueStudentNisRequest,
  type RemoveStudentRequest,
  type RestoreStudentRequest,
  type SearchStudentRequest,
  type StudentCreateOptions,
  type StudentDetailResponse,
  type StudentResponse,
  type UpdateStudentRequest,
} from "../model/student-model";
import { toEnrollmentAuditSnapshot } from "../model/enrollment-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { assertIdentifierFieldsEditable } from "../utils/identifier-lock";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import { computeNisPrefix, generateNis } from "../utils/nis-generator";
import { canViewSensitiveData } from "../utils/sensitive-data";
import { NIS_REGEX, StudentValidation } from "../validation/student-validation";
import { Validation, normalizeIndonesianPhone } from "../validation/validation";
import { logger } from "../lib/logger";

function bulkFailureMessage(error: unknown): string {
  if (error instanceof ResponseError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

function rethrowAsFriendlyStudentConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("email")) {
    throw new ResponseError(400, "Email already registered");
  }
  if (fields?.includes("nis")) {
    throw new ResponseError(400, "NIS already registered");
  }
  if (fields?.includes("nisn")) {
    throw new ResponseError(400, "NISN already registered");
  }
  throw error;
}

function rethrowAsFriendlyStudentUpdateConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("email")) {
    throw new ResponseError(400, "Email already registered to another person");
  }
  if (fields?.includes("nis")) {
    throw new ResponseError(400, "NIS already registered");
  }
  if (fields?.includes("nisn")) {
    throw new ResponseError(400, "NISN already registered");
  }
  throw error;
}

async function recordUnauthorizedStudentAction(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
  studentId?: string,
): Promise<void> {
  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    new_values: {
      reason: `blocked student ${action}`,
      ...(studentId ? { student_id: studentId } : {}),
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

export const TERMINAL_STUDENT_STATUS_TO_ENROLLMENT_STATUS: Partial<
  Record<StudentStatus, EnrollmentStatus>
> = {
  [StudentStatus.GRADUATED]: EnrollmentStatus.COMPLETED,
  [StudentStatus.TRANSFERRED]: EnrollmentStatus.TRANSFERRED,
  [StudentStatus.WITHDRAWN]: EnrollmentStatus.WITHDRAWN,
};

async function assertStudentCanBecomeActive(studentId: string): Promise<void> {
  const activeEnrollment = await prismaClient.studentClassEnrollment.findFirst({
    where: {
      student_id: studentId,
      enrollment_status: EnrollmentStatus.ACTIVE,
      deleted_at: null,
    },
  });

  if (!activeEnrollment) {
    throw new ResponseError(
      400,
      "An active student must have an active class enrollment",
    );
  }
}

// Shared with ExportService so search/export filters can't drift apart.
export function buildStudentSearchWhere(
  admin: Pick<AdminUser, "role" | "unit_id" | "can_view_all_units">,
  searchRequest: Omit<SearchStudentRequest, "page" | "size">,
): Prisma.PersonWhereInput {
  const andFilters: Prisma.PersonWhereInput[] = [];

  if (searchRequest.search) {
    const normalizedPhoneSearch = /\d/.test(searchRequest.search)
      ? normalizeIndonesianPhone(searchRequest.search)
      : null;
    const phoneSearchValues = [
      searchRequest.search,
      ...(normalizedPhoneSearch &&
      normalizedPhoneSearch !== searchRequest.search
        ? [normalizedPhoneSearch]
        : []),
    ];

    andFilters.push({
      OR: [
        {
          full_name: { contains: searchRequest.search, mode: "insensitive" },
        },
        {
          nick_name: { contains: searchRequest.search, mode: "insensitive" },
        },
        { email: { contains: searchRequest.search, mode: "insensitive" } },
        {
          student: {
            OR: [
              {
                nis: { contains: searchRequest.search, mode: "insensitive" },
              },
              {
                nisn: { contains: searchRequest.search, mode: "insensitive" },
              },
              {
                parents: {
                  some: {
                    deleted_at: null,
                    OR: [
                      {
                        full_name: {
                          contains: searchRequest.search,
                          mode: "insensitive",
                        },
                      },
                      ...phoneSearchValues.map((value) => ({
                        phone: {
                          contains: value,
                          mode: "insensitive" as const,
                        },
                      })),
                      {
                        email: {
                          contains: searchRequest.search,
                          mode: "insensitive",
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      ],
    });
  }

  if (searchRequest.gender) {
    andFilters.push({ gender: searchRequest.gender });
  }
  if (searchRequest.religion) {
    andFilters.push({ religion: searchRequest.religion });
  }

  const studentFilters: Prisma.StudentWhereInput = {};

  if (searchRequest.status) studentFilters.status = searchRequest.status;
  if (searchRequest.current_grade_id)
    studentFilters.current_grade_id = searchRequest.current_grade_id;
  if (searchRequest.current_class_id)
    studentFilters.current_class_id = searchRequest.current_class_id;
  if (searchRequest.join_academic_year_id)
    studentFilters.join_academic_year_id = searchRequest.join_academic_year_id;
  if (searchRequest.leave_year)
    studentFilters.leave_year = searchRequest.leave_year;
  if (searchRequest.pickup_drop_service !== undefined)
    studentFilters.pickup_drop_service = searchRequest.pickup_drop_service;
  if (searchRequest.catering_service !== undefined)
    studentFilters.catering_service = searchRequest.catering_service;
  if (searchRequest.psb_guide !== undefined)
    studentFilters.psb_guide = searchRequest.psb_guide;
  if (searchRequest.consent_status)
    studentFilters.consents = {
      some: { deleted_at: null, status: searchRequest.consent_status },
    };
  if (searchRequest.pc_activity_day)
    studentFilters.pc = {
      some: { deleted_at: null, day: searchRequest.pc_activity_day },
    };

  studentFilters.deleted_at = searchRequest.is_deleted ? { not: null } : null;

  // Only Kindergarten/Elementary/Junior High admins have a unit whose
  // grades ever carry a matching unit_id - any other DB Admin unit (e.g.
  // Directorate, MAD Lab) naturally gets zero students back, no separate
  // branch needed. SUPER_ADMIN stays fully unscoped, same as everywhere else.
  // can_view_all_units grants the same unscoped reach without a role change.
  if (admin.role !== AdminRole.SUPER_ADMIN && !admin.can_view_all_units) {
    studentFilters.current_grade = { unit_id: admin.unit_id };
  }

  if (Object.keys(studentFilters).length > 0) {
    andFilters.push({ student: studentFilters });
  }

  return {
    person_type: PersonType.STUDENT,
    AND: andFilters,
  };
}

export class StudentService {
  static async create(
    admin: AdminUser,
    request: CreateStudentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
    options: StudentCreateOptions = {},
  ): Promise<StudentResponse> {
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedStudentAction(admin, "create", context);
      throw new ResponseError(403, "Forbidden: Viewer cannot create data");
    }

    if (admin.role === AdminRole.DATABASE_ADMIN) {
      if (!admin.can_write_data) {
        await recordUnauthorizedStudentAction(admin, "create", context);
        throw new ResponseError(
          403,
          "Forbidden: You don't have permission to create data",
        );
      }

      await assertCanWriteNow(admin, context, now);
    }

    const createRequest = Validation.validate(
      StudentValidation.CREATE,
      request,
    );

    const initialStatus = createRequest.status ?? StudentStatus.REGISTERED;
    if (initialStatus === StudentStatus.ACTIVE) {
      throw new ResponseError(
        400,
        "New students must start as REGISTERED and become ACTIVE after class enrollment",
      );
    }

    const shouldAutoGenerateNis =
      !createRequest.nis &&
      !createRequest.legacy_nis &&
      !options.disableAutoGenerateNis;

    const needsPrefixCalculation =
      shouldAutoGenerateNis || (createRequest.legacy_nis && !createRequest.nis);

    const [currentGrade, joinGrade] = await Promise.all([
      prismaClient.grade.findUnique({
        where: { id: createRequest.current_grade_id },
      }),
      prismaClient.grade.findUnique({
        where: { id: createRequest.join_grade_id },
      }),
    ]);

    if (!currentGrade)
      throw new ResponseError(400, "Invalid current grade: grade not found");
    if (!joinGrade)
      throw new ResponseError(400, "Invalid join grade: grade not found");

    if (
      admin.role === AdminRole.DATABASE_ADMIN &&
      currentGrade.unit_id !== admin.unit_id
    ) {
      await recordUnauthorizedStudentAction(admin, "create", context);
      throw new ResponseError(
        403,
        "Forbidden: You can only create students within your unit scope",
      );
    }

    if (currentGrade.level < joinGrade.level) {
      throw new ResponseError(
        400,
        "Current grade cannot be lower than the grade the student joined at",
      );
    }

    let joinAcademicYear: { name: string; start_date: Date | null } | null =
      null;
    if (needsPrefixCalculation) {
      joinAcademicYear = await prismaClient.academicYear.findUnique({
        where: { id: createRequest.join_academic_year_id },
        select: { name: true, start_date: true },
      });
      if (!joinAcademicYear) {
        throw new ResponseError(
          400,
          "Invalid join academic year: academic year not found",
        );
      }
    }

    if (createRequest.legacy_nis && !createRequest.nis && joinAcademicYear) {
      try {
        const expectedPrefix = computeNisPrefix({
          academicYear: joinAcademicYear,
          gradeLevel: joinGrade.level,
          entryType: createRequest.entry_type,
        });

        const expectedPattern = new RegExp(`^${expectedPrefix}\\d{3}$`);
        const rawLegacyNis = createRequest.legacy_nis.trim();

        if (expectedPattern.test(rawLegacyNis)) {
          createRequest.nis = rawLegacyNis;
          createRequest.legacy_nis = undefined;
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        logger.debug(
          `Semantic promotion skipped for legacy_nis '${createRequest.legacy_nis}': ${errorMessage}`,
        );
      }
    }

    const existingUser = await prismaClient.person.findFirst({
      where: {
        OR: [
          { email: createRequest.email },
          ...(createRequest.nis
            ? [{ student: { nis: createRequest.nis } }]
            : []),
          ...(createRequest.nisn
            ? [{ student: { nisn: createRequest.nisn } }]
            : []),
        ],
      },
      include: { student: true },
    });

    if (existingUser) {
      if (existingUser.email === createRequest.email) {
        throw new ResponseError(400, "Email already registered");
      }
      if (
        createRequest.nis &&
        existingUser.student?.nis === createRequest.nis
      ) {
        throw new ResponseError(400, "NIS already registered");
      }
      if (
        createRequest.nisn &&
        existingUser.student?.nisn === createRequest.nisn
      ) {
        throw new ResponseError(
          400,
          `NISN is already registered to another student: ${existingUser.full_name} (${existingUser.student.nis})`,
        );
      }
    }

    const MAX_NIS_GENERATION_ATTEMPTS = 5;
    let createdPersonId: string | undefined;

    for (let attempt = 1; attempt <= MAX_NIS_GENERATION_ATTEMPTS; attempt++) {
      const nis =
        createRequest.nis ??
        (shouldAutoGenerateNis
          ? await generateNis({
              academicYear: joinAcademicYear!,
              gradeLevel: joinGrade.level,
              entryType: createRequest.entry_type,
            })
          : undefined);

      try {
        createdPersonId = await prismaClient.$transaction(async (tx) => {
          const newPerson = await tx.person.create({
            data: {
              full_name: createRequest.full_name,
              nick_name: createRequest.nick_name,
              email: createRequest.email,
              person_type: PersonType.STUDENT,
              gender: createRequest.gender,
              religion: createRequest.religion,
              birth_place: createRequest.birth_place,
              birth_date: new Date(createRequest.birth_date),
              photo_url: createRequest.photo_url,
              student: {
                create: {
                  nis,
                  legacy_nis: createRequest.legacy_nis,
                  nisn: createRequest.nisn,
                  status: initialStatus,
                  current_grade_id: createRequest.current_grade_id,
                  join_academic_year_id: createRequest.join_academic_year_id,
                  join_grade_id: createRequest.join_grade_id,
                  previous_school: createRequest.previous_school,
                  pickup_drop_service: createRequest.pickup_drop_service,
                  catering_service: createRequest.catering_service,
                  psb_guide: createRequest.psb_guide,
                  entry_type: createRequest.entry_type,
                },
              },
            },
          });

          const personForAudit = await tx.person.findUnique({
            where: { id: newPerson.id },
            include: { student: true },
          });
          if (!personForAudit?.student) {
            throw new ResponseError(500, "Failed to prepare student audit log");
          }

          await AuditService.record(
            {
              action: AuditAction.CREATE_STUDENT,
              source: AuditSource.UI,
              entity_type: "Student",
              entity_id: personForAudit.student.id,
              admin_id: admin.id,
              new_values: toStudentAuditSnapshot(
                personForAudit,
                personForAudit.student,
              ),
              ip_address: context.ip_address,
              user_agent: context.user_agent,
            },
            tx,
          );

          return newPerson.id;
        });
        break;
      } catch (error) {
        const conflictFields = getUniqueConstraintFields(error);
        const shouldRetry =
          shouldAutoGenerateNis &&
          conflictFields?.includes("nis") &&
          attempt < MAX_NIS_GENERATION_ATTEMPTS;
        if (!shouldRetry) {
          rethrowAsFriendlyStudentConflict(error);
        }
      }
    }

    const newPerson = await prismaClient.person.findUnique({
      where: { id: createdPersonId },
      include: {
        student: { include: { current_grade: true, join_grade: true } },
      },
    });

    if (!newPerson || !newPerson.student) {
      throw new ResponseError(
        500,
        "Internal Server Error: Failed to retrieve created student data",
      );
    }

    return toStudentResponse(newPerson);
  }

  static async reissueNis(
    admin: AdminUser,
    request: ReissueStudentNisRequest,
    context: AuditRequestContext = {},
  ): Promise<StudentResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedStudentAction(
        admin,
        "reissue NIS",
        context,
        request.id,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can reissue a student's NIS",
      );
    }

    const reissueRequest = Validation.validate(
      StudentValidation.REISSUE_NIS,
      request,
    );

    const existing = await prismaClient.student.findUnique({
      where: { id: reissueRequest.id },
      include: { current_grade: true, join_academic_year: true },
    });
    if (!existing) {
      throw new ResponseError(404, "Student not found");
    }
    if (existing.nis !== null) {
      throw new ResponseError(
        400,
        "This student already has a NIS - reissue is only for students without one.",
      );
    }

    const nis = await generateNis({
      academicYear: existing.join_academic_year,
      gradeLevel: existing.current_grade.level,
      entryType: reissueRequest.entry_type,
    });

    await prismaClient.$transaction(async (tx) => {
      await tx.student.update({
        where: { id: reissueRequest.id },
        data: { nis, entry_type: reissueRequest.entry_type },
      });

      await AuditService.record(
        {
          action: AuditAction.REISSUE_STUDENT_NIS,
          source: AuditSource.UI,
          entity_type: "Student",
          entity_id: reissueRequest.id,
          admin_id: admin.id,
          old_values: {
            nis: null,
            legacy_nis: existing.legacy_nis,
            entry_type: existing.entry_type,
          },
          new_values: { nis, entry_type: reissueRequest.entry_type },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const updatedPerson = await prismaClient.person.findFirst({
      where: { student: { id: reissueRequest.id } },
      include: {
        student: { include: { current_grade: true, join_grade: true } },
      },
    });
    if (!updatedPerson) {
      throw new ResponseError(
        500,
        "Internal Server Error: Failed to retrieve reissued student data",
      );
    }

    return toStudentResponse(updatedPerson);
  }

  static async update(
    admin: AdminUser,
    request: UpdateStudentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<StudentResponse> {
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedStudentAction(
        admin,
        "update",
        context,
        request.id,
      );
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }

    const updateRequest = Validation.validate(
      StudentValidation.UPDATE,
      request,
    );

    const existing = await prismaClient.person.findFirst({
      where: {
        student: { id: updateRequest.id, deleted_at: null },
      },
      include: {
        student: { include: { current_grade: true, join_grade: true } },
      },
    });

    if (!existing || !existing.student) {
      throw new ResponseError(404, "Student not found");
    }

    if (admin.role === AdminRole.DATABASE_ADMIN) {
      if (!admin.can_write_data) {
        await recordUnauthorizedStudentAction(
          admin,
          "update",
          context,
          request.id,
        );
        throw new ResponseError(
          403,
          "Forbidden: You don't have permission to update data",
        );
      }

      await assertCanWriteNow(admin, context, now);

      if (existing.student.current_grade.unit_id !== admin.unit_id) {
        await recordUnauthorizedStudentAction(
          admin,
          "update",
          context,
          request.id,
        );
        throw new ResponseError(
          403,
          "Forbidden: This student is outside your unit scope",
        );
      }
    }

    const oldSnapshot = toStudentAuditSnapshot(existing, existing.student);

    const effectiveStatus = updateRequest.status ?? existing.student.status;
    if (updateRequest.status === StudentStatus.ACTIVE) {
      await assertStudentCanBecomeActive(existing.student.id);
    }
    if (
      effectiveStatus === StudentStatus.GRADUATED &&
      (!(updateRequest.leave_year ?? existing.student.leave_year) ||
        !(updateRequest.graduation_grade ?? existing.student.graduation_grade))
    ) {
      throw new ResponseError(
        400,
        "Graduated students require leave_year and graduation_grade",
      );
    }
    // Moving off GRADUATED (e.g. re-registering a student who graduated by
    // mistake) should drop these too - otherwise they linger as stale
    // leftovers on a student who's no longer graduated.
    const clearGraduationFields = effectiveStatus !== StudentStatus.GRADUATED;

    const emailChanged =
      updateRequest.email && updateRequest.email !== existing.email;
    const nisnChanged =
      updateRequest.nisn && updateRequest.nisn !== existing.student.nisn;
    const nisnOverwritten = nisnChanged && existing.student.nisn !== null;
    await assertIdentifierFieldsEditable(
      admin,
      existing.student.created_at,
      Boolean(nisnOverwritten),
      "NISN",
      context,
      now,
    );

    const entryTypeChanged =
      updateRequest.entry_type !== undefined &&
      updateRequest.entry_type !== existing.student.entry_type;
    if (entryTypeChanged && existing.student.nis !== null) {
      throw new ResponseError(
        400,
        "Entry type cannot be changed after a NIS has already been assigned",
      );
    }

    if (emailChanged || nisnChanged) {
      const conditions: Array<{
        email?: string;
        student?: { nisn?: string };
      }> = [];

      if (emailChanged) {
        conditions.push({ email: updateRequest.email });
      }
      if (nisnChanged) {
        conditions.push({ student: { nisn: updateRequest.nisn } });
      }

      const duplicateCheck = await prismaClient.person.findFirst({
        where: {
          OR: conditions,
          NOT: { id: existing.id },
        },
        include: { student: true },
      });

      if (duplicateCheck) {
        if (emailChanged && duplicateCheck.email === updateRequest.email) {
          throw new ResponseError(
            400,
            "Email already registered to another person",
          );
        }
        if (
          duplicateCheck.student &&
          nisnChanged &&
          duplicateCheck.student.nisn === updateRequest.nisn
        ) {
          throw new ResponseError(
            400,
            `NISN is already registered to another student: ${duplicateCheck.full_name} (${duplicateCheck.student.nis})`,
          );
        }
      }
    }

    const effectiveCurrentGradeId =
      updateRequest.current_grade_id ?? existing.student.current_grade_id;
    const effectiveJoinGradeId =
      updateRequest.join_grade_id ?? existing.student.join_grade_id;

    if (
      updateRequest.current_grade_id !== undefined ||
      updateRequest.join_grade_id !== undefined
    ) {
      const [currentGrade, joinGrade] = await Promise.all([
        prismaClient.grade.findUnique({
          where: { id: effectiveCurrentGradeId },
        }),
        prismaClient.grade.findUnique({ where: { id: effectiveJoinGradeId } }),
      ]);

      if (!currentGrade) {
        throw new ResponseError(400, "Invalid current grade: grade not found");
      }
      if (!joinGrade) {
        throw new ResponseError(400, "Invalid join grade: grade not found");
      }
      if (currentGrade.level < joinGrade.level) {
        throw new ResponseError(
          400,
          "Current grade cannot be lower than the grade the student joined at",
        );
      }

      const gradeIsChanging =
        updateRequest.current_grade_id !== undefined &&
        updateRequest.current_grade_id !== existing.student.current_grade_id;

      if (gradeIsChanging) {
        const activeEnrollment =
          await prismaClient.studentClassEnrollment.findFirst({
            where: {
              student_id: existing.student.id,
              enrollment_status: EnrollmentStatus.ACTIVE,
              deleted_at: null,
            },
            include: { class: true },
          });

        if (
          activeEnrollment &&
          activeEnrollment.class.grade_id !== updateRequest.current_grade_id
        ) {
          throw new ResponseError(
            400,
            `Cannot change current grade to '${currentGrade.name}'. Student currently has an active enrollment in '${activeEnrollment.class.name}'. Please update or withdraw the enrollment first.`,
          );
        }
      }
    }

    const closingEnrollmentStatus = updateRequest.status
      ? TERMINAL_STUDENT_STATUS_TO_ENROLLMENT_STATUS[updateRequest.status]
      : undefined;

    try {
      await prismaClient.$transaction(async (tx) => {
        const enrollmentsToClose = closingEnrollmentStatus
          ? await tx.studentClassEnrollment.findMany({
              where: {
                student_id: existing.student!.id,
                enrollment_status: EnrollmentStatus.ACTIVE,
                deleted_at: null,
              },
            })
          : [];

        await tx.person.update({
          where: { id: existing.id },
          data: {
            full_name: updateRequest.full_name,
            nick_name: updateRequest.nick_name,
            email: updateRequest.email,
            gender: updateRequest.gender,
            religion: updateRequest.religion,
            birth_place: updateRequest.birth_place,
            birth_date: updateRequest.birth_date
              ? new Date(updateRequest.birth_date)
              : undefined,
            photo_url: updateRequest.photo_url,

            student: {
              update: {
                nisn: updateRequest.nisn,
                status: updateRequest.status,
                current_grade_id: updateRequest.current_grade_id,
                join_academic_year_id: updateRequest.join_academic_year_id,
                join_grade_id: updateRequest.join_grade_id,
                previous_school: updateRequest.previous_school,
                graduation_grade: clearGraduationFields
                  ? null
                  : updateRequest.graduation_grade,
                leave_year: clearGraduationFields
                  ? null
                  : updateRequest.leave_year,
                sn: updateRequest.sn,
                entry_type: updateRequest.entry_type,
                pickup_drop_service: updateRequest.pickup_drop_service,
                catering_service: updateRequest.catering_service,
                psb_guide: updateRequest.psb_guide,
                ...(enrollmentsToClose.length > 0
                  ? { current_class_id: null }
                  : {}),
              },
            },
          },
        });

        if (enrollmentsToClose.length > 0 && closingEnrollmentStatus) {
          await tx.studentClassEnrollment.updateMany({
            where: { id: { in: enrollmentsToClose.map((e) => e.id) } },
            data: { enrollment_status: closingEnrollmentStatus, end_date: now },
          });

          for (const enrollment of enrollmentsToClose) {
            await AuditService.record(
              {
                action: AuditAction.WITHDRAW_STUDENT_ENROLLMENT,
                source: AuditSource.UI,
                entity_type: "StudentClassEnrollment",
                entity_id: enrollment.id,
                admin_id: admin.id,
                old_values: toEnrollmentAuditSnapshot(enrollment),
                new_values: toEnrollmentAuditSnapshot({
                  ...enrollment,
                  enrollment_status: closingEnrollmentStatus,
                  end_date: now,
                }),
                ip_address: context.ip_address,
                user_agent: context.user_agent,
              },
              tx,
            );
          }
        }

        // Leaving GRADUATED (e.g. correcting a mistaken graduation) should
        // free up the current academic year for a fresh enrollment - the
        // COMPLETED row from the graduation is still occupying the
        // (student, academic_year) unique slot, which would otherwise block
        // a plain create(). Soft-delete rather than hard-delete so it's
        // still recoverable via the enrollment trash bin. Scoped to the
        // currently ACTIVE academic year only - older completed history
        // from ordinary promotions elsewhere is left untouched.
        if (
          existing.student!.status === StudentStatus.GRADUATED &&
          effectiveStatus !== StudentStatus.GRADUATED
        ) {
          const activeYear = await tx.academicYear.findFirst({
            where: { status: AcademicYearStatus.ACTIVE },
          });
          const orphanedEnrollment = activeYear
            ? await tx.studentClassEnrollment.findFirst({
                where: {
                  student_id: existing.student!.id,
                  academic_year_id: activeYear.id,
                  enrollment_status: EnrollmentStatus.COMPLETED,
                  deleted_at: null,
                },
              })
            : null;
          if (orphanedEnrollment) {
            await tx.studentClassEnrollment.update({
              where: { id: orphanedEnrollment.id },
              data: { deleted_at: now },
            });
            await AuditService.record(
              {
                action: AuditAction.DELETE_ENROLLMENT,
                source: AuditSource.UI,
                entity_type: "StudentClassEnrollment",
                entity_id: orphanedEnrollment.id,
                admin_id: admin.id,
                old_values: toEnrollmentAuditSnapshot(orphanedEnrollment),
                new_values: toEnrollmentAuditSnapshot({
                  ...orphanedEnrollment,
                  deleted_at: now,
                }),
                ip_address: context.ip_address,
                user_agent: context.user_agent,
              },
              tx,
            );
          }
        }

        // flat include only - a nested include here races on the tx's single
        // pg connection, and the audit snapshot only needs raw student fields
        const personForAudit = await tx.person.findUnique({
          where: { id: existing.id },
          include: { student: true },
        });
        if (!personForAudit?.student) {
          throw new ResponseError(500, "Failed to prepare student audit log");
        }

        await AuditService.record(
          {
            action: AuditAction.UPDATE_STUDENT,
            source: AuditSource.UI,
            entity_type: "Student",
            entity_id: personForAudit.student.id,
            admin_id: admin.id,
            old_values: oldSnapshot,
            new_values: toStudentAuditSnapshot(
              personForAudit,
              personForAudit.student,
            ),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );
      });
    } catch (error) {
      rethrowAsFriendlyStudentUpdateConflict(error);
    }

    const updatedPerson = await prismaClient.person.findUnique({
      where: { id: existing.id },
      include: {
        student: { include: { current_grade: true, join_grade: true } },
      },
    });

    if (!updatedPerson || !updatedPerson.student) {
      throw new ResponseError(
        500,
        "Internal Server Error: Failed to retrieve updated student data",
      );
    }

    return toStudentResponse(updatedPerson);
  }

  static async get(
    admin: AdminUser,
    request: GetStudentRequest,
  ): Promise<StudentResponse | StudentDetailResponse> {
    const person = await prismaClient.person.findFirst({
      where: {
        student: { id: request.id, deleted_at: null },
      },
      include: {
        student: {
          include: {
            current_grade: true,
            join_grade: true,
            current_class: true,
          },
        },
      },
    });

    if (!person || !person.student) {
      throw new ResponseError(404, "Student not found");
    }

    if (
      admin.role !== AdminRole.SUPER_ADMIN &&
      !admin.can_view_all_units &&
      person.student.current_grade.unit_id !== admin.unit_id
    ) {
      throw new ResponseError(404, "Student not found");
    }

    if (canViewSensitiveData(admin)) {
      return toStudentDetailResponse(person);
    }

    return toStudentResponse(person);
  }

  static async search(
    admin: AdminUser,
    request: SearchStudentRequest,
  ): Promise<Pageable<StudentResponse>> {
    const searchRequest = Validation.validate(
      StudentValidation.SEARCH,
      request,
    );

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const whereClause = buildStudentSearchWhere(admin, searchRequest);

    return paginate(searchRequest.page, searchRequest.size, {
      count: () => prismaClient.person.count({ where: whereClause }),
      findMany: () =>
        prismaClient.person
          .findMany({
            where: whereClause,
            take: searchRequest.size,
            skip: skip,
            orderBy: buildStudentOrderBy(
              searchRequest.sort_by || "created_at",
              searchRequest.sort_order || "desc",
            ),
            include: {
              student: {
                include: {
                  current_grade: true,
                  join_grade: true,
                },
              },
            },
          })
          .then((persons) => {
            const data: StudentResponse[] = [];
            for (const person of persons) {
              if (person.student) {
                data.push(toStudentResponse(person));
              }
            }
            return data;
          }),
    });
  }

  // Deliberately unscoped by unit/role - dashboard summary card only, no
  // student detail is exposed, just a headcount.
  static async countTotal(): Promise<number> {
    return prismaClient.person.count({
      where: { person_type: PersonType.STUDENT, student: { deleted_at: null } },
    });
  }

  static async remove(
    admin: AdminUser,
    request: RemoveStudentRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedStudentAction(
        admin,
        "delete",
        context,
        request.id,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete student data",
      );
    }

    const target = await prismaClient.student.findUnique({
      where: { id: request.id },
      select: { id: true, deleted_at: true, status: true, nisn: true },
    });

    if (!target) {
      throw new ResponseError(404, "Student not found");
    }

    if (target.deleted_at !== null) {
      throw new ResponseError(400, "Student is already deleted");
    }

    const deletedAt = new Date();
    await prismaClient.$transaction(async (tx) => {
      await tx.student.update({
        where: { id: request.id },
        data: {
          deleted_at: deletedAt,
          status: StudentStatus.ARCHIVED,
          pre_delete_status: target.status,
          // Frees the NISN for someone else if this was a mistaken entry -
          // the pre-archive value lives on in old_values below.
          nisn: null,
        },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_STUDENT,
          source: AuditSource.UI,
          entity_type: "Student",
          entity_id: target.id,
          admin_id: admin.id,
          old_values: { status: target.status, nisn: target.nisn },
          new_values: {
            status: StudentStatus.ARCHIVED,
            deleted_at: deletedAt.toISOString(),
            nisn: null,
          },
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
    request: RestoreStudentRequest,
    context: AuditRequestContext = {},
  ): Promise<StudentResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedStudentAction(
        admin,
        "restore",
        context,
        request.id,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can restore student data",
      );
    }

    const target = await prismaClient.student.findUnique({
      where: { id: request.id },
      select: {
        id: true,
        deleted_at: true,
        person_id: true,
        status: true,
        pre_delete_status: true,
      },
    });

    if (!target) {
      throw new ResponseError(404, "Student not found");
    }

    if (target.deleted_at === null) {
      throw new ResponseError(
        400,
        "Student is not in the trash bin. It might be active or permanently deleted.",
      );
    }

    if (!target.pre_delete_status) {
      throw new ResponseError(
        400,
        "Student was deleted before status preservation was introduced. Restore it manually with the correct status.",
      );
    }

    const restoredStatus = target.pre_delete_status;
    const deletedAt = target.deleted_at;

    await prismaClient.$transaction(async (tx) => {
      await tx.student.update({
        where: { id: request.id },
        data: {
          deleted_at: null,
          status: restoredStatus,
          pre_delete_status: null,
        },
      });

      await AuditService.record(
        {
          action: AuditAction.UPDATE_STUDENT,
          source: AuditSource.UI,
          entity_type: "Student",
          entity_id: target.id,
          admin_id: admin.id,
          old_values: {
            status: target.status,
            deleted_at: deletedAt.toISOString(),
          },
          new_values: { status: restoredStatus, deleted_at: null },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const restoredPerson = await prismaClient.person.findUnique({
      where: { id: target.person_id },
      include: {
        student: { include: { current_grade: true, join_grade: true } },
      },
    });

    if (!restoredPerson || !restoredPerson.student) {
      throw new ResponseError(
        500,
        "Internal Server Error: Failed to retrieve restored student data",
      );
    }

    return toStudentResponse(restoredPerson);
  }

  static async bulkRemove(
    admin: AdminUser,
    request: BulkIdsRequest,
    context: AuditRequestContext = {},
  ): Promise<BulkStudentResponse> {
    const bulkRequest = Validation.validate(
      StudentValidation.BULK_IDS,
      request,
    );

    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedStudentAction(admin, "bulk delete", context);
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete student data",
      );
    }

    const items: BulkActionItemResponse<StudentResponse | boolean>[] = [];

    for (const id of bulkRequest.ids) {
      try {
        const data = await StudentService.remove(admin, { id }, context);
        items.push({ id, status: "SUCCESS", data });
      } catch (error) {
        items.push({ id, status: "FAILED", error: bulkFailureMessage(error) });
      }
    }

    return toBulkActionResponse(items);
  }

  static async bulkRestore(
    admin: AdminUser,
    request: BulkIdsRequest,
    context: AuditRequestContext = {},
  ): Promise<BulkStudentResponse> {
    const bulkRequest = Validation.validate(
      StudentValidation.BULK_IDS,
      request,
    );

    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedStudentAction(admin, "bulk restore", context);
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can restore student data",
      );
    }

    const items: BulkActionItemResponse<StudentResponse | boolean>[] = [];

    for (const id of bulkRequest.ids) {
      try {
        const data = await StudentService.restore(admin, { id }, context);
        items.push({ id, status: "SUCCESS", data });
      } catch (error) {
        items.push({ id, status: "FAILED", error: bulkFailureMessage(error) });
      }
    }

    return toBulkActionResponse(items);
  }
}
