import type { Context } from "hono";
import type { ApiClientVariables } from "../../type/hono-context";
import { StudentSupportAssignmentApiService } from "../../service/student-support-assignment-api-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

function clientFromContext(c: Context<{ Variables: ApiClientVariables }>) {
  return {
    clientId: c.var.clientId,
    clientName: c.var.clientName,
    scopes: c.var.scopes,
  };
}

export class StudentSupportAssignmentApiController {
  static async list(c: Context<{ Variables: ApiClientVariables }>) {
    const page = c.req.query("page") ? Number(c.req.query("page")) : 1;
    const size = c.req.query("size") ? Number(c.req.query("size")) : 10;

    if (Number.isNaN(page)) {
      throw new ResponseError(400, "page must be a valid number");
    }
    if (Number.isNaN(size)) {
      throw new ResponseError(400, "size must be a valid number");
    }

    const response = await StudentSupportAssignmentApiService.list(
      clientFromContext(c),
      { page, size },
      getAuditRequestContext(c),
    );

    return c.json({ success: true, ...response });
  }
}
