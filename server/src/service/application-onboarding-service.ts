import { AdminRole, ApiCredentialStatus, HubSecretMode, ApplicationLaunchMode, ApplicationPermissionSource, AuditAction, AuditSource, IntegrationProfileStatus } from "../generated/prisma/client";
import type { AdminUser } from "../generated/prisma/client";
import { API_SCOPES } from "../constants/api-scopes";
import { ApplicationTaxonomyService } from "./application-taxonomy-service";
import { hubApplicationId } from "../constants/hub-application";
import { ResponseError } from "../error/response-error";
import { prismaClient } from "../lib/prisma";
import type { ApiClientCreatedResponse } from "../model/api-client-model";
import type { AuditRequestContext } from "../model/audit-log-model";
import type { ApplicationSummary, CreateApplicationRequest, UpdateApplicationRequest } from "../model/application-entitlement-model";
import { ApplicationValidation } from "../validation/application-entitlement-validation";
import { Validation } from "../validation/validation";
import { buildEnvItems, hubLinesMissing, resolveHubSettings, type EnvItem, type HubEnvSettings, type HubFacts } from "../utils/application-env";
import { deriveAppSecret } from "../utils/hub-app-secret";
import { decryptSecret, encryptSecret, keyReady, newSecret } from "../utils/secret-box";
import { addressProblem } from "../utils/application-id";
import { evaluateRemoval, usedRecently } from "../utils/application-removal";
import { getIntegrationEnvironment } from "../utils/integration-environment";
import { ApiClientService } from "./api-client-service";
import { ApplicationIntegrationProfileService } from "./application-integration-profile-service";
import { AuditService } from "./audit-service";
import { ApplicationAccessService, clearActiveSnapshot, resolveOrganizationId } from "./application-entitlement-service";

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
  scope: string | null;
  launch_url: string | null;
  logout_url: string | null;
  published: boolean;
  retired_at: string | null;
  // Whether its .env carries the Hub address and the shared secret.
  uses_hub: boolean;
  launch_mode: "sso" | "link";
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
  // What the menu may offer: delete when it is allowed, otherwise retire.
  removal: { can_remove: boolean; retire_available: boolean };
  // The Hub's sign-in settings that go into its .env. Null for other applications.
  env_settings: HubEnvSettings | null;
  // The Hub's address and whether it has a secret. The secret itself is never in the setup.
  hub: { base_url: string | null; secret_set: boolean; key_ready: boolean } | null;
  // Which Central this is (development, staging or production), its public address, and where the Hub is. The guide
  // for the pipeline shows these as the values of the environment this Central belongs to.
  environment: "development" | "test" | "staging" | "production";
  central_url: string;
  hub_address: string | null;
  // How an application gets the Hub secret. Null for the Hub, which holds the master.
  hub_secret: { mode: "shared" | "own"; version: number; applies: boolean } | null;
  // The names this application reads in its .env, so the guides can name them.
  env_keys: { key: string; secret: boolean }[];
};

export type RemovalPlan = {
  can_remove: boolean;
  blockers: string[];
  // Blocked, but Retire would stop it and open the way to delete.
  retire_available: boolean;
  retired: boolean;
  is_hub: boolean;
  will_delete: { roles: number; groups: number; permissions: number; clients: number; people: number };
};

export type ConnectResponse = {
  client: ApiClientCreatedResponse;
  token: string;
  env: EnvItem[];
  // The Hub has no address or secret yet, so the lines about it are not in the .env.
  hub_lines_missing: boolean;
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
  scope: string | null;
  launch_url: string | null;
  logout_url: string | null;
  published: boolean;
  retired_at: Date | null;
  launch_mode: ApplicationLaunchMode;
  uses_hub: boolean;
}): ApplicationDetail {
  return {
    application_id: row.application_id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    category: row.category,
    scope: row.scope,
    launch_url: row.launch_url,
    logout_url: row.logout_url,
    published: row.published,
    retired_at: row.retired_at ? row.retired_at.toISOString() : null,
    uses_hub: row.uses_hub,
    launch_mode: row.launch_mode === ApplicationLaunchMode.LINK ? "link" : "sso",
  };
}

