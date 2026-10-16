import type { Context } from "hono";
import type { ApiClientVariables } from "../../type/hono-context";
import type { InternListRequest } from "../../model/intern-api-model";
import { InternApiService } from "../../service/intern-api-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

function clientFromContext(c: Context<{ Variables: ApiClientVariables }>) {
  return { clientId: c.var.clientId, clientName: c.var.clientName, scopes: c.var.scopes };
}

export class InternApiController {
  static async lookup(c: Context<{ Variables: ApiClientVariables }>) {
    const id = c.req.query("id");
    const personId = c.req.query("person_id");
    const email = c.req.query("email");
    if (!id && !personId && !email) {
      throw new ResponseError(400, "Query parameter 'id', 'person_id' or 'email' is required");
    }
    const response = await InternApiService.lookup(
      clientFromContext(c),
      { id, person_id: personId, email },
      getAuditRequestContext(c),
    );
    return c.json({ success: true, data: response });
  }

  static async list(c: Context<{ Variables: ApiClientVariables }>) {
    const page = c.req.query("page") ? Number(c.req.query("page")) : 1;
    const size = c.req.query("size") ? Number(c.req.query("size")) : 10;
    if (Number.isNaN(page)) throw new ResponseError(400, "page must be a valid number");
    if (Number.isNaN(size)) throw new ResponseError(400, "size must be a valid number");
    const response = await InternApiService.list(clientFromContext(c), {
      page,
      size,
      status: c.req.query("status") as InternListRequest["status"],
      unit_id: c.req.query("unit_id"),
      job_position_id: c.req.query("job_position_id"),
      q: c.req.query("q"),
    });
    return c.json({ success: true, ...response });
  }
}
