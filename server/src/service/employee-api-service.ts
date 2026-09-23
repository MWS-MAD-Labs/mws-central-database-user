import {
  AuditAction,
  AuditSource,
  EmployeeStatus,
  PersonType,
  type Prisma,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import { paginate, type Pageable } from "../model/page-model";
import {
  toEmployeeLookupResponse,
  type EmployeeListRequest,
  type EmployeeLookupRequest,
  type EmployeeLookupResponse,
} from "../model/employee-api-model";
import type { PersonWithEmployee } from "../model/employee-model";
import type { ApiClientVariables } from "../type/hono-context";
import { AuditService } from "./audit-service";
import { EmployeeApiValidation } from "../validation/employee-api-validation";
import { Validation } from "../validation/validation";
import { withLookupCache } from "../lib/lookup-cache";

// Shared with PersonApiService's combined employee-or-student lookup.
export const EMPLOYEE_INCLUDE = {
  employee: {
    include: {
      unit: true,
      job_position: true,
      job_level: true,
      building: true,
    },
  },
} as const;

export class EmployeeApiService {
  static async lookup(
    client: ApiClientVariables,
    request: EmployeeLookupRequest,
    context: AuditRequestContext = {},
  ): Promise<EmployeeLookupResponse> {
    const lookupRequest = Validation.validate(
      EmployeeApiValidation.LOOKUP,
      request,
    );

    const { value: person, cached } = await withLookupCache(
      "employee",
      [lookupRequest.email, lookupRequest.employee_id, lookupRequest.id, lookupRequest.person_id],
      async () =>
        (await prismaClient.person.findFirst({
          where: {
            person_type: PersonType.EMPLOYEE,
            deleted_at: null,
            // Case-insensitive - see the matching note in
            // StudentApiService.lookup().
            ...(lookupRequest.email
              ? { email: { equals: lookupRequest.email, mode: "insensitive" } }
              : {}),
            // Person.id, not Employee.id - a different id space from `id`
            // below (see the field comment on EmployeeLookupRequest).
            ...(lookupRequest.person_id ? { id: lookupRequest.person_id } : {}),
            employee: {
              status: EmployeeStatus.ACTIVE,
              deleted_at: null,
              ...(lookupRequest.id ? { id: lookupRequest.id } : {}),
              ...(lookupRequest.employee_id
                ? { employee_id: lookupRequest.employee_id }
                : {}),
            },
          },
          include: EMPLOYEE_INCLUDE,
        })) as PersonWithEmployee | null,
      // id/person_id-based lookups are always a re-verification of someone
      // already resolved once (see mws-hub's resolveCentralIdentityById, and
      // LearnSpace's grant-time candidate re-validation) - the whole point
      // is catching a change (email, active status, ...) as soon as it
      // happens, so this path skips the 5-minute cache that email/
      // employee_id lookups (bulk roster syncs, high volume) use.
      { skipCache: Boolean(lookupRequest.id || lookupRequest.person_id) },
    );

    // Only on a real cache miss - see the matching note in
    // StudentApiService.lookup().
    if (!cached) {
      await AuditService.record({
        action: AuditAction.API_ACCESS,
        source: AuditSource.API,
        api_client_id: client.clientId,
        // Audit the employee entity type even when no employee matches.
        entity_type: "Employee",
        entity_id: person?.employee?.id,
        new_values: {
          requested_id: lookupRequest.id ?? null,
          requested_person_id: lookupRequest.person_id ?? null,
          requested_employee_id: lookupRequest.employee_id ?? null,
          requested_email: lookupRequest.email ?? null,
          found: person !== null,
          full_name: person?.full_name ?? null,
        },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });
    }

    if (!person || !person.employee) {
      throw new ResponseError(404, "Employee not found");
    }

    return toEmployeeLookupResponse(person);
  }

  static async list(
    client: ApiClientVariables,
    request: EmployeeListRequest,
    context: AuditRequestContext = {},
  ): Promise<Pageable<EmployeeLookupResponse>> {
    const listRequest = Validation.validate(
      EmployeeApiValidation.LIST,
      request,
    );
    const employeeFilters: Prisma.EmployeeWhereInput = {
      deleted_at: null,
      status: listRequest.status ?? EmployeeStatus.ACTIVE,
    };
    if (listRequest.unit_id) employeeFilters.unit_id = listRequest.unit_id;
    if (listRequest.job_position_id)
      employeeFilters.job_position_id = listRequest.job_position_id;

    const whereClause: Prisma.PersonWhereInput = {
      person_type: PersonType.EMPLOYEE,
      deleted_at: null,
      employee: employeeFilters,
      ...(listRequest.q
        ? {
            OR: [
              { full_name: { contains: listRequest.q, mode: "insensitive" } },
              { email: { contains: listRequest.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    // Routine roster syncs rely on last_used_at instead of per-call audits.
    return paginate(listRequest.page, listRequest.size, {
      count: () => prismaClient.person.count({ where: whereClause }),
      findMany: () =>
        prismaClient.person
          .findMany({
            where: whereClause,
            take: listRequest.size,
            skip: (listRequest.page - 1) * listRequest.size,
            orderBy: { created_at: "desc" },
            include: EMPLOYEE_INCLUDE,
          })
          .then((persons) =>
            (persons as PersonWithEmployee[]).map(toEmployeeLookupResponse),
          ),
    });
  }
}