async function findApplication(applicationId: string) {
  const app = await prismaClient.application.findUnique({ where: { application_id: applicationId } });
  if (!app) throw new ResponseError(404, `Application ${applicationId} not found`);
  // The Hub is always called HUB. A row made before that rule is put right when it is read.
  if (applicationId === hubApplicationId() && app.name !== "HUB") {
    return prismaClient.application.update({ where: { id: app.id }, data: { name: "HUB" } });
  }
  return app;
}

// The profile and client that connect this application to Central, if any.
async function findConnectionClient(applicationId: string) {
  return prismaClient.apiClient.findFirst({
    where: {
      profile: { code: applicationId },
      environment: getIntegrationEnvironment(),
      is_active: true,
    },
    orderBy: { created_at: "asc" },
  });
}

// What the Hub shares with the applications. The secret is only decrypted when a block is made, and
// `reveal: false` leaves it as a stand-in for listings that only need the names of the lines.
async function loadHubFacts(reveal = true): Promise<HubFacts> {
  const row = await prismaClient.application.findUnique({
    where: { application_id: hubApplicationId() },
    select: { hub_base_url: true, hub_internal_secret: true },
  });
  return {
    baseUrl: row?.hub_base_url ?? null,
    secret: row?.hub_internal_secret ? (reveal ? decryptSecret(row.hub_internal_secret) : "-") : null,
  };
}

