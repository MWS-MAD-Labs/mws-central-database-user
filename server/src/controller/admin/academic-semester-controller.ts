import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import { ResponseError } from "../../error/response-error";
import { AcademicSemesterService } from "../../service/academic-semester-service";

function required(c: Context<{ Variables: AdminVariables }>, name: string): string {
  const value = c.req.param(name);
  if (!value) throw new ResponseError(400, `${name} is required in parameter`);
  return value;
}

export class AcademicSemesterController {
  static async list(c: Context<{ Variables: AdminVariables }>) {
    return c.json({ data: await AcademicSemesterService.list(required(c, "id")) });
  }
}
