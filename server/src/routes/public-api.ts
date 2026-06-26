import { Hono } from "hono";
import { AuthController } from "../controller/admin/auth-controller";

export const publicRouter = new Hono();

publicRouter.post("/api/auth/google", (c) => AuthController.loginWithGoogle(c));
