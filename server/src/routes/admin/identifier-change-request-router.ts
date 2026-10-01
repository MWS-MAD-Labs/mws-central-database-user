import { Hono } from "hono";
import { IdentifierChangeRequestController } from "../../controller/admin/identifier-change-request-controller";
import type { AdminVariables } from "../../type/hono-context";

export const identifierChangeRequestRouter = new Hono<{ Variables: AdminVariables }>();

identifierChangeRequestRouter.get("/", (c) => IdentifierChangeRequestController.list(c));
identifierChangeRequestRouter.post("/", (c) => IdentifierChangeRequestController.create(c));
identifierChangeRequestRouter.get("/approver-status", (c) =>
  IdentifierChangeRequestController.approverStatus(c),
);
identifierChangeRequestRouter.get("/mine", (c) => IdentifierChangeRequestController.listMine(c));
identifierChangeRequestRouter.post("/mine/seen", (c) =>
  IdentifierChangeRequestController.markMineSeen(c),
);
identifierChangeRequestRouter.get("/:id", (c) => IdentifierChangeRequestController.get(c));
identifierChangeRequestRouter.patch("/:id/approve", (c) =>
  IdentifierChangeRequestController.approve(c),
);
identifierChangeRequestRouter.patch("/:id/reject", (c) =>
  IdentifierChangeRequestController.reject(c),
);
identifierChangeRequestRouter.patch("/:id/cancel", (c) =>
  IdentifierChangeRequestController.cancel(c),
);
