import { Hono } from "hono";
import { apiClientAuthMiddleware } from "../../middleware/api-client-auth-middleware";
import { employeeApiRouter } from "./employee-api-router";
import type { ApiClientVariables } from "../../type/hono-context";

export const internalRouter = new Hono<{ Variables: ApiClientVariables }>();

internalRouter.use("*", apiClientAuthMiddleware);

internalRouter.route("/employees", employeeApiRouter);
