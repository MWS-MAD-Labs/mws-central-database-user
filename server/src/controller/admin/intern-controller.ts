import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  CreateInternRequest,
  InternSortField,
  SearchInternRequest,
  UpdateInternRequest,
} from "../../model/intern-model";
import { InternService } from "../../service/intern-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";
import type { Gender, InternStatus, Religion } from "../../generated/prisma/enums";

export class InternController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    const request = (await c.req.json()) as CreateInternRequest;

    const response = await InternService.create(
      admin,
      request,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const internId = c.req.param("id");

    if (!internId) {
      throw new ResponseError(400, "Intern ID is required in parameter");
    }

    const request = (await c.req.json()) as UpdateInternRequest;

    const payload: UpdateInternRequest = {
      ...request,
      id: internId,
    };

    const response = await InternService.update(
      admin,
      payload,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async get(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const internId = c.req.param("id");

    if (!internId) {
      throw new ResponseError(400, "Intern ID is required in parameter");
    }

    const response = await InternService.get(admin, { id: internId });
    return c.json({ data: response });
  }

  static async countTotal(c: Context<{ Variables: AdminVariables }>) {
    const total = await InternService.countTotal();

    return c.json({ data: { total } });
  }

  static async search(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    const rawPage = c.req.query("page");
    const rawSize = c.req.query("size");
    const page = rawPage !== undefined ? Number(rawPage) : 1;
    const size = rawSize !== undefined ? Number(rawSize) : 10;

    if (Number.isNaN(page)) {
      throw new ResponseError(400, "page must be a valid number");
    }
    if (Number.isNaN(size)) {
      throw new ResponseError(400, "size must be a valid number");
    }

    const request: SearchInternRequest = {
      page,
      size,

      search: c.req.query("search"),

      status: c.req.query("status") as InternStatus | undefined,
      unit_id: c.req.query("unit_id"),
      job_position_id: c.req.query("job_position_id"),
      building_id: c.req.query("building_id"),
      gender: c.req.query("gender") as Gender | undefined,
      religion: c.req.query("religion") as Religion | undefined,
      join_date_start: c.req.query("join_date_start"),
      join_date_end: c.req.query("join_date_end"),

      is_deleted: c.req.query("is_deleted")
        ? c.req.query("is_deleted") === "true"
        : undefined,

      sort_by: c.req.query("sort_by") as InternSortField | undefined,
      sort_order: c.req.query("sort_order") as "asc" | "desc" | undefined,
    };

    const response = await InternService.search(admin, request);

    return c.json(response);
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const internId = c.req.param("id");

    if (!internId) {
      throw new ResponseError(400, "Intern ID is required in parameter");
    }

    const response = await InternService.remove(
      admin,
      { id: internId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async restore(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const internId = c.req.param("id");

    if (!internId) {
      throw new ResponseError(400, "Intern ID is required in parameter");
    }

    const response = await InternService.restore(
      admin,
      { id: internId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }
}
