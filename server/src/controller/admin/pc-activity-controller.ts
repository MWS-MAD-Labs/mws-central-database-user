import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  CreateMasterPCActivityRequest,
  CreatePCActivityRequest,
  MasterPCActivitySortField,
  SearchMasterPCActivityRequest,
  UpdateMasterPCActivityRequest,
  UpdatePCActivityRequest,
} from "../../model/pc-activity-model";
import {
  PCActivityMasterService,
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

// Master-data catalog (Master Data > PC Activities) - a separate controller
// rather than reusing createSimpleMasterDataController (simple-master-data-
// controller.ts), since PCActivityMasterService's request/response shapes
// carry default_mentor_id, which that generic controller's types don't.
export class PCActivityMasterController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const body = (await c.req.json()) as CreateMasterPCActivityRequest;

    const response = await PCActivityMasterService.create(
      admin,
      body,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const id = c.req.param("id");

    if (!id) {
      throw new ResponseError(400, "ID is required in parameter");
    }

    const body = (await c.req.json()) as UpdateMasterPCActivityRequest;

    const response = await PCActivityMasterService.update(
      admin,
      { ...body, id },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const id = c.req.param("id");

    if (!id) {
      throw new ResponseError(400, "ID is required in parameter");
    }

    const response = await PCActivityMasterService.remove(
      admin,
      { id },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async get(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const id = c.req.param("id");

    if (!id) {
      throw new ResponseError(400, "ID is required in parameter");
    }

    const response = await PCActivityMasterService.get(admin, { id });

    return c.json({ data: response });
  }

  static async search(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    const request: SearchMasterPCActivityRequest = {
      page: c.req.query("page") ? Number(c.req.query("page")) : 1,
      size: c.req.query("size") ? Number(c.req.query("size")) : 10,
      search: c.req.query("search"),
      sort_by: c.req.query("sort_by") as MasterPCActivitySortField | undefined,
      sort_order: c.req.query("sort_order") as "asc" | "desc" | undefined,
    };

    if (Number.isNaN(request.page)) {
      throw new ResponseError(400, "page must be a valid number");
    }
    if (Number.isNaN(request.size)) {
      throw new ResponseError(400, "size must be a valid number");
    }

    const response = await PCActivityMasterService.search(admin, request);

    return c.json(response);
  }
}