// The .env of an application, made from what Central knows about it.
async function envFor(
  app: { application_id: string; env_settings: unknown; uses_hub?: boolean; hub_secret_mode?: HubSecretMode; hub_secret_version?: number },
  organizationId: string,
  publicUrl: string,
  token: string,
  adminEmail?: string,
  reveal = true,
) {
  const isHub = app.application_id === hubApplicationId();
  // An application that does not sign in through the Hub gets none of its lines.
  const usesHub = isHub || app.uses_hub !== false;
  const master = usesHub ? await loadHubFacts(reveal) : undefined;
  // An application with its own secret gets one made from the master. The Hub's block carries the master itself.
  const own = !isHub && app.hub_secret_mode === HubSecretMode.OWN;
  const hub =
    master && own && master.secret && reveal
      ? { ...master, secret: deriveAppSecret(master.secret, app.application_id, app.hub_secret_version ?? 1) }
      : master;
  const facts = {
    applicationId: app.application_id,
    organizationId,
    publicUrl,
    token,
    isHub,
    hubSettings: isHub ? resolveHubSettings(app.env_settings, adminEmail) : undefined,
    hub,
    hubSecretOwn: own,
  };
  return { env: buildEnvItems(facts), hub_lines_missing: usesHub && hubLinesMissing(facts) };
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
    await ApplicationTaxonomyService.assertKnown(input);
    // The Hub is always called HUB. An older Hub row with another spelling can be put right, nothing else.
    if (input.application_id === hubApplicationId() && input.name !== undefined && input.name !== before.name && input.name !== "HUB") {
      throw new ResponseError(400, "The name of the Hub cannot change");
    }
    const data = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description || null }),
      ...(input.icon !== undefined && { icon: input.icon || null }),
      ...(input.category !== undefined && { category: input.category || null }),
      ...(input.scope !== undefined && { scope: input.scope || null }),
      ...(input.uses_hub !== undefined && { uses_hub: input.uses_hub }),
      ...(input.launch_url !== undefined && { launch_url: input.launch_url || null }),
      ...(input.launch_mode !== undefined && { launch_mode: input.launch_mode === "link" ? ApplicationLaunchMode.LINK : ApplicationLaunchMode.SSO }),
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
  static async setup(admin: AdminUser, applicationId: string, publicUrl = ""): Promise<SetupStatus> {
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
    // A plain link has no connection, so no permissions arrive.
    if (permissionCount === 0 && app.launch_mode === ApplicationLaunchMode.SSO) missing.push("permissions");
    if (roles === 0) missing.push("roles");
    if (groups === 0) missing.push("groups");

    const plan = await this.removalPlan(admin, applicationId);
    return {
      removal: { can_remove: plan.can_remove, retire_available: plan.retire_available },
      env_settings: applicationId === hubApplicationId() ? resolveHubSettings(app.env_settings, admin.email) : null,
      hub:
        applicationId === hubApplicationId()
          ? { base_url: app.hub_base_url, secret_set: Boolean(app.hub_internal_secret), key_ready: keyReady() }
          : null,
      environment: getIntegrationEnvironment().toLowerCase() as SetupStatus["environment"],
      central_url: publicUrl,
      hub_address: applicationId === hubApplicationId() ? null : (await loadHubFacts(false)).baseUrl,
      hub_secret:
        applicationId === hubApplicationId()
          ? null
          : {
              mode: app.hub_secret_mode === HubSecretMode.OWN ? "own" : "shared",
              version: app.hub_secret_version,
              applies: app.uses_hub && app.launch_mode === ApplicationLaunchMode.SSO,
            },
      env_keys: (await envFor(app, organizationId, "", "", admin.email, false)).env.map((item) => ({ key: item.key, secret: item.secret })),
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
        editable: Boolean(profile),
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
    options: { skipAudit?: boolean } = {},
  ): Promise<ConnectResponse> {
    assertSuperAdmin(admin);
    const app = await findApplication(applicationId);
    if (app.retired_at) throw new ResponseError(400, "This application is retired. Restore it first");
    if (app.launch_mode === ApplicationLaunchMode.LINK) throw new ResponseError(400, "A plain link has no connection");
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
    } else if (profile.status !== IntegrationProfileStatus.ACTIVE) {
      throw new ResponseError(400, "The integration profile of this application is not active");
    }

    const client = await ApiClientService.create(
      admin,
      { profile_code: applicationId, purpose: CONNECT_PURPOSE },
      context,
      { viaApplication: true, skipAudit: options.skipAudit },
    );

    return { client, token: client.token, ...(await envFor(app, organizationId, publicUrl, client.token, admin.email)) };
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
    const names = withRequiredScopes(scopeNames);
    await ApplicationIntegrationProfileService.update(admin, { id: profile.id, scope_names: names }, {}, { viaApplication: true });
    return { scope_names: names.sort(), editable: true };
  }

  // The Hub's sign-in settings. They reach its .env the next time the token is made or rotated.
  static async updateEnvSettings(
    admin: AdminUser,
    applicationId: string,
    request: unknown,
    context: AuditRequestContext = {},
  ): Promise<HubEnvSettings> {
    assertSuperAdmin(admin);
    const app = await findApplication(applicationId);
    if (applicationId !== hubApplicationId()) throw new ResponseError(400, "Only the Hub has sign-in settings");
    const settings = Validation.validate(ApplicationValidation.ENV_SETTINGS, request) as HubEnvSettings;
    await prismaClient.application.update({ where: { id: app.id }, data: { env_settings: settings } });
    await AuditService.record({
      action: AuditAction.APPLICATION_ROLE_UPDATE,
      source: AuditSource.UI,
      entity_type: "Application",
      entity_id: app.id,
      admin_id: admin.id,
      old_values: { env_settings: resolveHubSettings(app.env_settings, admin.email) },
      new_values: { env_settings: settings },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });
    return settings;
  }

  // The address people and applications reach the Hub at. The applications get it in their .env.
  static async setHubAddress(
    admin: AdminUser,
    applicationId: string,
    request: unknown,
    context: AuditRequestContext = {},
  ): Promise<{ base_url: string }> {
    assertSuperAdmin(admin);
    const app = await findApplication(applicationId);
    if (applicationId !== hubApplicationId()) throw new ResponseError(400, "Only the Hub has an address to share");
    const { hub_base_url } = Validation.validate(ApplicationValidation.HUB_ADDRESS, request) as { hub_base_url: string };
    await prismaClient.application.update({ where: { id: app.id }, data: { hub_base_url } });
    await AuditService.record({
      action: AuditAction.APPLICATION_ROLE_UPDATE,
      source: AuditSource.UI,
      entity_type: "Application",
      entity_id: app.id,
      admin_id: admin.id,
      old_values: { hub_base_url: app.hub_base_url },
      new_values: { hub_base_url },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });
    return { base_url: hub_base_url };
  }

  // Makes a new secret for the Hub, or keeps the one the Hub already runs with when it is given. It cannot be read
  // afterwards: it reaches the .env blocks, and a made one is returned here once.
  static async setHubSecret(
    admin: AdminUser,
    applicationId: string,
    request: unknown,
    context: AuditRequestContext = {},
  ): Promise<{ secret_set: true; secret?: string }> {
    assertSuperAdmin(admin);
    const app = await findApplication(applicationId);
    if (applicationId !== hubApplicationId()) throw new ResponseError(400, "Only the Hub has a secret to share");
    const { secret: given } = Validation.validate(ApplicationValidation.HUB_SECRET, request ?? {}) as { secret?: string };
    const made = given ? undefined : newSecret();
    const stored = encryptSecret(given ?? made!);
    await prismaClient.application.update({ where: { id: app.id }, data: { hub_internal_secret: stored } });
    // The value itself never goes into the log.
    await AuditService.record({
      action: AuditAction.APPLICATION_ROLE_UPDATE,
      source: AuditSource.UI,
      entity_type: "Application",
      entity_id: app.id,
      admin_id: admin.id,
      old_values: { hub_internal_secret: app.hub_internal_secret ? "set" : "none" },
      new_values: { hub_internal_secret: given ? "set from the existing one" : "newly made" },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });
    // A secret Central made is shown this once. One that was pasted is already in the hands of whoever pasted it.
    return { secret_set: true, ...(made ? { secret: made } : {}) };
  }

  // Gives an application a Hub secret of its own, or replaces the one it has. Shown once, like a token.
  static async setHubAppSecret(
    admin: AdminUser,
    applicationId: string,
    request: unknown,
    context: AuditRequestContext = {},
  ): Promise<{ secret: string; version: number }> {
    assertSuperAdmin(admin);
    const app = await findApplication(applicationId);
    if (applicationId === hubApplicationId()) throw new ResponseError(400, "The Hub holds the master secret. Rotate it in the Hub setup");
    const { action } = Validation.validate(ApplicationValidation.HUB_APP_SECRET, request) as { action: "own" | "rotate" };
    if (app.launch_mode !== ApplicationLaunchMode.SSO || !app.uses_hub) {
      throw new ResponseError(400, "This application does not sign in through the Hub");
    }
    const hub = await prismaClient.application.findUnique({
      where: { application_id: hubApplicationId() },
      select: { hub_internal_secret: true },
    });
    if (!hub?.hub_internal_secret) throw new ResponseError(400, "Make the Hub secret first, in the Hub setup");
    if (action === "own" && app.hub_secret_mode === HubSecretMode.OWN) throw new ResponseError(400, "This application already has its own Hub secret. Rotate it instead");
    if (action === "rotate" && app.hub_secret_mode !== HubSecretMode.OWN) throw new ResponseError(400, "Give this application its own Hub secret first");
    const version = action === "rotate" ? app.hub_secret_version + 1 : app.hub_secret_version;
    await prismaClient.application.update({
      where: { id: app.id },
      data: { hub_secret_mode: HubSecretMode.OWN, hub_secret_version: version },
    });
    // The value itself never goes into the log.
    await AuditService.record({
      action: AuditAction.APPLICATION_ROLE_UPDATE,
      source: AuditSource.UI,
      entity_type: "Application",
      entity_id: app.id,
      admin_id: admin.id,
      old_values: { hub_secret_mode: app.hub_secret_mode, hub_secret_version: app.hub_secret_version },
      new_values: { hub_secret_mode: "OWN", hub_secret_version: version },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });
    return { secret: deriveAppSecret(decryptSecret(hub.hub_internal_secret), applicationId, version), version };
  }

  // The applications that take the Hub address and secret into their .env, so a change reaches them.
  static async hubSecretImpact(admin: AdminUser, applicationId: string): Promise<{ applications: { application_id: string; name: string; mode: "shared" | "own" }[] }> {
    assertSuperAdmin(admin);
    await findApplication(applicationId);
    if (applicationId !== hubApplicationId()) throw new ResponseError(400, "Only the Hub has a secret to share");
    const rows = await prismaClient.application.findMany({
      where: { application_id: { not: applicationId }, uses_hub: true, launch_mode: ApplicationLaunchMode.SSO, retired_at: null },
      orderBy: { name: "asc" },
      select: { application_id: true, name: true, hub_secret_mode: true },
    });
    return {
      applications: rows.map((row) => ({
        application_id: row.application_id,
        name: row.name,
        mode: row.hub_secret_mode === HubSecretMode.OWN ? ("own" as const) : ("shared" as const),
      })),
    };
  }

  // Replaces the token of the connection of this application. The old one follows the grace of the mode.
  static async rotate(
    admin: AdminUser,
    applicationId: string,
    request: { immediate?: boolean; grace_hours?: number },
    publicUrl: string,
    context: AuditRequestContext = {},
  ): Promise<ApiClientCreatedResponse & { env: EnvItem[] }> {
    assertSuperAdmin(admin);
    const app = await findApplication(applicationId);
    const client = await findConnectionClient(applicationId);
    if (!client) throw new ResponseError(404, "This application has no connection yet");
    const rotated = await ApiClientService.rotate(admin, { id: client.id, ...request }, context);
    // The new token comes with the other three values, so the whole .env can be pasted again.
    const organizationId = await resolveOrganizationId(applicationId);
    return { ...rotated, ...(await envFor(app, organizationId, publicUrl, rotated.token, admin.email)) };
  }

  static async publish(
    admin: AdminUser,
    applicationId: string,
    context: AuditRequestContext = {},
  ): Promise<ApplicationDetail> {
    if (applicationId === hubApplicationId()) throw new ResponseError(400, "This is the Hub itself, it is not listed in the Hub");
    if ((await findApplication(applicationId)).retired_at) throw new ResponseError(400, "This application is retired. Restore it first");
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
    const recentlyUsed = clients.some((client) =>
      usedRecently([client.last_used_at, ...client.credentials.map((credential) => credential.last_used_at)]),
    );
    const isHub = applicationId === hubApplicationId();
    const retired = Boolean(app.retired_at);
    const otherApplications = isHub ? await prismaClient.application.count({ where: { application_id: { not: applicationId } } }) : 0;
    const verdict = evaluateRemoval({ isHub, otherApplications, retired, published: app.published, people, recentlyUsed });
    return {
      can_remove: verdict.can_remove,
      blockers: verdict.blockers,
      retire_available: verdict.retire_available,
      retired,
      is_hub: isHub,
      will_delete: { roles, groups, permissions, clients: clients.length, people },
    };
  }

  // Stops the application without deleting anything: hidden from the Hub, token revoked, nobody has access.
  static async retire(admin: AdminUser, applicationId: string, context: AuditRequestContext = {}): Promise<ApplicationDetail> {
    assertSuperAdmin(admin);
    const before = await findApplication(applicationId);
    if (applicationId === hubApplicationId()) {
      const others = await prismaClient.application.count({ where: { application_id: { not: applicationId } } });
      if (others > 0) {
        throw new ResponseError(400, `${others} other ${others === 1 ? "application is" : "applications are"} still set up in Central. Remove ${others === 1 ? "it" : "them"} before the Hub`);
      }
    }
    if (before.retired_at) throw new ResponseError(400, "This application is already retired");
    const clients = await prismaClient.apiClient.findMany({
      where: { profile: { code: applicationId }, is_active: true },
      select: { id: true, name: true },
    });
    for (const client of clients) {
      await ApiClientService.revoke(admin, { id: client.id }, context, { viaApplication: true, skipAudit: true });
      // Frees the name, so a new connection can be made after a restore.
      await prismaClient.apiClient.update({ where: { id: client.id }, data: { name: `${client.name} (retired ${new Date().toISOString()})` } });
    }
    await prismaClient.application.update({ where: { id: before.id }, data: { published: false, retired_at: new Date() } });
    clearActiveSnapshot(applicationId);
    const after = await findApplication(applicationId);
    await AuditService.record({
      action: AuditAction.APPLICATION_RETIRE,
      source: AuditSource.UI,
      entity_type: "Application",
      entity_id: after.id,
      admin_id: admin.id,
      new_values: { application_id: applicationId, was_published: before.published, revoked_clients: clients.map((client) => client.name) },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });
    return toDetail(after);
  }

  // Active again. The token stays revoked, so a new connection is made, and publishing is done by hand.
  static async restore(admin: AdminUser, applicationId: string, context: AuditRequestContext = {}): Promise<ApplicationDetail> {
    assertSuperAdmin(admin);
    const before = await findApplication(applicationId);
    if (!before.retired_at) throw new ResponseError(400, "This application is not retired");
    await prismaClient.application.update({ where: { id: before.id }, data: { retired_at: null } });
    clearActiveSnapshot(applicationId);
    const after = await findApplication(applicationId);
    await AuditService.record({
      action: AuditAction.APPLICATION_RESTORE,
      source: AuditSource.UI,
      entity_type: "Application",
      entity_id: after.id,
      admin_id: admin.id,
      new_values: { application_id: applicationId },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });
    return toDetail(after);
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
      if (client.is_active) await ApiClientService.revoke(admin, { id: client.id }, context, { viaApplication: true, skipAudit: true });
      // Frees the name, so adding the application again can make a new connection.
      await prismaClient.apiClient.update({
        where: { id: client.id },
        data: { name: `${client.name} (removed ${new Date().toISOString()})` },
      });
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.applicationEntitlement.deleteMany({ where: { application_id: applicationId } });
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
          old_values: { ...toDetail(app), ...plan.will_delete, revoked_clients: clients.filter((client) => client.is_active).map((client) => client.name) },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });
  }

  // Adds the application and, when asked, its connection, as one step with one audit entry.
  static async create(
    admin: AdminUser,
    request: CreateApplicationRequest,
    publicUrl: string,
    context: AuditRequestContext = {},
  ): Promise<ApplicationSummary & { connection: ConnectResponse | null }> {
    assertSuperAdmin(admin);
    const summary = await ApplicationAccessService.createApplication(admin, request, context, { skipAudit: true });
    const app = await findApplication(summary.application_id);
    let connection: ConnectResponse | null = null;
    try {
      if (request.connect && app.launch_mode === ApplicationLaunchMode.SSO) {
        connection = await this.connect(admin, app.application_id, publicUrl, context, request.scope_names, { skipAudit: true });
      }
    } finally {
      const profile = connection
        ? await prismaClient.applicationIntegrationProfile.findUnique({
            where: { code: app.application_id },
            include: { scopes: { include: { scope: true } } },
          })
        : null;
      await AuditService.record({
        action: AuditAction.APPLICATION_CREATE,
        source: AuditSource.UI,
        entity_type: "Application",
        entity_id: app.id,
        admin_id: admin.id,
        new_values: {
          application_id: app.application_id,
          name: app.name,
          organization_id: summary.organization_id,
          connection: connection
            ? {
                profile_code: app.application_id,
                client_name: connection.client.name,
                token_prefix: connection.token.split(".")[0] ?? null,
                scopes: (profile?.scopes ?? []).map((item) => item.scope.name).sort(),
              }
            : null,
        },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });
    }
    return { ...summary, connection };
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
      scope: row.scope,
      launch_url: row.launch_url,
      logout_url: row.logout_url,
      launch_mode: row.launch_mode === ApplicationLaunchMode.LINK ? "link" : "sso",
      // How the Hub checks the secret this application sends, and which version is the current one.
      hub_secret: { mode: row.hub_secret_mode === HubSecretMode.OWN ? "own" : "shared", version: row.hub_secret_version },
    }));
  }
}
