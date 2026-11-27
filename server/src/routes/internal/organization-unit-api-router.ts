import { Hono } from "hono";
import { API_SCOPES } from "../../constants/api-scopes";
import { OrganizationUnitApiController } from "../../controller/internal/organization-unit-api-controller";
import { requireScope } from "../../middleware/api-client-auth-middleware";
import type { ApiClientVariables } from "../../type/hono-context";

export const organizationUnitApiRouter = new Hono<{ Variables: ApiClientVariables }>();

organizationUnitApiRouter.get("/", requireScope(API_SCOPES.EMPLOYEES_READ), (c) =>
  OrganizationUnitApiController.list(c),
);
organizationUnitApiRouter.get("/version", requireScope(API_SCOPES.EMPLOYEES_READ), (c) =>
  OrganizationUnitApiController.version(c),
);
