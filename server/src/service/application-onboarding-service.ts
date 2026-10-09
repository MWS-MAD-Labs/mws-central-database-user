import { AdminRole, ApiCredentialStatus, ApplicationPermissionSource, AuditAction, AuditSource, IntegrationProfileStatus } from "../generated/prisma/client";
import type { AdminUser } from "../generated/prisma/client";
import { API_SCOPES } from "../constants/api-scopes";
import { ResponseError } from "../error/response-error";
import { prismaClient } from "../lib/prisma";
import type { ApiClientCreatedResponse } from "../model/api-client-model";
import type { AuditRequestContext } from "../model/audit-log-model";
import type { UpdateApplicationRequest } from "../model/application-entitlement-model";
import { ApplicationValidation } from "../validation/application-entitlement-validation";
import { Validation } from "../validation/validation";
import { getIntegrationEnvironment } from "../utils/integration-environment";
import { ApiClientService } from "./api-client-service";
import { AuditService } from "./audit-service";
import { resolveOrganizationId } from "./application-entitlement-service";

const CONNECT_PURPOSE = "app-connection";
const CONNECT_SCOPES = [
  API_SCOPES.APPLICATION_PERMISSIONS_WRITE,
  API_SCOPES.APPLICATION_ENTITLEMENTS_READ,
  API_SCOPES.EMPLOYEES_READ,
];

export type ApplicationDetail = {
  application_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  launch_url: string | null;
  logout_url: string | null;
  published: boolean;
};

export type SetupStatus = {
  application: ApplicationDetail;
  organization_id: string;
  connection: { client_id: string | null; created: boolean; last_used_at: string | null };
  permissions: { count: number; synced_at: string | null };
  roles: { active_count: number };
  groups: { active_count: number };
  can_publish: boolean;
  missing: string[];
};

export type ConnectResponse = {
  client: ApiClientCreatedResponse;
  token: string;
  env: { key: string; value: string }[];
};

function assertSuperAdmin(admin: AdminUser) {
  if (admin.role !== AdminRole.SUPER_ADMIN) {
    throw new ResponseError(403, "Forbidden: Only Super Admin can manage applications");
  }
}

function toDetail(row: {
  application_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  launch_url: string | null;
  logout_url: string | null;
  published: boolean;
}): ApplicationDetail {
  return {
    application_id: row.application_id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    category: row.category,
    launch_url: row.launch_url,
    logout_url: row.logout_url,
    published: row.published,
  };
}

async function findApplication(applicationId: string) {
  const app = await prismaClient.application.findUnique({ where: { application_id: applicationId } });
  if (!app) throw new ResponseError(404, `Application ${applicationId} not found`);
  return app;
}

// The profile and client that connect this application to Central, if any.
async function findConnectionClient(applicationId: string) {
  return prismaClient.apiClient.findFirst({
    where: {
      profile: { code: applicationId },
      environment: getIntegrationEnvironment(),
      purpose: CONNECT_PURPOSE,
      is_active: true,
    },
    orderBy: { created_at: "asc" },
  });
}

export class ApplicationOnboardingService {
  static async get(admin: AdminUser, applicationId: string): Promise<ApplicationDetail> {
    assertSuperAdmin(admin);
    return toDetail(await findApplication(applicationId));
  }

