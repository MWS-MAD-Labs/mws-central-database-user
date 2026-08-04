import { Hono } from "hono";
import { StudentSupportAssignmentController } from "../../controller/admin/student-support-assignment-controller";
import type { AdminVariables } from "../../type/hono-context";

export const studentSupportAssignmentRouter = new Hono<{
  Variables: AdminVariables;
}>();

studentSupportAssignmentRouter.get("/caseload", (c) =>
  StudentSupportAssignmentController.getCaseload(c),
);
