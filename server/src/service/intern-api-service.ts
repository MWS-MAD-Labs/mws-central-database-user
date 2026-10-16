import { AuditAction, AuditSource, InternStatus, PersonType, type Prisma } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import { paginate, type Pageable } from "../model/page-model";
import {
  toInternLookupResponse,
  type InternListRequest,
  type InternLookupRequest,
  type InternLookupResponse,
  type InternPerson,
} from "../model/intern-api-model";
import type { ApiClientVariables } from "../type/hono-context";
import { AuditService } from "./audit-service";
import { InternApiValidation } from "../validation/intern-api-validation";
import { Validation } from "../validation/validation";
import { withLookupCache } from "../lib/lookup-cache";

// Shared with PersonApiService's combined lookup.
export const INTERN_INCLUDE = {
  intern: { include: { unit: true, job_position: true, building: true } },
} as const;

export class InternApiService {
  static async lookup(
    client: ApiClientVariables,
    request: InternLookupRequest,
    context: AuditRequestContext = {},
  ): Promise<InternLookupResponse> {
    const lookupRequest = Validation.validate(InternApiValidation.LOOKUP, request);

    const { value: person, cached } = await withLookupCache(
      "intern",
      [lookupRequest.email, lookupRequest.id, lookupRequest.person_id],
      async () =>
        (await prismaClient.person.findFirst({
          where: {
            person_type: PersonType.INTERN,
            deleted_at: null,
            ...(lookupRequest.email ? { email: { equals: lookupRequest.email, mode: "insensitive" } } : {}),
            ...(lookupRequest.person_id ? { id: lookupRequest.person_id } : {}),
            intern: {
              status: InternStatus.ACTIVE,
              deleted_at: null,
              ...(lookupRequest.id ? { id: lookupRequest.id } : {}),
            },
          },
          include: INTERN_INCLUDE,
        })) as InternPerson | null,
      // An id lookup re-checks someone already resolved, so it never reads the cache.
      { skipCache: Boolean(lookupRequest.id || lookupRequest.person_id) },
    );

    if (!cached) {
      await AuditService.record({
        action: AuditAction.API_ACCESS,
        source: AuditSource.API,
        api_client_id: client.clientId,
        entity_type: "Intern",
        entity_id: person?.intern?.id,
        new_values: {
          requested_id: lookupRequest.id ?? null,
          requested_person_id: lookupRequest.person_id ?? null,
          requested_email: lookupRequest.email ?? null,
          found: person !== null,
          full_name: person?.full_name ?? null,
        },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });
    }

    if (!person || !person.intern) throw new ResponseError(404, "Intern not found");
    return toInternLookupResponse(person);
  }

  static async list(
    _client: ApiClientVariables,
    request: InternListRequest,
  ): Promise<Pageable<InternLookupResponse>> {
    const listRequest = Validation.validate(InternApiValidation.LIST, request);
    const internFilters: Prisma.InternWhereInput = {
      deleted_at: null,
      status: listRequest.status ?? InternStatus.ACTIVE,
    };
    if (listRequest.unit_id) internFilters.unit_id = listRequest.unit_id;
    if (listRequest.job_position_id) internFilters.job_position_id = listRequest.job_position_id;

    const where: Prisma.PersonWhereInput = {
      person_type: PersonType.INTERN,
      deleted_at: null,
      intern: internFilters,
      ...(listRequest.q
        ? {
            OR: [
              { full_name: { contains: listRequest.q, mode: "insensitive" } },
              { email: { contains: listRequest.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    return paginate(listRequest.page, listRequest.size, {
      count: () => prismaClient.person.count({ where }),
      findMany: () =>
        prismaClient.person
          .findMany({
            where,
            take: listRequest.size,
            skip: (listRequest.page - 1) * listRequest.size,
            orderBy: { created_at: "desc" },
            include: INTERN_INCLUDE,
          })
          .then((persons) => (persons as InternPerson[]).map(toInternLookupResponse)),
    });
  }
}
