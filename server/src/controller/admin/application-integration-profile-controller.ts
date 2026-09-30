import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import {
  ApplicationIntegrationProfileService,
  type CreateApplicationIntegrationProfileRequest,
} from "../../service/application-integration-profile-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";
import { getIntegrationEnvironment } from "../../utils/integration-environment";

export class ApplicationIntegrationProfileController {
  static async list(c: Context<{ Variables: AdminVariables }>) {
    const response = await ApplicationIntegrationProfileService.list(c.var.admin);
    return c.json({ data: response, environment: getIntegrationEnvironment() });
  }

  static async listScopes(c: Context<{ Variables: AdminVariables }>) {
    const response = await ApplicationIntegrationProfileService.listScopes(c.var.admin);
    return c.json({ data: response });
  }

  static async create(c: Context<{ Variables: AdminVariables }>) {
    const request = (await c.req.json()) as CreateApplicationIntegrationProfileRequest;
    const response = await ApplicationIntegrationProfileService.create(
      c.var.admin,
      request,
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    const id = c.req.param("id");
    if (!id) throw new ResponseError(400, "Profile ID is required");
    const body = (await c.req.json()) as Record<string, unknown>;
    const response = await ApplicationIntegrationProfileService.update(
      c.var.admin,
      { ...body, id },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }
}
