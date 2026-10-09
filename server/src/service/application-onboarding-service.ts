import { AdminRole, ApiCredentialStatus, ApplicationPermissionSource, AuditAction, AuditSource, IntegrationProfileStatus } from "../generated/prisma/client";
import type { AdminUser } from "../generated/prisma/client";
import { API_SCOPES } from "../constants/api-scopes";
import { hubApplicationId } from "../constants/hub-application";
import { ResponseError } from "../error/response-error";
import { prismaClient } from "../lib/prisma";
import type { ApiClientCreatedResponse } from "../model/api-client-model";
import type { AuditRequestContext } from "../model/audit-log-model";
import type { UpdateApplicationRequest } from "../model/application-entitlement-model";
import { ApplicationValidation } from "../validation/application-entitlement-validation";
import { Validation } from "../validation/validation";
import { getIntegrationEnvironment } from "../utils/integration-environment";
import { ApiClientService } from "./api-client-service";
import { ApplicationIntegrationProfileService } from "./application-integration-profile-service";
import { AuditService } from "./audit-service";
import { resolveOrganizationId } from "./application-entitlement-service";

const CONNECT_PURPOSE = "app-connection";
// Every connection can send permissions and check who may use the application.
export const REQUIRED_CONNECT_SCOPES: string[] = [
  API_SCOPES.APPLICATION_PERMISSIONS_WRITE,
  API_SCOPES.APPLICATION_ENTITLEMENTS_READ,
];
const DEFAULT_DATA_SCOPES: string[] = [API_SCOPES.EMPLOYEES_READ];

const withRequiredScopes = (names?: string[]) => [...new Set([...REQUIRED_CONNECT_SCOPES, ...(names ?? DEFAULT_DATA_SCOPES)])];

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
  connection: { client_id: string | null; created: boolean; created_at: string | null; last_used_at: string | null };
  permissions: { count: number; synced_at: string | null };
  roles: { active_count: number };
  groups: { active_count: number };
  can_publish: boolean;
  missing: string[];
  // The Hub itself has no "show in Hub" step.
  is_hub: boolean;
  // Scopes of the connection profile. Only a profile made for this application can be changed.
  data_access: { scope_names: string[]; editable: boolean };
};

export type RemovalPlan = {
  can_remove: boolean;
  blockers: string[];
  will_delete: { roles: number; groups: number; permissions: number; clients: number };
};

