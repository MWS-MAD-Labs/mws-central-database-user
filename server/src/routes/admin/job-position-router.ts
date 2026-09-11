import { Hono } from "hono";
import { JobPositionController } from "../../controller/admin/job-position-controller";
import type { AdminVariables } from "../../type/hono-context";

export const jobPositionRouter = new Hono<{ Variables: AdminVariables }>();

jobPositionRouter.post("/", (c) => JobPositionController.create(c));
jobPositionRouter.get("/", (c) => JobPositionController.search(c));
jobPositionRouter.patch("/:id", (c) => JobPositionController.update(c));
// Must come before /:id - otherwise Hono matches "reassignment-preview" as
// the :id param on the bare GET /:id route below.
jobPositionRouter.get("/:id/reassignment-preview", (c) =>
  JobPositionController.previewReassignmentImpact(c),
);
jobPositionRouter.get("/:id", (c) => JobPositionController.get(c));
jobPositionRouter.delete("/:id", (c) => JobPositionController.remove(c));
