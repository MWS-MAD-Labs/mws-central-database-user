import { ResponseError } from "../error/response-error";
import {
  AdminRole,
  AuditAction,
  AuditSource,
  EmployeeMutationField,
  EmployeeStatus,
  EmploymentType,
  PersonType,
  Prisma,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toBulkActionResponse,
  type BulkActionItemResponse,
  type BulkIdsRequest,
} from "../model/bulk-action-model";
import {
  toEmployeeAuditSnapshot,
  splitEmployeeDetailIdentity,
  toEmployeeDetailResponse,
  type EmployeeRevealedIdentity,
  type RedactedEmployeeDetailResponse,
  toEmployeeResponse,
  type BulkEmployeeResponse,
  type BulkExtendEmployeeContractRequest,
  type BulkUpdateEmployeeRequest,
  type CreateEmployeeRequest,
  type EmployeeDetailResponse,
  type EmployeeEducationSuggestionsResponse,
  type EmployeeResponse,
  type EmployeeSortField,
  type ExtendEmployeeContractRequest,
  type GetEmployeeRequest,
  type GetEmployeeVersionRequest,
  type RemoveEmployeeRequest,
  type RestoreEmployeeRequest,
  type SearchEmployeeRequest,
  type UnitConsistencyIssue,
  type UpdateEmployeeRequest,
} from "../model/employee-model";
import type { ResourceVersionResponse } from "../model/resource-version-model";
import { paginate, type Pageable } from "../model/page-model";
import { AuditService } from "./audit-service";
import { resolveEmployeePhotoUrl } from "./employee-photo-service";
import { CheckExist } from "../utils/check-exist";
import { withLookupCache } from "../lib/lookup-cache";
import { assertCanWriteNow } from "../utils/office-hours";
import { assertIdentifierFieldsEditable } from "../utils/identifier-lock";
import { isChangeRequestApprover } from "../utils/change-request-approver";
import {
  assertJobPositionJobLevelCompatibleByIds,
  assertContractEndDateAfterJoinDate,
  assertContractEndDatePresence,
  assertJobPositionUnitCompatible,
  assertJobPositionUnitCompatibleByIds,
  assertLastWorkingDateNotAfterContractEnd,
  assertUnitJobLevelCompatible,
  assertUnitJobLevelCompatibleByIds,
} from "../utils/employee-role-rules";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import { assertJobPositionCapacity } from "../utils/job-position-capacity";
import { lockJobPositionCapacityConfig } from "../utils/job-position-capacity";
import { assertAcademicUnitIds } from "../utils/academic-units";
import { maskSensitiveValue } from "../utils/sensitive-data";
import {
  assertCanViewEmployeeData,
  canViewEmployeeDisciplinaryData,
  resolveEmployeeUnitScope,
  type AdminUserWithEmployeeScope,
} from "../utils/admin-permissions";
import { EmployeeValidation } from "../validation/employee-validation";
import { Validation, yearsBetweenDates } from "../validation/validation";

