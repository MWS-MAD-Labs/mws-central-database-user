import { Hono } from "hono";
import { DashboardController } from "../controller/dashboard-controller";
import { dashboardAuthMiddleware } from "../middleware/dashboard-auth-middleware";
import { readLimiterMiddleware } from "../middleware/rate-limiter";
import type { DashboardVariables } from "../type/hono-context";

export const dashboardRouter = new Hono<{ Variables: DashboardVariables }>();

dashboardRouter.use("*", readLimiterMiddleware);
dashboardRouter.use("*", dashboardAuthMiddleware);

dashboardRouter.get("/summary", (c) => DashboardController.summary(c));
