import { ResponseError } from "../error/response-error";
import {
  AdminRole,
  AuditAction,
  AuditSource,
  InternStatus,
  InternMutationField,
  Prisma,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { withLookupCache } from "../lib/lookup-cache";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toBulkActionResponse,
  type BulkActionItemResponse,
  type BulkIdsRequest,
} from "../model/bulk-action-model";
import {
  toInternAuditSnapshot,
  splitInternDetailIdentity,
  toInternDetailResponse,
  type InternRevealedIdentity,
  type RedactedInternDetailResponse,
  toInternResponse,
  type CreateInternRequest,
  type GetInternRequest,
  type GetInternVersionRequest,
  type InternDetailResponse,
  type InternResponse,
  type InternSortField,
  type RemoveInternRequest,
  type RestoreInternRequest,
  type SearchInternRequest,
  type UpdateInternRequest,
  type BulkInternResponse,
} from "../model/intern-model";
import type { ResourceVersionResponse } from "../model/resource-version-model";
import { paginate, type Pageable } from "../model/page-model";
import { AuditService } from "./audit-service";
import { CheckExist } from "../utils/check-exist";
import { assertCanWriteNow } from "../utils/office-hours";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import { InternValidation } from "../validation/intern-validation";
import { Validation, yearsBetweenDates } from "../validation/validation";
import {
  assertCanViewEmployeeData,
  resolveEmployeeUnitScope,
  type AdminUserWithEmployeeScope,
} from "../utils/admin-permissions";
import { lockInternWorkforce } from "../utils/intern-workforce-lock";
import { assertAcademicUnitIds } from "../utils/academic-units";
import { assertJobPositionCapacity } from "../utils/job-position-capacity";
import { lockJobPositionCapacityConfig } from "../utils/job-position-capacity";
import { assertJobPositionUnitCompatibleByIds } from "../utils/employee-role-rules";

