import type { Context } from "hono";
import type {
  GrantApplicationEntitlementRequest,
  UpdateApplicationEntitlementRequest,
} from "../../model/application-entitlement-model";
import { ResponseError } from "../../error/response-error";
import { ApplicationEntitlementService } from "../../service/application-entitlement-service";
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

  static async list(c: Context<{ Variables: AdminVariables }>) {
    const active = c.req.query("is_active");
    if (active !== undefined && active !== "true" && active !== "false") {
      throw new ResponseError(400, "is_active must be 'true' or 'false'");
    }
    const response = await ApplicationEntitlementService.list(c.var.admin, {
      person_id: c.req.query("person_id"),
      application_id: c.req.query("application_id"),
      organization_id: c.req.query("organization_id"),
      is_active: active === undefined ? undefined : active === "true",
    });
    return c.json({ data: response });
  }
}
