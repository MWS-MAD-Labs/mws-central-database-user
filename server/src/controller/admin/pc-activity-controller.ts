import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  CreatePCActivityRequest,
  UpdatePCActivityRequest,
} from "../../model/pc-activity-model";
import { PCActivityService } from "../../service/pc-activity-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class PCActivityController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const body = (await c.req.json()) as CreatePCActivityRequest;

    const response = await PCActivityService.create(
      admin,
      { ...body, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const activityId = c.req.param("activityId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!activityId) {
      throw new ResponseError(400, "PC activity ID is required in parameter");
    }

    const body = (await c.req.json()) as UpdatePCActivityRequest;

    const response = await PCActivityService.update(
      admin,
      { ...body, id: activityId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const activityId = c.req.param("activityId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!activityId) {
      throw new ResponseError(400, "PC activity ID is required in parameter");
    }

    const response = await PCActivityService.remove(
      admin,
      { id: activityId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async restore(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const activityId = c.req.param("activityId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!activityId) {
      throw new ResponseError(400, "PC activity ID is required in parameter");
    }

    const response = await PCActivityService.restore(
      admin,
      { id: activityId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

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
