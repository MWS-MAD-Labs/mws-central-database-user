import type { Context } from "hono";
import { ResponseError } from "../../error/response-error";
import { ApplicationPermissionService } from "../../service/application-permission-service";
import { ApplicationAccessService, ApplicationEntitlementService } from "../../service/application-entitlement-service";
import type { ApiClientVariables } from "../../type/hono-context";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class ApplicationEntitlementApiController {
  static async lookup(c: Context<{ Variables: ApiClientVariables }>) {
    const personId = c.req.query("person_id");
    const applicationId = c.req.query("application_id");
    if (!personId || !applicationId) {
      throw new ResponseError(
        400,
        "Query parameters 'person_id' and 'application_id' are required",
      );
    }

    const response = await ApplicationEntitlementService.lookup(
      {
        clientId: c.var.clientId,
        clientName: c.var.clientName,
        scopes: c.var.scopes,
      },
      { person_id: personId, application_id: applicationId },
      getAuditRequestContext(c),
    );
    return c.json({ success: true, data: response });
  }

  static async list(c: Context<{ Variables: ApiClientVariables }>) {
    const page = Number(c.req.query("page") || 1);
    const size = Number(c.req.query("size") || 100);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(size) || size < 1 || size > 200) {
      throw new ResponseError(400, "'page' must be 1 or more and 'size' between 1 and 200");
    }
    const response = await ApplicationEntitlementService.listActive(
      { clientId: c.var.clientId, clientName: c.var.clientName, scopes: c.var.scopes },
      c.req.query("application_id") ?? "",
      page,
      size,
      getAuditRequestContext(c),
    );
    return c.json({ success: true, data: response.data, paging: response.paging });
  }

  static async applications(c: Context<{ Variables: ApiClientVariables }>) {
    return c.json({ success: true, data: await ApplicationAccessService.applicationIds() });
  }

  static async syncPermissions(c: Context<{ Variables: ApiClientVariables }>) {
    const body = (await c.req.json()) as {
      permissions?: { key: string; description?: string; requires?: string[] }[];
      confirm_removals?: boolean;
    };
    const response = await ApplicationPermissionService.sync(
      { clientId: c.var.clientId },
      {
        application_id: c.req.param("applicationId") ?? "",
        permissions: body.permissions ?? [],
        confirm_removals: body.confirm_removals,
      },
      getAuditRequestContext(c),
    );
    return c.json({ success: true, data: response });
  }

  static async permissionUsage(c: Context<{ Variables: ApiClientVariables }>) {
    return c.json({
      success: true,
      data: await ApplicationPermissionService.usage({ clientId: c.var.clientId }, c.req.param("applicationId") ?? ""),
    });
  }

  static async registeredPermissions(c: Context<{ Variables: ApiClientVariables }>) {
    return c.json({
      success: true,
      data: await ApplicationPermissionService.registered({ clientId: c.var.clientId }, c.req.param("applicationId") ?? ""),
    });
  }
}
