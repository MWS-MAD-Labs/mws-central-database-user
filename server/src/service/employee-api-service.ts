import {
  AuditAction,
  AuditSource,
  EmployeeStatus,
  PersonType,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toEmployeeLookupResponse,
  type EmployeeLookupRequest,
  type EmployeeLookupResponse,
} from "../model/employee-api-model";
import type { ApiClientVariables } from "../type/hono-context";
import { AuditService } from "./audit-service";
import { EmployeeApiValidation } from "../validation/employee-api-validation";
import { Validation } from "../validation/validation";

export class EmployeeApiService {
  static async lookupByEmail(
    client: ApiClientVariables,
    request: EmployeeLookupRequest,
    context: AuditRequestContext = {},
  ): Promise<EmployeeLookupResponse> {
    const lookupRequest = Validation.validate(
      EmployeeApiValidation.LOOKUP,
      request,
    );

    const person = await prismaClient.person.findFirst({
      where: {
        email: lookupRequest.email,
        person_type: PersonType.EMPLOYEE,
        deleted_at: null,
        employee: { status: EmployeeStatus.ACTIVE, deleted_at: null },
      },
      include: {
        employee: {
          include: { unit: true, job_position: true, job_level: true },
        },
      },
    });

    await AuditService.record({
      action: AuditAction.API_ACCESS,
      source: AuditSource.API,
      api_client_id: client.clientId,
      new_values: {
        requested_email: lookupRequest.email,
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
}
