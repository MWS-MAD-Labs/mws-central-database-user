import type { Context } from "hono";
import type { ApiClientVariables } from "../../type/hono-context";
import { PersonApiService } from "../../service/person-api-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

function clientFromContext(c: Context<{ Variables: ApiClientVariables }>) {
  return {
    clientId: c.var.clientId,
    clientName: c.var.clientName,
    scopes: c.var.scopes,
  };
}

export class PersonApiController {
  static async lookup(c: Context<{ Variables: ApiClientVariables }>) {
    const email = c.req.query("email");

    if (!email) {
      throw new ResponseError(400, "Query parameter 'email' is required");
    }

    const response = await PersonApiService.lookup(
      clientFromContext(c),
      { email },
      getAuditRequestContext(c),
    );

    return c.json({ success: true, data: response });
  }
}
