import { checkApplicationAddress, checkHubAddressDetailed, checkHubSecret } from "../../service/hub-address-check";
import { keyReady } from "../../utils/secret-box";
import { AUDIENCE_NAMES, audienceProblem, type AudienceName } from "../../utils/audience";
import { ApplicationTaxonomyService } from "../../service/application-taxonomy-service";
import { ApplicationOnboardingService } from "../../service/application-onboarding-service";
import type { Context } from "hono";
import type {
  BulkGrantApplicationEntitlementRequest,
  CreateApplicationRequest,
  UpdateApplicationRequest,
  CreateApplicationRoleRequest,
  CreateApplicationAccessRuleRequest,
  UpdateApplicationAccessRuleRequest,
  GrantApplicationEntitlementRequest,
  UpdateApplicationEntitlementRequest,
  ReorderApplicationRolesRequest,
  UpdateApplicationRoleRequest,
} from "../../model/application-entitlement-model";
import { ApplicationPermissionService } from "../../service/application-permission-service";
import { ResponseError } from "../../error/response-error";
import { Validation } from "../../validation/validation";
import { addressProblem } from "../../utils/application-id";
import { ApplicationValidation } from "../../validation/application-entitlement-validation";
import {
  ApplicationAccessRuleService,
  ApplicationAccessService,
  ApplicationEntitlementService,
  ApplicationOrganizationService,
  ApplicationRoleService,
} from "../../service/application-entitlement-service";
import type { AdminVariables } from "../../type/hono-context";
import { getAuditRequestContext } from "../../utils/audit-request-context";
import { getIntegrationEnvironment } from "../../utils/integration-environment";

// "a,b,c" in a query string becomes ["a", "b", "c"].
function listQuery(value: string | undefined): string[] | undefined {
  const items = value?.split(",").map((item) => item.trim()).filter(Boolean);
  return items?.length ? items : undefined;
}

// The address apps reach Central on. CENTRAL_API_PUBLIC_URL wins, otherwise what the proxy forwarded.
function publicBaseUrl(c: Context<{ Variables: AdminVariables }>): string {
  const configured = process.env.CENTRAL_API_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host = c.req.header("x-forwarded-host")?.split(",")[0]?.trim() || c.req.header("host") || url.host;
  return `${proto}://${host}`;
}

function requireApplicationId(c: Context<{ Variables: AdminVariables }>): string {
  const applicationId = c.req.param("applicationId");
  if (!applicationId) throw new ResponseError(400, "Application ID is required");
  return applicationId;
}

