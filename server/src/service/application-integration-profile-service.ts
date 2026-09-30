import {
  AdminRole,
  AuditAction,
  AuditSource,
  IntegrationProfileStatus,
  type AdminUser,
  type Prisma,
} from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import { ApplicationIntegrationProfileValidation } from "../validation/application-integration-profile-validation";
import { Validation } from "../validation/validation";
import { AuditService } from "./audit-service";

const PROFILE_INCLUDE = {
  scopes: { include: { scope: true } },
  _count: { select: { clients: true } },
} satisfies Prisma.ApplicationIntegrationProfileInclude;

type ProfileWithScopes = Prisma.ApplicationIntegrationProfileGetPayload<{
  include: typeof PROFILE_INCLUDE;
}>;

export type CreateApplicationIntegrationProfileRequest = {
  code: string;
  name: string;
  description?: string;
  scope_names: string[];
};

export type UpdateApplicationIntegrationProfileRequest = {
  id: string;
  name?: string;
  description?: string | null;
  status?: IntegrationProfileStatus;
  scope_names?: string[];
};

function assertSuperAdmin(admin: AdminUser, action: string): void {
  if (admin.role !== AdminRole.SUPER_ADMIN) {
    throw new ResponseError(
      403,
      `Forbidden: Only Super Admin can ${action} application integration profiles`,
    );
  }
}

function toProfileResponse(profile: ProfileWithScopes) {
  return {
    id: profile.id,
    code: profile.code,
    name: profile.name,
    description: profile.description,
    status: profile.status,
    version: profile.version,
    is_system: profile.is_system,
    client_count: profile._count.clients,
    scopes: profile.scopes
      .map(({ scope }) => ({
        name: scope.name,
        description: scope.description,
        is_sensitive: scope.is_sensitive,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    created_at: profile.created_at.toISOString(),
    updated_at: profile.updated_at.toISOString(),
  };
}

function toAuditSnapshot(profile: ProfileWithScopes) {
  return {
    code: profile.code,
    name: profile.name,
    description: profile.description,
    status: profile.status,
    version: profile.version,
    scopes: profile.scopes.map(({ scope }) => scope.name).sort(),
  };
}

async function resolveScopeIds(
  tx: Prisma.TransactionClient,
  scopeNames: string[],
): Promise<string[]> {
  const unique = [...new Set(scopeNames)];
  const scopes = await tx.apiScope.findMany({
    where: { name: { in: unique }, is_active: true },
    select: { id: true },
  });
  if (scopes.length !== unique.length) {
    throw new ResponseError(400, "One or more scopes do not exist or are inactive");
  }
  return scopes.map((scope) => scope.id);
}

export class ApplicationIntegrationProfileService {
  static async list(admin: AdminUser) {
    assertSuperAdmin(admin, "view");

    const profiles = await prismaClient.applicationIntegrationProfile.findMany({
      include: PROFILE_INCLUDE,
      orderBy: { name: "asc" },
    });
    return profiles.map(toProfileResponse);
  }

  static async listScopes(admin: AdminUser) {
    assertSuperAdmin(admin, "view");

    const scopes = await prismaClient.apiScope.findMany({
      where: { is_active: true },
      orderBy: { name: "asc" },
    });
    return scopes.map((scope) => ({
      name: scope.name,
      description: scope.description,
      is_sensitive: scope.is_sensitive,
    }));
  }

  static async create(
    admin: AdminUser,
    request: CreateApplicationIntegrationProfileRequest,
    context: AuditRequestContext = {},
  ) {
    assertSuperAdmin(admin, "create");
    const createRequest = Validation.validate(
      ApplicationIntegrationProfileValidation.CREATE,
      request,
    );

    let createdId: string;
    try {
      createdId = await prismaClient.$transaction(async (tx) => {
        const scopeIds = await resolveScopeIds(tx, createRequest.scope_names);
        const created = await tx.applicationIntegrationProfile.create({
          data: {
            code: createRequest.code,
            name: createRequest.name,
            description: createRequest.description,
            is_system: false,
            scopes: { create: scopeIds.map((scope_id) => ({ scope_id })) },
          },
        });
        const fetched = await tx.applicationIntegrationProfile.findUniqueOrThrow({
          where: { id: created.id },
          include: PROFILE_INCLUDE,
        });
        await AuditService.record(
          {
            action: AuditAction.CREATE_MASTER_DATA,
            source: AuditSource.UI,
            entity_type: "ApplicationIntegrationProfile",
            entity_id: created.id,
            admin_id: admin.id,
            new_values: toAuditSnapshot(fetched),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );
        return created.id;
      });
    } catch (error) {
      if (getUniqueConstraintFields(error)?.includes("code")) {
        throw new ResponseError(400, "An application profile with this code already exists");
      }
      throw error;
    }

    const profile = await prismaClient.applicationIntegrationProfile.findUniqueOrThrow({
      where: { id: createdId },
      include: PROFILE_INCLUDE,
    });
    return toProfileResponse(profile);
  }

  static async update(
    admin: AdminUser,
    request: UpdateApplicationIntegrationProfileRequest,
    context: AuditRequestContext = {},
  ) {
    assertSuperAdmin(admin, "update");
    const updateRequest = Validation.validate(
      ApplicationIntegrationProfileValidation.UPDATE,
      request,
    );

    await prismaClient.$transaction(async (tx) => {
      const existing = await tx.applicationIntegrationProfile.findUnique({
        where: { id: updateRequest.id },
        include: PROFILE_INCLUDE,
      });
      if (!existing) {
        throw new ResponseError(404, "Application integration profile not found");
      }

      if (existing.code === "unmapped") {
        throw new ResponseError(
          400,
          "The unmapped profile is a placeholder for legacy clients and cannot be edited",
        );
      }

      let scopesChanged = false;
      if (updateRequest.scope_names) {
        const scopeIds = await resolveScopeIds(tx, updateRequest.scope_names);
        const currentIds = existing.scopes.map(({ scope_id }) => scope_id).sort();
        const nextIds = [...scopeIds].sort();
        scopesChanged = JSON.stringify(currentIds) !== JSON.stringify(nextIds);
        if (scopesChanged) {
          await tx.applicationIntegrationProfileScope.deleteMany({
            where: { profile_id: existing.id },
          });
          await tx.applicationIntegrationProfileScope.createMany({
            data: scopeIds.map((scope_id) => ({ profile_id: existing.id, scope_id })),
          });
        }
      }

      await tx.applicationIntegrationProfile.update({
        where: { id: existing.id },
        data: {
          name: updateRequest.name,
          description: updateRequest.description,
          status: updateRequest.status,
          // Clients read scopes through the profile, so a scope change is a new version.
          ...(scopesChanged ? { version: { increment: 1 } } : {}),
        },
      });

      const updated = await tx.applicationIntegrationProfile.findUniqueOrThrow({
        where: { id: existing.id },
        include: PROFILE_INCLUDE,
      });
      await AuditService.record(
        {
          action: AuditAction.UPDATE_MASTER_DATA,
          source: AuditSource.UI,
          entity_type: "ApplicationIntegrationProfile",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: toAuditSnapshot(existing),
          new_values: toAuditSnapshot(updated),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const profile = await prismaClient.applicationIntegrationProfile.findUniqueOrThrow({
      where: { id: updateRequest.id },
      include: PROFILE_INCLUDE,
    });
    return toProfileResponse(profile);
  }
}
