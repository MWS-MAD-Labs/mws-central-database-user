import { Hono } from "hono";
import { adminAuthMiddleware } from "../../middleware/admin-auth-middleware";

export const adminRouter = new Hono();

adminRouter.use("*", adminAuthMiddleware);
