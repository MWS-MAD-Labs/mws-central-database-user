import { Hono } from "hono";
import { authRouter } from "./auth/auth-router";
import { adminRouter } from "./admin/index";
import { internalRouter } from "./internal/index";
import { dashboardRouter } from "./dashboard-router";
import { productionUrl } from "../utils/public-config";


export const apiRouter = new Hono();

// No sign in needed: the login page shows the test version note too.
apiRouter.get("/public-config", (c) => c.json({ data: { production_url: productionUrl() } }));

apiRouter.route("/auth", authRouter);

apiRouter.route("/dashboard", dashboardRouter);

apiRouter.route("/admin", adminRouter);

apiRouter.route("/internal", internalRouter);
