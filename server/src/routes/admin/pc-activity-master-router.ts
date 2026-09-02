import { Hono } from "hono";
import { PCActivityMasterController as controller } from "../../controller/admin/pc-activity-controller";
import type { AdminVariables } from "../../type/hono-context";

export const pcActivityMasterRouter = new Hono<{ Variables: AdminVariables }>();

pcActivityMasterRouter.post("/", (c) => controller.create(c));
pcActivityMasterRouter.get("/", (c) => controller.search(c));
pcActivityMasterRouter.patch("/:id", (c) => controller.update(c));
pcActivityMasterRouter.get("/:id", (c) => controller.get(c));
pcActivityMasterRouter.delete("/:id", (c) => controller.remove(c));
