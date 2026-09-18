import { Hono } from "hono";
import { PersonApiController } from "../../controller/internal/person-api-controller";
import { requireScope } from "../../middleware/api-client-auth-middleware";
import type { ApiClientVariables } from "../../type/hono-context";
import { API_SCOPES } from "../../constants/api-scopes";

export const personApiRouter = new Hono<{ Variables: ApiClientVariables }>();

// Requires both scopes - this endpoint can return either an employee or a
// student profile, so a caller needs to already be allowed to read both,
// same as calling /employees/lookup and /students/lookup separately.
personApiRouter.get(
  "/lookup",
  requireScope(API_SCOPES.EMPLOYEES_READ),
  requireScope(API_SCOPES.STUDENTS_READ),
  (c) => PersonApiController.lookup(c),
);
