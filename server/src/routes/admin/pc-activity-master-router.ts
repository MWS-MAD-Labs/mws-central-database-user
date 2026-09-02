import { Hono } from "hono";
import { createSimpleMasterDataController } from "../../controller/admin/simple-master-data-controller";
import { PCActivityDefaultMentorController } from "../../controller/admin/pc-activity-controller";
import { PCActivityMasterService } from "../../service/master-data-service";
import type { AdminVariables } from "../../type/hono-context";

export const pcActivityMasterRouter = new Hono<{ Variables: AdminVariables }>();
const controller = createSimpleMasterDataController(PCActivityMasterService);

pcActivityMasterRouter.post("/", (c) => controller.create(c));
pcActivityMasterRouter.get("/", (c) => controller.search(c));
pcActivityMasterRouter.patch("/:id", (c) => controller.update(c));
pcActivityMasterRouter.get("/:id", (c) => controller.get(c));
pcActivityMasterRouter.delete("/:id", (c) => controller.remove(c));

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
