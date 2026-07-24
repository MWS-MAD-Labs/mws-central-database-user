import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type { CreateApiClientRequest } from "../../model/api-client-model";
import { ApiClientService } from "../../service/api-client-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class ApiClientController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const request = (await c.req.json()) as CreateApiClientRequest;

    const response = await ApiClientService.create(
      admin,
      request,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async list(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const response = await ApiClientService.list(admin);

    return c.json({ data: response });
  }

  static async revoke(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const clientId = c.req.param("id");

    if (!clientId) {
      throw new ResponseError(400, "API Client ID is required in parameter");
    }

    const response = await ApiClientService.revoke(
      admin,
      { id: clientId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async rotate(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const clientId = c.req.param("id");

    if (!clientId) {
      throw new ResponseError(400, "API Client ID is required in parameter");
    }

    const response = await ApiClientService.rotate(
      admin,
      { id: clientId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }
}
