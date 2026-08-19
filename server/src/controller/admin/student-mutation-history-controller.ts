import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import { StudentMutationHistoryService } from "../../service/student-mutation-history-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class StudentMutationHistoryController {
  static async getHistory(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const response = await StudentMutationHistoryService.getHistory(admin, {
      student_id: studentId,
    });

    return c.json({ data: response });
  }

  static async rollback(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const historyId = c.req.param("historyId");

    if (!studentId || !historyId) {
      throw new ResponseError(
        400,
        "Student ID and history ID are required in parameter",
      );
    }

    const response = await StudentMutationHistoryService.rollback(
      admin,
      { student_id: studentId, history_id: historyId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }
}
