import { Hono } from "hono";
import { PCActivityMasterController } from "../../controller/admin/pc-activity-master-controller";
import { PCActivityDefaultMentorController } from "../../controller/admin/pc-activity-controller";
import { PCActivityMentorMutationHistoryController } from "../../controller/admin/pc-activity-mentor-mutation-history-controller";
import type { AdminVariables } from "../../type/hono-context";

export const pcActivityMasterRouter = new Hono<{ Variables: AdminVariables }>();

pcActivityMasterRouter.post("/", (c) => PCActivityMasterController.create(c));
pcActivityMasterRouter.get("/", (c) => PCActivityMasterController.search(c));

// Registered before /:id - a static path always has to win over that
// param route, or ?activity_ids=... would be swallowed as "get activity
// with id 'default-mentors'".
pcActivityMasterRouter.get("/default-mentors", (c) =>
  PCActivityDefaultMentorController.listBatch(c),
);

pcActivityMasterRouter.patch("/:id", (c) => PCActivityMasterController.update(c));
// Must come before /:id - otherwise Hono matches "reassignment-preview" as
// the :id param on the bare GET /:id route below.
pcActivityMasterRouter.get("/:id/reassignment-preview", (c) =>
  PCActivityMasterController.previewReassignmentImpact(c),
);
pcActivityMasterRouter.get("/:id", (c) => PCActivityMasterController.get(c));
pcActivityMasterRouter.delete("/:id", (c) => PCActivityMasterController.remove(c));

// Manage Mentors - per-unit default mentor for one activity.
pcActivityMasterRouter.get("/:activityId/default-mentors", (c) =>
  PCActivityDefaultMentorController.list(c),
);
pcActivityMasterRouter.patch("/:activityId/default-mentors/:unitId", (c) =>
  PCActivityDefaultMentorController.set(c),
);
pcActivityMasterRouter.delete("/:activityId/default-mentors/:unitId", (c) =>
  PCActivityDefaultMentorController.clear(c),
);

// Mentor assignment history, per activity (spans all its units) - Roll
// back undoes the most recent set()/clear() for one unit.
pcActivityMasterRouter.get("/:activityId/mentor-history", (c) =>
  PCActivityMentorMutationHistoryController.getHistory(c),
);
pcActivityMasterRouter.patch(
  "/:activityId/mentor-history/:historyId/rollback",
  (c) => PCActivityMentorMutationHistoryController.rollback(c),
);
