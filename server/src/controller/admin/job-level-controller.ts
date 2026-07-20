import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  CreateJobLevelRequest,
  JobLevelSortField,
  SearchJobLevelRequest,
  UpdateJobLevelRequest,
} from "../../model/job-level-model";
import { JobLevelService } from "../../service/job-level-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class JobLevelController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const request = (await c.req.json()) as CreateJobLevelRequest;

    const response = await JobLevelService.create(
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
      throw new ResponseError(400, "Job level ID is required in parameter");
    }

    const request = (await c.req.json()) as UpdateJobLevelRequest;

    const response = await JobLevelService.update(
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
      throw new ResponseError(400, "Job level ID is required in parameter");
    }

    const response = await JobLevelService.remove(
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
      throw new ResponseError(400, "Job level ID is required in parameter");
    }

    const response = await JobLevelService.get(admin, { id });

    return c.json({ data: response });
  }

  static async search(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    const request: SearchJobLevelRequest = {
      page: c.req.query("page") ? Number(c.req.query("page")) : 1,
      size: c.req.query("size") ? Number(c.req.query("size")) : 10,
      search: c.req.query("search"),
      sort_by: c.req.query("sort_by") as JobLevelSortField | undefined,
      sort_order: c.req.query("sort_order") as "asc" | "desc" | undefined,
    };

    if (Number.isNaN(request.page)) {
      throw new ResponseError(400, "page must be a valid number");
    }
    if (Number.isNaN(request.size)) {
      throw new ResponseError(400, "size must be a valid number");
    }

    const response = await JobLevelService.search(admin, request);

    return c.json(response);
  }
}
