import { Hono } from "hono";
import { ClassApiController } from "../../controller/internal/class-api-controller";
import { requireScope } from "../../middleware/api-client-auth-middleware";
import type { ApiClientVariables } from "../../type/hono-context";
import { API_SCOPES } from "../../constants/api-scopes";

export const classApiRouter = new Hono<{
  Variables: ApiClientVariables;
}>();

classApiRouter.get(
  "/",
  requireScope(API_SCOPES.CLASSES_READ),
  (c) => ClassApiController.list(c),
);
