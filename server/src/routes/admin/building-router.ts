import { Hono } from "hono";
import { createSimpleMasterDataController } from "../../controller/admin/simple-master-data-controller";
import { BuildingService } from "../../service/master-data-service";
import type { AdminVariables } from "../../type/hono-context";

export const buildingRouter = new Hono<{ Variables: AdminVariables }>();
const controller = createSimpleMasterDataController(BuildingService);

buildingRouter.post("/", (c) => controller.create(c));
buildingRouter.get("/", (c) => controller.search(c));
buildingRouter.patch("/:id", (c) => controller.update(c));
buildingRouter.get("/:id", (c) => controller.get(c));
buildingRouter.delete("/:id", (c) => controller.remove(c));
