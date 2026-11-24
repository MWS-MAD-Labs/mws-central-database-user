import type { Context } from "hono";
import type { ApiClientVariables } from "../../type/hono-context";
import { OrganizationUnitApiService } from "../../service/organization-unit-api-service";

export class OrganizationUnitApiController {
  static async list(c: Context<{ Variables: ApiClientVariables }>) {
    return c.json({ success: true, data: await OrganizationUnitApiService.list() });
  }

  static async version(c: Context<{ Variables: ApiClientVariables }>) {
    return c.json({ success: true, data: await OrganizationUnitApiService.version() });
  }
}
