import type { Context } from "hono";
import type { ApiClientVariables } from "../../type/hono-context";
import { EmployeeApiService } from "../../service/employee-api-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class EmployeeApiController {
  static async lookup(c: Context<{ Variables: ApiClientVariables }>) {
    try {
      const email = c.req.query("email");

      if (!email) {
        throw new ResponseError(400, "Query parameter 'email' is required");
      }

      const response = await EmployeeApiService.lookupByEmail(
        {
          clientId: c.var.clientId,
          clientName: c.var.clientName,
          scopes: c.var.scopes,
        },
        { email },
        getAuditRequestContext(c),
      );

      return c.json({ data: response });
    } catch (error) {
      throw error;
    }
  }
}