export class ApplicationEntitlementController {
  static async grant(c: Context<{ Variables: AdminVariables }>) {
    const request = (await c.req.json()) as GrantApplicationEntitlementRequest;
    const response = await ApplicationEntitlementService.grant(
      c.var.admin,
      request,
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async bulkGrant(c: Context<{ Variables: AdminVariables }>) {
    const request = (await c.req.json()) as BulkGrantApplicationEntitlementRequest;
    const response = await ApplicationEntitlementService.bulkGrant(
      c.var.admin,
      request,
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    const id = c.req.param("id");
    if (!id) throw new ResponseError(400, "Entitlement ID is required");
    const body = (await c.req.json()) as Omit<UpdateApplicationEntitlementRequest, "id">;
    const response = await ApplicationEntitlementService.update(
      c.var.admin,
      { id, ...body },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async revoke(c: Context<{ Variables: AdminVariables }>) {
    const id = c.req.param("id");
    if (!id) throw new ResponseError(400, "Entitlement ID is required");
    const response = await ApplicationEntitlementService.revoke(
      c.var.admin,
      { id },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async unblock(c: Context<{ Variables: AdminVariables }>) {
    const id = c.req.param("id");
    if (!id) throw new ResponseError(400, "Entitlement ID is required");
    const response = await ApplicationEntitlementService.unblock(c.var.admin, { id }, getAuditRequestContext(c));
    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const id = c.req.param("id");
    if (!id) throw new ResponseError(400, "Entitlement ID is required");
    const response = await ApplicationEntitlementService.remove(
      c.var.admin,
      { id },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async list(c: Context<{ Variables: AdminVariables }>) {
    const active = c.req.query("is_active");
    if (active !== undefined && active !== "true" && active !== "false") {
      throw new ResponseError(400, "is_active must be 'true' or 'false'");
    }
    const page = c.req.query("page");
    const size = c.req.query("size");
    const response = await ApplicationEntitlementService.list(c.var.admin, {
      person_id: c.req.query("person_id"),
      application_id: c.req.query("application_id"),
      organization_id: c.req.query("organization_id"),
      role: c.req.query("role"),
      search: c.req.query("search"),
      is_active: active === undefined ? undefined : active === "true",
      page: page ? Number(page) : undefined,
      size: size ? Number(size) : undefined,
    });
    return c.json(response);
  }
}

export class ApplicationRoleController {
  static async remove(c: Context<{ Variables: AdminVariables }>) {
    await ApplicationRoleService.remove(c.var.admin, c.req.param("id") ?? "", getAuditRequestContext(c));
    return c.json({ data: true });
  }

  static async reorder(c: Context<{ Variables: AdminVariables }>) {
    const request = (await c.req.json()) as ReorderApplicationRolesRequest;
    const response = await ApplicationRoleService.reorder(
      c.var.admin,
      request,
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async list(c: Context<{ Variables: AdminVariables }>) {
    const active = c.req.query("is_active");
    if (active !== undefined && active !== "true" && active !== "false") {
      throw new ResponseError(400, "is_active must be 'true' or 'false'");
    }
    const response = await ApplicationRoleService.list(c.var.admin, {
      application_id: c.req.query("application_id"),
      is_active: active === undefined ? undefined : active === "true",
    });
    return c.json({ data: response });
  }

  static async create(c: Context<{ Variables: AdminVariables }>) {
    const request = (await c.req.json()) as CreateApplicationRoleRequest;
    const response = await ApplicationRoleService.create(
      c.var.admin,
      request,
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    const id = c.req.param("id");
    if (!id) throw new ResponseError(400, "Role ID is required");
    const body = (await c.req.json()) as Omit<UpdateApplicationRoleRequest, "id">;
    const response = await ApplicationRoleService.update(
      c.var.admin,
      { id, ...body },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }
}

export class ApplicationOrganizationController {
  static async list(c: Context<{ Variables: AdminVariables }>) {
    return c.json({ data: await ApplicationOrganizationService.list(c.var.admin) });
  }
}

export class ApplicationAccessRuleController {
  static async get(c: Context<{ Variables: AdminVariables }>) {
    const id = c.req.param("id");
    if (!id) throw new ResponseError(400, "Rule ID is required");
    return c.json({ data: await ApplicationAccessRuleService.get(c.var.admin, id) });
  }

  static async create(c: Context<{ Variables: AdminVariables }>) {
    const request = (await c.req.json()) as CreateApplicationAccessRuleRequest;
    const response = await ApplicationAccessRuleService.create(
      c.var.admin,
      request,
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    const id = c.req.param("id");
    if (!id) throw new ResponseError(400, "Rule ID is required");
    const body = (await c.req.json()) as Omit<UpdateApplicationAccessRuleRequest, "id">;
    const response = await ApplicationAccessRuleService.update(
      c.var.admin,
      { id, ...body },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const id = c.req.param("id");
    if (!id) throw new ResponseError(400, "Rule ID is required");
    const response = await ApplicationAccessRuleService.remove(
      c.var.admin,
      { id },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }
}

export class ApplicationAccessController {
  static async context(c: Context<{ Variables: AdminVariables }>) {
    if (c.var.admin.role !== "SUPER_ADMIN") {
      throw new ResponseError(403, "Forbidden: Only Super Admin can manage applications");
    }
    const configured = process.env.HUB_PUBLIC_URL?.trim().replace(/\/+$/, "") || null;
    const suggestedHubUrl = configured && !addressProblem(configured) ? configured : null;
    return c.json({
      data: {
        environment: getIntegrationEnvironment().toLowerCase(),
        suggested_hub_url: suggestedHubUrl,
        // The address the Hub was added with, to tell whether an application sits under the same parent domain.
        hub_address: await ApplicationOnboardingService.savedHubAddress(),
      },
    });
  }

  static async applications(c: Context<{ Variables: AdminVariables }>) {
    const page = c.req.query("page");
    const size = c.req.query("size");
    const response = await ApplicationAccessService.applications(c.var.admin, {
      search: c.req.query("search"),
      page: page ? Number(page) : undefined,
      size: size ? Number(size) : undefined,
    });
    return c.json(response);
  }

  static async createApplication(c: Context<{ Variables: AdminVariables }>) {
    const request = (await c.req.json()) as CreateApplicationRequest;
    // The token and .env come back with the application, so nothing is left to set up by hand.
    const response = await ApplicationOnboardingService.create(
      c.var.admin,
      request,
      publicBaseUrl(c),
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async settings(c: Context<{ Variables: AdminVariables }>) {
    const page = Number(c.req.query("page")) || 1;
    const size = Number(c.req.query("size")) || 10;
    return c.json({ data: await ApplicationOnboardingService.settings(c.var.admin, requireApplicationId(c), { page, size, date_from: c.req.query("date_from"), date_to: c.req.query("date_to") }) });
  }

  static async getApplication(c: Context<{ Variables: AdminVariables }>) {
    return c.json({ data: await ApplicationOnboardingService.get(c.var.admin, requireApplicationId(c)) });
  }

  static async updateApplication(c: Context<{ Variables: AdminVariables }>) {
    const request = (await c.req.json()) as UpdateApplicationRequest;
    const response = await ApplicationOnboardingService.update(
      c.var.admin,
      { ...request, application_id: requireApplicationId(c) },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async setup(c: Context<{ Variables: AdminVariables }>) {
    return c.json({ data: await ApplicationOnboardingService.setup(c.var.admin, requireApplicationId(c), publicBaseUrl(c)) });
  }

  static async connect(c: Context<{ Variables: AdminVariables }>) {
    const publicUrl = publicBaseUrl(c);
    const response = await ApplicationOnboardingService.connect(
      c.var.admin,
      requireApplicationId(c),
      publicUrl,
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async updateConnectionScopes(c: Context<{ Variables: AdminVariables }>) {
    const request = (await c.req.json()) as { scope_names: string[] };
    return c.json({
      data: await ApplicationOnboardingService.updateConnectionScopes(c.var.admin, requireApplicationId(c), request),
    });
  }

  static async rotateConnection(c: Context<{ Variables: AdminVariables }>) {
    const request = (await c.req.json().catch(() => ({}))) as { immediate?: boolean; grace_hours?: number };
    const response = await ApplicationOnboardingService.rotate(
      c.var.admin,
      requireApplicationId(c),
      request,
      publicBaseUrl(c),
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async updateEnvSettings(c: Context<{ Variables: AdminVariables }>) {
    return c.json({
      data: await ApplicationOnboardingService.updateEnvSettings(
        c.var.admin,
        requireApplicationId(c),
        await c.req.json(),
        getAuditRequestContext(c),
      ),
    });
  }

  static async updateHubAddress(c: Context<{ Variables: AdminVariables }>) {
    return c.json({
      data: await ApplicationOnboardingService.setHubAddress(c.var.admin, requireApplicationId(c), await c.req.json(), getAuditRequestContext(c)),
    });
  }

  static async setHubSecret(c: Context<{ Variables: AdminVariables }>) {
    const body = await c.req.json().catch(() => ({}));
    return c.json({
      data: await ApplicationOnboardingService.setHubSecret(c.var.admin, requireApplicationId(c), body, getAuditRequestContext(c)),
    });
  }

  static async setHubAppSecret(c: Context<{ Variables: AdminVariables }>) {
    const body = await c.req.json().catch(() => ({}));
    return c.json({
      data: await ApplicationOnboardingService.setHubAppSecret(c.var.admin, requireApplicationId(c), body, getAuditRequestContext(c)),
    });
  }

  static async hubAddressCheck(c: Context<{ Variables: AdminVariables }>) {
    if (c.var.admin.role !== "SUPER_ADMIN") throw new ResponseError(403, "Forbidden: Only Super Admin can manage applications");
    const address = c.req.query("url") ?? "";
    // The same rules as saving it, so only an address that could be kept is asked.
    const parsed = ApplicationValidation.HUB_ADDRESS.safeParse({ hub_base_url: address });
    if (!parsed.success) return c.json({ data: { verdict: "refused", key: "unknown" } });
    const { verdict, thumbprints } = await checkHubAddressDetailed(parsed.data.hub_base_url as string);
    // The wizard sends the thumbprint of the key it just made. Otherwise it is the one kept for the Hub.
    const asked = (c.req.query("thumbprint") ?? "").trim();
    const expected = /^[A-Za-z0-9_-]{43}$/.test(asked) ? asked : await ApplicationOnboardingService.savedHubSigningThumbprint();
    const key = verdict !== "ok" || !expected ? "unknown" : thumbprints.includes(expected) ? "match" : "mismatch";
    return c.json({ data: { verdict, key } });
  }

  static async hubSigningKey(c: Context<{ Variables: AdminVariables }>) {
    const body = await c.req.json().catch(() => ({}));
    const data = await ApplicationOnboardingService.makeHubSigningKey(c.var.admin, body, getAuditRequestContext(c));
    c.header("Cache-Control", "no-store");
    return c.json({ data });
  }

  static async applicationAddressCheck(c: Context<{ Variables: AdminVariables }>) {
    if (c.var.admin.role !== "SUPER_ADMIN") throw new ResponseError(403, "Forbidden: Only Super Admin can manage applications");
    const address = (c.req.query("url") ?? "").trim();
    // The same rules as saving it, so only an address that could be kept is asked.
    if (!address || addressProblem(address)) return c.json({ data: { verdict: "refused" } });
    return c.json({ data: { verdict: await checkApplicationAddress(address) } });
  }

  static async hubSecretCheck(c: Context<{ Variables: AdminVariables }>) {
    if (c.var.admin.role !== "SUPER_ADMIN") throw new ResponseError(403, "Forbidden: Only Super Admin can manage applications");
    const body = Validation.validate(ApplicationValidation.HUB_SECRET_CHECK, await c.req.json().catch(() => ({}))) as { address?: string; secret: string };
    // While the Hub is being added the address is in the request. Otherwise it is the one kept.
    const address = body.address ?? (await ApplicationOnboardingService.savedHubAddress());
    if (!address) return c.json({ data: { verdict: "refused" } });
    return c.json({ data: { verdict: await checkHubSecret(address, body.secret) } });
  }

  static async secretsStatus(c: Context<{ Variables: AdminVariables }>) {
    return c.json({ data: { key_ready: keyReady() } });
  }

  static async hubSecretImpact(c: Context<{ Variables: AdminVariables }>) {
    return c.json({ data: await ApplicationOnboardingService.hubSecretImpact(c.var.admin, requireApplicationId(c)) });
  }

  static async retire(c: Context<{ Variables: AdminVariables }>) {
    return c.json({ data: await ApplicationOnboardingService.retire(c.var.admin, requireApplicationId(c), getAuditRequestContext(c)) });
  }

  static async restore(c: Context<{ Variables: AdminVariables }>) {
    return c.json({ data: await ApplicationOnboardingService.restore(c.var.admin, requireApplicationId(c), getAuditRequestContext(c)) });
  }

  static async removal(c: Context<{ Variables: AdminVariables }>) {
    return c.json({ data: await ApplicationOnboardingService.removalPlan(c.var.admin, requireApplicationId(c)) });
  }

  static async removeApplication(c: Context<{ Variables: AdminVariables }>) {
    await ApplicationOnboardingService.remove(c.var.admin, requireApplicationId(c), getAuditRequestContext(c));
    return c.json({ data: true });
  }

  static async publish(c: Context<{ Variables: AdminVariables }>) {
    const response = await ApplicationOnboardingService.publish(
      c.var.admin,
      requireApplicationId(c),
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async unpublish(c: Context<{ Variables: AdminVariables }>) {
    const response = await ApplicationOnboardingService.unpublish(
      c.var.admin,
      requireApplicationId(c),
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async exceptions(c: Context<{ Variables: AdminVariables }>) {
    const applicationId = c.req.param("applicationId");
    const groupId = c.req.query("group_id");
    if (!applicationId) throw new ResponseError(400, "Application ID is required");
    if (!groupId) throw new ResponseError(400, "group_id is required");
    const page = c.req.query("page");
    const size = c.req.query("size");
    const response = await ApplicationAccessService.exceptions(c.var.admin, applicationId, {
      group_id: groupId,
      search: c.req.query("search"),
      page: page ? Number(page) : undefined,
      size: size ? Number(size) : undefined,
    });
    return c.json(response);
  }

  static async taxonomy(c: Context<{ Variables: AdminVariables }>) {
    return c.json({ data: await ApplicationTaxonomyService.list() });
  }

  static async scopeCatalog(c: Context<{ Variables: AdminVariables }>) {
    return c.json({ data: await ApplicationAccessService.scopeCatalog(c.var.admin) });
  }

  static async roleOptions(c: Context<{ Variables: AdminVariables }>) {
    const applicationId = c.req.param("applicationId");
    if (!applicationId) throw new ResponseError(400, "Application ID is required");
    const audiences = listQuery(c.req.query("audiences")) ?? [];
    if (audiences.some((name) => !AUDIENCE_NAMES.includes(name as AudienceName))) {
      throw new ResponseError(400, "audiences must be EMPLOYEES, INTERNS or STUDENTS");
    }
    const problem = audienceProblem(audiences as AudienceName[]);
    if (problem) throw new ResponseError(400, problem);
    const response = await ApplicationAccessService.roleOptions(c.var.admin, applicationId, {
      audiences: audiences as AudienceName[],
      unit_ids: listQuery(c.req.query("unit_ids")),
      job_position_ids: listQuery(c.req.query("job_position_ids")),
      job_level_ids: listQuery(c.req.query("job_level_ids")),
      group_id: c.req.query("group_id"),
    });
    return c.json({ data: response });
  }

  static async application(c: Context<{ Variables: AdminVariables }>) {
    const applicationId = c.req.param("applicationId");
    if (!applicationId) throw new ResponseError(400, "Application ID is required");
    return c.json({ data: await ApplicationAccessService.application(c.var.admin, applicationId) });
  }

  static async candidates(c: Context<{ Variables: AdminVariables }>) {
    const applicationId = c.req.query("application_id");
    if (!applicationId) throw new ResponseError(400, "application_id is required");
    const coverage = c.req.query("coverage");
    if (coverage !== undefined && !["ANY", "COVERED", "UNCOVERED", "GROUP"].includes(coverage)) {
      throw new ResponseError(400, "coverage must be ANY, COVERED, UNCOVERED or GROUP");
    }
    const page = c.req.query("page");
    const size = c.req.query("size");
    const response = await ApplicationAccessService.candidates(c.var.admin, {
      application_id: applicationId,
      coverage: coverage as "ANY" | "COVERED" | "UNCOVERED" | "GROUP" | undefined,
      group_id: c.req.query("group_id"),
      exclude_own_access: c.req.query("exclude_own_access") === "true" ? true : undefined,
      unit_id: c.req.query("unit_id"),
      job_position_id: c.req.query("job_position_id"),
      job_level_id: c.req.query("job_level_id"),
      grade_id: c.req.query("grade_id"),
      class_id: c.req.query("class_id"),
      unit_ids: listQuery(c.req.query("unit_ids")),
      job_position_ids: listQuery(c.req.query("job_position_ids")),
      job_level_ids: listQuery(c.req.query("job_level_ids")),
      employment_type: c.req.query("employment_type"),
      search: c.req.query("search"),
      page: page ? Number(page) : undefined,
      size: size ? Number(size) : undefined,
    });
    return c.json(response);
  }

  static async list(c: Context<{ Variables: AdminVariables }>) {
    const active = c.req.query("is_active");
    if (active !== undefined && active !== "true" && active !== "false") {
      throw new ResponseError(400, "is_active must be 'true' or 'false'");
    }
    const kind = c.req.query("kind");
    if (kind !== undefined && kind !== "GROUP" && kind !== "PERSON") {
      throw new ResponseError(400, "kind must be 'GROUP' or 'PERSON'");
    }
    const page = c.req.query("page");
    const size = c.req.query("size");
    const response = await ApplicationAccessService.list(c.var.admin, {
      kind,
      application_id: c.req.query("application_id"),
      role: c.req.query("role"),
      search: c.req.query("search"),
      is_active: active === undefined ? undefined : active === "true",
      page: page ? Number(page) : undefined,
      size: size ? Number(size) : undefined,
    });
    return c.json(response);
  }
}

export class ApplicationPermissionController {
  static async list(c: Context<{ Variables: AdminVariables }>) {
    const response = await ApplicationPermissionService.list(c.var.admin, {
      application_id: c.req.query("application_id"),
    });
    return c.json({ data: response });
  }

  static async create(c: Context<{ Variables: AdminVariables }>) {
    const request = (await c.req.json()) as { application_id: string; key: string; description?: string };
    const response = await ApplicationPermissionService.create(c.var.admin, request, getAuditRequestContext(c));
    return c.json({ data: response });
  }
}
