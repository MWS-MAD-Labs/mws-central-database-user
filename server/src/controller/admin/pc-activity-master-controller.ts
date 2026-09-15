import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  CreatePCActivityMasterRequest,
  PCActivityMasterSortField,
  PreviewPCActivityReassignmentRequest,
  SearchPCActivityMasterRequest,
  UpdatePCActivityMasterRequest,
} from "../../model/pc-activity-model";
import { PCActivityMasterService } from "../../service/pc-activity-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

// Master Data > PC Activities - mirrors JobPositionController exactly
// (same "name + optional unit scope" shape, same reassignment-preview
// endpoint), since PCActivityMasterService now mirrors JobPositionService.
export class PCActivityMasterController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const request = (await c.req.json()) as CreatePCActivityMasterRequest;

    const response = await PCActivityMasterService.create(
      admin,
      request,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const id = c.req.param("id");

    if (!id) {
      throw new ResponseError(400, "PC activity ID is required in parameter");
    }

    const request = (await c.req.json()) as UpdatePCActivityMasterRequest;

    const response = await PCActivityMasterService.update(
      admin,
      { ...request, id },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const id = c.req.param("id");

    if (!id) {
      throw new ResponseError(400, "PC activity ID is required in parameter");
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
      throw new ResponseError(400, "PC activity ID is required in parameter");
    }

    const response = await PCActivityMasterService.get(admin, { id });

    return c.json({ data: response });
  }

  static async search(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    const request: SearchPCActivityMasterRequest = {
      page: c.req.query("page") ? Number(c.req.query("page")) : 1,
      size: c.req.query("size") ? Number(c.req.query("size")) : 10,
      search: c.req.query("search"),
      sort_by: c.req.query("sort_by") as PCActivityMasterSortField | undefined,
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

  static async previewReassignmentImpact(
    c: Context<{ Variables: AdminVariables }>,
  ) {
    const admin = c.var.admin;
    const id = c.req.param("id");

    if (!id) {
      throw new ResponseError(400, "PC activity ID is required in parameter");
    }

    const unitIdsParam = c.req.query("unit_ids") || "";
    const request: PreviewPCActivityReassignmentRequest = {
      id,
      unit_ids: unitIdsParam ? unitIdsParam.split(",").filter(Boolean) : [],
      page: c.req.query("page") ? Number(c.req.query("page")) : 1,
      size: c.req.query("size") ? Number(c.req.query("size")) : 10,
    };

    if (Number.isNaN(request.page)) {
      throw new ResponseError(400, "page must be a valid number");
    }
    if (Number.isNaN(request.size)) {
      throw new ResponseError(400, "size must be a valid number");
    }

    const response = await PCActivityMasterService.previewReassignmentImpact(
      admin,
      request,
    );

    return c.json(response);
  }
}
