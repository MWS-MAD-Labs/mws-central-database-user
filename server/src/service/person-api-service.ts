import {
  AuditAction,
  AuditSource,
  EmployeeStatus,
  InternStatus,
  PersonType,
  StudentStatus,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toPersonLookupResponse,
  type PersonLookupPerson,
  type PersonLookupRequest,
  type PersonLookupResponse,
} from "../model/person-api-model";
import { API_SCOPES } from "../constants/api-scopes";
import { EMPLOYEE_INCLUDE } from "./employee-api-service";
import { INTERN_INCLUDE } from "./intern-api-service";
import type { ApiClientVariables } from "../type/hono-context";
import { AuditService } from "./audit-service";
import { PersonApiValidation } from "../validation/person-api-validation";
import { Validation } from "../validation/validation";
import { withLookupCache } from "../lib/lookup-cache";

export class PersonApiService {
  static async lookup(
    client: ApiClientVariables,
    request: PersonLookupRequest,
    context: AuditRequestContext = {},
  ): Promise<PersonLookupResponse> {
    const lookupRequest = Validation.validate(
      PersonApiValidation.LOOKUP,
      request,
    );

    // Interns are found only by a client that may read them, so a caller without the scope sees what it always saw.
    const withInterns = client.scopes.includes(API_SCOPES.INTERNS_READ);
    const { value: person, cached } = await withLookupCache(
      "person",
      [lookupRequest.email, withInterns ? "with-interns" : ""],
      async () =>
        (await prismaClient.person.findFirst({
          where: {
            deleted_at: null,
            email: { equals: lookupRequest.email, mode: "insensitive" },
            // Same eligibility rules as /employees/lookup and
            // /students/lookup, OR'd - matches either path exactly, never
            // grants access either individual endpoint wouldn't.
            OR: [
              {
                person_type: PersonType.EMPLOYEE,
                employee: { status: EmployeeStatus.ACTIVE, deleted_at: null },
              },
              ...(withInterns
                ? [{ person_type: PersonType.INTERN, intern: { status: InternStatus.ACTIVE, deleted_at: null } }]
                : []),
              {
                person_type: PersonType.STUDENT,
                student: {
                  status: { in: [StudentStatus.REGISTERED, StudentStatus.ACTIVE] },
                  deleted_at: null,
                },
              },
            ],
          },
          include: {
            ...EMPLOYEE_INCLUDE,
            ...(withInterns ? INTERN_INCLUDE : {}),
            student: { include: { current_grade: true, current_class: true } },
          },
        })) as PersonLookupPerson | null,
    );

    if (!cached) {
      await AuditService.record({
        action: AuditAction.API_ACCESS,
        source: AuditSource.API,
        api_client_id: client.clientId,
        entity_type: "Person",
        entity_id: person?.employee?.id ?? person?.intern?.id ?? person?.student?.id,
        new_values: {
          requested_email: lookupRequest.email,
          found: person !== null,
          source: person?.employee ? "employee" : person?.intern ? "intern" : person?.student ? "student" : null,
          full_name: person?.full_name ?? null,
        },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });
    }

    if (!person || (!person.employee && !person.intern && !person.student)) {
      throw new ResponseError(404, "Person not found");
    }

    return toPersonLookupResponse(person);
  }
}
