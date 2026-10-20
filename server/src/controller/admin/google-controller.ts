import type { Context } from "hono";
import { AdminRole } from "../../generated/prisma/client";
import { ResponseError } from "../../error/response-error";
import { GoogleWorkspaceService } from "../../service/google-workspace-service";
import type { AdminVariables } from "../../type/hono-context";

export class GoogleController {
  // Whether an email can be given to a new employee or intern. For the admins who can create them.
  static async emailAvailability(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    if (admin.role === AdminRole.VIEWER || (admin.role === AdminRole.DATABASE_ADMIN && !admin.can_write_employee_data)) {
      throw new ResponseError(403, "Forbidden: You don't have permission to create employees");
    }
    const email = c.req.query("email");
    if (!email) throw new ResponseError(400, "Email is required");
    return c.json({ data: await GoogleWorkspaceService.checkEmailAvailable(email) });
  }
}
