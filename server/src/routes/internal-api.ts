import { Hono } from "hono";
import { apiAuthMiddleware } from "../middleware/api-auth-middleware";
import type { ApiClientVariables } from "../type/hono-context";

export const internalRouter = new Hono<{ Variables: ApiClientVariables }>();

internalRouter.use("/api/v1/*", apiAuthMiddleware);
