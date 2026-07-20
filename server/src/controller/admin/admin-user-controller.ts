import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  GrantAfterHoursWriteRequest,
  PromoteEmployeeRequest,
  SetCanWriteDataRequest,
} from "../../model/admin-user-model";
import { AdminUserService } from "../../service/admin-user-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class AdminUserController {
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
