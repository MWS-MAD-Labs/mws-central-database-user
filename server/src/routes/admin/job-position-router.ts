import { Hono } from "hono";
import { createSimpleMasterDataController } from "../../controller/admin/simple-master-data-controller";
import { JobPositionService } from "../../service/master-data-service";
import type { AdminVariables } from "../../type/hono-context";

export const jobPositionRouter = new Hono<{ Variables: AdminVariables }>();
const controller = createSimpleMasterDataController(JobPositionService);

jobPositionRouter.post("/", (c) => controller.create(c));
jobPositionRouter.get("/", (c) => controller.search(c));
jobPositionRouter.patch("/:id", (c) => controller.update(c));
jobPositionRouter.get("/:id", (c) => controller.get(c));
jobPositionRouter.delete("/:id", (c) => controller.remove(c));
