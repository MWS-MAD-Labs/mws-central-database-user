import type { Context } from "hono";
import type { ApiClientVariables } from "../../type/hono-context";
import type { EmployeeListRequest } from "../../model/employee-api-model";
import { EmployeeApiService } from "../../service/employee-api-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

function clientFromContext(c: Context<{ Variables: ApiClientVariables }>) {
  return {
    clientId: c.var.clientId,
    clientName: c.var.clientName,
    scopes: c.var.scopes,
  };
}

export class EmployeeApiController {
  static async lookup(c: Context<{ Variables: ApiClientVariables }>) {
    const employeeId = c.req.query("employee_id");
    const email = c.req.query("email");

    if (!employeeId && !email) {
      throw new ResponseError(
        400,
        "Query parameter 'employee_id' or 'email' is required",
      );
    }

    const response = await EmployeeApiService.lookup(
      clientFromContext(c),
      { employee_id: employeeId, email },
      getAuditRequestContext(c),
    );

    return c.json({ success: true, data: response });
  }

  static async list(c: Context<{ Variables: ApiClientVariables }>) {
    const page = c.req.query("page") ? Number(c.req.query("page")) : 1;
    const size = c.req.query("size") ? Number(c.req.query("size")) : 10;

    if (Number.isNaN(page)) {
      throw new ResponseError(400, "page must be a valid number");
    }
    if (Number.isNaN(size)) {
      throw new ResponseError(400, "size must be a valid number");
    }

    const response = await EmployeeApiService.list(
      clientFromContext(c),
      {
        page,
        size,
        status: c.req.query("status") as EmployeeListRequest["status"],
        unit_id: c.req.query("unit_id"),
        job_position_id: c.req.query("job_position_id"),
      },
      getAuditRequestContext(c),
    );

    return c.json({ success: true, ...response });
  }
}
