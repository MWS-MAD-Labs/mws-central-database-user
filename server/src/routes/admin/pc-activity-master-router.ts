import { Hono } from "hono";
import { PCActivityMasterController } from "../../controller/admin/pc-activity-master-controller";
import type { AdminVariables } from "../../type/hono-context";

export const pcActivityMasterRouter = new Hono<{ Variables: AdminVariables }>();

pcActivityMasterRouter.post("/", (c) => PCActivityMasterController.create(c));
pcActivityMasterRouter.get("/", (c) => PCActivityMasterController.search(c));

pcActivityMasterRouter.patch("/:id", (c) => PCActivityMasterController.update(c));
pcActivityMasterRouter.get("/:id", (c) => PCActivityMasterController.get(c));
pcActivityMasterRouter.delete("/:id", (c) => PCActivityMasterController.remove(c));