const RECENT_USE_MS = 30 * 24 * 60 * 60 * 1000;

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
    const [client, profile, permissionCount, latestPermission, roles, groups] = await Promise.all([
      findConnectionClient(applicationId),
      prismaClient.applicationIntegrationProfile.findUnique({
        where: { code: applicationId },
        include: { scopes: { include: { scope: true } } },
      }),
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
        created_at: client ? client.created_at.toISOString() : null,
        last_used_at: lastUsed ? lastUsed.toISOString() : null,
      },
      permissions: { count: permissionCount, synced_at: latestPermission._max.synced_at?.toISOString() ?? null },
      roles: { active_count: roles },
      groups: { active_count: groups },
      can_publish: missing.length === 0 && applicationId !== hubApplicationId(),
      missing,
      is_hub: applicationId === hubApplicationId(),
      data_access: {
        scope_names: (profile?.scopes ?? []).map((item) => item.scope.name).sort(),
        editable: Boolean(profile && !profile.is_system),
      },
    };
  }

  // One connection per application: the profile is made when missing, then a client for it.
  static async connect(
    admin: AdminUser,
    applicationId: string,
    publicUrl: string,
    context: AuditRequestContext = {},
    scopeNames?: string[],
  ): Promise<ConnectResponse> {
    assertSuperAdmin(admin);
    const app = await findApplication(applicationId);
    if (await findConnectionClient(applicationId)) {
      throw new ResponseError(400, "This application already has a connection. Rotate its token instead");
    }

    const organizationId = await resolveOrganizationId(applicationId);
    let profile = await prismaClient.applicationIntegrationProfile.findUnique({ where: { code: applicationId } });
    if (!profile) {
      const wanted = withRequiredScopes(scopeNames);
      const scopes = await prismaClient.apiScope.findMany({ where: { name: { in: wanted }, is_active: true } });
      if (scopes.length !== wanted.length) throw new ResponseError(400, "One or more scopes do not exist or are inactive");
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

  // Changes what a connection made for this application may read.
  static async updateConnectionScopes(
    admin: AdminUser,
    applicationId: string,
    request: { scope_names: string[] },
  ): Promise<SetupStatus["data_access"]> {
    assertSuperAdmin(admin);
    const { scope_names: scopeNames } = Validation.validate(ApplicationValidation.CONNECTION_SCOPES, request);
    await findApplication(applicationId);
    const profile = await prismaClient.applicationIntegrationProfile.findUnique({ where: { code: applicationId } });
    if (!profile) throw new ResponseError(404, "This application has no connection yet");
    if (profile.is_system) throw new ResponseError(400, "The connection of this application is managed by the system");
    const names = withRequiredScopes(scopeNames);
    await ApplicationIntegrationProfileService.update(admin, { id: profile.id, scope_names: names });
    return { scope_names: names.sort(), editable: true };
  }

  static async publish(
    admin: AdminUser,
    applicationId: string,
    context: AuditRequestContext = {},
  ): Promise<ApplicationDetail> {
    if (applicationId === hubApplicationId()) throw new ResponseError(400, "This is the Hub itself, it is not listed in the Hub");
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

  // What stops this application from being removed, and what would go with it.
  static async removalPlan(admin: AdminUser, applicationId: string): Promise<RemovalPlan> {
    assertSuperAdmin(admin);
    const app = await findApplication(applicationId);
    const [people, roles, groups, permissions, clients] = await Promise.all([
      prismaClient.applicationEntitlement.count({ where: { application_id: applicationId } }),
      prismaClient.applicationRole.count({ where: { application_id: applicationId } }),
      prismaClient.applicationAccessRule.count({ where: { application_id: applicationId } }),
      prismaClient.applicationPermission.count({ where: { application_id: applicationId } }),
      prismaClient.apiClient.findMany({
        where: { profile: { code: applicationId }, is_active: true },
        include: { credentials: { select: { last_used_at: true } } },
      }),
    ]);
    const since = Date.now() - RECENT_USE_MS;
    const recentlyUsed = clients.some((client) =>
      [client.last_used_at, ...client.credentials.map((credential) => credential.last_used_at)].some(
        (date) => date && date.getTime() > since,
      ),
    );

    const blockers: string[] = [];
    if (applicationId === hubApplicationId()) blockers.push("This is the Hub's own application. Removing it would lock everyone out of the Hub.");
    if (app.published) blockers.push("It is showing in the Hub. Hide it from the Hub first.");
    if (people > 0) {
      blockers.push(`${people} ${people === 1 ? "person has" : "people have"} access to it. Remove that access first.`);
    }
    if (recentlyUsed) blockers.push("Its token was used in the last 30 days, so the application is still running.");
    return {
      can_remove: blockers.length === 0,
      blockers,
      will_delete: { roles, groups, permissions, clients: clients.length },
    };
  }

  // Deletes the application and what only belongs to it. Its API clients are revoked, not deleted, so the audit trail stays.
  static async remove(admin: AdminUser, applicationId: string, context: AuditRequestContext = {}): Promise<void> {
    const plan = await this.removalPlan(admin, applicationId);
    if (!plan.can_remove) throw new ResponseError(400, plan.blockers.join(" "));
    const app = await findApplication(applicationId);

    const clients = await prismaClient.apiClient.findMany({
      where: { profile: { code: applicationId } },
      select: { id: true, name: true, is_active: true },
    });
    for (const client of clients) {
      if (client.is_active) await ApiClientService.revoke(admin, { id: client.id }, context);
      // Frees the name, so adding the application again can make a new connection.
      await prismaClient.apiClient.update({
        where: { id: client.id },
        data: { name: `${client.name} (removed ${new Date().toISOString()})` },
      });
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.applicationAccessRule.deleteMany({ where: { application_id: applicationId } });
      await tx.applicationRole.deleteMany({ where: { application_id: applicationId } });
      await tx.applicationPermission.deleteMany({ where: { application_id: applicationId } });
      await tx.applicationOrganization.deleteMany({ where: { application_id: applicationId } });
      await tx.application.delete({ where: { id: app.id } });
      await AuditService.record(
        {
          action: AuditAction.APPLICATION_DELETE,
          source: AuditSource.UI,
          entity_type: "Application",
          entity_id: app.id,
          admin_id: admin.id,
          old_values: { ...toDetail(app), ...plan.will_delete },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });
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
