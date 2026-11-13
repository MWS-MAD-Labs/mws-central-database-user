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
    const id = c.req.query("id");
    const personId = c.req.query("person_id");
    const employeeId = c.req.query("employee_id");
    const email = c.req.query("email");

    if (!id && !personId && !employeeId && !email) {
      throw new ResponseError(
        400,
        "Query parameter 'id', 'person_id', 'employee_id', or 'email' is required",
      );
    }

    const response = await EmployeeApiService.lookup(
      clientFromContext(c),
      { id, person_id: personId, employee_id: employeeId, email },
      getAuditRequestContext(c),
    );

    return c.json({ success: true, data: response });
  }

  static async photo(c: Context<{ Variables: ApiClientVariables }>) {
    const personId = c.req.query("person_id");
    if (!personId) {
      throw new ResponseError(400, "Query parameter 'person_id' is required");
    }
    const { buffer, contentType, etag } = await EmployeeApiService.photo(personId);
    if (c.req.header("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }
    return new Response(new Uint8Array(buffer), {
      headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=300", ETag: etag },
    });
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
        q: c.req.query("q"),
      },
      getAuditRequestContext(c),
    );

    return c.json({ success: true, ...response });
  }
}
