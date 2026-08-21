import { ResponseError } from "../error/response-error";
import {
  AcademicYearStatus,
  AdminRole,
  AuditAction,
  AuditSource,
  EnrollmentStatus,
  PersonType,
  Prisma,
  StudentMutationField,
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
  type DeactivateStudentRequest,
  type GetStudentRequest,
  type ReactivateStudentRequest,
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
import { resolveStudentPhotoUrl } from "./student-photo-service";
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

// Shared by deactivate()/reactivate() - same three-tier gate update() uses
// (VIEWER blocked, DATABASE_ADMIN needs can_write_student_data + office
// hours + unit match, SUPER_ADMIN unrestricted).
async function assertCanManageActivation(
  admin: AdminUser,
  studentId: string,
  gradeUnitId: string | null,
  action: string,
  context: AuditRequestContext,
  now: Date,
): Promise<void> {
  if (admin.role === AdminRole.VIEWER) {
    await recordUnauthorizedStudentAction(admin, action, context, studentId);
    throw new ResponseError(403, "Forbidden: Viewer cannot update data");
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    if (!admin.can_write_student_data) {
      await recordUnauthorizedStudentAction(admin, action, context, studentId);
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to write student data",
      );
    }
    await assertCanWriteNow(admin, context, now);
    if (gradeUnitId !== admin.unit_id) {
      await recordUnauthorizedStudentAction(admin, action, context, studentId);
      throw new ResponseError(
        403,
        "Forbidden: This student is outside your unit scope",
      );
    }
  }
}

