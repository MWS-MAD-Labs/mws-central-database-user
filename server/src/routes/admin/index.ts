import { Hono } from "hono";
import { adminAuthMiddleware } from "../../middleware/admin-auth-middleware";
import { employeeRouter } from "./employee-router";
import { adminUserRouter } from "./admin-user-router";
import { apiClientRouter } from "./api-client-router";

export const adminRouter = new Hono();

adminRouter.use("*", adminAuthMiddleware);

adminRouter.route("/employees", employeeRouter);
adminRouter.route("/admin-users", adminUserRouter);
adminRouter.route("/api-clients", apiClientRouter);
