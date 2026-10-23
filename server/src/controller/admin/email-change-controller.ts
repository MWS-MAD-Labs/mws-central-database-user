import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import { ResponseError } from "../../error/response-error";
import { EmailChangeService, type EmailChangeKind } from "../../service/email-change-service";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class EmailChangeController {
  static change(kind: EmailChangeKind) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      const id = c.req.param("id");
      if (!id) throw new ResponseError(400, "ID is required in parameter");
      const body = await c.req.json().catch(() => ({}));
      const result = await EmailChangeService.change(kind, c.var.admin, id, body, getAuditRequestContext(c));
      return c.json({ data: result });
    };
  }
}
