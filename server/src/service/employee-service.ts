import { ResponseError } from "../error/response-error";
import {
  AdminRole,
  AuditAction,
  AuditSource,
  EmployeeStatus,
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
  toEmployeeDetailResponse,
  toEmployeeResponse,
  type BulkEmployeeResponse,
  type CreateEmployeeRequest,
  type EmployeeDetailResponse,
  type EmployeeResponse,
  type EmployeeSortField,
  type GetEmployeeRequest,
  type RemoveEmployeeRequest,
  type RestoreEmployeeRequest,
  type SearchEmployeeRequest,
  type UpdateEmployeeRequest,
} from "../model/employee-model";
import { paginate, type Pageable } from "../model/page-model";
import { AuditService } from "./audit-service";
import { CheckExist } from "../utils/check-exist";
import { assertCanWriteNow } from "../utils/office-hours";
import { assertIdentifierFieldsEditable } from "../utils/identifier-lock";
import {
  assertJobPositionJobLevelCompatibleByIds,
  assertUnitJobLevelCompatibleByIds,
} from "../utils/employee-role-rules";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import { EmployeeValidation } from "../validation/employee-validation";
import { Validation } from "../validation/validation";

function bulkFailureMessage(error: unknown): string {
  if (error instanceof ResponseError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unknown error";
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
    new_values: {
      reason: `blocked employee ${action}`,
      ...(employeeId ? { employee_id: employeeId } : {}),
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

// Labels for the identity/sensitive fields that must be unique per person -
// shared between the pre-check (assertEmployeeIdentityFieldsUnique, which
// names the conflicting employee) and the P2002 fallback below (which
// can't - it only knows the column name, not the value that raced).
const IDENTITY_FIELD_LABELS: Record<string, string> = {
  nik: "NIK",
  npwp: "NPWP",
  bank_account_number: "Bank account number",
  bpjs_number: "BPJS Kesehatan number",
  bpjs_employment_number: "BPJS Ketenagakerjaan number",
};

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

// Primary check for the identity fields' uniqueness - runs before the write
// so the error can name the conflicting employee (the P2002 fallback in
// rethrowAsFriendly*Conflict above only fires if two requests race between
// this check and the write itself).
async function assertEmployeeIdentityFieldsUnique(
  values: {
    nik?: string;
    npwp?: string;
    bank_account_number?: string;
    bpjs_number?: string;
    bpjs_employment_number?: string;
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

// Shared with ExportService so search/export filters can't drift apart.
export function buildEmployeeSearchWhere(
  admin: Pick<AdminUser, "role" | "unit_id" | "can_view_all_units">,
  searchRequest: Omit<SearchEmployeeRequest, "page" | "size">,
): Prisma.PersonWhereInput {
  const andFilters: Prisma.PersonWhereInput[] = [];

  let effectiveUnitId = searchRequest.unit_id;
  if (admin.role !== AdminRole.SUPER_ADMIN && !admin.can_view_all_units) {
    effectiveUnitId = admin.unit_id;
  }

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

  if (effectiveUnitId) employeeFilters.unit_id = effectiveUnitId;
  if (searchRequest.status) employeeFilters.status = searchRequest.status;
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
      if (!admin.can_write_data) {
        await recordUnauthorizedEmployeeAction(admin, "create", context);
        throw new ResponseError(
          403,
          "Forbidden: You don't have permission to create data",
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

    await assertUnitJobLevelCompatibleByIds(
      createRequest.unit_id,
      createRequest.job_level_id,
    );
    await assertJobPositionJobLevelCompatibleByIds(
      createRequest.job_position_id,
      createRequest.job_level_id,
    );

    await assertEmployeeIdentityFieldsUnique({
      nik: createRequest.nik,
      npwp: createRequest.npwp,
      bank_account_number: createRequest.bank_account_number,
      bpjs_number: createRequest.bpjs_number,
      bpjs_employment_number: createRequest.bpjs_employment_number,
    });

    let createdPersonId: string;
    try {
      createdPersonId = await prismaClient.$transaction(async (tx) => {
        const newPerson = await tx.person.create({
          data: {
            full_name: createRequest.full_name,
            nick_name: createRequest.nick_name,
            email: createRequest.email,
            person_type: PersonType.EMPLOYEE,
            gender: createRequest.gender,
            religion: createRequest.religion,
            birth_place: createRequest.birth_place,
            birth_date: new Date(createRequest.birth_date),
            photo_url: createRequest.photo_url,
            employee: {
              create: {
                employee_id: createRequest.employee_id,
                status: createRequest.status,
                employment_type: createRequest.employment_type,
                unit_id: createRequest.unit_id,
                job_position_id: createRequest.job_position_id,
                job_level_id: createRequest.job_level_id,
                building_id: createRequest.building_id,
                join_date: new Date(createRequest.join_date),
                contract_end_date: createRequest.contract_end_date
                  ? new Date(createRequest.contract_end_date)
                  : undefined,
                resignation_date: createRequest.resignation_date
                  ? new Date(createRequest.resignation_date)
                  : undefined,
                last_working_date: createRequest.last_working_date
                  ? new Date(createRequest.last_working_date)
                  : undefined,
                notes: createRequest.notes,
                marital_status: createRequest.marital_status,
                mobile_phone: createRequest.mobile_phone,
                residential_address: createRequest.residential_address,
                nik: createRequest.nik,
                npwp: createRequest.npwp,
                bank_account_number: createRequest.bank_account_number,
                bpjs_number: createRequest.bpjs_number,
                bpjs_employment_number: createRequest.bpjs_employment_number,
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

    return toEmployeeResponse(personWithRelations, admin);
  }
  static async update(
    admin: AdminUser,
    request: UpdateEmployeeRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
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

    const updateRequest = Validation.validate(
      EmployeeValidation.UPDATE,
      request,
    );

    const existingEmployee = await CheckExist.checkEmployeeExists(
      updateRequest.id,
    );
    const oldSnapshot = toEmployeeAuditSnapshot(
      existingEmployee.person,
      existingEmployee,
    );

    if (admin.role === AdminRole.DATABASE_ADMIN) {
      if (!admin.can_write_data) {
        await recordUnauthorizedEmployeeAction(
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
    const nextResignationDate =
      updateRequest.resignation_date !== undefined
        ? updateRequest.resignation_date
        : existingEmployee.resignation_date;

    if (nextStatus === EmployeeStatus.RESIGNED && !nextResignationDate) {
      throw new ResponseError(
        400,
        "Resignation date is required when status is RESIGNED",
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
    await assertIdentifierFieldsEditable(
      admin,
      existingEmployee.created_at,
      Boolean(
        nikChanged ||
          npwpChanged ||
          bpjsChanged ||
          bankAccountChanged ||
          bpjsEmploymentChanged,
      ),
      "NIK/NPWP/BPJS/BPJS Ketenagakerjaan/Bank account",
      context,
      now,
    );

    await assertEmployeeIdentityFieldsUnique(
      {
        nik: updateRequest.nik,
        npwp: updateRequest.npwp,
        bank_account_number: updateRequest.bank_account_number,
        bpjs_number: updateRequest.bpjs_number,
        bpjs_employment_number: updateRequest.bpjs_employment_number,
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

    try {
      await prismaClient.$transaction(async (tx) => {
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
            birth_place: updateRequest.birth_place,
            birth_date: updateRequest.birth_date
              ? new Date(updateRequest.birth_date)
              : undefined,
            photo_url: updateRequest.photo_url,

            employee: {
              update: {
                employee_id: updateRequest.employee_id,
                employment_type: updateRequest.employment_type,
                status: updateRequest.status,
                unit_id: updateRequest.unit_id,
                job_position_id: updateRequest.job_position_id,
                job_level_id: updateRequest.job_level_id,
                building_id: updateRequest.building_id,
                join_date: updateRequest.join_date
                  ? new Date(updateRequest.join_date)
                  : undefined,
                contract_end_date: updateRequest.contract_end_date
                  ? new Date(updateRequest.contract_end_date)
                  : undefined,
                resignation_date: updateRequest.resignation_date
                  ? new Date(updateRequest.resignation_date)
                  : undefined,
                last_working_date: updateRequest.last_working_date
                  ? new Date(updateRequest.last_working_date)
                  : undefined,
                notes: updateRequest.notes,
                marital_status: updateRequest.marital_status,
                mobile_phone: updateRequest.mobile_phone,
                residential_address: updateRequest.residential_address,
                nik: updateRequest.nik,
                npwp: updateRequest.npwp,
                bank_account_number: updateRequest.bank_account_number,
                bpjs_number: updateRequest.bpjs_number,
                bpjs_employment_number: updateRequest.bpjs_employment_number,
              },
            },
          },
        });

        // flat include only - a nested include here races on the tx's single
        // pg connection, and the audit snapshot only needs raw employee fields
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
          include: { unit: true, job_position: true, job_level: true, building: true },
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
    admin: AdminUser,
    request: GetEmployeeRequest,
  ): Promise<EmployeeResponse | EmployeeDetailResponse> {
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
          },
        },
      },
    });

    if (!person || !person.employee) {
      throw new ResponseError(404, "Employee not found");
    }

    if (admin.role !== AdminRole.SUPER_ADMIN && !admin.can_view_all_units) {
      if (person.employee.unit_id !== admin.unit_id) {
        throw new ResponseError(404, "Employee not found");
      }
    }

    if (admin.role === AdminRole.SUPER_ADMIN) {
      return toEmployeeDetailResponse(person, admin);
    }

    return toEmployeeResponse(person, admin);
  }

  static async search(
    admin: AdminUser,
    request: SearchEmployeeRequest,
  ): Promise<Pageable<EmployeeResponse>> {
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
                },
              },
            },
          })
          .then((persons) => {
            const data: EmployeeResponse[] = [];
            for (const person of persons) {
              if (person.employee) {
                data.push(toEmployeeResponse(person, admin));
              }
            }
            return data;
          }),
    });
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
        nik: true,
        npwp: true,
        bank_account_number: true,
        bpjs_number: true,
        bpjs_employment_number: true,
      },
    });

    if (!targetEmployee) {
      throw new ResponseError(404, "Employee not found");
    }

    if (targetEmployee.deleted_at !== null) {
      throw new ResponseError(400, "Employee is already deleted");
    }

    const deletedAt = new Date();
    await prismaClient.$transaction(async (tx) => {
      await tx.employee.update({
        where: {
          id: request.id,
        },
        data: {
          deleted_at: deletedAt,
          status: EmployeeStatus.ARCHIVED,
          // Frees these identity numbers for someone else if this was a
          // mistaken entry - the pre-archive values live on in old_values
          // below, so nothing is actually lost.
          nik: null,
          npwp: null,
          bank_account_number: null,
          bpjs_number: null,
          bpjs_employment_number: null,
        },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_EMPLOYEE,
          source: AuditSource.UI,
          entity_type: "Employee",
          entity_id: targetEmployee.id,
          admin_id: admin.id,
          old_values: {
            status: targetEmployee.status,
            nik: targetEmployee.nik,
            npwp: targetEmployee.npwp,
            bank_account_number: targetEmployee.bank_account_number,
            bpjs_number: targetEmployee.bpjs_number,
            bpjs_employment_number: targetEmployee.bpjs_employment_number,
          },
          new_values: {
            status: EmployeeStatus.ARCHIVED,
            deleted_at: deletedAt.toISOString(),
            nik: null,
            npwp: null,
            bank_account_number: null,
            bpjs_number: null,
            bpjs_employment_number: null,
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

    await prismaClient.$transaction(async (tx) => {
      await tx.employee.update({
        where: {
          id: request.id,
        },
        data: {
          deleted_at: null,
          status: EmployeeStatus.ACTIVE,
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
          new_values: { status: EmployeeStatus.ACTIVE, deleted_at: null },
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

    const items: BulkActionItemResponse<EmployeeResponse | boolean>[] = [];

    for (const id of bulkRequest.ids) {
      try {
        const data = await EmployeeService.remove(admin, { id }, context);
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
}
