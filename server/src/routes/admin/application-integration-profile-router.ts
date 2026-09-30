import { Hono } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import { ApplicationIntegrationProfileController } from "../../controller/admin/application-integration-profile-controller";

export const applicationIntegrationProfileRouter = new Hono<{
  Variables: AdminVariables;
}>();

applicationIntegrationProfileRouter.get("/", (c) =>
  ApplicationIntegrationProfileController.list(c),
);
// Registered before "/:id" so it is not read as a profile id.
applicationIntegrationProfileRouter.get("/scopes", (c) =>
  ApplicationIntegrationProfileController.listScopes(c),
);
applicationIntegrationProfileRouter.post("/", (c) =>
  ApplicationIntegrationProfileController.create(c),
);
applicationIntegrationProfileRouter.patch("/:id", (c) =>
  ApplicationIntegrationProfileController.update(c),
);
