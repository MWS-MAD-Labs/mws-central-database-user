import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  CreateGradeRequest,
  GradeSortField,
  SearchGradeRequest,
  UpdateGradeRequest,
} from "../../model/grade-model";
import { GradeService } from "../../service/grade-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class GradeController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    try {
      const admin = c.var.admin;
      const request = (await c.req.json()) as CreateGradeRequest;

      const response = await GradeService.create(
        admin,
        request,
        getAuditRequestContext(c),
      );

      return c.json({ data: response });
    } catch (error) {
      throw error;
    }
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    try {
      const admin = c.var.admin;
      const id = c.req.param("id");

      if (!id) {
        throw new ResponseError(400, "Grade ID is required in parameter");
      }

      const request = (await c.req.json()) as UpdateGradeRequest;

      const response = await GradeService.update(
        admin,
        { ...request, id },
        getAuditRequestContext(c),
      );

      return c.json({ data: response });
    } catch (error) {
      throw error;
    }
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    try {
      const admin = c.var.admin;
      const id = c.req.param("id");

      if (!id) {
        throw new ResponseError(400, "Grade ID is required in parameter");
      }

      const response = await GradeService.remove(
        admin,
        { id },
        getAuditRequestContext(c),
      );

      return c.json({ data: response });
    } catch (error) {
      throw error;
    }
  }

  static async get(c: Context<{ Variables: AdminVariables }>) {
    try {
      const admin = c.var.admin;
      const id = c.req.param("id");

      if (!id) {
        throw new ResponseError(400, "Grade ID is required in parameter");
      }

      const response = await GradeService.get(admin, { id });

      return c.json({ data: response });
    } catch (error) {
      throw error;
    }
  }

  static async search(c: Context<{ Variables: AdminVariables }>) {
    try {
      const admin = c.var.admin;

      const request: SearchGradeRequest = {
        page: c.req.query("page") ? Number(c.req.query("page")) : 1,
        size: c.req.query("size") ? Number(c.req.query("size")) : 10,
        search: c.req.query("search"),
        sort_by: c.req.query("sort_by") as GradeSortField | undefined,
        sort_order: c.req.query("sort_order") as "asc" | "desc" | undefined,
      };

      if (Number.isNaN(request.page)) {
        throw new ResponseError(400, "page must be a valid number");
      }
      if (Number.isNaN(request.size)) {
        throw new ResponseError(400, "size must be a valid number");
      }

      const response = await GradeService.search(admin, request);

      return c.json(response);
    } catch (error) {
      throw error;
    }
  }
}
