import { Hono } from "hono";
import { adminAuthMiddleware } from "../middleware/admin-auth-middleware";
import type { AdminVariables } from "../type/hono-context";

export const adminRouter = new Hono<{ Variables: AdminVariables }>();

adminRouter.use("/api/admin/*", adminAuthMiddleware);
