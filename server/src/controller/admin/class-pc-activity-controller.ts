import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  AssignClassPcActivityRequest,
  BulkEnrollClassPcActivityStudentsRequest,
} from "../../model/class-pc-activity-model";
import { ClassPcActivityService } from "../../service/class-pc-activity-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class ClassPcActivityController {
  static async list(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const classId = c.req.param("id");

    if (!classId) {
      throw new ResponseError(400, "Class ID is required in parameter");
    }

    const response = await ClassPcActivityService.list(admin, { class_id: classId });
    return c.json({ data: response });
  }

  static async assign(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const classId = c.req.param("id");

    if (!classId) {
      throw new ResponseError(400, "Class ID is required in parameter");
    }

    const body = (await c.req.json()) as AssignClassPcActivityRequest;

    const response = await ClassPcActivityService.assign(
      admin,
      { ...body, class_id: classId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const classId = c.req.param("id");
    const classActivityId = c.req.param("classActivityId");

    if (!classId || !classActivityId) {
      throw new ResponseError(400, "Class ID and class activity ID are required in parameter");
    }

    await ClassPcActivityService.remove(
      admin,
      { id: classActivityId, class_id: classId },
      getAuditRequestContext(c),
    );

    return c.json({ data: null });
  }

  static async bulkEnrollStudents(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const classId = c.req.param("id");
    const classActivityId = c.req.param("classActivityId");

    if (!classId || !classActivityId) {
      throw new ResponseError(400, "Class ID and class activity ID are required in parameter");
    }

    const body = (await c.req.json()) as BulkEnrollClassPcActivityStudentsRequest;

    const response = await ClassPcActivityService.bulkEnrollStudents(
      admin,
      { ...body, class_id: classId, class_activity_id: classActivityId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async rosterStatus(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const classId = c.req.param("id");
    const classActivityId = c.req.param("classActivityId");

    if (!classId || !classActivityId) {
      throw new ResponseError(400, "Class ID and class activity ID are required in parameter");
    }

    const response = await ClassPcActivityService.rosterStatus(admin, {
      class_id: classId,
      class_activity_id: classActivityId,
    });

    return c.json({ data: response });
  }

  static async listEnrolledStudents(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const classId = c.req.param("id");
    const classActivityId = c.req.param("classActivityId");

    if (!classId || !classActivityId) {
      throw new ResponseError(400, "Class ID and class activity ID are required in parameter");
    }

    const response = await ClassPcActivityService.listEnrolledStudents(admin, {
      class_id: classId,
      class_activity_id: classActivityId,
    });

    return c.json({ data: response });
  }
}
