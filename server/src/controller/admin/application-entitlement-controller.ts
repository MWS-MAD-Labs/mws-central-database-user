import type { Context } from "hono";
import type {
  BulkGrantApplicationEntitlementRequest,
  CreateApplicationRequest,
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
import {
  ApplicationAccessRuleService,
  ApplicationAccessService,
  ApplicationEntitlementService,
  ApplicationOrganizationService,
  ApplicationRoleService,
} from "../../service/application-entitlement-service";
import type { AdminVariables } from "../../type/hono-context";
import { getAuditRequestContext } from "../../utils/audit-request-context";

// "a,b,c" in a query string becomes ["a", "b", "c"].
function listQuery(value: string | undefined): string[] | undefined {
  const items = value?.split(",").map((item) => item.trim()).filter(Boolean);
  return items?.length ? items : undefined;
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
    const response = await ApplicationAccessService.createApplication(
      c.var.admin,
      request,
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

  static async scopeCatalog(c: Context<{ Variables: AdminVariables }>) {
    return c.json({ data: await ApplicationAccessService.scopeCatalog(c.var.admin) });
  }

  static async roleOptions(c: Context<{ Variables: AdminVariables }>) {
    const applicationId = c.req.param("applicationId");
    if (!applicationId) throw new ResponseError(400, "Application ID is required");
    const audience = c.req.query("audience");
    if (!audience || !["EMPLOYEES", "STUDENTS", "EMPLOYEES_AND_STUDENTS"].includes(audience)) {
      throw new ResponseError(400, "audience must be EMPLOYEES, STUDENTS or EMPLOYEES_AND_STUDENTS");
    }
    const response = await ApplicationAccessService.roleOptions(c.var.admin, applicationId, {
      audience: audience as "EMPLOYEES" | "STUDENTS" | "EMPLOYEES_AND_STUDENTS",
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
