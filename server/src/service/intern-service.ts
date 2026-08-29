import { ResponseError } from "../error/response-error";
import {
  AdminRole,
  AuditAction,
  AuditSource,
  InternStatus,
  PersonType,
  Prisma,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toInternAuditSnapshot,
  toInternDetailResponse,
  toInternResponse,
  type CreateInternRequest,
  type GetInternRequest,
  type InternDetailResponse,
  type InternResponse,
  type InternSortField,
  type RemoveInternRequest,
  type RestoreInternRequest,
  type SearchInternRequest,
  type UpdateInternRequest,
} from "../model/intern-model";
import { paginate, type Pageable } from "../model/page-model";
import { AuditService } from "./audit-service";
import { CheckExist } from "../utils/check-exist";
import { assertCanWriteNow } from "../utils/office-hours";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import { InternValidation } from "../validation/intern-validation";
import { Validation } from "../validation/validation";

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

// Institution/major stay free-text on Intern too - mirrors Employee's own
// flexible-dropdown seeding (see ensureMasterEducationEntries there).
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

const PERSON_SORT_FIELDS = new Set<InternSortField>([
  "created_at",
  "full_name",
  "nick_name",
  "email",
]);

export function buildInternOrderBy(
  sortBy: InternSortField,
  sortOrder: "asc" | "desc",
): Prisma.PersonOrderByWithRelationInput {
  if (PERSON_SORT_FIELDS.has(sortBy)) {
    return { [sortBy]: sortOrder };
  }
  return { intern: { [sortBy]: sortOrder } };
}

