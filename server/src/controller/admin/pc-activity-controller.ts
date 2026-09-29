import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import { PCActivityService } from "../../service/pc-activity-service";
import { ResponseError } from "../../error/response-error";

export class PCActivityController {
  static async getList(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const isDeletedQuery = c.req.query("is_deleted");

    const response = await PCActivityService.getList(admin, {
      student_id: studentId,
      is_deleted: isDeletedQuery ? isDeletedQuery === "true" : undefined,
    });

    return c.json({ data: response });
  }
}
