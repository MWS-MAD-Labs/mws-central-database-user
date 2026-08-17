import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import { EmployeeMutationHistoryService } from "../../service/employee-mutation-history-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class EmployeeMutationHistoryController {
  static async getHistory(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");

    if (!employeeId) {
      throw new ResponseError(400, "Employee ID is required in parameter");
    }

    const response = await EmployeeMutationHistoryService.getHistory(admin, {
      employee_id: employeeId,
    });

    return c.json({ data: response });
  }

  static async rollback(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");
    const historyId = c.req.param("historyId");

    if (!employeeId || !historyId) {
      throw new ResponseError(
        400,
        "Employee ID and history ID are required in parameter",
      );
    }

    const response = await EmployeeMutationHistoryService.rollback(
      admin,
      { employee_id: employeeId, history_id: historyId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }
}