// Pulls the first 4-digit year out of a free-text label like "2021" or
// "2020/2021" - leave_year has no enforced format (legacy data especially),
// so this is best-effort: returns null rather than guessing on anything
// that doesn't contain one.
function extractFourDigitYear(label: string | null | undefined): number | null {
  if (!label) return null;
  const match = label.match(/\d{4}/);
  return match ? Number(match[0]) : null;
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

type StudentMutationFieldValue =
  | { field: "JOIN_GRADE"; join_grade_id: string }
  | { field: "JOIN_ACADEMIC_YEAR"; join_academic_year_id: string }
  | { field: "ENTRY_TYPE"; entry_type: CreateStudentRequest["entry_type"] };

// Closes the currently-open row (if any) for this student+field and opens a
// new one linked to it via previous_history_id - same pattern as
// recordEmployeeMutation in employee-service.ts, scoped to the three student
// fields NOT already covered by StudentClassEnrollment history (grade/
// class/academic year/status live there instead - see EnrollmentService).
async function recordStudentMutation(
  tx: Prisma.TransactionClient,
  studentId: string,
  value: StudentMutationFieldValue,
  startDate: Date,
): Promise<void> {
  const previous = await tx.studentMutationHistory.findFirst({
    where: {
      student_id: studentId,
      field: value.field as StudentMutationField,
      end_date: null,
      deleted_at: null,
    },
  });

  if (previous && startDate < previous.start_date) {
    throw new ResponseError(
      400,
      `Effective date cannot be before this student's current ${value.field.toLowerCase().replace(/_/g, " ")} record started (${previous.start_date.toISOString().slice(0, 10)})`,
    );
  }

  if (previous) {
    await tx.studentMutationHistory.update({
      where: { id: previous.id },
      data: { end_date: startDate },
    });
  }

  await tx.studentMutationHistory.create({
    data: {
      student_id: studentId,
      start_date: startDate,
      previous_history_id: previous?.id ?? null,
      ...value,
    },
  });
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
      if (!admin.can_write_student_data) {
        await recordUnauthorizedStudentAction(admin, "create", context);
        throw new ResponseError(
          403,
          "Forbidden: You don't have permission to write student data",
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

          await recordStudentMutation(
            tx,
            personForAudit.student.id,
            { field: "JOIN_GRADE", join_grade_id: createRequest.join_grade_id },
            now,
          );
          await recordStudentMutation(
            tx,
            personForAudit.student.id,
            {
              field: "JOIN_ACADEMIC_YEAR",
              join_academic_year_id: createRequest.join_academic_year_id,
            },
            now,
          );
          await recordStudentMutation(
            tx,
            personForAudit.student.id,
            { field: "ENTRY_TYPE", entry_type: createRequest.entry_type },
            now,
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
        student: {
          include: {
            current_grade: true,
            join_grade: true,
            _count: { select: { enrollments: true } },
          },
        },
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
        student: {
          include: {
            current_grade: true,
            join_grade: true,
            _count: { select: { enrollments: true } },
          },
        },
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

  // Deactivate/Reactivate are deliberately narrow: Inactive only reaches
  // (and only leaves from) ACTIVE, never Transferred/Withdrawn/Graduated.
  // Those already have their own real "how they left" outcome via
  // EnrollmentService.close()/reactivate() on the class side - layering
  // Inactive on top would let the class page's enrollment-level Reactivate
  // (which only ever checks the enrollment's own status, not the
  // student's) silently flip a Transferred/Withdrawn student back to
  // Active without anyone touching this flag at all. Restricting to
  // ACTIVE only avoids that entirely: an Inactive student's enrollment is
  // never closed in the first place, so the enrollment-level Reactivate
  // button never applies to them - there's nothing to collide with.
  static async deactivate(
    admin: AdminUser,
    request: DeactivateStudentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<StudentResponse> {
    const target = await prismaClient.student.findFirst({
      where: { id: request.id, deleted_at: null },
      include: { current_grade: true },
    });
    if (!target) {
      throw new ResponseError(404, "Student not found");
    }

    await assertCanManageActivation(
      admin,
      target.id,
      target.current_grade.unit_id,
      "deactivate",
      context,
      now,
    );

    if (target.status !== StudentStatus.ACTIVE) {
      throw new ResponseError(
        400,
        "Only an active student can be deactivated.",
      );
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.student.update({
        where: { id: target.id },
        data: { status: StudentStatus.INACTIVE },
      });

      await AuditService.record(
        {
          action: AuditAction.DEACTIVATE_STUDENT,
          source: AuditSource.UI,
          entity_type: "Student",
          entity_id: target.id,
          admin_id: admin.id,
          old_values: { status: target.status },
          new_values: { status: StudentStatus.INACTIVE },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const updated = await prismaClient.person.findFirst({
      where: { student: { id: target.id } },
      include: {
        student: {
          include: {
            current_grade: true,
            join_grade: true,
            _count: { select: { enrollments: true } },
          },
        },
      },
    });
    if (!updated) {
      throw new ResponseError(
        500,
        "Internal Server Error: Failed to retrieve deactivated student data",
      );
    }

    return toStudentResponse(updated);
  }

  static async reactivate(
    admin: AdminUser,
    request: ReactivateStudentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<StudentResponse> {
    const target = await prismaClient.student.findFirst({
      where: { id: request.id, deleted_at: null },
      include: { current_grade: true },
    });
    if (!target) {
      throw new ResponseError(404, "Student not found");
    }

    await assertCanManageActivation(
      admin,
      target.id,
      target.current_grade.unit_id,
      "reactivate",
      context,
      now,
    );

    if (target.status !== StudentStatus.INACTIVE) {
      throw new ResponseError(
        400,
        "Only an inactive student can be reactivated this way.",
      );
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.student.update({
        where: { id: target.id },
        data: { status: StudentStatus.ACTIVE },
      });

      await AuditService.record(
        {
          action: AuditAction.REACTIVATE_STUDENT,
          source: AuditSource.UI,
          entity_type: "Student",
          entity_id: target.id,
          admin_id: admin.id,
          old_values: { status: target.status },
          new_values: { status: StudentStatus.ACTIVE },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const updated = await prismaClient.person.findFirst({
      where: { student: { id: target.id } },
      include: {
        student: {
          include: {
            current_grade: true,
            join_grade: true,
            _count: { select: { enrollments: true } },
          },
        },
      },
    });
    if (!updated) {
      throw new ResponseError(
        500,
        "Internal Server Error: Failed to retrieve reactivated student data",
      );
    }

    return toStudentResponse(updated);
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
        student: {
          include: {
            current_grade: true,
            join_grade: true,
            _count: { select: { enrollments: true } },
          },
        },
      },
    });

    if (!existing || !existing.student) {
      throw new ResponseError(404, "Student not found");
    }

    if (admin.role === AdminRole.DATABASE_ADMIN) {
      if (!admin.can_write_student_data) {
        await recordUnauthorizedStudentAction(
          admin,
          "update",
          context,
          request.id,
        );
        throw new ResponseError(
          403,
          "Forbidden: You don't have permission to write student data",
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
    // Mirror of assertStudentCanBecomeActive - REGISTERED means "never
    // enrolled yet", same as create() enforces. There's no EnrollmentStatus
    // to close an active enrollment *to* when going back to REGISTERED
    // (unlike GRADUATED/TRANSFERRED/WITHDRAWN, which all map to a real
    // outcome - see TERMINAL_STUDENT_STATUS_TO_ENROLLMENT_STATUS), so this
    // is a hard block rather than an implicit cascade: remove the
    // enrollment first (EnrollmentService.remove), which already sets the
    // student back to REGISTERED as a side effect once nothing's left active.
    if (
      updateRequest.status === StudentStatus.REGISTERED &&
      existing.student.status !== StudentStatus.REGISTERED
    ) {
      const activeEnrollment = await prismaClient.studentClassEnrollment.findFirst({
        where: {
          student_id: existing.student.id,
          enrollment_status: EnrollmentStatus.ACTIVE,
          deleted_at: null,
        },
      });
      if (activeEnrollment) {
        throw new ResponseError(
          400,
          "Cannot set status to Registered while the student has an active class enrollment. Remove them from their current class first.",
        );
      }
    }
    // INACTIVE only ever reaches (and only leaves from) ACTIVE - see
    // StudentService.deactivate()/reactivate() for why. Enforced here too,
    // not just via those dedicated endpoints, so a direct update() call
    // can't bypass it.
    if (
      updateRequest.status === StudentStatus.INACTIVE &&
      existing.student.status !== StudentStatus.ACTIVE
    ) {
      throw new ResponseError(
        400,
        "Inactive can only be set from Active. Use the class's Close/Reactivate actions for Transferred, Withdrawn, or Graduated students.",
      );
    }
    if (
      existing.student.status === StudentStatus.INACTIVE &&
      updateRequest.status !== undefined &&
      updateRequest.status !== StudentStatus.INACTIVE &&
      updateRequest.status !== StudentStatus.ACTIVE
    ) {
      throw new ResponseError(
        400,
        "An inactive student can only be moved back to Active.",
      );
    }
    // GRADUATED derives graduation_grade/leave_year from the student's real
    // active enrollment when one exists, instead of trusting whatever's
    // typed in the form - a free-typed grade/year could drift from what
    // actually happened (e.g. claiming a grade they were never enrolled
    // in, or a year that doesn't match their real class history). Only
    // students with no active enrollment right now (legacy imports, or a
    // student already closed out some other way) fall back to the typed
    // fields, since there's no real enrollment to derive from.
    let derivedGraduationGrade: string | undefined;
    let derivedLeaveYear: string | undefined;
    if (effectiveStatus === StudentStatus.GRADUATED) {
      const activeEnrollment = await prismaClient.studentClassEnrollment.findFirst({
        where: {
          student_id: existing.student.id,
          enrollment_status: EnrollmentStatus.ACTIVE,
          deleted_at: null,
        },
        include: { academic_year: true },
      });
      if (activeEnrollment) {
        derivedGraduationGrade = activeEnrollment.grade_level;
        derivedLeaveYear = activeEnrollment.academic_year.name;
      }
    }
    const effectiveGraduationGrade =
      derivedGraduationGrade ??
      updateRequest.graduation_grade ??
      existing.student.graduation_grade;
    const effectiveLeaveYear =
      derivedLeaveYear ?? updateRequest.leave_year ?? existing.student.leave_year;

    if (
      effectiveStatus === StudentStatus.GRADUATED &&
      (!effectiveLeaveYear || !effectiveGraduationGrade)
    ) {
      throw new ResponseError(
        400,
        "Graduated students require leave_year and graduation_grade",
      );
    }
    // No real enrollment to derive from - the typed leave_year is the only
    // source of truth here, so at least catch an impossible one: they
    // can't have graduated before the academic year they joined in (e.g.
    // joined 2020, "graduated" 2019). Anything that doesn't parse as a
    // plain year is left alone rather than blocked - legacy data isn't
    // always in a clean format.
    if (effectiveStatus === StudentStatus.GRADUATED && !derivedLeaveYear) {
      const joinYear = await prismaClient.academicYear.findUnique({
        where: { id: existing.student.join_academic_year_id },
        select: { name: true, start_date: true },
      });
      const leaveYearNumber = extractFourDigitYear(effectiveLeaveYear);
      const joinYearNumber = joinYear?.start_date.getFullYear() ?? null;
      if (
        leaveYearNumber !== null &&
        joinYearNumber !== null &&
        leaveYearNumber < joinYearNumber
      ) {
        throw new ResponseError(
          400,
          `Leave year "${effectiveLeaveYear}" can't be before the academic year they joined (${joinYear?.name}).`,
        );
      }
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
        // Any real enrollment - not just an ACTIVE one - is the source of
        // truth for current_grade once it exists, same posture as
        // graduation_grade/leave_year (see toStudentDetailResponse's
        // has_completed_enrollment). A GRADUATED/TRANSFERRED/WITHDRAWN
        // student's most recent enrollment (whatever its own status) still
        // says what grade they actually finished in - letting it drift via
        // a direct edit here would silently disagree with that record with
        // no trace of which value is right. Only a student with zero
        // enrollment history (never actually enrolled, or a legacy import
        // with no enrollment trail) can freely set this directly.
        const latestEnrollment =
          await prismaClient.studentClassEnrollment.findFirst({
            where: { student_id: existing.student.id, deleted_at: null },
            include: { class: true },
            orderBy: { academic_year: { start_date: "desc" } },
          });

        if (
          latestEnrollment &&
          latestEnrollment.class.grade_id !== updateRequest.current_grade_id
        ) {
          throw new ResponseError(
            400,
            `Cannot change current grade to '${currentGrade.name}'. This student's most recent enrollment record says '${latestEnrollment.class.name}' - current grade is derived from enrollment history, not editable directly. Enroll, promote, or transfer them instead.`,
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
                  : effectiveGraduationGrade,
                leave_year: clearGraduationFields ? null : effectiveLeaveYear,
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

        // Leaving a terminal status (GRADUATED/TRANSFERRED/WITHDRAWN, e.g.
        // correcting a mistake) only touches the old enrollment row in two
        // cases, each scoped differently:
        // - swapping directly between two terminal statuses (e.g. corrected
        //   from TRANSFERRED to WITHDRAWN) corrects whichever enrollment
        //   actually represents that closure, wherever it is - a student
        //   marked TRANSFERRED years ago almost certainly closed out in an
        //   older academic year, not the currently active one, so this is
        //   NOT scoped to the active year. Picks the most recent matching
        //   row in case there's more than one (e.g. withdrawn once, later
        //   re-enrolled, transferred again).
        // - moving specifically to REGISTERED (the one status that means
        //   "no class ties at all", same meaning create() already gives it)
        //   soft-deletes the row to free up the (student, academic_year)
        //   unique slot for a fresh enrollment. This one IS scoped to the
        //   currently ACTIVE year specifically - that's the only slot a
        //   fresh create() could actually collide with right now; an old
        //   row from a past year isn't blocking anything and is left as
        //   real history. Soft-delete rather than hard-delete so it's
        //   still recoverable via the trash bin.
        // Any other target status (INACTIVE, ARCHIVED, ...) leaves the old
        // enrollment row exactly as it is - those statuses don't mean "free
        // to re-enrol", so nothing here should imply otherwise. ACTIVE is
        // excluded structurally: assertStudentCanBecomeActive above already
        // requires an active enrollment to exist before status can even
        // become ACTIVE, so this code never runs for that case.
        const previousTerminalEnrollmentStatus =
          TERMINAL_STUDENT_STATUS_TO_ENROLLMENT_STATUS[
            existing.student!.status
          ];
        const nextTerminalEnrollmentStatus =
          TERMINAL_STUDENT_STATUS_TO_ENROLLMENT_STATUS[effectiveStatus];
        if (
          previousTerminalEnrollmentStatus &&
          effectiveStatus !== existing.student!.status
        ) {
          if (nextTerminalEnrollmentStatus) {
            const closingEnrollment =
              await tx.studentClassEnrollment.findFirst({
                where: {
                  student_id: existing.student!.id,
                  enrollment_status: previousTerminalEnrollmentStatus,
                  deleted_at: null,
                },
                orderBy: { start_date: "desc" },
              });
            if (closingEnrollment) {
              const corrected = await tx.studentClassEnrollment.update({
                where: { id: closingEnrollment.id },
                data: { enrollment_status: nextTerminalEnrollmentStatus },
              });
              await AuditService.record(
                {
                  action: AuditAction.WITHDRAW_STUDENT_ENROLLMENT,
                  source: AuditSource.UI,
                  entity_type: "StudentClassEnrollment",
                  entity_id: closingEnrollment.id,
                  admin_id: admin.id,
                  old_values: toEnrollmentAuditSnapshot(closingEnrollment),
                  new_values: toEnrollmentAuditSnapshot(corrected),
                  ip_address: context.ip_address,
                  user_agent: context.user_agent,
                },
                tx,
              );
            }
          } else if (effectiveStatus === StudentStatus.REGISTERED) {
            const activeYear = await tx.academicYear.findFirst({
              where: { status: AcademicYearStatus.ACTIVE },
            });
            const orphanedEnrollment = activeYear
              ? await tx.studentClassEnrollment.findFirst({
                  where: {
                    student_id: existing.student!.id,
                    academic_year_id: activeYear.id,
                    enrollment_status: previousTerminalEnrollmentStatus,
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

        if (
          personForAudit.student.join_grade_id !==
          existing.student!.join_grade_id
        ) {
          await recordStudentMutation(
            tx,
            personForAudit.student.id,
            {
              field: "JOIN_GRADE",
              join_grade_id: personForAudit.student.join_grade_id,
            },
            now,
          );
        }
        if (
          personForAudit.student.join_academic_year_id !==
          existing.student!.join_academic_year_id
        ) {
          await recordStudentMutation(
            tx,
            personForAudit.student.id,
            {
              field: "JOIN_ACADEMIC_YEAR",
              join_academic_year_id:
                personForAudit.student.join_academic_year_id,
            },
            now,
          );
        }
        if (
          personForAudit.student.entry_type !== existing.student!.entry_type
        ) {
          await recordStudentMutation(
            tx,
            personForAudit.student.id,
            {
              field: "ENTRY_TYPE",
              entry_type: personForAudit.student.entry_type,
            },
            now,
          );
        }
      });
    } catch (error) {
      rethrowAsFriendlyStudentUpdateConflict(error);
    }

    const updatedPerson = await prismaClient.person.findUnique({
      where: { id: existing.id },
      include: {
        student: {
          include: {
            current_grade: true,
            join_grade: true,
            _count: { select: { enrollments: true } },
          },
        },
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
            _count: { select: { enrollments: true } },
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
      const completedEnrollmentCount =
        await prismaClient.studentClassEnrollment.count({
          where: {
            student_id: person.student.id,
            enrollment_status: EnrollmentStatus.COMPLETED,
            deleted_at: null,
          },
        });
      const activeEnrollmentHistoryCount =
        await prismaClient.studentClassEnrollment.count({
          where: {
            student_id: person.student.id,
            deleted_at: null,
          },
        });
      const detail = toStudentDetailResponse(
        person,
        completedEnrollmentCount > 0,
        activeEnrollmentHistoryCount > 0,
      );
      detail.identity.photo_url = await resolveStudentPhotoUrl(
        person.photo_object_key,
        person.photo_url,
      );
      return detail;
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
                  _count: { select: { enrollments: true } },
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
        student: {
          include: {
            current_grade: true,
            join_grade: true,
            _count: { select: { enrollments: true } },
          },
        },
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

  static async bulkDeactivate(
    admin: AdminUser,
    request: BulkIdsRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkStudentResponse> {
    const bulkRequest = Validation.validate(
      StudentValidation.BULK_IDS,
      request,
    );

    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedStudentAction(admin, "bulk deactivate", context);
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }

    const items: BulkActionItemResponse<StudentResponse>[] = [];

    for (const id of bulkRequest.ids) {
      try {
        const data = await StudentService.deactivate(
          admin,
          { id },
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

  static async bulkReactivate(
    admin: AdminUser,
    request: BulkIdsRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkStudentResponse> {
    const bulkRequest = Validation.validate(
      StudentValidation.BULK_IDS,
      request,
    );

    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedStudentAction(admin, "bulk reactivate", context);
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }

    const items: BulkActionItemResponse<StudentResponse>[] = [];

    for (const id of bulkRequest.ids) {
      try {
        const data = await StudentService.reactivate(
          admin,
          { id },
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
}
