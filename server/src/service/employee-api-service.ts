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

const EMPLOYEE_INCLUDE = {
  employee: {
    include: { unit: true, job_position: true, job_level: true },
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

    const person = (await prismaClient.person.findFirst({
      where: {
        person_type: PersonType.EMPLOYEE,
        deleted_at: null,
        ...(lookupRequest.email ? { email: lookupRequest.email } : {}),
        employee: {
          status: EmployeeStatus.ACTIVE,
          deleted_at: null,
          ...(lookupRequest.employee_id
            ? { employee_id: lookupRequest.employee_id }
            : {}),
        },
      },
      include: EMPLOYEE_INCLUDE,
    })) as PersonWithEmployee | null;

    await AuditService.record({
      action: AuditAction.API_ACCESS,
      source: AuditSource.API,
      api_client_id: client.clientId,
      new_values: {
        requested_employee_id: lookupRequest.employee_id ?? null,
        requested_email: lookupRequest.email ?? null,
        found: person !== null,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

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
    };

    await AuditService.record({
      action: AuditAction.API_ACCESS,
      source: AuditSource.API,
      api_client_id: client.clientId,
      new_values: {
        resource: "EmployeeList",
        filters: {
          status: listRequest.status ?? null,
          unit_id: listRequest.unit_id ?? null,
          job_position_id: listRequest.job_position_id ?? null,
        },
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

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
