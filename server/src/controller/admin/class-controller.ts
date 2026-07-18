import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  ClassSortField,
  CreateClassRequest,
  SearchClassRequest,
  UpdateClassRequest,
} from "../../model/class-model";
import { ClassService } from "../../service/class-service";
import { ResponseError } from "../../error/response-error";
import type { ClassStatus } from "../../generated/prisma/client";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class ClassController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    try {
      const admin = c.var.admin;
      const request = (await c.req.json()) as CreateClassRequest;

      const response = await ClassService.create(
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
        throw new ResponseError(400, "Class ID is required in parameter");
      }

      const request = (await c.req.json()) as UpdateClassRequest;

      const response = await ClassService.update(
        admin,
        {
          ...request,
          id,
        },
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
        throw new ResponseError(400, "Class ID is required in parameter");
      }

      const response = await ClassService.remove(
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
        throw new ResponseError(400, "Class ID is required in parameter");
      }

      const response = await ClassService.get(admin, { id });

      return c.json({ data: response });
    } catch (error) {
      throw error;
    }
  }

  static async search(c: Context<{ Variables: AdminVariables }>) {
    try {
      const admin = c.var.admin;

      const request: SearchClassRequest = {
        page: c.req.query("page") ? Number(c.req.query("page")) : 1,
        size: c.req.query("size") ? Number(c.req.query("size")) : 10,
        search: c.req.query("search"),
        grade_id: c.req.query("grade_id"),
        academic_year_id: c.req.query("academic_year_id"),
        status: c.req.query("status") as ClassStatus | undefined,
        sort_by: c.req.query("sort_by") as ClassSortField | undefined,
        sort_order: c.req.query("sort_order") as "asc" | "desc" | undefined,
      };

      if (Number.isNaN(request.page)) {
        throw new ResponseError(400, "page must be a valid number");
      }
      if (Number.isNaN(request.size)) {
        throw new ResponseError(400, "size must be a valid number");
      }

      const response = await ClassService.search(admin, request);

      return c.json(response);
    } catch (error) {
      throw error;
    }
  }
}
