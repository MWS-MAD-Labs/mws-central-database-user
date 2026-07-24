import type { Context } from "hono";
import type { ApiClientVariables } from "../../type/hono-context";
import type { StudentListRequest } from "../../model/student-api-model";
import { StudentApiService } from "../../service/student-api-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

function clientFromContext(c: Context<{ Variables: ApiClientVariables }>) {
  return {
    clientId: c.var.clientId,
    clientName: c.var.clientName,
    scopes: c.var.scopes,
  };
}

export class StudentApiController {
  static async lookup(c: Context<{ Variables: ApiClientVariables }>) {
    const nis = c.req.query("nis");
    const email = c.req.query("email");

    if (!nis && !email) {
      throw new ResponseError(
        400,
        "Query parameter 'nis' or 'email' is required",
      );
    }

    const response = await StudentApiService.lookup(
      clientFromContext(c),
      { nis, email },
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

    const response = await StudentApiService.list(
      clientFromContext(c),
      {
        page,
        size,
        status: c.req.query("status") as StudentListRequest["status"],
        current_grade_id: c.req.query("current_grade_id"),
        current_class_id: c.req.query("current_class_id"),
        academic_year_id: c.req.query("academic_year_id"),
      },
      getAuditRequestContext(c),
    );

    return c.json({ success: true, ...response });
  }

  static async consentStatus(c: Context<{ Variables: ApiClientVariables }>) {
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const response = await StudentApiService.getConsentStatus(
      clientFromContext(c),
      studentId,
      getAuditRequestContext(c),
    );

    return c.json({ success: true, data: response });
  }

  static async academicHistory(c: Context<{ Variables: ApiClientVariables }>) {
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const response = await StudentApiService.getAcademicHistory(
      clientFromContext(c),
      studentId,
      getAuditRequestContext(c),
    );

    return c.json({ success: true, data: response });
  }

  static async health(c: Context<{ Variables: ApiClientVariables }>) {
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const response = await StudentApiService.getHealth(
      clientFromContext(c),
      studentId,
      getAuditRequestContext(c),
    );

    return c.json({ success: true, data: response });
  }
}
