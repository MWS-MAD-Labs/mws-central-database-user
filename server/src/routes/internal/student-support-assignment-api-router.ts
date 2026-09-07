import { Hono } from "hono";
import { StudentSupportAssignmentApiController } from "../../controller/internal/student-support-assignment-api-controller";
import { requireScope } from "../../middleware/api-client-auth-middleware";
import type { ApiClientVariables } from "../../type/hono-context";
import { API_SCOPES } from "../../constants/api-scopes";

export const studentSupportAssignmentApiRouter = new Hono<{
  Variables: ApiClientVariables;
}>();

studentSupportAssignmentApiRouter.get(
  "/",
  requireScope(API_SCOPES.STUDENT_SUPPORT_ASSIGNMENTS_READ),
  (c) => StudentSupportAssignmentApiController.list(c),
);
