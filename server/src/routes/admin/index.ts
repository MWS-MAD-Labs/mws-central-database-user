import { Hono } from "hono";
import { adminAuthMiddleware } from "../../middleware/admin-auth-middleware";
import { employeeRouter } from "./employee-router";
import { adminUserRouter } from "./admin-user-router";
import { apiClientRouter } from "./api-client-router";
import { workingDayRouter } from "./working-day-router";
import { academicYearRouter } from "./academic-year-router";
import { classRouter } from "./class-router";
import { unitRouter } from "./unit-router";
import { jobPositionRouter } from "./job-position-router";
import { jobLevelRouter } from "./job-level-router";
import { gradeRouter } from "./grade-router";
import { studentRouter } from "./student-router";

export const adminRouter = new Hono();

adminRouter.use("*", adminAuthMiddleware);

adminRouter.route("/employees", employeeRouter);
adminRouter.route("/admin-users", adminUserRouter);
adminRouter.route("/api-clients", apiClientRouter);
adminRouter.route("/working-days", workingDayRouter);
adminRouter.route("/academic-years", academicYearRouter);
adminRouter.route("/classes", classRouter);
adminRouter.route("/units", unitRouter);
adminRouter.route("/job-positions", jobPositionRouter);
adminRouter.route("/job-levels", jobLevelRouter);
adminRouter.route("/grades", gradeRouter);
adminRouter.route("/students", studentRouter);
