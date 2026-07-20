import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type { CreateStudentRequest } from "../../model/student-model";
import { StudentService } from "../../service/student-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class StudentController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const request = (await c.req.json()) as CreateStudentRequest;

    const response = await StudentService.create(
      admin,
      request,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async get(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const id = c.req.param("id");

    if (!id) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const response = await StudentService.get(admin, { id });

    return c.json({ data: response });
  }
}
