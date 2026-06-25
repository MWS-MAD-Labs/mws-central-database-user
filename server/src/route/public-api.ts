import { Hono } from "hono";
import { AuthController } from "../controller/admin/auth-controller";

export const publicRouter = new Hono();

publicRouter.get("/auth/google", (c) => AuthController.redirect(c));
publicRouter.get("/auth/google/callback", (c) => AuthController.callback(c));
publicRouter.post("/auth/refresh", (c) => AuthController.refresh(c));
