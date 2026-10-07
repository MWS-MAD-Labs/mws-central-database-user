import { Hono } from "hono";
import { adminAuthMiddleware } from "../../middleware/admin-auth-middleware";
import { adminLimiterMiddleware } from "../../middleware/rate-limiter";
import { employeeRouter } from "./employee-router";
import { internRouter } from "./intern-router";
import { adminUserRouter } from "./admin-user-router";
import { apiClientRouter } from "./api-client-router";
import { workingDayRouter } from "./working-day-router";
import { academicYearRouter } from "./academic-year-router";
import { classRouter } from "./class-router";
import { unitRouter } from "./unit-router";
import { jobPositionRouter } from "./job-position-router";
import { jobLevelRouter } from "./job-level-router";
import { buildingRouter } from "./building-router";
import { pcActivityMasterRouter } from "./pc-activity-master-router";
import { pcActivityRoomRouter } from "./pc-activity-room-router";
import { institutionRouter } from "./institution-router";
import { majorRouter } from "./major-router";
import { gradeRouter } from "./grade-router";
import { studentRouter } from "./student-router";
import { enrollmentRouter } from "./enrollment-router";
import { auditLogRouter } from "./audit-log-router";
import { studentSupportAssignmentRouter } from "./student-support-assignment-router";
import { identifierChangeRequestRouter } from "./identifier-change-request-router";
import { applicationEntitlementRouter } from "./application-entitlement-router";
import {
  applicationAccessRouter,
  applicationAccessRuleRouter,
  applicationOrganizationRouter,
  applicationRoleRouter,
  applicationPermissionRouter,
} from "./application-role-router";
import { applicationIntegrationProfileRouter } from "./application-integration-profile-router";

export const adminRouter = new Hono();

adminRouter.use("*", adminLimiterMiddleware);
adminRouter.use("*", adminAuthMiddleware);

adminRouter.route("/employees", employeeRouter);
adminRouter.route("/interns", internRouter);
adminRouter.route("/admin-users", adminUserRouter);
adminRouter.route("/api-clients", apiClientRouter);
adminRouter.route("/working-days", workingDayRouter);
adminRouter.route("/academic-years", academicYearRouter);
adminRouter.route("/classes", classRouter);
adminRouter.route("/units", unitRouter);
adminRouter.route("/job-positions", jobPositionRouter);
adminRouter.route("/job-levels", jobLevelRouter);
adminRouter.route("/buildings", buildingRouter);
adminRouter.route("/pc-activities-master", pcActivityMasterRouter);
adminRouter.route("/pc-activity-rooms", pcActivityRoomRouter);
adminRouter.route("/institutions", institutionRouter);
adminRouter.route("/majors", majorRouter);
adminRouter.route("/grades", gradeRouter);
adminRouter.route("/students", studentRouter);
adminRouter.route("/enrollments", enrollmentRouter);
adminRouter.route("/audit-logs", auditLogRouter);
adminRouter.route("/support-assignments", studentSupportAssignmentRouter);
adminRouter.route("/identifier-change-requests", identifierChangeRequestRouter);
adminRouter.route("/application-entitlements", applicationEntitlementRouter);
adminRouter.route("/application-roles", applicationRoleRouter);
adminRouter.route("/application-permissions", applicationPermissionRouter);
adminRouter.route("/application-access-rules", applicationAccessRuleRouter);
adminRouter.route("/application-access", applicationAccessRouter);
adminRouter.route("/application-organizations", applicationOrganizationRouter);
adminRouter.route(
  "/application-integration-profiles",
  applicationIntegrationProfileRouter,
);
