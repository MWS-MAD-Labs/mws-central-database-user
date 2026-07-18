import { Hono } from "hono";
import { createSimpleMasterDataController } from "../../controller/admin/simple-master-data-controller";
import { UnitService } from "../../service/master-data-service";
import type { AdminVariables } from "../../type/hono-context";

export const unitRouter = new Hono<{ Variables: AdminVariables }>();
const controller = createSimpleMasterDataController(UnitService);

unitRouter.post("/", (c) => controller.create(c));
unitRouter.get("/", (c) => controller.search(c));
unitRouter.patch("/:id", (c) => controller.update(c));
unitRouter.get("/:id", (c) => controller.get(c));
unitRouter.delete("/:id", (c) => controller.remove(c));