// Shared with ExportService so search/export filters can't drift apart.
export function buildInternSearchWhere(
  admin: Pick<AdminUser, "role" | "unit_id" | "can_view_all_units">,
  searchRequest: Omit<SearchInternRequest, "page" | "size">,
): Prisma.PersonWhereInput {
  const andFilters: Prisma.PersonWhereInput[] = [];

  let effectiveUnitId = searchRequest.unit_id;
  if (admin.role !== AdminRole.SUPER_ADMIN && !admin.can_view_all_units) {
    effectiveUnitId = admin.unit_id;
  }

  if (searchRequest.search) {
    andFilters.push({
      OR: [
        { full_name: { contains: searchRequest.search, mode: "insensitive" } },
        { nick_name: { contains: searchRequest.search, mode: "insensitive" } },
        { email: { contains: searchRequest.search, mode: "insensitive" } },
      ],
    });
  }

  if (searchRequest.gender) {
    andFilters.push({ gender: searchRequest.gender });
  }
  if (searchRequest.religion) {
    andFilters.push({ religion: searchRequest.religion });
  }

  const internFilters: Prisma.InternWhereInput = {};

  if (effectiveUnitId) internFilters.unit_id = effectiveUnitId;
  if (searchRequest.status) internFilters.status = searchRequest.status;
  if (searchRequest.job_position_id)
    internFilters.job_position_id = searchRequest.job_position_id;
  if (searchRequest.building_id)
    internFilters.building_id = searchRequest.building_id;
  if (searchRequest.join_date_start || searchRequest.join_date_end) {
    internFilters.join_date = {};
    if (searchRequest.join_date_start) {
      internFilters.join_date.gte = new Date(searchRequest.join_date_start);
    }
    if (searchRequest.join_date_end) {
      internFilters.join_date.lte = new Date(searchRequest.join_date_end);
    }
  }

  internFilters.deleted_at = searchRequest.is_deleted ? { not: null } : null;

  if (Object.keys(internFilters).length > 0) {
    andFilters.push({ intern: internFilters });
  }

  return {
    person_type: PersonType.INTERN,
    AND: andFilters,
  };
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

    const existingUser = await prismaClient.person.findFirst({
      where: { email: createRequest.email },
    });
    if (existingUser) {
      throw new ResponseError(400, "Email already registered");
    }

    let createdPersonId: string;
    try {
      createdPersonId = await prismaClient.$transaction(async (tx) => {
        const newPerson = await tx.person.create({
          data: {
            full_name: createRequest.full_name,
            nick_name: createRequest.nick_name,
            email: createRequest.email,
            person_type: PersonType.INTERN,
            gender: createRequest.gender,
            religion: createRequest.religion,
            religion_other: createRequest.religion_other,
            birth_place: createRequest.birth_place,
            birth_date: new Date(createRequest.birth_date),
            photo_url: createRequest.photo_url,
            intern: {
              create: {
                status: createRequest.status ?? InternStatus.ACTIVE,
                unit_id: createRequest.unit_id,
                job_position_id: createRequest.job_position_id,
                building_id: createRequest.building_id,
                join_date: new Date(createRequest.join_date),
                end_date: new Date(createRequest.end_date),
                notes: createRequest.notes,
                mobile_phone: createRequest.mobile_phone,
                residential_address: createRequest.residential_address,
                education_level: createRequest.education_level,
                institution_name: createRequest.institution_name,
                major: createRequest.major,
                graduation_year: createRequest.graduation_year,
              },
            },
          },
        });

        // Flat include only - a nested include here races on the tx's
        // single pg connection (see student-service.ts's create() for the
        // same note).
        const personForAudit = await tx.person.findUnique({
          where: { id: newPerson.id },
          include: { intern: true },
        });

        if (!personForAudit || !personForAudit.intern) {
          throw new ResponseError(
            500,
            "Internal Server Error: Failed to retrieve created intern data",
          );
        }

        await AuditService.record(
          {
            action: AuditAction.CREATE_INTERN,
            source: AuditSource.UI,
            entity_type: "Intern",
            entity_id: personForAudit.intern.id,
            admin_id: admin.id,
            new_values: toInternAuditSnapshot(
              personForAudit,
              personForAudit.intern,
            ),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return newPerson.id;
      });
    } catch (error) {
      rethrowAsFriendlyInternConflict(error);
    }

    const personWithRelations = await prismaClient.person.findUnique({
      where: { id: createdPersonId },
      include: {
        intern: {
          include: { unit: true, job_position: true, building: true },
        },
      },
    });

    if (!personWithRelations || !personWithRelations.intern) {
      throw new ResponseError(
        500,
        "Internal Server Error: Failed to retrieve created intern data",
      );
    }

    await ensureMasterEducationEntries(
      createRequest.institution_name,
      createRequest.major,
    );

    return toInternResponse(personWithRelations, admin);
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

    const existingIntern = await CheckExist.checkInternExists(updateRequest.id);
    const oldSnapshot = toInternAuditSnapshot(
      existingIntern.person,
      existingIntern,
    );

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

    let updatedPersonId: string;
    try {
      updatedPersonId = await prismaClient.$transaction(async (tx) => {
        await tx.person.update({
          where: { id: existingIntern.person_id },
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

            intern: {
              update: {
                status: updateRequest.status,
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
                mobile_phone: updateRequest.mobile_phone,
                residential_address: updateRequest.residential_address,
                education_level: updateRequest.education_level,
                institution_name: updateRequest.institution_name,
                major: updateRequest.major,
                graduation_year: updateRequest.graduation_year,
              },
            },
          },
        });

        const personForAudit = await tx.person.findUnique({
          where: { id: existingIntern.person_id },
          include: { intern: true },
        });

        if (!personForAudit || !personForAudit.intern) {
          throw new ResponseError(
            500,
            "Internal Server Error: Failed to retrieve updated intern data",
          );
        }

        await AuditService.record(
          {
            action: AuditAction.UPDATE_INTERN,
            source: AuditSource.UI,
            entity_type: "Intern",
            entity_id: personForAudit.intern.id,
            admin_id: admin.id,
            old_values: oldSnapshot,
            new_values: toInternAuditSnapshot(
              personForAudit,
              personForAudit.intern,
            ),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return personForAudit.id;
      });
    } catch (error) {
      rethrowAsFriendlyInternConflict(error);
    }

    const personWithRelations = await prismaClient.person.findUnique({
      where: { id: updatedPersonId },
      include: {
        intern: {
          include: { unit: true, job_position: true, building: true },
        },
      },
    });

    if (!personWithRelations || !personWithRelations.intern) {
      throw new ResponseError(
        500,
        "Internal Server Error: Failed to retrieve updated intern data",
      );
    }

    await ensureMasterEducationEntries(
      updateRequest.institution_name,
      updateRequest.major,
    );

    return toInternResponse(personWithRelations, admin);
  }

  static async get(
    admin: AdminUser,
    request: GetInternRequest,
  ): Promise<InternResponse | InternDetailResponse> {
    const person = await prismaClient.person.findFirst({
      where: { intern: { id: request.id, deleted_at: null } },
      include: {
        intern: {
          include: { unit: true, job_position: true, building: true },
        },
      },
    });

    if (!person || !person.intern) {
      throw new ResponseError(404, "Intern not found");
    }

    if (admin.role !== AdminRole.SUPER_ADMIN && !admin.can_view_all_units) {
      if (person.intern.unit_id !== admin.unit_id) {
        throw new ResponseError(404, "Intern not found");
      }
    }

    if (admin.role === AdminRole.SUPER_ADMIN || admin.can_view_employee_pii) {
      return toInternDetailResponse(person, admin);
    }

    return toInternResponse(person, admin);
  }

  static async search(
    admin: AdminUser,
    request: SearchInternRequest,
  ): Promise<Pageable<InternResponse>> {
    const searchRequest = Validation.validate(InternValidation.SEARCH, request);

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const whereClause = buildInternSearchWhere(admin, searchRequest);

    return paginate(searchRequest.page, searchRequest.size, {
      count: () => prismaClient.person.count({ where: whereClause }),
      findMany: () =>
        prismaClient.person
          .findMany({
            where: whereClause,
            take: searchRequest.size,
            skip: skip,
            orderBy: buildInternOrderBy(
              searchRequest.sort_by || "created_at",
              searchRequest.sort_order || "desc",
            ),
            include: {
              intern: {
                include: { unit: true, job_position: true, building: true },
              },
            },
          })
          .then((persons) =>
            persons
              .filter((person) => person.intern)
              .map((person) => toInternResponse(person, admin)),
          ),
    });
  }

  // Deliberately unscoped by unit/role - dashboard summary card only, no
  // intern detail is exposed, just a headcount. Mirrors
  // EmployeeService.countTotal.
  static async countTotal(): Promise<number> {
    return prismaClient.person.count({
      where: {
        person_type: PersonType.INTERN,
        intern: { deleted_at: null },
      },
    });
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
      await tx.intern.update({
        where: { id: request.id },
        data: { deleted_at: deletedAt, status: InternStatus.TERMINATED },
      });

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
      select: { id: true, deleted_at: true, person_id: true, status: true },
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
      await tx.intern.update({
        where: { id: request.id },
        data: { deleted_at: null, status: InternStatus.ACTIVE },
      });

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
          new_values: { status: InternStatus.ACTIVE, deleted_at: null },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const restoredPerson = await prismaClient.person.findUnique({
      where: { id: targetIntern.person_id },
      include: {
        intern: {
          include: { unit: true, job_position: true, building: true },
        },
      },
    });

    if (!restoredPerson || !restoredPerson.intern) {
      throw new ResponseError(
        500,
        "Internal Server Error: Failed to retrieve restored intern data",
      );
    }

    return toInternResponse(restoredPerson, admin);
  }
}
