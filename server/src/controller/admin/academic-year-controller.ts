import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  AcademicYearSortField,
  CreateAcademicYearRequest,
  SearchAcademicYearRequest,
  UpdateAcademicYearRequest,
} from "../../model/academic-year-model";
import { AcademicYearService } from "../../service/academic-year-service";
import { ResponseError } from "../../error/response-error";
import type { AcademicYearStatus } from "../../generated/prisma/client";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class AcademicYearController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const request = (await c.req.json()) as CreateAcademicYearRequest;

    const response = await AcademicYearService.create(
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
      throw new ResponseError(400, "Academic year ID is required in parameter");
    }

    const request = (await c.req.json()) as UpdateAcademicYearRequest;

    const response = await AcademicYearService.update(
      admin,
      {
        ...request,
        id,
      },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const id = c.req.param("id");

    if (!id) {
      throw new ResponseError(400, "Academic year ID is required in parameter");
    }

    const response = await AcademicYearService.remove(
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
      throw new ResponseError(400, "Academic year ID is required in parameter");
    }

    const response = await AcademicYearService.get(admin, { id });

    return c.json({ data: response });
  }

  static async search(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    const request: SearchAcademicYearRequest = {
      page: c.req.query("page") ? Number(c.req.query("page")) : 1,
      size: c.req.query("size") ? Number(c.req.query("size")) : 10,
      search: c.req.query("search"),
      status: c.req.query("status") as AcademicYearStatus | undefined,
      sort_by: c.req.query("sort_by") as AcademicYearSortField | undefined,
      sort_order: c.req.query("sort_order") as "asc" | "desc" | undefined,
    };

    if (Number.isNaN(request.page)) {
      throw new ResponseError(400, "page must be a valid number");
    }
    if (Number.isNaN(request.size)) {
      throw new ResponseError(400, "size must be a valid number");
    }

    const response = await AcademicYearService.search(admin, request);

    return c.json(response);
  }
}
