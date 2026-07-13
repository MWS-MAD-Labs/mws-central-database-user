import { Hono } from "hono";
import { AuthController } from "../../controller/admin/auth-controller";
import { adminAuthMiddleware } from "../../middleware/admin-auth-middleware";
import { employeeAuthRouter } from "./employee-auth-router";
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

// Employee self-service — no dashboard access, only their own profile or home (maybe)
authRouter.route("/employee", employeeAuthRouter);
