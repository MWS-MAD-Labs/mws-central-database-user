import { Hono } from "hono";
import { API_SCOPES } from "../../constants/api-scopes";
import { ApplicationEntitlementApiController } from "../../controller/internal/application-entitlement-api-controller";
import { requireScope } from "../../middleware/api-client-auth-middleware";
import type { ApiClientVariables } from "../../type/hono-context";

export const applicationEntitlementApiRouter = new Hono<{
  Variables: ApiClientVariables;
}>();

applicationEntitlementApiRouter.get(
  "/lookup",
  requireScope(API_SCOPES.APPLICATION_ENTITLEMENTS_READ),
  (c) => ApplicationEntitlementApiController.lookup(c),
);
