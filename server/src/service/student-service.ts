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
  StudentSupportRole,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import { paginate, type Pageable } from "../model/page-model";
import { UNKNOWN_LEGACY_GRADE_NAME } from "../model/grade-model";
import { UNKNOWN_LEGACY_CLASS_PREFIX } from "../model/class-model";
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
  type GetBackfillCandidatesRequest,
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
import { generateNis, tryPromoteLegacyNis } from "../utils/nis-generator";
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

// One batched query per page rather than a per-student lookup - cheap since
// it's bounded by the page's own size, same shape as the _count aggregates
// already used for has_class_history elsewhere in this file.
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

// Join Grade/Year records when a student first joined - it can never be
// later than the earliest enrollment already on file (any status, not just
// ACTIVE - a closed enrollment's own dates are a permanent historical
// snapshot too), or the enrollment history would silently disagree with
// "when they joined". Reused by update() and reissueNis() - the only two
// places these fields can be edited after create(). No-ops when the
// student has no enrollment history yet (nothing to disagree with).
// Pure comparison, no DB access - the caller supplies laterAcademicYearCount
// (however it wants to compute it: a targeted COUNT query at commit, or a
// filter over an already-fetched academic year list during import preview).
// Kept as a single source of truth so preview can report the exact same
// verdict/wording as the real commit-time check in create() below, instead
// of a hand-duplicated copy that can silently drift out of sync.
export function tooFarAheadMessage(params: {
  currentGrade: { name: string };
  joinGrade: { name: string };
  joinAcademicYear: { name: string };
  // Number of real grade-year promotions between joinGrade and
  // currentGrade - i.e. how many Grade rows exist with a level in
  // (joinGrade.level, currentGrade.level]. Deliberately NOT the raw level
  // difference: Kindergarten sub-levels are negative (Pre-K -3, K1 -2, K2
  // -1) with no level 0, so Elementary starts at Grade 1 (level 1) -
  // K2 -> Grade 1 is one real promotion but a level difference of 2. The
  // caller computes this from the actual grade list so it's never wrong
  // about how many grades really exist in that range.
  gradeStepCount: number;
  laterAcademicYearCount: number;
}): string | null {
  const {
    currentGrade,
    joinGrade,
    joinAcademicYear,
    gradeStepCount,
    laterAcademicYearCount,
  } = params;

  // The legacy-import sentinel stands for "we don't know the real join
  // grade", not an actual grade level, so there's no real reference point
  // to bound "too far ahead" against.
  if (joinGrade.name === UNKNOWN_LEGACY_GRADE_NAME) return null;

  if (gradeStepCount > laterAcademicYearCount) {
    const excess = gradeStepCount - laterAcademicYearCount;
    return `Current grade ('${currentGrade.name}') is too far ahead of the join grade ('${joinGrade.name}') - only ${laterAcademicYearCount} academic year(s) exist after ${joinAcademicYear.name}. Check Join Grade/Year for a possible ${excess}-level mismatch before assuming a real grade skip.`;
  }
  return null;
}

async function assertJoinFieldsConsistentWithEnrollment(
  studentId: string,
  proposedJoinGrade: { level: number; name: string },
  proposedJoinAcademicYear: { start_date: Date; name: string },
): Promise<void> {
  const earliestEnrollment = await prismaClient.studentClassEnrollment.findFirst(
    {
      where: { student_id: studentId, deleted_at: null },
      include: { grade: true, academic_year: true },
      orderBy: { academic_year: { start_date: "asc" } },
    },
  );

  if (!earliestEnrollment) return;

  if (
    proposedJoinAcademicYear.start_date >
    earliestEnrollment.academic_year.start_date
  ) {
    throw new ResponseError(
      400,
      `Cannot set Join Year to '${proposedJoinAcademicYear.name}' - this student's earliest enrollment on record is in '${earliestEnrollment.academic_year.name}', which is before that. Join Year can't be later than an enrollment already on file.`,
    );
  }
  if (proposedJoinGrade.level > earliestEnrollment.grade.level) {
    throw new ResponseError(
      400,
      `Cannot set Join Grade to '${proposedJoinGrade.name}' - this student's earliest enrollment on record is in '${earliestEnrollment.grade.name}', a lower grade. Join Grade can't be higher than an enrollment already on file.`,
    );
  }
}

