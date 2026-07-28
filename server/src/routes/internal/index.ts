import { Hono } from "hono";
import { apiClientAuthMiddleware } from "../../middleware/api-client-auth-middleware";
import { internalLimiterMiddleware } from "../../middleware/rate-limiter";
import { employeeApiRouter } from "./employee-api-router";
import { studentApiRouter } from "./student-api-router";
import type { ApiClientVariables } from "../../type/hono-context";

export const internalRouter = new Hono<{ Variables: ApiClientVariables }>();

internalRouter.use("*", internalLimiterMiddleware);
internalRouter.use("*", apiClientAuthMiddleware);

internalRouter.route("/employees", employeeApiRouter);
internalRouter.route("/students", studentApiRouter);
