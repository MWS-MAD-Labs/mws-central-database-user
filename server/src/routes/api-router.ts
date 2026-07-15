import { Hono } from "hono";
import { authRouter } from "./auth/auth-router";
import { adminRouter } from "./admin/index";
import { internalRouter } from "./internal/index";

// This is Master Route

export const apiRouter = new Hono();

apiRouter.route("/auth", authRouter);

apiRouter.route("/admin", adminRouter);

apiRouter.route("/internal", internalRouter);
