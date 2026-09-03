import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  ClearPCActivityDefaultMentorRequest,
  CreatePCActivityRequest,
  SetPCActivityDefaultMentorRequest,
  UpdatePCActivityRequest,
} from "../../model/pc-activity-model";
import {
  PCActivityDefaultMentorService,
  PCActivityService,
} from "../../service/pc-activity-service";
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

// Master Data > PC Activities > Manage Mentors - the per-unit default
// mentor sub-resource, nested under one activity.
export class PCActivityDefaultMentorController {
  static async list(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const activityId = c.req.param("activityId");

    if (!activityId) {
      throw new ResponseError(400, "PC activity ID is required in parameter");
    }

    const response = await PCActivityDefaultMentorService.list(admin, {
      activity_id: activityId,
    });

    return c.json({ data: response });
  }

  // Master Data table's "Mentor" column - one call for however many
  // activities are on the current page, via ?activity_ids=a,b,c.
  static async listBatch(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const activityIdsParam = c.req.query("activity_ids");
    const activityIds = activityIdsParam
      ? activityIdsParam.split(",").filter(Boolean)
      : [];

    if (activityIds.length === 0) {
      return c.json({ data: [] });
    }

    const response = await PCActivityDefaultMentorService.listBatch(admin, {
      activity_ids: activityIds,
    });

    return c.json({ data: response });
  }

  static async set(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const activityId = c.req.param("activityId");
    const unitId = c.req.param("unitId");

    if (!activityId) {
      throw new ResponseError(400, "PC activity ID is required in parameter");
    }
    if (!unitId) {
      throw new ResponseError(400, "Unit ID is required in parameter");
    }

    const body = (await c.req.json()) as Omit<
      SetPCActivityDefaultMentorRequest,
      "activity_id" | "unit_id"
    >;

    const response = await PCActivityDefaultMentorService.set(
      admin,
      { ...body, activity_id: activityId, unit_id: unitId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async clear(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const activityId = c.req.param("activityId");
    const unitId = c.req.param("unitId");

    if (!activityId) {
      throw new ResponseError(400, "PC activity ID is required in parameter");
    }
    if (!unitId) {
      throw new ResponseError(400, "Unit ID is required in parameter");
    }

    const request: ClearPCActivityDefaultMentorRequest = {
      activity_id: activityId,
      unit_id: unitId,
    };

    const response = await PCActivityDefaultMentorService.clear(
      admin,
      request,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }
}
