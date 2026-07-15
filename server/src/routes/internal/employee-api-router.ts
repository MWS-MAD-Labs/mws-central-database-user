import { Hono } from "hono";
import { EmployeeApiController } from "../../controller/internal/employee-api-controller";
import { requireScope } from "../../middleware/api-client-auth-middleware";
import type { ApiClientVariables } from "../../type/hono-context";
import { API_SCOPES } from "../../constants/api-scopes";

export const employeeApiRouter = new Hono<{ Variables: ApiClientVariables }>();

employeeApiRouter.get("/lookup", requireScope(API_SCOPES.EMPLOYEES_READ), (c) =>
  EmployeeApiController.lookup(c),
);
