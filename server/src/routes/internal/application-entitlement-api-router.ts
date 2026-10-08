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

applicationEntitlementApiRouter.get(
  "/",
  requireScope(API_SCOPES.APPLICATION_ENTITLEMENTS_READ),
  (c) => ApplicationEntitlementApiController.list(c),
);

applicationEntitlementApiRouter.get(
  "/version",
  requireScope(API_SCOPES.APPLICATION_ENTITLEMENTS_READ),
  (c) => ApplicationEntitlementApiController.version(c),
);

applicationEntitlementApiRouter.get(
  "/applications",
  requireScope(API_SCOPES.APPLICATION_ENTITLEMENTS_READ),
  (c) => ApplicationEntitlementApiController.applications(c),
);

export const applicationPermissionApiRouter = new Hono<{ Variables: ApiClientVariables }>();

applicationPermissionApiRouter.put(
  "/:applicationId",
  requireScope(API_SCOPES.APPLICATION_PERMISSIONS_WRITE),
  (c) => ApplicationEntitlementApiController.syncPermissions(c),
);
applicationPermissionApiRouter.get(
  "/:applicationId/usage",
  requireScope(API_SCOPES.APPLICATION_ENTITLEMENTS_READ),
  (c) => ApplicationEntitlementApiController.permissionUsage(c),
);
applicationPermissionApiRouter.get(
  "/:applicationId",
  requireScope(API_SCOPES.APPLICATION_ENTITLEMENTS_READ),
  (c) => ApplicationEntitlementApiController.registeredPermissions(c),
);