// Surfaces "this student's enrollment history has a gap" on the detail
// page - only meaningful while they're still expected to keep progressing
// (REGISTERED/ACTIVE; a GRADUATED/TRANSFERRED/WITHDRAWN/INACTIVE student's
// journey is intentionally over). Compares against the chronologically-next
// academic year that's actually ACTIVE or COMPLETED - an UPCOMING year
// prepped ahead of time (a normal, routine practice - see
// AcademicYearsPanel.jsx) hasn't started yet, so a currently-enrolled
// student isn't "missing" anything there yet.
async function resolveNextUnenrolledAcademicYear(
  studentId: string,
  studentStatus: StudentStatus,
  joinAcademicYearId: string,
  joinGradeId: string,
  currentGradeId: string,
  graduationGrade: string | null,
): Promise<{
  id: string;
  name: string;
  expected_grade: { id: string; name: string } | null;
} | null> {
  const isTerminalStatus =
    studentStatus === StudentStatus.GRADUATED ||
    studentStatus === StudentStatus.TRANSFERRED ||
    studentStatus === StudentStatus.WITHDRAWN;

  if (
    studentStatus !== StudentStatus.REGISTERED &&
    studentStatus !== StudentStatus.ACTIVE &&
    !isTerminalStatus
  ) {
    return null;
  }

  const joinYear = await prismaClient.academicYear.findUnique({
    where: { id: joinAcademicYearId },
  });
  if (!joinYear) return null;

  // Scan every ACTIVE/COMPLETED year from their join year onward for the
  // earliest one with no enrollment record, instead of just checking "the
  // year after their latest enrollment" - a student can have a later
  // enrollment on file (e.g. from a non-backfill path) while an earlier
  // year was still never filled in, and that earlier gap is the real
  // problem to surface.
  const [enrollments, candidateYears] = await Promise.all([
    prismaClient.studentClassEnrollment.findMany({
      where: { student_id: studentId, deleted_at: null },
      select: { academic_year_id: true },
    }),
    prismaClient.academicYear.findMany({
      where: {
        start_date: { gte: joinYear.start_date },
        status: { not: AcademicYearStatus.UPCOMING },
      },
      orderBy: { start_date: "asc" },
    }),
  ]);

  // A terminal-status student with zero enrollments is unambiguous - their
  // join year is missing regardless of anything else, same as REGISTERED/
  // ACTIVE. It's only once they have at least one enrollment (mid
  // backfill+Promote reconstruction) that "keep going or stop?" needs a
  // boundary: graduation_grade is the real final grade EnrollmentService.
  // create() snapshotted there before reconstruction started overwriting
  // current_grade_id. Once current_grade_id has been walked back up to
  // match it, they're done - don't keep nudging Promote forever (there's
  // no live "now" to catch up to for a student whose journey already ended).
  if (isTerminalStatus && enrollments.length > 0) {
    if (!graduationGrade) return null;
    const boundaryGrade = await prismaClient.grade.findFirst({
      where: { name: graduationGrade },
    });
    if (!boundaryGrade || boundaryGrade.id === currentGradeId) return null;
  }

  const enrolledYearIds = new Set(
    enrollments.map((enrollment) => enrollment.academic_year_id),
  );
  const gapYear = candidateYears.find(
    (year) => !enrolledYearIds.has(year.id),
  );
  if (!gapYear) return null;

  // Same anchor StudentService.getBackfillCandidates/EnrollmentService.
  // assertLegacyGradeMatchesExpectedStep would require for this exact gap:
  // the join grade itself when there's no enrollment on file at all, or
  // whatever grade the immediately preceding year's enrollment was in
  // otherwise (their retention-level floor - always a valid backfill target).
  let expectedGrade: { id: string; name: string } | null = null;
  if (enrollments.length === 0) {
    const joinGrade = await prismaClient.grade.findUnique({
      where: { id: joinGradeId },
    });
    expectedGrade = joinGrade
      ? { id: joinGrade.id, name: joinGrade.name }
      : null;
  } else {
    const precedingYear = await prismaClient.academicYear.findFirst({
      where: { start_date: { lt: gapYear.start_date } },
      orderBy: { start_date: "desc" },
    });
    const precedingEnrollment = precedingYear
      ? await prismaClient.studentClassEnrollment.findFirst({
          where: {
            student_id: studentId,
            academic_year_id: precedingYear.id,
            deleted_at: null,
          },
          include: { class: { include: { grade: true } } },
          orderBy: { class: { grade: { level: "desc" } } },
        })
      : null;
    expectedGrade = precedingEnrollment
      ? {
          id: precedingEnrollment.class.grade.id,
          name: precedingEnrollment.class.grade.name,
        }
      : null;
  }

  return { id: gapYear.id, name: gapYear.name, expected_grade: expectedGrade };
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
//
// priorLiveValue self-heals gaps left by data that predates mutation-history
// tracking (or any student whose first-ever change on this field happens to
// land here with nothing already tracked): when no open record exists yet,
// the live value being overwritten is real - it just was never recorded -
// so without this, the row created below would look like a genesis record
// (rollback dead-ends here) even though a real prior value existed. Omitted
// at create() time - there's nothing to roll back to yet, by definition.
async function recordStudentMutation(
  tx: Prisma.TransactionClient,
  studentId: string,
  value: StudentMutationFieldValue,
  startDate: Date,
  priorLiveValue?: { value: StudentMutationFieldValue; since: Date },
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

  let previousHistoryId = previous?.id ?? null;

  if (previous) {
    await tx.studentMutationHistory.update({
      where: { id: previous.id },
      data: { end_date: startDate },
    });
  } else if (priorLiveValue && priorLiveValue.since < startDate) {
    const genesis = await tx.studentMutationHistory.create({
      data: {
        student_id: studentId,
        start_date: priorLiveValue.since,
        end_date: startDate,
        previous_history_id: null,
        ...priorLiveValue.value,
      },
    });
    previousHistoryId = genesis.id;
  }

  await tx.studentMutationHistory.create({
    data: {
      student_id: studentId,
      start_date: startDate,
      previous_history_id: previousHistoryId,
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

    // Skipped when either side is the legacy-import "Unknown" sentinel -
    // its level (0) doesn't represent a real grade, so it can't be
    // meaningfully compared as "lower" or "higher" than the other one.
    if (
      currentGrade.level < joinGrade.level &&
      currentGrade.name !== UNKNOWN_LEGACY_GRADE_NAME &&
      joinGrade.name !== UNKNOWN_LEGACY_GRADE_NAME
    ) {
      // Same override as too-far-ahead below - a bulk data-entry import
      // often isn't the person who can actually correct which side of a
      // sheet mismatch is wrong (that's a data-owner call, e.g. the
      // school secretary), so this needs the same "let it in, flagged"
      // escape hatch rather than blocking the whole row on a field
      // outside the importer's authority to fix.
      if (createRequest.override_too_far_ahead_reason) {
        if (admin.role !== AdminRole.SUPER_ADMIN) {
          throw new ResponseError(
            403,
            "Only a Super Admin can override a grade consistency check",
          );
        }
      } else {
        throw new ResponseError(
          400,
          "Current grade cannot be lower than the grade the student joined at",
        );
      }
    }

    const joinAcademicYear = await prismaClient.academicYear.findUnique({
      where: { id: createRequest.join_academic_year_id },
      select: { name: true, start_date: true },
    });
    if (!joinAcademicYear) {
      throw new ResponseError(
        400,
        "Invalid join academic year: academic year not found",
      );
    }

    // Bounds how far ahead of the join grade a fresh student record can
    // claim to already be: at most one grade level per academic year that
    // actually exists after the join year (retention/behind-schedule is
    // always fine - only claiming to be further along than time allows is
    // the nonsensical case, e.g. joining Pre-K in 2024/2025 but current
    // grade already Grade 1 when only one later academic year exists).
    // Only COMPLETED/ACTIVE years count as "elapsed" - an UPCOMING year is
    // just prepped ahead of time and isn't a year the student has actually
    // been through yet, so it can't justify being further along either.
    if (currentGrade.level > joinGrade.level && joinAcademicYear.start_date) {
      const [laterAcademicYearCount, gradeStepCount] = await Promise.all([
        prismaClient.academicYear.count({
          where: {
            start_date: { gt: joinAcademicYear.start_date },
            status: { not: AcademicYearStatus.UPCOMING },
          },
        }),
        prismaClient.grade.count({
          where: { level: { gt: joinGrade.level, lte: currentGrade.level } },
        }),
      ]);
      const tooFarAheadError = tooFarAheadMessage({
        currentGrade,
        joinGrade,
        joinAcademicYear,
        gradeStepCount,
        laterAcademicYearCount,
      });
      if (tooFarAheadError) {
        // Deliberately narrow: a non-empty reason bypasses the block, but
        // only for a Super Admin - anyone else's override attempt is
        // rejected outright rather than silently ignored (so it fails
        // loudly instead of looking like the override worked).
        if (createRequest.override_too_far_ahead_reason) {
          if (admin.role !== AdminRole.SUPER_ADMIN) {
            throw new ResponseError(
              403,
              "Only a Super Admin can override a too-far-ahead grade check",
            );
          }
        } else {
          throw new ResponseError(400, tooFarAheadError);
        }
      }
    }

    if (createRequest.legacy_nis && !createRequest.nis && joinAcademicYear) {
      const promotedNis = tryPromoteLegacyNis({
        legacyNis: createRequest.legacy_nis,
        academicYear: joinAcademicYear,
        gradeLevel: joinGrade.level,
        entryType: createRequest.entry_type,
      });
      if (promotedNis) {
        createRequest.nis = promotedNis;
        createRequest.legacy_nis = undefined;
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
              religion_other: createRequest.religion_other,
              birth_place: createRequest.birth_place,
              birth_date: new Date(createRequest.birth_date),
              photo_url: createRequest.photo_url,
              student: {
                create: {
                  nis,
                  legacy_nis: createRequest.legacy_nis,
                  nisn: createRequest.nisn,
                  legacy_nisn: createRequest.legacy_nisn,
                  import_defaulted_fields:
                    createRequest.import_defaulted_fields ?? [],
                  grade_consistency_override_reason:
                    createRequest.override_too_far_ahead_reason ?? null,
                  status: initialStatus,
                  current_grade_id: createRequest.current_grade_id,
                  join_academic_year_id: createRequest.join_academic_year_id,
                  join_grade_id: createRequest.join_grade_id,
                  previous_school: createRequest.previous_school,
                  pickup_drop_service: createRequest.pickup_drop_service,
                  catering_service: createRequest.catering_service,
                  psb_guide: createRequest.psb_guide,
                  entry_type: createRequest.entry_type,
                  graduation_grade: createRequest.graduation_grade,
                  leave_year: createRequest.leave_year,
                  sn: createRequest.sn,
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
              new_values: {
                ...toStudentAuditSnapshot(
                  personForAudit,
                  personForAudit.student,
                ),
                ...(createRequest.override_too_far_ahead_reason && {
                  override_too_far_ahead_reason:
                    createRequest.override_too_far_ahead_reason,
                }),
              },
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
      include: { join_grade: true, join_academic_year: true },
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

    const joinGradeIsChanging =
      reissueRequest.join_grade_id !== undefined &&
      reissueRequest.join_grade_id !== existing.join_grade_id;
    const joinAcademicYearIsChanging =
      reissueRequest.join_academic_year_id !== undefined &&
      reissueRequest.join_academic_year_id !== existing.join_academic_year_id;

    let effectiveJoinGrade = existing.join_grade;
    let effectiveJoinAcademicYear = existing.join_academic_year;

    if (joinGradeIsChanging || joinAcademicYearIsChanging) {
      const [proposedJoinGrade, proposedJoinAcademicYear] = await Promise.all(
        [
          reissueRequest.join_grade_id
            ? prismaClient.grade.findUnique({
                where: { id: reissueRequest.join_grade_id },
              })
            : Promise.resolve(existing.join_grade),
          reissueRequest.join_academic_year_id
            ? prismaClient.academicYear.findUnique({
                where: { id: reissueRequest.join_academic_year_id },
              })
            : Promise.resolve(existing.join_academic_year),
        ],
      );

      if (!proposedJoinGrade) {
        throw new ResponseError(400, "Invalid join grade: grade not found");
      }
      if (!proposedJoinAcademicYear) {
        throw new ResponseError(
          400,
          "Invalid join academic year: academic year not found",
        );
      }

      await assertJoinFieldsConsistentWithEnrollment(
        existing.id,
        proposedJoinGrade,
        proposedJoinAcademicYear,
      );

      effectiveJoinGrade = proposedJoinGrade;
      effectiveJoinAcademicYear = proposedJoinAcademicYear;
    }

    // Prefix is computed from Join Grade/Year (both "at time of joining"),
    // matching the same pairing create()'s legacy_nis auto-promotion uses -
    // it must never mix a join field with current_grade.
    //
    // If the existing legacy_nis already matches this exact prefix under
    // the entry type being confirmed here, reuse it as the real nis
    // instead of allocating a fresh sequence number - the (possibly just
    // corrected) Join Grade/Year and entry type are exactly what
    // tryPromoteLegacyNis checks against, so this naturally re-evaluates
    // if either was wrong and got fixed as part of this same reissue.
    const promotedNis = tryPromoteLegacyNis({
      legacyNis: existing.legacy_nis,
      academicYear: effectiveJoinAcademicYear,
      gradeLevel: effectiveJoinGrade.level,
      entryType: reissueRequest.entry_type,
    });

    // A legacy_nis that's well-formed can still already belong to another
    // student on file (a genuine duplicate/typo in the source data, not
    // something safe to silently paper over by falling back to
    // generateNis() - that would file this student under a fresh number
    // while the real conflict, and whichever record is actually wrong,
    // stays hidden). Same posture as create()'s existingUser check just
    // does further down its own flow - surfaced here explicitly since
    // reissueNis() has no equivalent check of its own otherwise.
    if (promotedNis) {
      const nisOwner = await prismaClient.student.findFirst({
        where: { nis: promotedNis, id: { not: reissueRequest.id } },
        include: { person: true },
      });
      if (nisOwner) {
        throw new ResponseError(
          400,
          `Legacy NIS '${promotedNis}' matches the expected pattern, but it's already registered to another student: ${nisOwner.person.full_name}. Check whether this is a duplicate before reissuing.`,
        );
      }
    }

    const nis =
      promotedNis ??
      (await generateNis({
        academicYear: effectiveJoinAcademicYear,
        gradeLevel: effectiveJoinGrade.level,
        entryType: reissueRequest.entry_type,
      }));

    await prismaClient.$transaction(async (tx) => {
      await tx.student.update({
        where: { id: reissueRequest.id },
        data: {
          nis,
          legacy_nis: promotedNis ? null : undefined,
          entry_type: reissueRequest.entry_type,
          join_grade_id: joinGradeIsChanging
            ? reissueRequest.join_grade_id
            : undefined,
          join_academic_year_id: joinAcademicYearIsChanging
            ? reissueRequest.join_academic_year_id
            : undefined,
        },
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
            join_grade_id: existing.join_grade_id,
            join_academic_year_id: existing.join_academic_year_id,
          },
          new_values: {
            nis,
            entry_type: reissueRequest.entry_type,
            join_grade_id: effectiveJoinGrade.id,
            join_academic_year_id: effectiveJoinAcademicYear.id,
          },
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
      // Skipped when either side is the legacy-import "Unknown" sentinel -
      // see the same check in create() for why.
      if (
        currentGrade.level < joinGrade.level &&
        currentGrade.name !== UNKNOWN_LEGACY_GRADE_NAME &&
        joinGrade.name !== UNKNOWN_LEGACY_GRADE_NAME
      ) {
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

        // Mirrors assertSameUnit in student-support-assignment-service.ts,
        // checked there only at assign time - a grade change here can move
        // the student into a different unit without anything re-validating
        // an already-active SE assignment against it, leaving the teacher's
        // own unit silently mismatched with the student's new one.
        const activeSeAssignment =
          await prismaClient.studentSupportAssignment.findFirst({
            where: {
              student_id: existing.student.id,
              role: StudentSupportRole.SPECIAL_ED,
              end_date: null,
            },
            include: { employee: { select: { unit_id: true } } },
          });
        if (
          activeSeAssignment &&
          currentGrade.unit_id &&
          activeSeAssignment.employee.unit_id !== currentGrade.unit_id
        ) {
          throw new ResponseError(
            400,
            `Cannot change current grade to '${currentGrade.name}': this student has an active Special Education Teacher assignment from a different unit. End that assignment first.`,
          );
        }
      }
    }

    // Join Grade/Year can't be moved past an enrollment already on file -
    // see assertJoinFieldsConsistentWithEnrollment. Checked independently
    // of the current-grade block above since either field can change on
    // its own (e.g. correcting just the Join Year, not the grade).
    const joinGradeIsChanging =
      updateRequest.join_grade_id !== undefined &&
      updateRequest.join_grade_id !== existing.student.join_grade_id;
    const joinAcademicYearIsChanging =
      updateRequest.join_academic_year_id !== undefined &&
      updateRequest.join_academic_year_id !==
        existing.student.join_academic_year_id;

    if (joinGradeIsChanging || joinAcademicYearIsChanging) {
      const [proposedJoinGrade, proposedJoinAcademicYear] = await Promise.all([
        prismaClient.grade.findUnique({ where: { id: effectiveJoinGradeId } }),
        prismaClient.academicYear.findUnique({
          where: {
            id:
              updateRequest.join_academic_year_id ??
              existing.student.join_academic_year_id,
          },
        }),
      ]);

      if (!proposedJoinGrade) {
        throw new ResponseError(400, "Invalid join grade: grade not found");
      }
      if (!proposedJoinAcademicYear) {
        throw new ResponseError(
          400,
          "Invalid join academic year: academic year not found",
        );
      }

      await assertJoinFieldsConsistentWithEnrollment(
        existing.student.id,
        proposedJoinGrade,
        proposedJoinAcademicYear,
      );
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

        // A field the admin is actually updating now has a real value, so
        // it no longer needs the "was defaulted at import" flag - clears
        // itself rather than needing a separate dismiss action.
        const justUpdatedDefaultKeys = new Set(
          [
            updateRequest.religion !== undefined && "religion",
            updateRequest.birth_place !== undefined && "birth_place",
            updateRequest.birth_date !== undefined && "birth_date",
            updateRequest.status !== undefined && "status",
          ].filter(Boolean),
        );
        const nextImportDefaultedFields = (
          existing.student!.import_defaulted_fields ?? []
        ).filter((key) => !justUpdatedDefaultKeys.has(key));

        // Same self-clearing convention as import_defaulted_fields above -
        // once an admin actually touches either grade, the override reason
        // that explained the original mismatch no longer applies to
        // whatever the grades are now.
        const nextGradeConsistencyOverrideReason =
          updateRequest.current_grade_id !== undefined ||
          updateRequest.join_grade_id !== undefined
            ? null
            : existing.student!.grade_consistency_override_reason;

        await tx.person.update({
          where: { id: existing.id },
          data: {
            full_name: updateRequest.full_name,
            nick_name: updateRequest.nick_name,
            email: updateRequest.email,
            gender: updateRequest.gender,
            religion: updateRequest.religion,
            religion_other: updateRequest.religion_other,
            birth_place: updateRequest.birth_place,
            birth_date: updateRequest.birth_date
              ? new Date(updateRequest.birth_date)
              : undefined,
            photo_url: updateRequest.photo_url,

            student: {
              update: {
                nisn: updateRequest.nisn,
                legacy_nisn: updateRequest.legacy_nisn,
                import_defaulted_fields: nextImportDefaultedFields,
                grade_consistency_override_reason:
                  nextGradeConsistencyOverrideReason,
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
            {
              value: {
                field: "JOIN_GRADE",
                join_grade_id: existing.student!.join_grade_id,
              },
              since: existing.student!.created_at,
            },
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
            {
              value: {
                field: "JOIN_ACADEMIC_YEAR",
                join_academic_year_id: existing.student!.join_academic_year_id,
              },
              since: existing.student!.created_at,
            },
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
            {
              value: {
                field: "ENTRY_TYPE",
                entry_type: existing.student!.entry_type,
              },
              since: existing.student!.created_at,
            },
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
      const nextUnenrolledAcademicYear = await resolveNextUnenrolledAcademicYear(
        person.student.id,
        person.student.status,
        person.student.join_academic_year_id,
        person.student.join_grade_id,
        person.student.current_grade_id,
        person.student.graduation_grade,
      );
      const detail = toStudentDetailResponse(
        person,
        completedEnrollmentCount > 0,
        activeEnrollmentHistoryCount > 0,
        nextUnenrolledAcademicYear,
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
                  current_class: true,
                  join_grade: true,
                  _count: { select: { enrollments: true } },
                },
              },
            },
          })
          .then(async (persons) => {
            const studentIds = persons
              .map((person) => person.student?.id)
              .filter((id): id is string => Boolean(id));
            const flaggedIds = await findStudentIdsWithPlaceholderClass(
              studentIds,
            );

            const data: StudentResponse[] = [];
            for (const person of persons) {
              if (person.student) {
                data.push(
                  toStudentResponse(
                    person,
                    flaggedIds.has(person.student.id),
                  ),
                );
              }
            }
            return data;
          }),
    });
  }

  // Backfill (Historical Data) enrollment picker - only students for whom
  // this is their very first enrollment ever, into their own exact join
  // year and join grade. Historical is a one-time seed, not a repeatable
  // catch-up tool - once it's used, Promote (which already carries a
  // student forward correctly, including across a gap of several past
  // years) is the only way to progress them further. Mirrors
  // EnrollmentService.assertLegacyEnrollmentIsFirstEver, which enforces
  // the same rule again at submit time.
  static async getBackfillCandidates(
    admin: AdminUser,
    request: GetBackfillCandidatesRequest,
  ): Promise<Pageable<StudentResponse>> {
    const getRequest = Validation.validate(
      StudentValidation.GET_BACKFILL_CANDIDATES,
      request,
    );

    const [targetYear, targetGrade] = await Promise.all([
      prismaClient.academicYear.findUnique({
        where: { id: getRequest.academic_year_id },
      }),
      prismaClient.grade.findUnique({
        where: { id: getRequest.grade_id },
      }),
    ]);
    if (!targetYear) {
      throw new ResponseError(400, "Invalid academic year");
    }
    if (!targetGrade) {
      throw new ResponseError(400, "Invalid grade");
    }

    const studentFilters: Prisma.StudentWhereInput = {
      deleted_at: null,
      join_academic_year_id: targetYear.id,
      join_grade_id: targetGrade.id,
      enrollments: { none: { deleted_at: null } },
    };
    if (admin.role !== AdminRole.SUPER_ADMIN && !admin.can_view_all_units) {
      studentFilters.current_grade = { unit_id: admin.unit_id };
    }

    const whereClause: Prisma.PersonWhereInput = {
      person_type: PersonType.STUDENT,
      student: studentFilters,
    };

    const skip = (getRequest.page - 1) * getRequest.size;

    return paginate(getRequest.page, getRequest.size, {
      count: () => prismaClient.person.count({ where: whereClause }),
      findMany: () =>
        prismaClient.person
          .findMany({
            where: whereClause,
            take: getRequest.size,
            skip,
            orderBy: { full_name: "asc" },
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
