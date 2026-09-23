import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import { ResponseError } from "../../error/response-error";
import { InternMutationHistoryService } from "../../service/intern-mutation-history-service";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class InternMutationHistoryController {
  static async getHistory(c: Context<{ Variables: AdminVariables }>) {
    const internId = c.req.param("id");
    if (!internId) throw new ResponseError(400, "Intern ID is required in parameter");
    return c.json({
      data: await InternMutationHistoryService.getHistory(c.var.admin, {
        intern_id: internId,
      }),
    });
  }

  static async rollback(c: Context<{ Variables: AdminVariables }>) {
    const internId = c.req.param("id");
    const historyId = c.req.param("historyId");
    if (!internId || !historyId) {
      throw new ResponseError(
        400,
        "Intern ID and history ID are required in parameter",
      );
    }
    return c.json({
      data: await InternMutationHistoryService.rollback(
        c.var.admin,
        { intern_id: internId, history_id: historyId },
        getAuditRequestContext(c),
      ),
    });
  }
}
