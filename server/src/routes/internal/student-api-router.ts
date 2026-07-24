import { Hono } from "hono";
import { StudentApiController } from "../../controller/internal/student-api-controller";
import { requireScope } from "../../middleware/api-client-auth-middleware";
import type { ApiClientVariables } from "../../type/hono-context";
import { API_SCOPES } from "../../constants/api-scopes";

export const studentApiRouter = new Hono<{ Variables: ApiClientVariables }>();

studentApiRouter.get(
  "/",
  requireScope(API_SCOPES.STUDENTS_READ),
  (c) => StudentApiController.list(c),
);
studentApiRouter.get(
  "/lookup",
  requireScope(API_SCOPES.STUDENTS_READ),
  (c) => StudentApiController.lookup(c),
);
studentApiRouter.get(
  "/:id/academic-history",
  requireScope(API_SCOPES.STUDENTS_ACADEMIC_HISTORY_READ),
  (c) => StudentApiController.academicHistory(c),
);
studentApiRouter.get(
  "/:id/consent-status",
  requireScope(API_SCOPES.STUDENTS_CONSENT_READ),
  (c) => StudentApiController.consentStatus(c),
);
studentApiRouter.get(
  "/:id/health",
  requireScope(API_SCOPES.STUDENTS_HEALTH_READ),
  (c) => StudentApiController.health(c),
);
