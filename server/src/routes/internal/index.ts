import { Hono } from "hono";
import { apiClientAuthMiddleware } from "../../middleware/api-client-auth-middleware";
import { internalLimiterMiddleware } from "../../middleware/rate-limiter";
import { employeeApiRouter } from "./employee-api-router";
import { studentApiRouter } from "./student-api-router";
import { personApiRouter } from "./person-api-router";
import { classApiRouter } from "./class-api-router";
import { classTeacherAssignmentApiRouter } from "./class-teacher-assignment-api-router";
import { studentSupportAssignmentApiRouter } from "./student-support-assignment-api-router";
import type { ApiClientVariables } from "../../type/hono-context";
import { applicationEntitlementApiRouter, applicationPermissionApiRouter } from "./application-entitlement-api-router";

export const internalRouter = new Hono<{ Variables: ApiClientVariables }>();

internalRouter.use("*", internalLimiterMiddleware);
internalRouter.use("*", apiClientAuthMiddleware);

internalRouter.route("/employees", employeeApiRouter);
internalRouter.route("/students", studentApiRouter);
internalRouter.route("/persons", personApiRouter);
internalRouter.route("/classes", classApiRouter);
internalRouter.route("/class-teacher-assignments", classTeacherAssignmentApiRouter);
internalRouter.route(
  "/student-support-assignments",
  studentSupportAssignmentApiRouter,
);
internalRouter.route(
  "/application-entitlements",
  applicationEntitlementApiRouter,
);
internalRouter.route("/application-permissions", applicationPermissionApiRouter);
