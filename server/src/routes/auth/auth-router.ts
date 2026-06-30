import { Hono } from "hono";
import { AuthController } from "../../controller/admin/auth-controller";
import { adminAuthMiddleware } from "../../middleware/admin-auth-middleware";
import type { AdminVariables } from "../../type/hono-context";

export const authRouter = new Hono<{ Variables: AdminVariables }>();

// Public Routes
authRouter.post("/google", (c) => AuthController.loginWithGoogle(c));
authRouter.post("/refresh", (c) => AuthController.refresh(c));

// Protected Routes >>>> Need Middleware
authRouter.get("/me", adminAuthMiddleware, (c) => AuthController.me(c));
authRouter.post("/logout", adminAuthMiddleware, (c) =>
  AuthController.logout(c),
);
