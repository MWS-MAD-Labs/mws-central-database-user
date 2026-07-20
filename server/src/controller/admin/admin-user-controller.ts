import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  AdminUserSortField,
  GrantAfterHoursWriteRequest,
  PromoteEmployeeRequest,
  SearchAdminUserRequest,
  SetCanWriteDataRequest,
} from "../../model/admin-user-model";
import { AdminUserService } from "../../service/admin-user-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";
import type { AdminRole } from "../../generated/prisma/client";

export class AdminUserController {
  static async get(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const id = c.req.param("id");

    if (!id) {
      throw new ResponseError(400, "Admin ID is required in parameter");
    }

    const response = await AdminUserService.get(admin, { id });

    return c.json({ data: response });
  }

  static async search(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    const request: SearchAdminUserRequest = {
      page: c.req.query("page") ? Number(c.req.query("page")) : 1,
      size: c.req.query("size") ? Number(c.req.query("size")) : 10,
      search: c.req.query("search"),
      role: c.req.query("role") as AdminRole | undefined,
      is_active: c.req.query("is_active")
        ? c.req.query("is_active") === "true"
        : undefined,
      sort_by: c.req.query("sort_by") as AdminUserSortField | undefined,
      sort_order: c.req.query("sort_order") as "asc" | "desc" | undefined,
    };

    if (Number.isNaN(request.page)) {
      throw new ResponseError(400, "page must be a valid number");
    }
    if (Number.isNaN(request.size)) {
      throw new ResponseError(400, "size must be a valid number");
    }

    const response = await AdminUserService.search(admin, request);

    return c.json(response);
  }

  static async promote(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const request = (await c.req.json()) as PromoteEmployeeRequest;

    const response = await AdminUserService.promoteEmployee(
      admin,
      request,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async demote(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const targetAdminId = c.req.param("id");

    if (!targetAdminId) {
      throw new ResponseError(400, "Admin ID is required in parameter");
    }

    const response = await AdminUserService.demoteAdmin(
      admin,
      targetAdminId,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async setCanWriteData(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const targetAdminId = c.req.param("id");

    if (!targetAdminId) {
      throw new ResponseError(400, "Admin ID is required in parameter");
    }

    const request = (await c.req.json()) as SetCanWriteDataRequest;

    const response = await AdminUserService.setCanWriteData(
      admin,
      targetAdminId,
      request,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async grantAfterHoursWrite(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const targetAdminId = c.req.param("id");

    if (!targetAdminId) {
      throw new ResponseError(400, "Admin ID is required in parameter");
    }

    const request = (await c.req.json()) as GrantAfterHoursWriteRequest;

    const response = await AdminUserService.grantAfterHoursWrite(
      admin,
      targetAdminId,
      request,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }
}
