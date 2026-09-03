import { Hono } from "hono";
import { ClassTeacherAssignmentApiController } from "../../controller/internal/class-teacher-assignment-api-controller";
import { requireScope } from "../../middleware/api-client-auth-middleware";
import type { ApiClientVariables } from "../../type/hono-context";
import { API_SCOPES } from "../../constants/api-scopes";

export const classTeacherAssignmentApiRouter = new Hono<{
  Variables: ApiClientVariables;
}>();

classTeacherAssignmentApiRouter.get(
  "/",
  requireScope(API_SCOPES.CLASS_TEACHER_ASSIGNMENTS_READ),
  (c) => ClassTeacherAssignmentApiController.list(c),
);
