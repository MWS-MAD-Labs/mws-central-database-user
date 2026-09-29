import {
  AdminRole,
  AuditAction,
  AuditSource,
  EmployeeStatus,
  PersonType,
  type AdminUser,
  type ApplicationEntitlement,
} from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toApplicationEntitlementResponse,
  type ApplicationEntitlementLookupRequest,
  type ApplicationEntitlementResponse,
  type GrantApplicationEntitlementRequest,
  type ListApplicationEntitlementsRequest,
  type RevokeApplicationEntitlementRequest,
  type UpdateApplicationEntitlementRequest,
} from "../model/application-entitlement-model";
import type { ApiClientVariables } from "../type/hono-context";
import { ApplicationEntitlementValidation } from "../validation/application-entitlement-validation";
import { Validation } from "../validation/validation";
import { AuditService } from "./audit-service";

function assertSuperAdmin(admin: AdminUser) {
  if (admin.role !== AdminRole.SUPER_ADMIN) {
    throw new ResponseError(
      403,
      "Forbidden: Only Super Admin can manage application entitlements",
    );
  }
}

function auditSnapshot(entitlement: ApplicationEntitlement) {
  return {
    person_id: entitlement.person_id,
    application_id: entitlement.application_id,
    organization_id: entitlement.organization_id,
    role: entitlement.role,
    permissions: entitlement.permissions,
    version: entitlement.version,
    is_active: entitlement.is_active,
  };
}

