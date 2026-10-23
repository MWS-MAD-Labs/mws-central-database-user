import { Hono } from "hono";
import { photoUploadBodyLimit } from "../../middleware/upload-body-limit";
import { AuthController } from "../../controller/admin/auth-controller";
import { adminAuthMiddleware } from "../../middleware/admin-auth-middleware";
import {
  authLimiterMiddleware,
  readLimiterMiddleware,
} from "../../middleware/rate-limiter";
import { employeeAuthRouter } from "./employee-auth-router";
import type { AdminVariables } from "../../type/hono-context";

export const authRouter = new Hono<{ Variables: AdminVariables }>();

authRouter.post("/google", authLimiterMiddleware, (c) =>
  AuthController.loginWithGoogle(c),
);
// Refresh requires a valid token and uses the read limit.
authRouter.post("/refresh", readLimiterMiddleware, (c) =>
  AuthController.refresh(c),
);

authRouter.get("/me", adminAuthMiddleware, (c) => AuthController.me(c));
authRouter.put("/me/photo", adminAuthMiddleware, photoUploadBodyLimit, (c) =>
  AuthController.adminPhoto(c),
);
authRouter.get("/me/disciplinary-actions", adminAuthMiddleware, (c) =>
  AuthController.adminDisciplinaryActions(c),
);
authRouter.post("/logout", adminAuthMiddleware, (c) =>
  AuthController.logout(c),
);

authRouter.route("/employee", employeeAuthRouter);
