import { Hono } from "hono";
import { ApplicationEntitlementController } from "../../controller/admin/application-entitlement-controller";
import type { AdminVariables } from "../../type/hono-context";

export const applicationEntitlementRouter = new Hono<{
  Variables: AdminVariables;
}>();

applicationEntitlementRouter.post("/", (c) =>
  ApplicationEntitlementController.grant(c),
);
applicationEntitlementRouter.post("/bulk", (c) =>
  ApplicationEntitlementController.bulkGrant(c),
);
applicationEntitlementRouter.get("/", (c) =>
  ApplicationEntitlementController.list(c),
);
applicationEntitlementRouter.patch("/revoke/:id", (c) =>
  ApplicationEntitlementController.revoke(c),
);
applicationEntitlementRouter.patch("/unblock/:id", (c) =>
  ApplicationEntitlementController.unblock(c),
);
applicationEntitlementRouter.delete("/:id", (c) =>
  ApplicationEntitlementController.remove(c),
);
applicationEntitlementRouter.patch("/:id", (c) =>
  ApplicationEntitlementController.update(c),
);
