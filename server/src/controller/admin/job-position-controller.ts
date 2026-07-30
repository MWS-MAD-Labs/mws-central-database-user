import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  CreateJobPositionRequest,
  JobPositionSortField,
  SearchJobPositionRequest,
  UpdateJobPositionRequest,
} from "../../model/job-position-model";
import { JobPositionService } from "../../service/job-position-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class JobPositionController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const request = (await c.req.json()) as CreateJobPositionRequest;

    const response = await JobPositionService.create(
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
      throw new ResponseError(400, "Job position ID is required in parameter");
    }

    const request = (await c.req.json()) as UpdateJobPositionRequest;

    const response = await JobPositionService.update(
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
      throw new ResponseError(400, "Job position ID is required in parameter");
    }

    const response = await JobPositionService.remove(
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
      throw new ResponseError(400, "Job position ID is required in parameter");
    }

    const response = await JobPositionService.get(admin, { id });

    return c.json({ data: response });
  }

  static async search(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    const request: SearchJobPositionRequest = {
      page: c.req.query("page") ? Number(c.req.query("page")) : 1,
      size: c.req.query("size") ? Number(c.req.query("size")) : 10,
      search: c.req.query("search"),
      sort_by: c.req.query("sort_by") as JobPositionSortField | undefined,
      sort_order: c.req.query("sort_order") as "asc" | "desc" | undefined,
    };

    if (Number.isNaN(request.page)) {
      throw new ResponseError(400, "page must be a valid number");
    }
    if (Number.isNaN(request.size)) {
      throw new ResponseError(400, "size must be a valid number");
    }

    const response = await JobPositionService.search(admin, request);

    return c.json(response);
  }
}
