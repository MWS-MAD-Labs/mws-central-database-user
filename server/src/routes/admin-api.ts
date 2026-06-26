import { Hono } from "hono";
import { adminAuthMiddleware } from "../middleware/admin-auth-middleware";
import type { AdminVariables } from "../type/hono-context";
import { AuthController } from "../controller/admin/auth-controller";

export const adminRouter = new Hono<{ Variables: AdminVariables }>();

adminRouter.get("/api/auth/me", adminAuthMiddleware, (c) =>
  AuthController.me(c),
);
adminRouter.post("/api/auth/logout", adminAuthMiddleware, (c) =>
  AuthController.logout(c),
);

adminRouter.use("/api/admin/*", adminAuthMiddleware);
