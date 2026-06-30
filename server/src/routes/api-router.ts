import { Hono } from "hono";
import { authRouter } from "./auth/auth-router";
import { adminRouter } from "./admin/index";

// This is Master Route

export const apiRouter = new Hono();

apiRouter.route("/auth", authRouter);

apiRouter.route("/admin", adminRouter);
