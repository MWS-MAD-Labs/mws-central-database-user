import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type { PromoteEmployeeRequest } from "../../model/admin-user-model";
import { AdminUserService } from "../../service/admin-user-service";
import { ResponseError } from "../../error/response-error";

export class AdminUserController {
  static async promote(c: Context<{ Variables: AdminVariables }>) {
    try {
      const admin = c.var.admin;
      const request = (await c.req.json()) as PromoteEmployeeRequest;

      const response = await AdminUserService.promoteEmployee(admin, request);

      return c.json({ data: response });
    } catch (error) {
      throw error;
    }
  }

  static async demote(c: Context<{ Variables: AdminVariables }>) {
    try {
      const admin = c.var.admin;
      const targetAdminId = c.req.param("id");

      if (!targetAdminId) {
        throw new ResponseError(400, "Admin ID is required in parameter");
      }

      const response = await AdminUserService.demoteAdmin(
        admin,
        targetAdminId,
      );

      return c.json({ data: response });
    } catch (error) {
      throw error;
    }
  }
}