function bulkFailureMessage(error: unknown): string {
  if (error instanceof ResponseError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

function resolveInternStatus(
  status: InternStatus,
  endDate: Date,
  now: Date,
): InternStatus {
  if (status === InternStatus.ACTIVE && endDate <= now) {
    return InternStatus.COMPLETED;
  }
  return status;
}

type InternMutationFieldValue =
  | { field: "UNIT"; unit_id: string }
  | { field: "JOB_POSITION"; job_position_id: string }
  | { field: "BUILDING"; building_id: string }
  | { field: "STATUS"; status: InternStatus };

async function recordInternMutation(
  tx: Prisma.TransactionClient,
  internId: string,
  value: InternMutationFieldValue,
  startDate: Date,
  priorLiveValue?: { value: InternMutationFieldValue; since: Date },
): Promise<void> {
  const previous = await tx.internMutationHistory.findFirst({
    where: {
      intern_id: internId,
      field: value.field as InternMutationField,
      end_date: null,
      deleted_at: null,
    },
  });
  let previousHistoryId = previous?.id ?? null;
  if (previous) {
    await tx.internMutationHistory.update({
      where: { id: previous.id },
      data: { end_date: startDate },
    });
  } else if (priorLiveValue && priorLiveValue.since < startDate) {
    const genesis = await tx.internMutationHistory.create({
      data: {
        intern_id: internId,
        start_date: priorLiveValue.since,
        end_date: startDate,
        ...priorLiveValue.value,
      },
    });
    previousHistoryId = genesis.id;
  }
  await tx.internMutationHistory.create({
    data: {
      intern_id: internId,
      start_date: startDate,
      previous_history_id: previousHistoryId,
      ...value,
    },
  });
}

async function assertNoActiveInternWorkforceAssignments(
  tx: Prisma.TransactionClient,
  internId: string,
  action: string,
): Promise<void> {
  const classAssignments = await tx.classTeacherAssignment.count({
    where: { intern_id: internId, end_date: null, deleted_at: null },
  });
  const supportAssignments = await tx.studentSupportAssignment.count({
    where: { intern_id: internId, end_date: null, deleted_at: null },
  });
  const mentorships = await tx.pcActivityRoomMentorAssignment.count({
    where: {
      intern_id: internId,
      status: { in: ["ACTIVE", "SCHEDULED"] },
      deleted_at: null,
    },
  });
  const blockers = [
    classAssignments > 0
      ? `${classAssignments} active class assignment${classAssignments === 1 ? "" : "s"}`
      : null,
    supportAssignments > 0
      ? `${supportAssignments} active student support assignment${supportAssignments === 1 ? "" : "s"}`
      : null,
    mentorships > 0
      ? `${mentorships} active PC activity mentorship${mentorships === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);
  if (blockers.length > 0) {
    throw new ResponseError(
      400,
      `Cannot ${action} this intern: ${blockers.join(", ")} remain. End, clear, or reassign them first.`,
    );
  }
}

async function recordUnauthorizedInternAction(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
  internId?: string,
): Promise<void> {
  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    entity_type: "Intern",
    entity_id: internId,
    new_values: {
      reason: `blocked intern ${action}`,
      ...(internId ? { intern_id: internId } : {}),
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

function rethrowAsFriendlyInternConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("email")) {
    throw new ResponseError(400, "Email already registered");
  }
  throw error as Error;
}

// Interns may join from age 15.
const MIN_INTERN_AGE_YEARS = 15;

// Validate age only when the optional birth date is present.
function assertMinInternAgeAtJoin(
  birthDateIso: Date | string | null | undefined,
  joinDateIso: Date | string,
): void {
  if (!birthDateIso) return;
  const birthIso =
    typeof birthDateIso === "string" ? birthDateIso : birthDateIso.toISOString();
  const joinIso =
    typeof joinDateIso === "string" ? joinDateIso : joinDateIso.toISOString();
  if (yearsBetweenDates(birthIso, joinIso) < MIN_INTERN_AGE_YEARS) {
    throw new ResponseError(
      400,
      `Intern must be at least ${MIN_INTERN_AGE_YEARS} years old on their join date`,
    );
  }
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

export function buildInternOrderBy(
  sortBy: InternSortField,
  sortOrder: "asc" | "desc",
): Prisma.InternOrderByWithRelationInput {
  return { [sortBy]: sortOrder };
}

// Share filters with export.
export function buildInternSearchWhere(
  admin: AdminUserWithEmployeeScope,
  searchRequest: Omit<SearchInternRequest, "page" | "size">,
): Prisma.InternWhereInput {
  const andFilters: Prisma.InternWhereInput[] = [];

  const employeeUnitScope = resolveEmployeeUnitScope(admin);
  const unitIdFilter: string | { in: string[] } | undefined =
    employeeUnitScope === undefined
      ? searchRequest.unit_id
      : searchRequest.unit_id && employeeUnitScope.includes(searchRequest.unit_id)
        ? searchRequest.unit_id
        : { in: employeeUnitScope };

  if (searchRequest.search) {
    andFilters.push({
      OR: [
        { full_name: { contains: searchRequest.search, mode: "insensitive" } },
        { nick_name: { contains: searchRequest.search, mode: "insensitive" } },
        { email: { contains: searchRequest.search, mode: "insensitive" } },
      ],
    });
  }

  if (searchRequest.gender) andFilters.push({ gender: searchRequest.gender });
  if (searchRequest.religion) {
    andFilters.push({ religion: searchRequest.religion });
  }
  if (unitIdFilter) andFilters.push({ unit_id: unitIdFilter });
  // Ignore status when querying archived interns.
  if (searchRequest.status && !searchRequest.is_deleted) {
    andFilters.push({ status: searchRequest.status });
  }
  if (searchRequest.job_position_id) {
    andFilters.push({ job_position_id: searchRequest.job_position_id });
  }
  if (searchRequest.building_id) {
    andFilters.push({ building_id: searchRequest.building_id });
  }
  if (searchRequest.join_date_start || searchRequest.join_date_end) {
    andFilters.push({
      join_date: {
        gte: searchRequest.join_date_start
          ? new Date(searchRequest.join_date_start)
          : undefined,
        lte: searchRequest.join_date_end
          ? new Date(searchRequest.join_date_end)
          : undefined,
      },
    });
  }

  return {
    deleted_at: searchRequest.is_deleted ? { not: null } : null,
    AND: andFilters,
  };
}

async function assertCanWriteInternContactPii(
  admin: AdminUser,
  fields: Pick<CreateInternRequest, "mobile_phone" | "residential_address">,
  context: AuditRequestContext,
): Promise<void> {
  if (admin.role === AdminRole.SUPER_ADMIN || admin.can_view_employee_pii) return;
  if (fields.mobile_phone === undefined && fields.residential_address === undefined) return;

  await recordUnauthorizedInternAction(admin, "set intern contact PII", context);
  throw new ResponseError(
    403,
    "Forbidden: You don't have permission to set intern contact PII (mobile phone/residential address)",
  );
}

export class InternService {
  static async create(
    admin: AdminUser,
    request: CreateInternRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<InternResponse> {
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedInternAction(admin, "create", context);
      throw new ResponseError(403, "Forbidden: Viewer cannot create data");
    }

    if (admin.role === AdminRole.DATABASE_ADMIN) {
      if (!admin.can_write_employee_data) {
        await recordUnauthorizedInternAction(admin, "create", context);
        throw new ResponseError(
          403,
          "Forbidden: You don't have permission to write employee data",
        );
      }

      await assertCanWriteNow(admin, context, now);

      if (admin.unit_id !== request.unit_id) {
        await recordUnauthorizedInternAction(admin, "create", context);
        throw new ResponseError(
          403,
          "Forbidden: You can only create interns within your unit scope",
        );
      }
    }

    const createRequest = Validation.validate(InternValidation.CREATE, request);
    await assertCanWriteInternContactPii(admin, createRequest, context);

    assertMinInternAgeAtJoin(createRequest.birth_date, createRequest.join_date);
    const createEndDate = new Date(createRequest.end_date);
    const resolvedStatus = resolveInternStatus(
      createRequest.status ?? InternStatus.ACTIVE,
      createEndDate,
      now,
    );

    let createdId: string;
    try {
      createdId = await prismaClient.$transaction(async (tx) => {
        await lockJobPositionCapacityConfig(tx, createRequest.job_position_id);
        await assertJobPositionUnitCompatibleByIds(
          createRequest.job_position_id,
          createRequest.unit_id,
          tx,
        );
        await assertJobPositionCapacity(tx, {
          jobPositionId: createRequest.job_position_id,
          unitId: createRequest.unit_id,
          occupiesSlot: resolvedStatus === InternStatus.ACTIVE,
        });
        const created = await tx.intern.create({
          data: {
            full_name: createRequest.full_name,
            nick_name: createRequest.nick_name,
            email: createRequest.email,
            gender: createRequest.gender,
            religion: createRequest.religion,
            religion_other: createRequest.religion_other,
            birth_place: createRequest.birth_place,
            birth_date: createRequest.birth_date
              ? new Date(createRequest.birth_date)
              : undefined,
            status: resolvedStatus,
            unit_id: createRequest.unit_id,
            job_position_id: createRequest.job_position_id,
            building_id: createRequest.building_id,
            join_date: new Date(createRequest.join_date),
            end_date: createEndDate,
            notes: createRequest.notes,
            is_pc_mentor_eligible: createRequest.is_pc_mentor_eligible ?? false,
            mobile_phone: createRequest.mobile_phone,
            residential_address: createRequest.residential_address,
            education_level: createRequest.education_level,
            institution_name: createRequest.institution_name,
            major: createRequest.major,
            graduation_year: createRequest.graduation_year,
          },
        });

        if (createRequest.pc_mentor_unit_ids?.length) {
          await assertAcademicUnitIds(
            tx,
            createRequest.pc_mentor_unit_ids,
            "PC mentor units must be academic units (units that have grades)",
          );
          await tx.internPcMentorUnit.createMany({
            data: createRequest.pc_mentor_unit_ids.map((unitId) => ({
              intern_id: created.id,
              unit_id: unitId,
            })),
          });
        }

        await AuditService.record(
          {
            action: AuditAction.CREATE_INTERN,
            source: AuditSource.UI,
            entity_type: "Intern",
            entity_id: created.id,
            admin_id: admin.id,
            new_values: toInternAuditSnapshot(created),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        const joinDate = new Date(createRequest.join_date);
        await recordInternMutation(tx, created.id, { field: "UNIT", unit_id: created.unit_id }, joinDate);
        await recordInternMutation(tx, created.id, { field: "JOB_POSITION", job_position_id: created.job_position_id }, joinDate);
        await recordInternMutation(tx, created.id, { field: "BUILDING", building_id: created.building_id }, joinDate);
        await recordInternMutation(tx, created.id, { field: "STATUS", status: created.status }, joinDate);

        return created.id;
      });
    } catch (error) {
      rethrowAsFriendlyInternConflict(error);
    }

    const withRelations = await prismaClient.intern.findUnique({
      where: { id: createdId },
      include: {
        unit: true,
        job_position: true,
        building: true,
        pc_mentor_units: { include: { unit: true } },
      },
    });

    if (!withRelations) {
      throw new ResponseError(
        500,
        "Internal Server Error: Failed to retrieve created intern data",
      );
    }

    await ensureMasterEducationEntries(
      createRequest.institution_name,
      createRequest.major,
    );

    return toInternResponse(withRelations, admin);
  }

  static async update(
    admin: AdminUser,
    request: UpdateInternRequest,
    context: AuditRequestContext = {},
  ): Promise<InternResponse> {
    if (admin.role === AdminRole.VIEWER) {
      await recordUnauthorizedInternAction(admin, "update", context, request.id);
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }

    const updateRequest = Validation.validate(InternValidation.UPDATE, request);
    await assertCanWriteInternContactPii(admin, updateRequest, context);

    const existingIntern = await CheckExist.checkInternExists(updateRequest.id);
    const oldSnapshot = toInternAuditSnapshot(existingIntern);

    if (admin.role === AdminRole.DATABASE_ADMIN) {
      if (!admin.can_write_employee_data) {
        await recordUnauthorizedInternAction(
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

      await assertCanWriteNow(admin, context);

      if (existingIntern.unit_id !== admin.unit_id) {
        await recordUnauthorizedInternAction(
          admin,
          "update",
          context,
          request.id,
        );
        throw new ResponseError(
          403,
          "Forbidden: This intern is outside your unit scope",
        );
      }

      if (updateRequest.unit_id && updateRequest.unit_id !== admin.unit_id) {
        await recordUnauthorizedInternAction(
          admin,
          "update",
          context,
          request.id,
        );
        throw new ResponseError(
          403,
          "Forbidden: You cannot transfer an intern to a different unit",
        );
      }
    }

    const nextJoinDate = updateRequest.join_date
      ? new Date(updateRequest.join_date)
      : existingIntern.join_date;
    const nextEndDate = updateRequest.end_date
      ? new Date(updateRequest.end_date)
      : existingIntern.end_date;
    if (nextEndDate <= nextJoinDate) {
      throw new ResponseError(400, "End date must be after join date");
    }

    const resolvedStatus = resolveInternStatus(
      updateRequest.status ?? existingIntern.status,
      nextEndDate,
      new Date(),
    );
    const invalidatesSupportAssignments =
      resolvedStatus !== InternStatus.ACTIVE ||
      nextEndDate <= new Date() ||
      (updateRequest.unit_id !== undefined &&
        updateRequest.unit_id !== existingIntern.unit_id) ||
      (updateRequest.job_position_id !== undefined &&
        updateRequest.job_position_id !== existingIntern.job_position_id);
    if (updateRequest.birth_date || updateRequest.join_date) {
      const nextBirthDate = updateRequest.birth_date ?? existingIntern.birth_date;
      assertMinInternAgeAtJoin(nextBirthDate, nextJoinDate);
    }

    try {
      await prismaClient.$transaction(async (tx) => {
        await lockInternWorkforce(tx, updateRequest.id);
        const nextJobPositionId =
          updateRequest.job_position_id ?? existingIntern.job_position_id;
        const nextUnitId = updateRequest.unit_id ?? existingIntern.unit_id;
        await lockJobPositionCapacityConfig(tx, nextJobPositionId);
        await assertJobPositionUnitCompatibleByIds(
          nextJobPositionId,
          nextUnitId,
          tx,
        );
        await assertJobPositionCapacity(tx, {
          jobPositionId: nextJobPositionId,
          unitId: nextUnitId,
          internId: existingIntern.id,
          occupiesSlot: resolvedStatus === InternStatus.ACTIVE,
        });
        if (invalidatesSupportAssignments) {
          await assertNoActiveInternWorkforceAssignments(
            tx,
            updateRequest.id,
            "update",
          );
        }
        const updated = await tx.intern.update({
          where: { id: updateRequest.id },
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
            status: resolvedStatus,
            unit_id: updateRequest.unit_id,
            job_position_id: updateRequest.job_position_id,
            building_id: updateRequest.building_id,
            join_date: updateRequest.join_date
              ? new Date(updateRequest.join_date)
              : undefined,
            end_date: updateRequest.end_date
              ? new Date(updateRequest.end_date)
              : undefined,
            notes: updateRequest.notes,
            is_pc_mentor_eligible: updateRequest.is_pc_mentor_eligible,
            mobile_phone: updateRequest.mobile_phone,
            residential_address: updateRequest.residential_address,
            education_level: updateRequest.education_level,
            institution_name: updateRequest.institution_name,
            major: updateRequest.major,
            graduation_year: updateRequest.graduation_year,
          },
        });

        if (updateRequest.pc_mentor_unit_ids !== undefined) {
          await assertAcademicUnitIds(
            tx,
            updateRequest.pc_mentor_unit_ids,
            "PC mentor units must be academic units (units that have grades)",
          );
          await tx.internPcMentorUnit.deleteMany({
            where: { intern_id: updated.id },
          });
          if (updateRequest.pc_mentor_unit_ids.length > 0) {
            await tx.internPcMentorUnit.createMany({
              data: updateRequest.pc_mentor_unit_ids.map((unitId) => ({
                intern_id: updated.id,
                unit_id: unitId,
              })),
            });
          }
        }

        await AuditService.record(
          {
            action: AuditAction.UPDATE_INTERN,
            source: AuditSource.UI,
            entity_type: "Intern",
            entity_id: updated.id,
            admin_id: admin.id,
            old_values: oldSnapshot,
            new_values: toInternAuditSnapshot(updated),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        const effectiveDate = new Date();
        if (updated.unit_id !== existingIntern.unit_id) {
          await recordInternMutation(
            tx,
            updated.id,
            { field: "UNIT", unit_id: updated.unit_id },
            effectiveDate,
            {
              value: { field: "UNIT", unit_id: existingIntern.unit_id },
              since: existingIntern.join_date,
            },
          );
        }
        if (updated.job_position_id !== existingIntern.job_position_id) {
          await recordInternMutation(
            tx,
            updated.id,
            { field: "JOB_POSITION", job_position_id: updated.job_position_id },
            effectiveDate,
            {
              value: {
                field: "JOB_POSITION",
                job_position_id: existingIntern.job_position_id,
              },
              since: existingIntern.join_date,
            },
          );
        }
        if (updated.building_id !== existingIntern.building_id) {
          await recordInternMutation(
            tx,
            updated.id,
            { field: "BUILDING", building_id: updated.building_id },
            effectiveDate,
            {
              value: { field: "BUILDING", building_id: existingIntern.building_id },
              since: existingIntern.join_date,
            },
          );
        }
        if (updated.status !== existingIntern.status) {
          await recordInternMutation(
            tx,
            updated.id,
            { field: "STATUS", status: updated.status },
            effectiveDate,
            {
              value: { field: "STATUS", status: existingIntern.status },
              since: existingIntern.join_date,
            },
          );
        }
      });
    } catch (error) {
      rethrowAsFriendlyInternConflict(error);
    }

    const withRelations = await prismaClient.intern.findUnique({
      where: { id: updateRequest.id },
      include: {
        unit: true,
        job_position: true,
        building: true,
        pc_mentor_units: { include: { unit: true } },
      },
    });

    if (!withRelations) {
      throw new ResponseError(
        500,
        "Internal Server Error: Failed to retrieve updated intern data",
      );
    }

    await ensureMasterEducationEntries(
      updateRequest.institution_name,
      updateRequest.major,
    );

    return toInternResponse(withRelations, admin);
  }

  static async get(
    admin: AdminUserWithEmployeeScope,
    request: GetInternRequest,
  ): Promise<InternResponse | RedactedInternDetailResponse> {
    assertCanViewEmployeeData(admin);
    const intern = await prismaClient.intern.findFirst({
      where: { id: request.id, deleted_at: null },
      include: {
        unit: true,
        job_position: true,
        building: true,
        pc_mentor_units: { include: { unit: true } },
      },
    });

    if (!intern) {
      throw new ResponseError(404, "Intern not found");
    }

    const employeeUnitScope = resolveEmployeeUnitScope(admin);
    if (
      employeeUnitScope !== undefined &&
      !employeeUnitScope.includes(intern.unit_id)
    ) {
      throw new ResponseError(404, "Intern not found");
    }

    if (admin.role === AdminRole.SUPER_ADMIN || admin.can_view_employee_pii) {
      return splitInternDetailIdentity(toInternDetailResponse(intern, admin)).redacted;
    }

    return toInternResponse(intern, admin);
  }

  // Releases the identity fields GET /interns/:id leaves out, and records the
  // reveal in the same call so they cannot be read without an audit entry.
  static async revealPii(
    admin: AdminUserWithEmployeeScope,
    internId: string,
    context: AuditRequestContext = {},
  ): Promise<InternRevealedIdentity> {
    assertCanViewEmployeeData(admin);
    const intern = await prismaClient.intern.findFirst({
      where: { id: internId, deleted_at: null },
      include: {
        unit: true,
        job_position: true,
        building: true,
        pc_mentor_units: { include: { unit: true } },
      },
    });
    if (!intern) {
      throw new ResponseError(404, "Intern not found");
    }

    const employeeUnitScope = resolveEmployeeUnitScope(admin);
    if (
      employeeUnitScope !== undefined &&
      !employeeUnitScope.includes(intern.unit_id)
    ) {
      throw new ResponseError(404, "Intern not found");
    }

    if (admin.role !== AdminRole.SUPER_ADMIN && !admin.can_view_employee_pii) {
      await recordUnauthorizedInternAction(admin, "view intern PII", context, internId);
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to view intern PII",
      );
    }

    // Deduplicate repeated reveals within the same viewing session.
    const { cached } = await withLookupCache(
      "intern-pii-access",
      [admin.id, internId],
      async () => true,
    );
    if (!cached) {
      await AuditService.record({
        action: AuditAction.ACCESS_EMPLOYEE_PII,
        source: AuditSource.UI,
        entity_type: "Intern",
        entity_id: internId,
        admin_id: admin.id,
        new_values: { resource: "InternSensitiveFields", full_name: intern.full_name },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });
    }

    return splitInternDetailIdentity(toInternDetailResponse(intern, admin)).revealed;
  }

  static async search(
    admin: AdminUserWithEmployeeScope,
    request: SearchInternRequest,
  ): Promise<Pageable<InternResponse>> {
    assertCanViewEmployeeData(admin);
    const searchRequest = Validation.validate(InternValidation.SEARCH, request);

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const whereClause = buildInternSearchWhere(admin, searchRequest);

    return paginate(searchRequest.page, searchRequest.size, {
      count: () => prismaClient.intern.count({ where: whereClause }),
      findMany: () =>
        prismaClient.intern
          .findMany({
            where: whereClause,
            take: searchRequest.size,
            skip: skip,
            orderBy: buildInternOrderBy(
              searchRequest.sort_by || "created_at",
              searchRequest.sort_order || "desc",
            ),
            include: {
              unit: true,
              job_position: true,
              building: true,
              pc_mentor_units: { include: { unit: true } },
            },
          })
          .then((interns) =>
            interns.map((intern) => toInternResponse(intern, admin)),
          ),
    });
  }

  // Cheap "has anything in this filtered set changed" check for a
  // floating "new data available" indicator - same scope as search(), but
  // a count + max(updated_at) instead of fetching every row.
  static async getVersion(
    admin: AdminUserWithEmployeeScope,
    request: GetInternVersionRequest,
  ): Promise<ResourceVersionResponse> {
    assertCanViewEmployeeData(admin);
    const versionRequest = Validation.validate(
      InternValidation.VERSION,
      request,
    );
    const whereClause = buildInternSearchWhere(admin, versionRequest);

    const [count, latest] = await Promise.all([
      prismaClient.intern.count({ where: whereClause }),
      prismaClient.intern.findFirst({
        where: whereClause,
        orderBy: { updated_at: "desc" },
        select: { updated_at: true },
      }),
    ]);

    return {
      count,
      updated_at: latest ? latest.updated_at.toISOString() : null,
    };
  }

  // The dashboard total exposes no intern details.
  static async countTotal(): Promise<number> {
    return prismaClient.intern.count({ where: { deleted_at: null } });
  }

  static async remove(
    admin: AdminUser,
    request: RemoveInternRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedInternAction(
        admin,
        "delete",
        context,
        request.id,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete intern data",
      );
    }

    const targetIntern = await prismaClient.intern.findUnique({
      where: { id: request.id },
      select: { id: true, deleted_at: true, status: true },
    });

    if (!targetIntern) {
      throw new ResponseError(404, "Intern not found");
    }
    if (targetIntern.deleted_at !== null) {
      throw new ResponseError(400, "Intern is already deleted");
    }
    const deletedAt = new Date();
    await prismaClient.$transaction(async (tx) => {
      await lockInternWorkforce(tx, request.id);
      await assertNoActiveInternWorkforceAssignments(tx, request.id, "archive");
      await tx.intern.update({
        where: { id: request.id },
        data: { deleted_at: deletedAt, status: InternStatus.TERMINATED },
      });
      if (targetIntern.status !== InternStatus.TERMINATED) {
        await recordInternMutation(
          tx,
          targetIntern.id,
          { field: "STATUS", status: InternStatus.TERMINATED },
          deletedAt,
          {
            value: { field: "STATUS", status: targetIntern.status },
            since: deletedAt,
          },
        );
      }

      await AuditService.record(
        {
          action: AuditAction.DELETE_INTERN,
          source: AuditSource.UI,
          entity_type: "Intern",
          entity_id: targetIntern.id,
          admin_id: admin.id,
          old_values: { status: targetIntern.status },
          new_values: {
            status: InternStatus.TERMINATED,
            deleted_at: deletedAt.toISOString(),
          },
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
    request: BulkIdsRequest,
    context: AuditRequestContext = {},
  ): Promise<BulkInternResponse> {
    const bulkRequest = Validation.validate(InternValidation.BULK_IDS, request);
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedInternAction(admin, "bulk delete", context);
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete intern data",
      );
    }

    const interns = await prismaClient.intern.findMany({
      where: { id: { in: bulkRequest.ids } },
      select: { id: true, full_name: true },
    });
    const nameById = new Map(interns.map((intern) => [intern.id, intern.full_name]));
    const items: BulkActionItemResponse<InternResponse | boolean>[] = [];

    for (const id of bulkRequest.ids) {
      try {
        const data = await InternService.remove(admin, { id }, context);
        items.push({ id, label: nameById.get(id), status: "SUCCESS", data });
      } catch (error) {
        items.push({
          id,
          label: nameById.get(id),
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
  ): Promise<BulkInternResponse> {
    const bulkRequest = Validation.validate(InternValidation.BULK_IDS, request);
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedInternAction(admin, "bulk restore", context);
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can restore intern data",
      );
    }

    const interns = await prismaClient.intern.findMany({
      where: { id: { in: bulkRequest.ids } },
      select: { id: true, full_name: true },
    });
    const nameById = new Map(interns.map((intern) => [intern.id, intern.full_name]));
    const items: BulkActionItemResponse<InternResponse | boolean>[] = [];

    for (const id of bulkRequest.ids) {
      try {
        const data = await InternService.restore(admin, { id }, context);
        items.push({ id, label: nameById.get(id), status: "SUCCESS", data });
      } catch (error) {
        items.push({
          id,
          label: nameById.get(id),
          status: "FAILED",
          error: bulkFailureMessage(error),
        });
      }
    }

    return toBulkActionResponse(items);
  }

  static async restore(
    admin: AdminUser,
    request: RestoreInternRequest,
    context: AuditRequestContext = {},
  ): Promise<InternResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedInternAction(
        admin,
        "restore",
        context,
        request.id,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can restore intern data",
      );
    }

    const targetIntern = await prismaClient.intern.findUnique({
      where: { id: request.id },
      select: { id: true, deleted_at: true, status: true },
    });

    if (!targetIntern) {
      throw new ResponseError(404, "Intern not found");
    }
    if (targetIntern.deleted_at === null) {
      throw new ResponseError(
        400,
        "Intern is not in the trash bin. It might be active or permanently deleted.",
      );
    }

    await prismaClient.$transaction(async (tx) => {
      await lockInternWorkforce(tx, request.id);
      const target = await tx.intern.findUniqueOrThrow({
        where: { id: request.id },
        select: { unit_id: true, job_position_id: true, end_date: true },
      });
      await lockJobPositionCapacityConfig(tx, target.job_position_id);
      await assertJobPositionUnitCompatibleByIds(
        target.job_position_id,
        target.unit_id,
        tx,
      );
      await assertJobPositionCapacity(tx, {
        jobPositionId: target.job_position_id,
        unitId: target.unit_id,
        internId: request.id,
        occupiesSlot: target.end_date > new Date(),
      });
      const restoredStatus =
        target.end_date > new Date()
          ? InternStatus.ACTIVE
          : InternStatus.COMPLETED;
      await tx.intern.update({
        where: { id: request.id },
        data: { deleted_at: null, status: restoredStatus },
      });
      if (targetIntern.status !== restoredStatus) {
        await recordInternMutation(
          tx,
          targetIntern.id,
          { field: "STATUS", status: restoredStatus },
          new Date(),
          {
            value: { field: "STATUS", status: targetIntern.status },
            since: targetIntern.deleted_at!,
          },
        );
      }

      await AuditService.record(
        {
          action: AuditAction.UPDATE_INTERN,
          source: AuditSource.UI,
          entity_type: "Intern",
          entity_id: targetIntern.id,
          admin_id: admin.id,
          old_values: {
            status: targetIntern.status,
            deleted_at: targetIntern.deleted_at!.toISOString(),
          },
          new_values: { status: restoredStatus, deleted_at: null },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const withRelations = await prismaClient.intern.findUnique({
      where: { id: request.id },
      include: {
        unit: true,
        job_position: true,
        building: true,
        pc_mentor_units: { include: { unit: true } },
      },
    });

    if (!withRelations) {
      throw new ResponseError(
        500,
        "Internal Server Error: Failed to retrieve restored intern data",
      );
    }

    return toInternResponse(withRelations, admin);
  }
}