  static async update(
    admin: AdminUser,
    request: UpdateApplicationRequest,
    context: AuditRequestContext = {},
  ): Promise<ApplicationDetail> {
    assertSuperAdmin(admin);
    const input = Validation.validate(ApplicationValidation.UPDATE, request);
    const before = await findApplication(input.application_id);
    const data = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description || null }),
      ...(input.icon !== undefined && { icon: input.icon || null }),
      ...(input.category !== undefined && { category: input.category || null }),
      ...(input.launch_url !== undefined && { launch_url: input.launch_url || null }),
      ...(input.logout_url !== undefined && { logout_url: input.logout_url || null }),
    };
    await prismaClient.application.update({ where: { id: before.id }, data });
    const after = await findApplication(input.application_id);
    await AuditService.record({
      action: AuditAction.APPLICATION_ROLE_UPDATE,
      source: AuditSource.UI,
      entity_type: "Application",
      entity_id: after.id,
      admin_id: admin.id,
      old_values: toDetail(before),
      new_values: toDetail(after),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });
    return toDetail(after);
  }

  // Progress is read from the data, so nothing is stored about which step a person is on.
  static async setup(admin: AdminUser, applicationId: string): Promise<SetupStatus> {
    assertSuperAdmin(admin);
    const app = await findApplication(applicationId);
    const organizationId = await resolveOrganizationId(applicationId);
    const [client, permissionCount, latestPermission, roles, groups] = await Promise.all([
      findConnectionClient(applicationId),
      prismaClient.applicationPermission.count({
        where: { application_id: applicationId, source: ApplicationPermissionSource.MANIFEST, deprecated_at: null },
      }),
      prismaClient.applicationPermission.aggregate({
        where: { application_id: applicationId, source: ApplicationPermissionSource.MANIFEST },
        _max: { synced_at: true },
      }),
      prismaClient.applicationRole.count({ where: { application_id: applicationId } }),
      prismaClient.applicationAccessRule.count({ where: { application_id: applicationId, is_active: true } }),
    ]);

    let lastUsed: Date | null = null;
    if (client) {
      const credential = await prismaClient.apiClientCredential.aggregate({
        where: { client_id: client.id, status: { not: ApiCredentialStatus.REVOKED } },
        _max: { last_used_at: true },
      });
      lastUsed = [client.last_used_at, credential._max.last_used_at]
        .filter((date): date is Date => Boolean(date))
        .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
    }

    const missing: string[] = [];
    if (permissionCount === 0) missing.push("permissions");
    if (roles === 0) missing.push("roles");
    if (groups === 0) missing.push("groups");

    return {
      application: toDetail(app),
      organization_id: organizationId,
      connection: {
        client_id: client?.id ?? null,
        created: Boolean(client),
        last_used_at: lastUsed ? lastUsed.toISOString() : null,
      },
      permissions: { count: permissionCount, synced_at: latestPermission._max.synced_at?.toISOString() ?? null },
      roles: { active_count: roles },
      groups: { active_count: groups },
      can_publish: missing.length === 0,
      missing,
    };
  }

  // One connection per application: the profile is made when missing, then a client for it.
  static async connect(
    admin: AdminUser,
    applicationId: string,
    publicUrl: string,
    context: AuditRequestContext = {},
  ): Promise<ConnectResponse> {
    assertSuperAdmin(admin);
    const app = await findApplication(applicationId);
    if (await findConnectionClient(applicationId)) {
      throw new ResponseError(400, "This application already has a connection. Rotate its token instead");
    }

    const organizationId = await resolveOrganizationId(applicationId);
    let profile = await prismaClient.applicationIntegrationProfile.findUnique({ where: { code: applicationId } });
    if (!profile) {
      const scopes = await prismaClient.apiScope.findMany({ where: { name: { in: CONNECT_SCOPES } } });
      const created = await prismaClient.applicationIntegrationProfile.create({
        data: {
          code: applicationId,
          name: app.name,
          description: `Connection for ${app.name}`,
          is_system: false,
          scopes: { create: scopes.map((scope) => ({ scope_id: scope.id })) },
        },
      });
      profile = created;
      await AuditService.record({
        action: AuditAction.CREATE_MASTER_DATA,
        source: AuditSource.UI,
        entity_type: "ApplicationIntegrationProfile",
        entity_id: created.id,
        admin_id: admin.id,
        new_values: { code: created.code, name: created.name },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });
    } else if (profile.status !== IntegrationProfileStatus.ACTIVE) {
      throw new ResponseError(400, "The integration profile of this application is not active");
    }

    const client = await ApiClientService.create(
      admin,
      { profile_code: applicationId, purpose: CONNECT_PURPOSE },
      context,
    );

    return {
      client,
      token: client.token,
      env: [
        { key: "HUB_SSO_APP_ID", value: applicationId },
        { key: "CENTRAL_DATA_API_BASE_URL", value: publicUrl },
        { key: "CENTRAL_DATA_API_TOKEN", value: client.token },
        { key: "CENTRAL_ORGANIZATION_ID", value: organizationId },
      ],
    };
  }

  static async publish(
    admin: AdminUser,
    applicationId: string,
    context: AuditRequestContext = {},
  ): Promise<ApplicationDetail> {
    const status = await this.setup(admin, applicationId);
    if (!status.application.launch_url) status.missing.unshift("launch URL");
    if (status.missing.length > 0) {
      throw new ResponseError(400, `Cannot show this application in the Hub yet. Missing: ${status.missing.join(", ")}`);
    }
    return this.setPublished(admin, applicationId, true, context);
  }

  static async unpublish(
    admin: AdminUser,
    applicationId: string,
    context: AuditRequestContext = {},
  ): Promise<ApplicationDetail> {
    assertSuperAdmin(admin);
    await findApplication(applicationId);
    return this.setPublished(admin, applicationId, false, context);
  }

  private static async setPublished(
    admin: AdminUser,
    applicationId: string,
    published: boolean,
    context: AuditRequestContext,
  ): Promise<ApplicationDetail> {
    const before = await findApplication(applicationId);
    await prismaClient.application.update({ where: { id: before.id }, data: { published } });
    const after = await findApplication(applicationId);
    await AuditService.record({
      action: AuditAction.APPLICATION_ROLE_UPDATE,
      source: AuditSource.UI,
      entity_type: "Application",
      entity_id: after.id,
      admin_id: admin.id,
      old_values: { published: before.published },
      new_values: { published },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });
    return toDetail(after);
  }

  // What the Hub reads: published applications only, nothing about people.
  static async listPublished() {
    const rows = await prismaClient.application.findMany({
      where: { published: true, launch_url: { not: null } },
      orderBy: { name: "asc" },
    });
    return rows.map((row) => ({
      id: row.application_id,
      name: row.name,
      description: row.description,
      icon: row.icon,
      category: row.category,
      launch_url: row.launch_url,
      logout_url: row.logout_url,
    }));
  }
}
