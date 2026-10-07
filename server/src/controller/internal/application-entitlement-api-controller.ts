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

  static async applications(c: Context<{ Variables: ApiClientVariables }>) {
    return c.json({ success: true, data: await ApplicationAccessService.applicationIds() });
  }

  static async syncPermissions(c: Context<{ Variables: ApiClientVariables }>) {
    const body = (await c.req.json()) as { permissions?: { key: string; description?: string }[] };
    const response = await ApplicationPermissionService.sync(
      { clientId: c.var.clientId },
      { application_id: c.req.param("applicationId") ?? "", permissions: body.permissions ?? [] },
      getAuditRequestContext(c),
    );
    return c.json({ success: true, data: response });
  }

  static async permissionUsage(c: Context<{ Variables: ApiClientVariables }>) {
    return c.json({
      success: true,
      data: await ApplicationPermissionService.usage(c.req.param("applicationId") ?? ""),
    });
  }
}
