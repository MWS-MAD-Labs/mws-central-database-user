import { Hono } from "hono";
import { adminAuthMiddleware } from "../../middleware/admin-auth-middleware";
import { employeeRouter } from "./employee-router";
import { adminUserRouter } from "./admin-user-router";

export const adminRouter = new Hono();

adminRouter.use("*", adminAuthMiddleware);

adminRouter.route("/employees", employeeRouter);
adminRouter.route("/admin-users", adminUserRouter);
