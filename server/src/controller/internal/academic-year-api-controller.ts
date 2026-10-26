import type { Context } from "hono";
import type { ApiClientVariables } from "../../type/hono-context";
import { AcademicYearApiService } from "../../service/academic-year-api-service";

export class AcademicYearApiController {
  static async list(c: Context<{ Variables: ApiClientVariables }>) {
    return c.json({ success: true, data: await AcademicYearApiService.listActive() });
  }
}
