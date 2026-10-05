import type { Context } from "hono";
import type {
  BulkGrantApplicationEntitlementRequest,
  CreateApplicationRoleRequest,
  CreateApplicationAccessRuleRequest,
  UpdateApplicationAccessRuleRequest,
  GrantApplicationEntitlementRequest,
  UpdateApplicationEntitlementRequest,
  UpdateApplicationRoleRequest,
} from "../../model/application-entitlement-model";
import { ResponseError } from "../../error/response-error";
import {
  ApplicationAccessRuleService,
  ApplicationAccessService,
  ApplicationEntitlementService,
  ApplicationOrganizationService,
  ApplicationRoleService,
} from "../../service/application-entitlement-service";
import type { AdminVariables } from "../../type/hono-context";
import { getAuditRequestContext } from "../../utils/audit-request-context";

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
      unit_id: c.req.query("unit_id"),
      job_position_id: c.req.query("job_position_id"),
      job_level_id: c.req.query("job_level_id"),
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
