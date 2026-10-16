import { Hono } from "hono";
import { InternApiController } from "../../controller/internal/intern-api-controller";
import { requireScope } from "../../middleware/api-client-auth-middleware";
import type { ApiClientVariables } from "../../type/hono-context";
import { API_SCOPES } from "../../constants/api-scopes";

export const internApiRouter = new Hono<{ Variables: ApiClientVariables }>();

internApiRouter.get("/", requireScope(API_SCOPES.INTERNS_READ), (c) => InternApiController.list(c));
internApiRouter.get("/lookup", requireScope(API_SCOPES.INTERNS_READ), (c) => InternApiController.lookup(c));
