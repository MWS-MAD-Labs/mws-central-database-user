import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import { PCActivityMentorMutationHistoryService } from "../../service/pc-activity-mentor-mutation-history-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class PCActivityMentorMutationHistoryController {
  static async getHistory(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const activityId = c.req.param("activityId");

    if (!activityId) {
      throw new ResponseError(400, "Activity ID is required in parameter");
    }

    const response = await PCActivityMentorMutationHistoryService.getHistory(
      admin,
      { activity_id: activityId },
    );

    return c.json({ data: response });
  }

  static async rollback(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const activityId = c.req.param("activityId");
    const historyId = c.req.param("historyId");

    if (!activityId || !historyId) {
      throw new ResponseError(
        400,
        "Activity ID and history ID are required in parameter",
      );
    }

    const response = await PCActivityMentorMutationHistoryService.rollback(
      admin,
      { activity_id: activityId, history_id: historyId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }
}