export class ApplicationEntitlementService {
  static async lookup(
    client: ApiClientVariables,
    request: ApplicationEntitlementLookupRequest,
    context: AuditRequestContext = {},
  ): Promise<ApplicationEntitlementResponse> {
    const lookup = Validation.validate(
      ApplicationEntitlementValidation.LOOKUP,
      request,
    );

    const entitlement = await prismaClient.applicationEntitlement.findFirst({
      where: {
        person_id: lookup.person_id,
        application_id: lookup.application_id,
        is_active: true,
        person: {
          deleted_at: null,
          person_type: PersonType.EMPLOYEE,
          employee: { status: EmployeeStatus.ACTIVE, deleted_at: null },
        },
      },
      orderBy: { updated_at: "desc" },
    });

    await AuditService.record({
      action: AuditAction.API_ACCESS,
      source: AuditSource.API,
      api_client_id: client.clientId,
      entity_type: "ApplicationEntitlement",
      entity_id: entitlement?.id,
      new_values: {
        requested_person_id: lookup.person_id ?? null,
        requested_application_id: lookup.application_id ?? null,
        found: entitlement !== null,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    if (!entitlement) {
      throw new ResponseError(404, "Active application entitlement not found");
    }

    return toApplicationEntitlementResponse(entitlement);
  }

  static async grant(
    admin: AdminUser,
    request: GrantApplicationEntitlementRequest,
    context: AuditRequestContext = {},
  ): Promise<ApplicationEntitlementResponse> {
    assertSuperAdmin(admin);
    const grant = Validation.validate(
      ApplicationEntitlementValidation.GRANT,
      request,
    );

    const person = await prismaClient.person.findFirst({
      where: {
        id: grant.person_id,
        deleted_at: null,
        person_type: PersonType.EMPLOYEE,
        employee: { status: EmployeeStatus.ACTIVE, deleted_at: null },
      },
      select: { id: true },
    });
    if (!person) {
      throw new ResponseError(404, "Active employee person not found");
    }

    const existing = await prismaClient.applicationEntitlement.findUnique({
      where: {
        person_id_application_id: {
          person_id: grant.person_id,
          application_id: grant.application_id,
        },
      },
    });
    if (existing?.is_active) {
      throw new ResponseError(400, "Application entitlement already exists");
    }

    const entitlement = await prismaClient.$transaction(async (tx) => {
      const saved = existing
        ? await tx.applicationEntitlement.update({
            where: { id: existing.id },
            data: {
              role: grant.role,
              permissions: grant.permissions,
              is_active: true,
              version: { increment: 1 },
              granted_at: new Date(),
            },
          })
        : await tx.applicationEntitlement.create({ data: grant });

      await AuditService.record(
        {
          action: AuditAction.APPLICATION_ENTITLEMENT_GRANT,
          source: AuditSource.UI,
          entity_type: "ApplicationEntitlement",
          entity_id: saved.id,
          admin_id: admin.id,
          old_values: existing ? auditSnapshot(existing) : undefined,
          new_values: auditSnapshot(saved),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return saved;
    });

    return toApplicationEntitlementResponse(entitlement);
  }

  static async update(
    admin: AdminUser,
    request: UpdateApplicationEntitlementRequest,
    context: AuditRequestContext = {},
  ): Promise<ApplicationEntitlementResponse> {
    assertSuperAdmin(admin);
    const update = Validation.validate(
      ApplicationEntitlementValidation.UPDATE,
      request,
    );
    const existing = await prismaClient.applicationEntitlement.findUnique({
      where: { id: update.id },
    });
    if (!existing) throw new ResponseError(404, "Application entitlement not found");
    if (!existing.is_active) {
      throw new ResponseError(400, "Cannot update a revoked application entitlement");
    }
    const normalizedUpdate = Validation.validate(
      ApplicationEntitlementValidation.GRANT,
      {
        person_id: existing.person_id,
        application_id: existing.application_id,
        organization_id: existing.organization_id,
        role: update.role ?? existing.role,
        permissions: update.permissions ?? existing.permissions,
      },
    );

    const entitlement = await prismaClient.$transaction(async (tx) => {
      const saved = await tx.applicationEntitlement.update({
        where: { id: update.id },
        data: {
          role: normalizedUpdate.role,
          permissions: normalizedUpdate.permissions,
          version: { increment: 1 },
        },
      });
      await AuditService.record(
        {
          action: AuditAction.APPLICATION_ENTITLEMENT_UPDATE,
          source: AuditSource.UI,
          entity_type: "ApplicationEntitlement",
          entity_id: saved.id,
          admin_id: admin.id,
          old_values: auditSnapshot(existing),
          new_values: auditSnapshot(saved),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return saved;
    });

    return toApplicationEntitlementResponse(entitlement);
  }

  static async revoke(
    admin: AdminUser,
    request: RevokeApplicationEntitlementRequest,
    context: AuditRequestContext = {},
  ): Promise<ApplicationEntitlementResponse> {
    assertSuperAdmin(admin);
    const revoke = Validation.validate(
      ApplicationEntitlementValidation.REVOKE,
      request,
    );
    const existing = await prismaClient.applicationEntitlement.findUnique({
      where: { id: revoke.id },
    });
    if (!existing) throw new ResponseError(404, "Application entitlement not found");
    if (!existing.is_active) {
      throw new ResponseError(400, "Application entitlement is already revoked");
    }

    const entitlement = await prismaClient.$transaction(async (tx) => {
      const saved = await tx.applicationEntitlement.update({
        where: { id: revoke.id },
        data: { is_active: false, version: { increment: 1 } },
      });
      await AuditService.record(
        {
          action: AuditAction.APPLICATION_ENTITLEMENT_REVOKE,
          source: AuditSource.UI,
          entity_type: "ApplicationEntitlement",
          entity_id: saved.id,
          admin_id: admin.id,
          old_values: auditSnapshot(existing),
          new_values: auditSnapshot(saved),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return saved;
    });

    return toApplicationEntitlementResponse(entitlement);
  }

  static async list(
    admin: AdminUser,
    request: ListApplicationEntitlementsRequest,
  ): Promise<ApplicationEntitlementResponse[]> {
    assertSuperAdmin(admin);
    const filters = Validation.validate(
      ApplicationEntitlementValidation.LIST,
      request,
    );
    const entitlements = await prismaClient.applicationEntitlement.findMany({
      where: filters,
      orderBy: { updated_at: "desc" },
    });
    return entitlements.map(toApplicationEntitlementResponse);
  }
}
