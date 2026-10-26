import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import { ResponseError } from "../../error/response-error";
import { AcademicSemesterService } from "../../service/academic-semester-service";
import { getAuditRequestContext } from "../../utils/audit-request-context";

function required(c: Context<{ Variables: AdminVariables }>, name: string): string {
  const value = c.req.param(name);
  if (!value) throw new ResponseError(400, `${name} is required in parameter`);
  return value;
}

export class AcademicSemesterController {
  static async list(c: Context<{ Variables: AdminVariables }>) {
    return c.json({ data: await AcademicSemesterService.list(required(c, "id")) });
  }

  static async create(c: Context<{ Variables: AdminVariables }>) {
    const body = (await c.req.json()) as Record<string, unknown>;
    const response = await AcademicSemesterService.create(
      c.var.admin,
      { ...body, academic_year_id: required(c, "id") } as never,
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async createDefaults(c: Context<{ Variables: AdminVariables }>) {
    const response = await AcademicSemesterService.createDefaults(
      c.var.admin,
      required(c, "id"),
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    const body = (await c.req.json()) as Record<string, unknown>;
    const response = await AcademicSemesterService.update(
      c.var.admin,
      { ...body, id: required(c, "semesterId") } as never,
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    await AcademicSemesterService.remove(c.var.admin, required(c, "semesterId"), getAuditRequestContext(c));
    return c.json({ data: true });
  }
}