function bulkFailureMessage(error: unknown): string {
  if (error instanceof ResponseError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

// Auto-resign only non-terminal employee statuses.
const STATUSES_ELIGIBLE_FOR_AUTO_RESIGN = new Set<EmployeeStatus>([
  EmployeeStatus.ACTIVE,
  EmployeeStatus.INACTIVE,
  EmployeeStatus.ON_LEAVE,
]);

// Allow 14 days to record a contract extension.
const CONTRACT_EXPIRY_GRACE_PERIOD_DAYS = 14;

// Past offboarding dates take effect immediately when saved.
function resolveStatusForOffboarding(
  status: EmployeeStatus,
  lastWorkingDate: Date | null,
  contractEndDate: Date | null,
  now: Date,
): EmployeeStatus {
  if (!STATUSES_ELIGIBLE_FOR_AUTO_RESIGN.has(status)) return status;
  if (lastWorkingDate && lastWorkingDate <= now) {
    return EmployeeStatus.RESIGNED;
  }
  if (contractEndDate && contractEndDate <= now) {
    return EmployeeStatus.RESIGNED;
  }
  return status;
}

// Keep education values free-text while seeding suggestions.
async function ensureMasterEducationEntries(
  institutionName?: string,
  major?: string,
): Promise<void> {
  await Promise.all([
    institutionName
      ? prismaClient.masterInstitution.upsert({
          where: { name: institutionName },
          create: { name: institutionName },
          update: {},
        })
      : Promise.resolve(undefined),
    major
      ? prismaClient.masterMajor.upsert({
          where: { name: major },
          create: { name: major },
          update: {},
        })
      : Promise.resolve(undefined),
  ]);
}

const MIN_EMPLOYEE_AGE_YEARS = 18;

function assertMinAgeAtJoin(birthDateIso: string, joinDateIso: string): void {
  if (yearsBetweenDates(birthDateIso, joinDateIso) < MIN_EMPLOYEE_AGE_YEARS) {
    throw new ResponseError(
      400,
      `Employee must be at least ${MIN_EMPLOYEE_AGE_YEARS} years old on their join date`,
    );
  }
}

// End active teaching, support, and mentor assignments before role changes or archive.
async function assertNoActiveTeacherAssignmentsBlockingRoleChange(
  employeeId: string,
  changedFields: string[],
): Promise<void> {
  if (changedFields.length === 0) return;

  const [
    activeAssignmentCount,
    activeSupportAssignmentCount,
    activeMentorAssignmentCount,
  ] = await Promise.all([
    prismaClient.classTeacherAssignment.count({
      where: { employee_id: employeeId, end_date: null, deleted_at: null },
    }),
    prismaClient.studentSupportAssignment.count({
      where: { employee_id: employeeId, end_date: null, deleted_at: null },
    }),
    // Active room mentorships represent current PC assignments.
    prismaClient.pcActivityRoomMentorAssignment.count({
      where: {
        employee_id: employeeId,
        status: { in: ["ACTIVE", "SCHEDULED"] },
        deleted_at: null,
      },
    }),
  ]);
  if (activeAssignmentCount > 0) {
    throw new ResponseError(
      400,
      `Cannot change ${changedFields.join("/")}: this employee has ${activeAssignmentCount} active teacher assignment(s). End those assignments in the class first.`,
    );
  }
  if (activeSupportAssignmentCount > 0) {
    throw new ResponseError(
      400,
      `Cannot change ${changedFields.join("/")}: this employee has ${activeSupportAssignmentCount} active student support assignment(s). End or drop those assignments first.`,
    );
  }
  if (activeMentorAssignmentCount > 0) {
    throw new ResponseError(
      400,
      `Cannot change ${changedFields.join("/")}: this employee is an active mentor on ${activeMentorAssignmentCount} PC activity room(s). End or remove those assignments first.`,
    );
  }
}

async function assertNoActiveAssignmentsBlockingArchive(
  employeeId: string,
): Promise<void> {
  const [activeTeacherAssignmentCount, activeSupportAssignmentCount, activeMentorAssignmentCount] =
    await Promise.all([
      prismaClient.classTeacherAssignment.count({
        where: { employee_id: employeeId, end_date: null, deleted_at: null },
      }),
      prismaClient.studentSupportAssignment.count({
        where: { employee_id: employeeId, end_date: null, deleted_at: null },
      }),
      prismaClient.pcActivityRoomMentorAssignment.count({
        where: {
          employee_id: employeeId,
          status: { in: ["ACTIVE", "SCHEDULED"] },
          deleted_at: null,
        },
      }),
    ]);

  const assignments: string[] = [];
  if (activeTeacherAssignmentCount > 0) {
    assignments.push(
      `${activeTeacherAssignmentCount} active teacher assignment${activeTeacherAssignmentCount === 1 ? "" : "s"}`,
    );
  }
  if (activeSupportAssignmentCount > 0) {
    assignments.push(
      `${activeSupportAssignmentCount} active student support assignment${activeSupportAssignmentCount === 1 ? "" : "s"}`,
    );
  }
  if (activeMentorAssignmentCount > 0) {
    assignments.push(
      `${activeMentorAssignmentCount} active PC activity mentor assignment${activeMentorAssignmentCount === 1 ? "" : "s"}`,
    );
  }

  if (assignments.length > 0) {
    throw new ResponseError(
      400,
      `${assignments.join(" and ")} remain. End or remove them first.`,
    );
  }
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

// SP outranks ST; higher levels win within the same type.
function isMoreSevere(
  candidate: { type: string; level: number },
  existing: { type: string; level: number },
): boolean {
  const candidateRank = candidate.type === "SURAT_PERINGATAN" ? 1 : 0;
  const existingRank = existing.type === "SURAT_PERINGATAN" ? 1 : 0;
  if (candidateRank !== existingRank) return candidateRank > existingRank;
  return candidate.level > existing.level;
}

const PERSON_SORT_FIELDS = new Set<EmployeeSortField>([
  "created_at",
  "full_name",
  "nick_name",
  "email",
]);

async function recordUnauthorizedEmployeeAction(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
  employeeId?: string,
): Promise<void> {
  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    entity_type: "Employee",
    entity_id: employeeId,
    new_values: {
      reason: `blocked employee ${action}`,
      ...(employeeId ? { employee_id: employeeId } : {}),
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

// Shared labels for identity uniqueness errors.
const IDENTITY_FIELD_LABELS: Record<string, string> = {
  nik: "NIK",
  npwp: "NPWP",
  bank_account_number: "Bank account number",
  bpjs_number: "BPJS Kesehatan number",
  bpjs_employment_number: "BPJS Ketenagakerjaan number",
  kpj_number: "KPJ number",
};

// Optional identifiers require employee PII permission to write.
async function assertCanWriteEmployeePii(
  admin: AdminUser,
  fields: Partial<Record<keyof typeof IDENTITY_FIELD_LABELS, unknown>>,
  context: AuditRequestContext,
): Promise<void> {
  if (admin.role === AdminRole.SUPER_ADMIN || admin.can_view_employee_pii) {
    return;
  }

  const attemptedField = Object.keys(IDENTITY_FIELD_LABELS).find(
    (field) => fields[field] !== undefined,
  );
  if (!attemptedField) return;

  await recordUnauthorizedEmployeeAction(admin, "set employee PII", context);
  throw new ResponseError(
    403,
    "Forbidden: You don't have permission to set employee PII (NIK/NPWP/bank account/BPJS)",
  );
}

function rethrowAsFriendlyEmployeeConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("email")) {
    throw new ResponseError(400, "Email already registered");
  }
  if (fields?.includes("employee_id")) {
    throw new ResponseError(400, "Employee ID already registered");
  }
  for (const field of fields ?? []) {
    if (IDENTITY_FIELD_LABELS[field]) {
      throw new ResponseError(
        400,
        `${IDENTITY_FIELD_LABELS[field]} already registered to another employee`,
      );
    }
  }
  throw error;
}

function rethrowAsFriendlyEmployeeUpdateConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("email")) {
    throw new ResponseError(400, "Email already registered to another person");
  }
  if (fields?.includes("employee_id")) {
    throw new ResponseError(400, "Employee ID already registered");
  }
  for (const field of fields ?? []) {
    if (IDENTITY_FIELD_LABELS[field]) {
      throw new ResponseError(
        400,
        `${IDENTITY_FIELD_LABELS[field]} already registered to another employee`,
      );
    }
  }
  throw error;
}

// Precheck names the owner; the database constraint handles races.
async function assertEmployeeIdentityFieldsUnique(
  values: {
    nik?: string;
    npwp?: string;
    bank_account_number?: string;
    bpjs_number?: string;
    bpjs_employment_number?: string;
    kpj_number?: string;
  },
  excludeEmployeeId?: string,
): Promise<void> {
  for (const field of Object.keys(IDENTITY_FIELD_LABELS) as Array<
    keyof typeof values
  >) {
    const value = values[field];
    if (!value) continue;

    const owner = await prismaClient.employee.findFirst({
      where: {
        [field]: value,
        ...(excludeEmployeeId ? { id: { not: excludeEmployeeId } } : {}),
      },
      include: { person: true },
    });
    if (owner) {
      throw new ResponseError(
        400,
        `${IDENTITY_FIELD_LABELS[field]} is already registered to another employee: ${owner.person.full_name} (${owner.employee_id})`,
      );
    }
  }
}

export function buildEmployeeOrderBy(
  sortBy: EmployeeSortField,
  sortOrder: "asc" | "desc",
): Prisma.PersonOrderByWithRelationInput {
  if (PERSON_SORT_FIELDS.has(sortBy)) {
    return { [sortBy]: sortOrder };
  }
  return { employee: { [sortBy]: sortOrder } };
}

// Share filters with export.
export function buildEmployeeSearchWhere(
  admin: AdminUserWithEmployeeScope,
  searchRequest: Omit<SearchEmployeeRequest, "page" | "size">,
): Prisma.PersonWhereInput {
  const andFilters: Prisma.PersonWhereInput[] = [];

  const employeeUnitScope = resolveEmployeeUnitScope(admin);
  // Unrestricted: honor whatever unit_id was requested (or none). Restricted:
  // a requested unit still narrows further as long as it's in scope,
  // otherwise fall back to the full scope rather than erroring.
  const unitIdFilter: string | { in: string[] } | undefined =
    employeeUnitScope === undefined
      ? searchRequest.unit_id
      : searchRequest.unit_id && employeeUnitScope.includes(searchRequest.unit_id)
        ? searchRequest.unit_id
        : { in: employeeUnitScope };

  if (searchRequest.search) {
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
          employee: {
            employee_id: {
              contains: searchRequest.search,
              mode: "insensitive",
            },
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

  const employeeFilters: Prisma.EmployeeWhereInput = {};

  if (unitIdFilter) employeeFilters.unit_id = unitIdFilter;
  // Ignore status when querying archived employees.
  if (searchRequest.status && !searchRequest.is_deleted) {
    employeeFilters.status = searchRequest.status;
  }
  if (searchRequest.employment_type) {
    employeeFilters.employment_type = searchRequest.employment_type;
  }
  if (searchRequest.job_level_id)
    employeeFilters.job_level_id = searchRequest.job_level_id;
  if (searchRequest.job_position_id)
    employeeFilters.job_position_id = searchRequest.job_position_id;
  if (searchRequest.building_id)
    employeeFilters.building_id = searchRequest.building_id;
  if (searchRequest.join_date_start || searchRequest.join_date_end) {
    employeeFilters.join_date = {};
    if (searchRequest.join_date_start) {
      employeeFilters.join_date.gte = new Date(searchRequest.join_date_start);
    }
    if (searchRequest.join_date_end) {
      employeeFilters.join_date.lte = new Date(searchRequest.join_date_end);
    }
  }

  employeeFilters.deleted_at = searchRequest.is_deleted ? { not: null } : null;

  if (Object.keys(employeeFilters).length > 0) {
    andFilters.push({ employee: employeeFilters });
  }

  return {
    person_type: PersonType.EMPLOYEE,
    AND: andFilters,
  };
}

type MutationFieldValue =
  | { field: "UNIT"; unit_id: string }
  | { field: "JOB_POSITION"; job_position_id: string }
  | { field: "JOB_LEVEL"; job_level_id: string }
  | { field: "BUILDING"; building_id: string }
  | { field: "STATUS"; status: EmployeeStatus }
  | { field: "EMPLOYMENT_TYPE"; employment_type: EmploymentType };

// Close the current field history and link the replacement.
// priorLiveValue seeds history for legacy rows.
async function recordEmployeeMutation(
  tx: Prisma.TransactionClient,
  employeeId: string,
  value: MutationFieldValue,
  startDate: Date,
  priorLiveValue?: { value: MutationFieldValue; since: Date },
): Promise<void> {
  const previous = await tx.employeeMutationHistory.findFirst({
    where: {
      employee_id: employeeId,
      field: value.field as EmployeeMutationField,
      end_date: null,
      deleted_at: null,
    },
  });

  if (previous && startDate < previous.start_date) {
    throw new ResponseError(
      400,
      `Effective date cannot be before this employee's current ${value.field.toLowerCase().replace("_", " ")} record started (${previous.start_date.toISOString().slice(0, 10)})`,
    );
  }

  let previousHistoryId = previous?.id ?? null;

  if (previous) {
    await tx.employeeMutationHistory.update({
      where: { id: previous.id },
      data: { end_date: startDate },
    });
  } else if (priorLiveValue && priorLiveValue.since < startDate) {
    const genesis = await tx.employeeMutationHistory.create({
      data: {
        employee_id: employeeId,
        start_date: priorLiveValue.since,
        end_date: startDate,
        previous_history_id: null,
        ...priorLiveValue.value,
      },
    });
    previousHistoryId = genesis.id;
  }

  await tx.employeeMutationHistory.create({
    data: {
      employee_id: employeeId,
      start_date: startDate,
      previous_history_id: previousHistoryId,
      ...value,
    },
  });
}

export class EmployeeService {
  static async create(
    admin: AdminUser,
    request: CreateEmployeeRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<EmployeeResponse> {
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedEmployeeAction(admin, "create", context);
      throw new ResponseError(403, "Forbidden: Viewer cannot create data");
    }

    if (admin.role === AdminRole.DATABASE_ADMIN) {
      if (!admin.can_write_employee_data) {
        await recordUnauthorizedEmployeeAction(admin, "create", context);
        throw new ResponseError(
          403,
          "Forbidden: You don't have permission to write employee data",
        );
      }

      await assertCanWriteNow(admin, context, now);

      if (admin.unit_id !== request.unit_id) {
        await recordUnauthorizedEmployeeAction(admin, "create", context);
        throw new ResponseError(
          403,
          "Forbidden: You can only create employees within your unit scope",
        );
      }
    }

    const createRequest = Validation.validate(
      EmployeeValidation.CREATE,
      request,
    );
    await assertCanWriteEmployeePii(admin, createRequest, context);

    const existingUser = await prismaClient.person.findFirst({
      where: {
        OR: [
          { email: createRequest.email },
          { employee: { employee_id: createRequest.employee_id } },
        ],
      },
      include: { employee: true },
    });

    if (existingUser) {
      if (existingUser.email === createRequest.email) {
        throw new ResponseError(400, "Email already registered");
      }
      if (existingUser.employee?.employee_id === createRequest.employee_id) {
        throw new ResponseError(400, "Employee ID already registered");
      }
    }

    assertContractEndDatePresence(
      createRequest.employment_type,
      Boolean(createRequest.contract_end_date),
    );

    assertLastWorkingDateNotAfterContractEnd(
      createRequest.last_working_date
        ? new Date(createRequest.last_working_date)
        : null,
      createRequest.contract_end_date
        ? new Date(createRequest.contract_end_date)
        : null,
    );
    assertContractEndDateAfterJoinDate(
      new Date(createRequest.join_date),
      createRequest.contract_end_date
        ? new Date(createRequest.contract_end_date)
        : null,
    );
    assertMinAgeAtJoin(createRequest.birth_date, createRequest.join_date);

    await assertUnitJobLevelCompatibleByIds(
      createRequest.unit_id,
      createRequest.job_level_id,
    );
    await assertJobPositionJobLevelCompatibleByIds(
      createRequest.job_position_id,
      createRequest.job_level_id,
    );
    await assertJobPositionUnitCompatibleByIds(
      createRequest.job_position_id,
      createRequest.unit_id,
    );

    await assertEmployeeIdentityFieldsUnique({
      nik: createRequest.nik,
      npwp: createRequest.npwp,
      bank_account_number: createRequest.bank_account_number,
      bpjs_number: createRequest.bpjs_number,
      bpjs_employment_number: createRequest.bpjs_employment_number,
      kpj_number: createRequest.kpj_number,
    });

    const resolvedStatus = resolveStatusForOffboarding(
      createRequest.status,
      createRequest.last_working_date
        ? new Date(createRequest.last_working_date)
        : null,
      createRequest.contract_end_date
        ? new Date(createRequest.contract_end_date)
        : null,
      now,
    );

    let createdPersonId: string;
    try {
      createdPersonId = await prismaClient.$transaction(async (tx) => {
        await lockJobPositionCapacityConfig(tx, createRequest.job_position_id);
        await assertJobPositionUnitCompatibleByIds(
          createRequest.job_position_id,
          createRequest.unit_id,
          tx,
        );
        await assertJobPositionCapacity(tx, {
          jobPositionId: createRequest.job_position_id,
          unitId: createRequest.unit_id,
          occupiesSlot:
            resolvedStatus === EmployeeStatus.ACTIVE ||
            resolvedStatus === EmployeeStatus.ON_LEAVE,
        });
        const newPerson = await tx.person.create({
          data: {
            full_name: createRequest.full_name,
            nick_name: createRequest.nick_name,
            email: createRequest.email,
            person_type: PersonType.EMPLOYEE,
            gender: createRequest.gender,
            religion: createRequest.religion,
            religion_other: createRequest.religion_other,
            birth_place: createRequest.birth_place,
            birth_date: new Date(createRequest.birth_date),
            photo_url: createRequest.photo_url,
            employee: {
              create: {
                employee_id: createRequest.employee_id,
                status: resolvedStatus,
                employment_type: createRequest.employment_type,
                unit_id: createRequest.unit_id,
                job_position_id: createRequest.job_position_id,
                job_level_id: createRequest.job_level_id,
                building_id: createRequest.building_id,
                join_date: new Date(createRequest.join_date),
                contract_end_date: createRequest.contract_end_date
                  ? new Date(createRequest.contract_end_date)
                  : undefined,
                last_working_date: createRequest.last_working_date
                  ? new Date(createRequest.last_working_date)
                  : undefined,
                notes: createRequest.notes,
                is_pc_mentor_eligible: createRequest.is_pc_mentor_eligible ?? false,
                marital_status: createRequest.marital_status,
                mobile_phone: createRequest.mobile_phone,
                residential_address: createRequest.residential_address,
                nik: createRequest.nik,
                npwp: createRequest.npwp,
                bank_account_number: createRequest.bank_account_number,
                bpjs_number: createRequest.bpjs_number,
                bpjs_employment_number: createRequest.bpjs_employment_number,
                kpj_number: createRequest.kpj_number,
                nik_set_at: createRequest.nik ? now : undefined,
                npwp_set_at: createRequest.npwp ? now : undefined,
                bank_account_number_set_at: createRequest.bank_account_number
                  ? now
                  : undefined,
                bpjs_number_set_at: createRequest.bpjs_number
                  ? now
                  : undefined,
                bpjs_employment_number_set_at:
                  createRequest.bpjs_employment_number ? now : undefined,
                kpj_number_set_at: createRequest.kpj_number ? now : undefined,
                education_level: createRequest.education_level,
                institution_name: createRequest.institution_name,
                major: createRequest.major,
                graduation_year: createRequest.graduation_year,
              },
            },
          },
        });

        // flat include only - a nested include here races on the tx's single
        // pg connection, and the audit snapshot only needs raw employee fields
        const personForAudit = await tx.person.findUnique({
          where: { id: newPerson.id },
          include: { employee: true },
        });

        if (!personForAudit || !personForAudit.employee) {
          throw new ResponseError(
            500,
            "Internal Server Error: Failed to retrieve created employee data",
          );
        }

        await AuditService.record(
          {
            action: AuditAction.CREATE_EMPLOYEE,
            source: AuditSource.UI,
            entity_type: "Employee",
            entity_id: personForAudit.employee.id,
            admin_id: admin.id,
            new_values: toEmployeeAuditSnapshot(
              personForAudit,
              personForAudit.employee,
            ),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        const joinDate = new Date(createRequest.join_date);
        await recordEmployeeMutation(
          tx,
          personForAudit.employee.id,
          { field: "UNIT", unit_id: createRequest.unit_id },
          joinDate,
        );
        await recordEmployeeMutation(
          tx,
          personForAudit.employee.id,
          { field: "JOB_POSITION", job_position_id: createRequest.job_position_id },
          joinDate,
        );
        await recordEmployeeMutation(
          tx,
          personForAudit.employee.id,
          { field: "JOB_LEVEL", job_level_id: createRequest.job_level_id },
          joinDate,
        );
        await recordEmployeeMutation(
          tx,
          personForAudit.employee.id,
          { field: "BUILDING", building_id: createRequest.building_id },
          joinDate,
        );
        await recordEmployeeMutation(
          tx,
          personForAudit.employee.id,
          { field: "STATUS", status: resolvedStatus },
          joinDate,
        );
        await recordEmployeeMutation(
          tx,
          personForAudit.employee.id,
          {
            field: "EMPLOYMENT_TYPE",
            employment_type: createRequest.employment_type,
          },
          joinDate,
        );

        if (createRequest.pc_mentor_unit_ids?.length) {
          await assertAcademicUnitIds(
            tx,
            createRequest.pc_mentor_unit_ids,
            "PC mentor units must be academic units (units that have grades)",
          );
          await tx.employeePcMentorUnit.createMany({
            data: createRequest.pc_mentor_unit_ids.map((unitId) => ({
              employee_id: personForAudit.employee!.id,
              unit_id: unitId,
            })),
          });
        }

        return newPerson.id;
      });
    } catch (error) {
      rethrowAsFriendlyEmployeeConflict(error);
    }

    const personWithRelations = await prismaClient.person.findUnique({
      where: {
        id: createdPersonId,
      },
      include: {
        employee: {
          include: {
            unit: true,
            job_position: true,
            job_level: true,
            building: true,
            pc_mentor_units: { include: { unit: true } },
          },
        },
      },
    });

    if (!personWithRelations || !personWithRelations.employee) {
      throw new ResponseError(
        500,
        "Internal Server Error: Failed to retrieve created employee data",
      );
    }

    await ensureMasterEducationEntries(
      createRequest.institution_name,
      createRequest.major,
    );

    return toEmployeeResponse(personWithRelations, admin);
  }
  static async update(
    admin: AdminUser,
    request: UpdateEmployeeRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
    // Set only by an approved IdentifierChangeRequest to apply its one
    // field past the grace period (identifier-change-request-service.ts).
    bypassIdentifierLock = false,
  ): Promise<EmployeeResponse> {
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedEmployeeAction(
        admin,
        "update",
        context,
        request.id,
      );
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }
    // An identifier-change approver edits a locked field directly - no
    // point routing them through the request/approval flow when they
    // could only ever decide someone else's request, not their own edit.
    bypassIdentifierLock = bypassIdentifierLock || isChangeRequestApprover(admin);

    const updateRequest = Validation.validate(
      EmployeeValidation.UPDATE,
      request,
    );
    await assertCanWriteEmployeePii(admin, updateRequest, context);

    const existingEmployee = await CheckExist.checkEmployeeExists(
      updateRequest.id,
    );
    const oldSnapshot = toEmployeeAuditSnapshot(
      existingEmployee.person,
      existingEmployee,
    );

    if (admin.role === AdminRole.DATABASE_ADMIN) {
      if (!admin.can_write_employee_data) {
        await recordUnauthorizedEmployeeAction(
          admin,
          "update",
          context,
          request.id,
        );
        throw new ResponseError(
          403,
          "Forbidden: You don't have permission to write employee data",
        );
      }

      await assertCanWriteNow(admin, context, now);

      if (existingEmployee.unit_id !== admin.unit_id) {
        await recordUnauthorizedEmployeeAction(
          admin,
          "update",
          context,
          request.id,
        );
        throw new ResponseError(
          403,
          "Forbidden: This employee is outside your unit scope",
        );
      }

      if (updateRequest.unit_id && updateRequest.unit_id !== admin.unit_id) {
        await recordUnauthorizedEmployeeAction(
          admin,
          "update",
          context,
          request.id,
        );
        throw new ResponseError(
          403,
          "Forbidden: You cannot transfer an employee to a different unit",
        );
      }
    }

    const nextStatus = updateRequest.status ?? existingEmployee.status;
    const nextLastWorkingDate =
      updateRequest.last_working_date !== undefined
        ? updateRequest.last_working_date
        : existingEmployee.last_working_date;

    if (nextStatus === EmployeeStatus.RESIGNED && !nextLastWorkingDate) {
      throw new ResponseError(
        400,
        "Last working date is required when status is RESIGNED",
      );
    }

    const nextEmploymentType =
      updateRequest.employment_type ?? existingEmployee.employment_type;
    const nextContractEndDate =
      updateRequest.contract_end_date !== undefined
        ? updateRequest.contract_end_date
        : existingEmployee.contract_end_date;

    const resolvedStatus = resolveStatusForOffboarding(
      nextStatus,
      nextLastWorkingDate ? new Date(nextLastWorkingDate) : null,
      nextContractEndDate ? new Date(nextContractEndDate) : null,
      now,
    );

    assertContractEndDatePresence(
      nextEmploymentType,
      Boolean(nextContractEndDate),
    );

    assertLastWorkingDateNotAfterContractEnd(
      nextLastWorkingDate ? new Date(nextLastWorkingDate) : null,
      nextContractEndDate ? new Date(nextContractEndDate) : null,
    );

    const nextJoinDate = updateRequest.join_date
      ? new Date(updateRequest.join_date)
      : existingEmployee.join_date;
    assertContractEndDateAfterJoinDate(
      nextJoinDate,
      nextContractEndDate ? new Date(nextContractEndDate) : null,
    );
    if (updateRequest.birth_date || updateRequest.join_date) {
      const nextBirthDateIso =
        updateRequest.birth_date ??
        existingEmployee.person.birth_date.toISOString();
      assertMinAgeAtJoin(nextBirthDateIso, nextJoinDate.toISOString());
    }

    // Mutation effective dates may be backdated, but never future-dated.
    const mutationEffectiveDate = updateRequest.effective_date
      ? new Date(updateRequest.effective_date)
      : now;
    if (mutationEffectiveDate > now) {
      throw new ResponseError(
        400,
        "Effective date cannot be in the future",
      );
    }

    const emailChanged =
      updateRequest.email &&
      updateRequest.email !== existingEmployee.person.email;
    const empIdChanged =
      updateRequest.employee_id &&
      updateRequest.employee_id !== existingEmployee.employee_id;

    if (emailChanged || empIdChanged) {
      const conditions: Array<{
        email?: string;
        employee?: { employee_id: string };
      }> = [];

      if (emailChanged) {
        conditions.push({ email: updateRequest.email });
      }
      if (empIdChanged) {
        conditions.push({
          employee: { employee_id: updateRequest.employee_id as string },
        });
      }

      const duplicateCheck = await prismaClient.person.findFirst({
        where: { OR: conditions },
        include: { employee: true },
      });

      if (duplicateCheck) {
        if (emailChanged && duplicateCheck.email === updateRequest.email) {
          throw new ResponseError(
            400,
            "Email already registered to another person",
          );
        }
        if (
          empIdChanged &&
          duplicateCheck.employee?.employee_id === updateRequest.employee_id
        ) {
          throw new ResponseError(400, "Employee ID already registered");
        }
      }
    }

    const nikChanged =
      updateRequest.nik &&
      existingEmployee.nik !== null &&
      updateRequest.nik !== existingEmployee.nik;
    const npwpChanged =
      updateRequest.npwp &&
      existingEmployee.npwp !== null &&
      updateRequest.npwp !== existingEmployee.npwp;
    const bpjsChanged =
      updateRequest.bpjs_number &&
      existingEmployee.bpjs_number !== null &&
      updateRequest.bpjs_number !== existingEmployee.bpjs_number;
    const bankAccountChanged =
      updateRequest.bank_account_number &&
      existingEmployee.bank_account_number !== null &&
      updateRequest.bank_account_number !==
        existingEmployee.bank_account_number;
    const bpjsEmploymentChanged =
      updateRequest.bpjs_employment_number &&
      existingEmployee.bpjs_employment_number !== null &&
      updateRequest.bpjs_employment_number !==
        existingEmployee.bpjs_employment_number;
    const kpjChanged =
      updateRequest.kpj_number &&
      existingEmployee.kpj_number !== null &&
      updateRequest.kpj_number !== existingEmployee.kpj_number;
    // Enforce each identifier's grace period from its own set timestamp.
    await assertIdentifierFieldsEditable(
      admin,
      existingEmployee.nik_set_at ?? existingEmployee.created_at,
      Boolean(nikChanged),
      "NIK",
      context,
      now,
      bypassIdentifierLock,
    );
    await assertIdentifierFieldsEditable(
      admin,
      existingEmployee.npwp_set_at ?? existingEmployee.created_at,
      Boolean(npwpChanged),
      "NPWP",
      context,
      now,
      bypassIdentifierLock,
    );
    await assertIdentifierFieldsEditable(
      admin,
      existingEmployee.bank_account_number_set_at ?? existingEmployee.created_at,
      Boolean(bankAccountChanged),
      "Bank account number",
      context,
      now,
      bypassIdentifierLock,
    );
    await assertIdentifierFieldsEditable(
      admin,
      existingEmployee.bpjs_number_set_at ?? existingEmployee.created_at,
      Boolean(bpjsChanged),
      "BPJS Kesehatan number",
      context,
      now,
      bypassIdentifierLock,
    );
    await assertIdentifierFieldsEditable(
      admin,
      existingEmployee.bpjs_employment_number_set_at ??
        existingEmployee.created_at,
      Boolean(bpjsEmploymentChanged),
      "BPJS Ketenagakerjaan number",
      context,
      now,
      bypassIdentifierLock,
    );
    await assertIdentifierFieldsEditable(
      admin,
      existingEmployee.kpj_number_set_at ?? existingEmployee.created_at,
      Boolean(kpjChanged),
      "KPJ number",
      context,
      now,
      bypassIdentifierLock,
    );

    // First-time values also start their own grace window.
    const nikValueChanged =
      Boolean(updateRequest.nik) && updateRequest.nik !== existingEmployee.nik;
    const npwpValueChanged =
      Boolean(updateRequest.npwp) &&
      updateRequest.npwp !== existingEmployee.npwp;
    const bankAccountValueChanged =
      Boolean(updateRequest.bank_account_number) &&
      updateRequest.bank_account_number !==
        existingEmployee.bank_account_number;
    const bpjsValueChanged =
      Boolean(updateRequest.bpjs_number) &&
      updateRequest.bpjs_number !== existingEmployee.bpjs_number;
    const bpjsEmploymentValueChanged =
      Boolean(updateRequest.bpjs_employment_number) &&
      updateRequest.bpjs_employment_number !==
        existingEmployee.bpjs_employment_number;
    const kpjValueChanged =
      Boolean(updateRequest.kpj_number) &&
      updateRequest.kpj_number !== existingEmployee.kpj_number;

    await assertEmployeeIdentityFieldsUnique(
      {
        nik: updateRequest.nik,
        npwp: updateRequest.npwp,
        bank_account_number: updateRequest.bank_account_number,
        bpjs_number: updateRequest.bpjs_number,
        bpjs_employment_number: updateRequest.bpjs_employment_number,
        kpj_number: updateRequest.kpj_number,
      },
      existingEmployee.id,
    );

    if (
      updateRequest.unit_id !== undefined ||
      updateRequest.job_level_id !== undefined
    ) {
      await assertUnitJobLevelCompatibleByIds(
        updateRequest.unit_id ?? existingEmployee.unit_id,
        updateRequest.job_level_id ?? existingEmployee.job_level_id,
      );
    }

    if (
      updateRequest.job_position_id !== undefined ||
      updateRequest.job_level_id !== undefined
    ) {
      await assertJobPositionJobLevelCompatibleByIds(
        updateRequest.job_position_id ?? existingEmployee.job_position_id,
        updateRequest.job_level_id ?? existingEmployee.job_level_id,
      );
    }

    if (
      updateRequest.job_position_id !== undefined ||
      updateRequest.unit_id !== undefined
    ) {
      await assertJobPositionUnitCompatibleByIds(
        updateRequest.job_position_id ?? existingEmployee.job_position_id,
        updateRequest.unit_id ?? existingEmployee.unit_id,
      );
    }

    const changedRoleFields: string[] = [];
    if (
      updateRequest.unit_id !== undefined &&
      updateRequest.unit_id !== existingEmployee.unit_id
    ) {
      changedRoleFields.push("unit");
    }
    if (
      updateRequest.job_position_id !== undefined &&
      updateRequest.job_position_id !== existingEmployee.job_position_id
    ) {
      changedRoleFields.push("job position");
    }
    if (
      updateRequest.job_level_id !== undefined &&
      updateRequest.job_level_id !== existingEmployee.job_level_id
    ) {
      changedRoleFields.push("job level");
    }
    await assertNoActiveTeacherAssignmentsBlockingRoleChange(
      existingEmployee.id,
      changedRoleFields,
    );

    try {
      await prismaClient.$transaction(async (tx) => {
        const nextJobPositionId =
          updateRequest.job_position_id ?? existingEmployee.job_position_id;
        const nextUnitId = updateRequest.unit_id ?? existingEmployee.unit_id;
        await lockJobPositionCapacityConfig(tx, nextJobPositionId);
        await assertJobPositionUnitCompatibleByIds(
          nextJobPositionId,
          nextUnitId,
          tx,
        );
        await assertJobPositionCapacity(tx, {
          jobPositionId: nextJobPositionId,
          unitId: nextUnitId,
          employeeId: existingEmployee.id,
          occupiesSlot:
            resolvedStatus === EmployeeStatus.ACTIVE ||
            resolvedStatus === EmployeeStatus.ON_LEAVE,
        });
        await tx.person.update({
          where: {
            id: existingEmployee.person_id,
          },
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

            employee: {
              update: {
                employee_id: updateRequest.employee_id,
                employment_type: updateRequest.employment_type,
                status: resolvedStatus,
                unit_id: updateRequest.unit_id,
                job_position_id: updateRequest.job_position_id,
                job_level_id: updateRequest.job_level_id,
                building_id: updateRequest.building_id,
                join_date: updateRequest.join_date
                  ? new Date(updateRequest.join_date)
                  : undefined,
                contract_end_date:
                  updateRequest.contract_end_date === null
                    ? null
                    : updateRequest.contract_end_date
                      ? new Date(updateRequest.contract_end_date)
                      : undefined,
                last_working_date: updateRequest.last_working_date
                  ? new Date(updateRequest.last_working_date)
                  : undefined,
                notes: updateRequest.notes,
                is_pc_mentor_eligible: updateRequest.is_pc_mentor_eligible,
                marital_status: updateRequest.marital_status,
                mobile_phone: updateRequest.mobile_phone,
                residential_address: updateRequest.residential_address,
                nik: updateRequest.nik,
                npwp: updateRequest.npwp,
                bank_account_number: updateRequest.bank_account_number,
                bpjs_number: updateRequest.bpjs_number,
                bpjs_employment_number: updateRequest.bpjs_employment_number,
                kpj_number: updateRequest.kpj_number,
                // An approved change request keeps the field locked instead of opening a new grace window.
                nik_set_at: nikValueChanged && !bypassIdentifierLock ? now : undefined,
                npwp_set_at: npwpValueChanged && !bypassIdentifierLock ? now : undefined,
                bank_account_number_set_at:
                  bankAccountValueChanged && !bypassIdentifierLock ? now : undefined,
                bpjs_number_set_at: bpjsValueChanged && !bypassIdentifierLock ? now : undefined,
                bpjs_employment_number_set_at:
                  bpjsEmploymentValueChanged && !bypassIdentifierLock ? now : undefined,
                kpj_number_set_at: kpjValueChanged && !bypassIdentifierLock ? now : undefined,
                education_level: updateRequest.education_level,
                institution_name: updateRequest.institution_name,
                major: updateRequest.major,
                graduation_year: updateRequest.graduation_year,
              },
            },
          },
        });

        // Nested includes can race on the transaction's single connection.
        const fetched = await tx.person.findUnique({
          where: {
            id: existingEmployee.person_id,
          },
          include: { employee: true },
        });

        if (!fetched || !fetched.employee) {
          throw new ResponseError(
            500,
            "Internal Server Error: Failed to retrieve updated employee data",
          );
        }

        if (updateRequest.pc_mentor_unit_ids !== undefined) {
          await assertAcademicUnitIds(
            tx,
            updateRequest.pc_mentor_unit_ids,
            "PC mentor units must be academic units (units that have grades)",
          );
          await tx.employeePcMentorUnit.deleteMany({
            where: { employee_id: fetched.employee.id },
          });
          if (updateRequest.pc_mentor_unit_ids.length > 0) {
            await tx.employeePcMentorUnit.createMany({
              data: updateRequest.pc_mentor_unit_ids.map((unitId) => ({
                employee_id: fetched.employee!.id,
                unit_id: unitId,
              })),
            });
          }
        }

        await AuditService.record(
          {
            action: AuditAction.UPDATE_EMPLOYEE,
            source: AuditSource.UI,
            entity_type: "Employee",
            entity_id: existingEmployee.id,
            admin_id: admin.id,
            old_values: oldSnapshot,
            new_values: toEmployeeAuditSnapshot(fetched, fetched.employee),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        if (fetched.employee.unit_id !== existingEmployee.unit_id) {
          await recordEmployeeMutation(
            tx,
            existingEmployee.id,
            { field: "UNIT", unit_id: fetched.employee.unit_id },
            mutationEffectiveDate,
            {
              value: { field: "UNIT", unit_id: existingEmployee.unit_id },
              since: existingEmployee.join_date,
            },
          );
        }
        if (
          fetched.employee.job_position_id !== existingEmployee.job_position_id
        ) {
          await recordEmployeeMutation(
            tx,
            existingEmployee.id,
            {
              field: "JOB_POSITION",
              job_position_id: fetched.employee.job_position_id,
            },
            mutationEffectiveDate,
            {
              value: {
                field: "JOB_POSITION",
                job_position_id: existingEmployee.job_position_id,
              },
              since: existingEmployee.join_date,
            },
          );
        }
        if (fetched.employee.job_level_id !== existingEmployee.job_level_id) {
          await recordEmployeeMutation(
            tx,
            existingEmployee.id,
            { field: "JOB_LEVEL", job_level_id: fetched.employee.job_level_id },
            mutationEffectiveDate,
            {
              value: {
                field: "JOB_LEVEL",
                job_level_id: existingEmployee.job_level_id,
              },
              since: existingEmployee.join_date,
            },
          );
        }
        if (fetched.employee.building_id !== existingEmployee.building_id) {
          await recordEmployeeMutation(
            tx,
            existingEmployee.id,
            { field: "BUILDING", building_id: fetched.employee.building_id },
            mutationEffectiveDate,
            {
              value: {
                field: "BUILDING",
                building_id: existingEmployee.building_id,
              },
              since: existingEmployee.join_date,
            },
          );
        }
        if (fetched.employee.status !== existingEmployee.status) {
          await recordEmployeeMutation(
            tx,
            existingEmployee.id,
            { field: "STATUS", status: fetched.employee.status },
            mutationEffectiveDate,
            {
              value: { field: "STATUS", status: existingEmployee.status },
              since: existingEmployee.join_date,
            },
          );
        }
        if (
          fetched.employee.employment_type !== existingEmployee.employment_type
        ) {
          await recordEmployeeMutation(
            tx,
            existingEmployee.id,
            {
              field: "EMPLOYMENT_TYPE",
              employment_type: fetched.employee.employment_type,
            },
            mutationEffectiveDate,
            {
              value: {
                field: "EMPLOYMENT_TYPE",
                employment_type: existingEmployee.employment_type,
              },
              since: existingEmployee.join_date,
            },
          );
        }
      });
    } catch (error) {
      rethrowAsFriendlyEmployeeUpdateConflict(error);
    }

    const updatedPersonWithRelations = await prismaClient.person.findUnique({
      where: {
        id: existingEmployee.person_id,
      },
      include: {
        employee: {
          include: {
            unit: true,
            job_position: true,
            job_level: true,
            building: true,
            pc_mentor_units: { include: { unit: true } },
          },
        },
      },
    });

    if (!updatedPersonWithRelations || !updatedPersonWithRelations.employee) {
      throw new ResponseError(
        500,
        "Internal Server Error: Failed to retrieve updated employee data",
      );
    }

    await ensureMasterEducationEntries(
      updateRequest.institution_name,
      updateRequest.major,
    );

    return toEmployeeResponse(updatedPersonWithRelations, admin);
  }

  // Contract extension does not create categorical mutation history.
  static async extendContract(
    admin: AdminUser,
    request: ExtendEmployeeContractRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<EmployeeResponse> {
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedEmployeeAction(
        admin,
        "extend contract",
        context,
        request.id,
      );
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }

    const extendRequest = Validation.validate(
      EmployeeValidation.EXTEND_CONTRACT,
      request,
    );

    const existingEmployee = await CheckExist.checkEmployeeExists(
      extendRequest.id,
    );

    if (admin.role === AdminRole.DATABASE_ADMIN) {
      if (!admin.can_write_employee_data) {
        await recordUnauthorizedEmployeeAction(
          admin,
          "extend contract",
          context,
          request.id,
        );
        throw new ResponseError(
          403,
          "Forbidden: You don't have permission to write employee data",
        );
      }
      await assertCanWriteNow(admin, context, now);
      if (existingEmployee.unit_id !== admin.unit_id) {
        await recordUnauthorizedEmployeeAction(
          admin,
          "extend contract",
          context,
          request.id,
        );
        throw new ResponseError(
          403,
          "Forbidden: This employee is outside your unit scope",
        );
      }
    }

    if (existingEmployee.employment_type === EmploymentType.PERMANENT) {
      throw new ResponseError(
        400,
        "Permanent employees don't have a contract end date to extend",
      );
    }

    if (existingEmployee.status === EmployeeStatus.RESIGNED) {
      throw new ResponseError(
        400,
        "Cannot extend the contract of a resigned employee",
      );
    }

    const newContractEndDate = new Date(extendRequest.contract_end_date);
    if (
      existingEmployee.contract_end_date &&
      newContractEndDate <= existingEmployee.contract_end_date
    ) {
      throw new ResponseError(
        400,
        "New contract end date must be after the current one",
      );
    }

    const oldSnapshot = toEmployeeAuditSnapshot(
      existingEmployee.person,
      existingEmployee,
    );

    await prismaClient.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: existingEmployee.id },
        data: { contract_end_date: newContractEndDate },
      });

      // Nested includes can race on the transaction's single connection.
      const fetched = await tx.employee.findUniqueOrThrow({
        where: { id: existingEmployee.id },
        include: { person: true },
      });

      await AuditService.record(
        {
          action: AuditAction.EXTEND_EMPLOYEE_CONTRACT,
          source: AuditSource.UI,
          entity_type: "Employee",
          entity_id: existingEmployee.id,
          admin_id: admin.id,
          old_values: oldSnapshot,
          new_values: toEmployeeAuditSnapshot(fetched.person, fetched),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const updatedPersonWithRelations = await prismaClient.person.findUnique({
      where: { id: existingEmployee.person_id },
      include: {
        employee: {
          include: {
            unit: true,
            job_position: true,
            job_level: true,
            building: true,
            pc_mentor_units: { include: { unit: true } },
          },
        },
      },
    });

    if (!updatedPersonWithRelations || !updatedPersonWithRelations.employee) {
      throw new ResponseError(
        500,
        "Internal Server Error: Failed to retrieve updated employee data",
      );
    }

    return toEmployeeResponse(updatedPersonWithRelations, admin);
  }

  static async get(
    admin: AdminUserWithEmployeeScope,
    request: GetEmployeeRequest,
  ): Promise<EmployeeResponse | RedactedEmployeeDetailResponse> {
    const person = await prismaClient.person.findFirst({
      where: {
        employee: {
          id: request.id,
          deleted_at: null,
        },
      },
      include: {
        employee: {
          include: {
            unit: true,
            job_position: true,
            job_level: true,
            building: true,
            pc_mentor_units: { include: { unit: true } },
          },
        },
      },
    });

    if (!person || !person.employee) {
      throw new ResponseError(404, "Employee not found");
    }

    // Self-access uses the stable promoted Person link.
    const isSelf = admin.person_id !== null && admin.person_id === person.id;
    if (!isSelf) assertCanViewEmployeeData(admin);

    if (!isSelf) {
      const employeeUnitScope = resolveEmployeeUnitScope(admin);
      if (
        employeeUnitScope !== undefined &&
        !employeeUnitScope.includes(person.employee.unit_id)
      ) {
        throw new ResponseError(404, "Employee not found");
      }
    }

    if (isSelf || admin.role === AdminRole.SUPER_ADMIN || admin.can_view_employee_pii) {
      const detail = toEmployeeDetailResponse(person, admin);
      detail.identity.photo_url = await resolveEmployeePhotoUrl(
        person.photo_object_key,
        person.photo_url,
      );
      detail.identity.is_self = isSelf;
      return splitEmployeeDetailIdentity(detail).redacted;
    }

    return toEmployeeResponse(person, admin);
  }

  // Releases the identifiers GET /employees/:id leaves out, and records the
  // reveal in the same call so they cannot be read without an audit entry.
  static async revealPii(
    admin: AdminUserWithEmployeeScope,
    employeeId: string,
    context: AuditRequestContext = {},
  ): Promise<EmployeeRevealedIdentity> {
    const person = await prismaClient.person.findFirst({
      where: { employee: { id: employeeId, deleted_at: null } },
      include: {
        employee: {
          include: {
            unit: true,
            job_position: true,
            job_level: true,
            building: true,
          },
        },
      },
    });

    if (!person || !person.employee) {
      throw new ResponseError(404, "Employee not found");
    }

    const isSelf = admin.person_id !== null && admin.person_id === person.id;

    if (!isSelf) {
      const employeeUnitScope = resolveEmployeeUnitScope(admin);
      if (
        employeeUnitScope !== undefined &&
        !employeeUnitScope.includes(person.employee.unit_id)
      ) {
        throw new ResponseError(404, "Employee not found");
      }
    }

    if (
      !isSelf &&
      admin.role !== AdminRole.SUPER_ADMIN &&
      !admin.can_view_employee_pii
    ) {
      await recordUnauthorizedEmployeeAction(
        admin,
        "view employee PII",
        context,
        employeeId,
      );
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to view employee PII (NIK/NPWP/bank account/BPJS)",
      );
    }

    // Deduplicate repeated reveals within the same viewing session.
    const { cached } = await withLookupCache(
      "employee-pii-access",
      [admin.id, employeeId],
      async () => true,
    );

    if (!cached) {
      await AuditService.record({
        action: AuditAction.ACCESS_EMPLOYEE_PII,
        source: AuditSource.UI,
        entity_type: "Employee",
        entity_id: employeeId,
        admin_id: admin.id,
        new_values: { resource: "EmployeeSensitiveFields", full_name: person.full_name },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });
    }

    return splitEmployeeDetailIdentity(toEmployeeDetailResponse(person, admin)).revealed;
  }

  static async search(
    admin: AdminUserWithEmployeeScope,
    request: SearchEmployeeRequest,
  ): Promise<Pageable<EmployeeResponse>> {
    assertCanViewEmployeeData(admin);
    const searchRequest = Validation.validate(
      EmployeeValidation.SEARCH,
      request,
    );

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const whereClause = buildEmployeeSearchWhere(admin, searchRequest);

    return paginate(searchRequest.page, searchRequest.size, {
      count: () => prismaClient.person.count({ where: whereClause }),
      findMany: () =>
        prismaClient.person
          .findMany({
            where: whereClause,
            take: searchRequest.size,
            skip: skip,
            orderBy: buildEmployeeOrderBy(
              searchRequest.sort_by || "created_at",
              searchRequest.sort_order || "desc",
            ),
            include: {
              employee: {
                include: {
                  unit: true,
                  job_position: true,
                  job_level: true,
                  building: true,
                  pc_mentor_units: { include: { unit: true } },
                },
              },
            },
          })
          .then(async (persons) => {
            const data: EmployeeResponse[] = [];
            for (const person of persons) {
              if (person.employee) {
                data.push(toEmployeeResponse(person, admin));
              }
            }

            if (!canViewEmployeeDisciplinaryData(admin)) return data;

            // Batch current disciplinary flags only for authorized callers.
            const employeeIds = data.map((entry) => entry.id);
            if (employeeIds.length > 0) {
              const activeActions =
                await prismaClient.employeeDisciplinaryAction.findMany({
                  where: {
                    employee_id: { in: employeeIds },
                    status: "ACTIVE",
                  },
                  select: { employee_id: true, type: true, level: true },
                });

              const flagByEmployeeId = new Map<
                string,
                { type: (typeof activeActions)[number]["type"]; level: number }
              >();
              for (const action of activeActions) {
                // SP outranks ST; higher levels win within the same type.
                const existing = flagByEmployeeId.get(action.employee_id);
                if (!existing || isMoreSevere(action, existing)) {
                  flagByEmployeeId.set(action.employee_id, {
                    type: action.type,
                    level: action.level,
                  });
                }
              }

              for (const entry of data) {
                entry.disciplinary_flag =
                  flagByEmployeeId.get(entry.id) ?? null;
              }
            }

            return data;
          }),
    });
  }

  // Cheap "has anything in this filtered set changed" check for a
  // floating "new data available" indicator - same scope as search(), but
  // a count + max(updated_at) instead of fetching every row.
  static async getVersion(
    admin: AdminUserWithEmployeeScope,
    request: GetEmployeeVersionRequest,
  ): Promise<ResourceVersionResponse> {
    assertCanViewEmployeeData(admin);
    const versionRequest = Validation.validate(
      EmployeeValidation.VERSION,
      request,
    );
    const whereClause = buildEmployeeSearchWhere(admin, versionRequest);

    const [count, latest] = await Promise.all([
      prismaClient.person.count({ where: whereClause }),
      prismaClient.employee.findFirst({
        where: { person: whereClause },
        orderBy: { updated_at: "desc" },
        select: { updated_at: true },
      }),
    ]);

    return {
      count,
      updated_at: latest ? latest.updated_at.toISOString() : null,
    };
  }

  // Deliberately unscoped by unit/role - dashboard summary card only, no
  // employee detail is exposed, just a headcount.
  static async countTotal(): Promise<number> {
    return prismaClient.person.count({
      where: {
        person_type: PersonType.EMPLOYEE,
        employee: { deleted_at: null },
      },
    });
  }

  static async getEducationSuggestions(): Promise<EmployeeEducationSuggestionsResponse> {
    const [institutions, majors] = await Promise.all([
      prismaClient.employee.findMany({
        where: { institution_name: { not: null }, deleted_at: null },
        select: { institution_name: true },
        distinct: ["institution_name"],
        orderBy: { institution_name: "asc" },
      }),
      prismaClient.employee.findMany({
        where: { major: { not: null }, deleted_at: null },
        select: { major: true },
        distinct: ["major"],
        orderBy: { major: "asc" },
      }),
    ]);

    return {
      institution_names: institutions
        .map((employee) => employee.institution_name)
        .filter((value): value is string => Boolean(value)),
      majors: majors
        .map((employee) => employee.major)
        .filter((value): value is string => Boolean(value)),
    };
  }

  // Report legacy placement mismatches without blocking reads.
  static async getUnitConsistencyIssues(
    admin: AdminUser,
  ): Promise<UnitConsistencyIssue[]> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can view unit consistency issues",
      );
    }

    const employees = await prismaClient.employee.findMany({
      where: { deleted_at: null },
      include: {
        person: true,
        unit: true,
        job_position: { include: { units: { include: { unit: true } } } },
        job_level: { include: { units: { include: { unit: true } } } },
      },
    });

    const issues: UnitConsistencyIssue[] = [];
    for (const employee of employees) {
      const jobPositionUnitNames = employee.job_position.units.map(
        (u) => u.unit.name,
      );
      try {
        assertJobPositionUnitCompatible(
          employee.job_position.name,
          jobPositionUnitNames,
          employee.unit.name,
        );
      } catch (error) {
        if (error instanceof ResponseError) {
          issues.push({
            employee_id: employee.id,
            employee_number: employee.employee_id,
            employee_name: employee.person.full_name,
            unit_name: employee.unit.name,
            job_position_name: employee.job_position.name,
            job_level_name: null,
            reason: error.message,
          });
        }
      }

      const jobLevelUnitNames = employee.job_level.units.map(
        (u) => u.unit.name,
      );
      try {
        assertUnitJobLevelCompatible(
          employee.unit.name,
          employee.job_level.name,
          jobLevelUnitNames,
        );
      } catch (error) {
        if (error instanceof ResponseError) {
          issues.push({
            employee_id: employee.id,
            employee_number: employee.employee_id,
            employee_name: employee.person.full_name,
            unit_name: employee.unit.name,
            job_position_name: null,
            job_level_name: employee.job_level.name,
            reason: error.message,
          });
        }
      }
    }

    return issues;
  }

  static async remove(
    admin: AdminUser,
    request: RemoveEmployeeRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedEmployeeAction(
        admin,
        "delete",
        context,
        request.id,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete employee data",
      );
    }

    const targetEmployee = await prismaClient.employee.findUnique({
      where: {
        id: request.id,
      },
      select: {
        id: true,
        deleted_at: true,
        status: true,
        unit_id: true,
        job_position_id: true,
        nik: true,
        npwp: true,
        bank_account_number: true,
        bpjs_number: true,
        bpjs_employment_number: true,
        kpj_number: true,
      },
    });

    if (!targetEmployee) {
      throw new ResponseError(404, "Employee not found");
    }

    if (targetEmployee.deleted_at !== null) {
      throw new ResponseError(400, "Employee is already deleted");
    }

    await assertNoActiveAssignmentsBlockingArchive(targetEmployee.id);

    const deletedAt = new Date();
    await prismaClient.$transaction(async (tx) => {
      await tx.employee.update({
        where: {
          id: request.id,
        },
        data: {
          deleted_at: deletedAt,
          status: EmployeeStatus.ARCHIVED,
          // Archive releases identifiers while preserving them in the audit snapshot.
          nik: null,
          npwp: null,
          bank_account_number: null,
          bpjs_number: null,
          bpjs_employment_number: null,
          kpj_number: null,
          nik_set_at: null,
          npwp_set_at: null,
          bank_account_number_set_at: null,
          bpjs_number_set_at: null,
          bpjs_employment_number_set_at: null,
          kpj_number_set_at: null,
        },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_EMPLOYEE,
          source: AuditSource.UI,
          entity_type: "Employee",
          entity_id: targetEmployee.id,
          admin_id: admin.id,
          // Mask identifiers before clearing them from the employee row.
          old_values: {
            status: targetEmployee.status,
            nik: maskSensitiveValue(targetEmployee.nik),
            npwp: maskSensitiveValue(targetEmployee.npwp),
            bank_account_number: maskSensitiveValue(
              targetEmployee.bank_account_number,
            ),
            bpjs_number: maskSensitiveValue(targetEmployee.bpjs_number),
            bpjs_employment_number: maskSensitiveValue(
              targetEmployee.bpjs_employment_number,
            ),
            kpj_number: maskSensitiveValue(targetEmployee.kpj_number),
          },
          new_values: {
            status: EmployeeStatus.ARCHIVED,
            deleted_at: deletedAt.toISOString(),
            nik: null,
            npwp: null,
            bank_account_number: null,
            bpjs_number: null,
            bpjs_employment_number: null,
            kpj_number: null,
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
    request: RestoreEmployeeRequest,
    context: AuditRequestContext = {},
  ): Promise<EmployeeResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedEmployeeAction(
        admin,
        "restore",
        context,
        request.id,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can restore employee data",
      );
    }

    const targetEmployee = await prismaClient.employee.findUnique({
      where: {
        id: request.id,
      },
      select: {
        id: true,
        deleted_at: true,
        person_id: true,
        status: true,
        unit_id: true,
        job_position_id: true,
        contract_end_date: true,
        last_working_date: true,
      },
    });

    if (!targetEmployee) {
      throw new ResponseError(404, "Employee not found");
    }

    if (targetEmployee.deleted_at === null) {
      throw new ResponseError(
        400,
        "Employee is not in the trash bin. It might be active or permanently deleted.",
      );
    }

    const restoredStatus = resolveStatusForOffboarding(
      EmployeeStatus.ACTIVE,
      targetEmployee.last_working_date,
      targetEmployee.contract_end_date,
      new Date(),
    );

    await prismaClient.$transaction(async (tx) => {
      await lockJobPositionCapacityConfig(tx, targetEmployee.job_position_id);
      await assertJobPositionUnitCompatibleByIds(
        targetEmployee.job_position_id,
        targetEmployee.unit_id,
        tx,
      );
      await assertJobPositionCapacity(tx, {
        jobPositionId: targetEmployee.job_position_id,
        unitId: targetEmployee.unit_id,
        employeeId: targetEmployee.id,
        occupiesSlot:
          restoredStatus === EmployeeStatus.ACTIVE ||
          restoredStatus === EmployeeStatus.ON_LEAVE,
      });
      await tx.employee.update({
        where: {
          id: request.id,
        },
        data: {
          deleted_at: null,
          status: restoredStatus,
        },
      });

      await AuditService.record(
        {
          action: AuditAction.UPDATE_EMPLOYEE,
          source: AuditSource.UI,
          entity_type: "Employee",
          entity_id: targetEmployee.id,
          admin_id: admin.id,
          old_values: {
            status: targetEmployee.status,
            // deleted_at already checked above - TS narrowing doesn't cross closures.
            deleted_at: targetEmployee.deleted_at!.toISOString(),
          },
          new_values: { status: restoredStatus, deleted_at: null },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const restoredPerson = await prismaClient.person.findUnique({
      where: {
        id: targetEmployee.person_id,
      },
      include: {
        employee: {
          include: {
            unit: true,
            job_position: true,
            job_level: true,
            building: true,
            pc_mentor_units: { include: { unit: true } },
          },
        },
      },
    });

    if (!restoredPerson || !restoredPerson.employee) {
      throw new ResponseError(
        500,
        "Internal Server Error: Failed to retrieve restored employee data",
      );
    }

    return toEmployeeResponse(restoredPerson, admin);
  }

  static async bulkRemove(
    admin: AdminUser,
    request: BulkIdsRequest,
    context: AuditRequestContext = {},
  ): Promise<BulkEmployeeResponse> {
    const bulkRequest = Validation.validate(EmployeeValidation.BULK_IDS, request);

    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedEmployeeAction(admin, "bulk delete", context);
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete employee data",
      );
    }

    const employees = await prismaClient.employee.findMany({
      where: { id: { in: bulkRequest.ids } },
      select: { id: true, person: { select: { full_name: true } } },
    });
    const employeeNameById = new Map(
      employees.map((employee) => [employee.id, employee.person.full_name]),
    );

    const items: BulkActionItemResponse<EmployeeResponse | boolean>[] = [];

    for (const id of bulkRequest.ids) {
      try {
        const data = await EmployeeService.remove(admin, { id }, context);
        items.push({
          id,
          label: employeeNameById.get(id),
          status: "SUCCESS",
          data,
        });
      } catch (error) {
        items.push({
          id,
          label: employeeNameById.get(id),
          status: "FAILED",
          error: bulkFailureMessage(error),
        });
      }
    }

    return toBulkActionResponse(items);
  }

  static async bulkRestore(
    admin: AdminUser,
    request: BulkIdsRequest,
    context: AuditRequestContext = {},
  ): Promise<BulkEmployeeResponse> {
    const bulkRequest = Validation.validate(EmployeeValidation.BULK_IDS, request);

    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedEmployeeAction(admin, "bulk restore", context);
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can restore employee data",
      );
    }

    const items: BulkActionItemResponse<EmployeeResponse | boolean>[] = [];

    for (const id of bulkRequest.ids) {
      try {
        const data = await EmployeeService.restore(admin, { id }, context);
        items.push({ id, status: "SUCCESS", data });
      } catch (error) {
        items.push({ id, status: "FAILED", error: bulkFailureMessage(error) });
      }
    }

    return toBulkActionResponse(items);
  }

  static async bulkUpdate(
    admin: AdminUser,
    request: BulkUpdateEmployeeRequest,
    context: AuditRequestContext = {},
  ): Promise<BulkEmployeeResponse> {
    const bulkRequest = Validation.validate(
      EmployeeValidation.BULK_UPDATE,
      request,
    );

    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedEmployeeAction(admin, "bulk update", context);
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }

    if (
      admin.role === AdminRole.DATABASE_ADMIN &&
      !admin.can_write_employee_data
    ) {
      await recordUnauthorizedEmployeeAction(admin, "bulk update", context);
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to write employee data",
      );
    }

    const items: BulkActionItemResponse<EmployeeResponse | boolean>[] = [];
    const contractEndDateById = new Map(
      (bulkRequest.contract_end_date_overrides ?? []).map((override) => [
        override.id,
        override.contract_end_date,
      ]),
    );
    const lastWorkingDateById = new Map(
      (bulkRequest.last_working_date_overrides ?? []).map((override) => [
        override.id,
        override.last_working_date,
      ]),
    );
    // PERMANENT can't carry a contract end date - clear it outright for
    // everyone in the batch rather than relying on per-employee overrides.
    const clearsContractEndDate =
      bulkRequest.employment_type === EmploymentType.PERMANENT;

    for (const id of bulkRequest.ids) {
      try {
        const updatePayload: Omit<UpdateEmployeeRequest, "id"> = {
          employment_type: bulkRequest.employment_type,
          status: bulkRequest.status,
          unit_id: bulkRequest.unit_id,
          job_position_id: bulkRequest.job_position_id,
          job_level_id: bulkRequest.job_level_id,
          building_id: bulkRequest.building_id,
          effective_date: bulkRequest.effective_date,
          contract_end_date: clearsContractEndDate
            ? null
            : contractEndDateById.get(id),
          last_working_date: lastWorkingDateById.get(id),
        };
        const data = await EmployeeService.update(
          admin,
          { id, ...updatePayload },
          context,
        );
        items.push({ id, status: "SUCCESS", data });
      } catch (error) {
        items.push({ id, status: "FAILED", error: bulkFailureMessage(error) });
      }
    }

    return toBulkActionResponse(items);
  }

  // Extend each contract from its own end date; permanent employees fail per item.
  static async bulkExtendContract(
    admin: AdminUser,
    request: BulkExtendEmployeeContractRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkEmployeeResponse> {
    const bulkRequest = Validation.validate(
      EmployeeValidation.BULK_EXTEND_CONTRACT,
      request,
    );

    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedEmployeeAction(
        admin,
        "bulk extend contract",
        context,
      );
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }
    if (
      admin.role === AdminRole.DATABASE_ADMIN &&
      !admin.can_write_employee_data
    ) {
      await recordUnauthorizedEmployeeAction(
        admin,
        "bulk extend contract",
        context,
      );
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to write employee data",
      );
    }

    const items: BulkActionItemResponse<EmployeeResponse | boolean>[] = [];
    const baselineOverrideById = new Map(
      (bulkRequest.baseline_overrides ?? []).map((override) => [
        override.id,
        new Date(override.baseline_date),
      ]),
    );

    for (const id of bulkRequest.ids) {
      try {
        const existing = await prismaClient.employee.findUnique({
          where: { id },
          select: { contract_end_date: true },
        });
        if (!existing) {
          throw new ResponseError(404, "Employee not found");
        }
        const newEndDate = bulkRequest.contract_end_date
          ? new Date(bulkRequest.contract_end_date)
          : addMonths(
              baselineOverrideById.get(id) ??
                existing.contract_end_date ??
                now,
              bulkRequest.duration_months!,
            );
        const data = await EmployeeService.extendContract(
          admin,
          { id, contract_end_date: newEndDate.toISOString() },
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

  // Auto-resign overdue employees and record each change as a system audit.
  static async autoResignPastDueEmployees(
    now: Date = new Date(),
  ): Promise<number> {
    const contractGraceCutoff = new Date(
      now.getTime() - CONTRACT_EXPIRY_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
    );

    const dueEmployees = await prismaClient.employee.findMany({
      where: {
        status: { in: Array.from(STATUSES_ELIGIBLE_FOR_AUTO_RESIGN) },
        deleted_at: null,
        OR: [
          { last_working_date: { lte: now } },
          {
            employment_type: { not: EmploymentType.PERMANENT },
            contract_end_date: { lte: contractGraceCutoff },
          },
        ],
      },
      include: { person: true },
    });

    for (const employee of dueEmployees) {
      const oldSnapshot = toEmployeeAuditSnapshot(employee.person, employee);

      await prismaClient.$transaction(async (tx) => {
        await tx.employee.update({
          where: { id: employee.id },
          data: { status: EmployeeStatus.RESIGNED },
        });

        // flat include only - a nested include here races on the tx's single
        // pg connection, and the audit snapshot only needs raw employee fields
        const fetched = await tx.employee.findUniqueOrThrow({
          where: { id: employee.id },
          include: { person: true },
        });

        await recordEmployeeMutation(
          tx,
          employee.id,
          { field: "STATUS", status: EmployeeStatus.RESIGNED },
          now,
          {
            value: { field: "STATUS", status: employee.status },
            since: employee.join_date,
          },
        );

        await AuditService.record(
          {
            action: AuditAction.AUTO_RESIGN_EMPLOYEE,
            source: AuditSource.SYSTEM,
            entity_type: "Employee",
            entity_id: employee.id,
            old_values: oldSnapshot,
            new_values: toEmployeeAuditSnapshot(fetched.person, fetched),
          },
          tx,
        );
      });
    }

    return dueEmployees.length;
  }
}
