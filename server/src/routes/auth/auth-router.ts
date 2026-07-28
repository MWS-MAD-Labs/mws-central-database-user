import { Hono } from "hono";
import { AuthController } from "../../controller/admin/auth-controller";
import { adminAuthMiddleware } from "../../middleware/admin-auth-middleware";
import {
  authLimiterMiddleware,
  readLimiterMiddleware,
} from "../../middleware/rate-limiter";
import { employeeAuthRouter } from "./employee-auth-router";
import type { AdminVariables } from "../../type/hono-context";

export const authRouter = new Hono<{ Variables: AdminVariables }>();

// Public Routes
authRouter.post("/google", authLimiterMiddleware, (c) =>
  AuthController.loginWithGoogle(c),
);
// Refresh isn't brute-forceable the way login is (it needs a real refresh
// token, not a guessable credential) - readLimiter still caps abuse without
// punishing an active session's normal periodic refresh calls.
authRouter.post("/refresh", readLimiterMiddleware, (c) =>
  AuthController.refresh(c),
);

// Protected Routes >>>> Need Middleware
authRouter.get("/me", adminAuthMiddleware, (c) => AuthController.me(c));
authRouter.post("/logout", adminAuthMiddleware, (c) =>
  AuthController.logout(c),
);

// Employee self-service — no dashboard access, only their own profile or home (maybe)
authRouter.route("/employee", employeeAuthRouter);
