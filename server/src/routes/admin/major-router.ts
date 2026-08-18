import { Hono } from "hono";
import { createSimpleMasterDataController } from "../../controller/admin/simple-master-data-controller";
import { MajorService } from "../../service/master-data-service";
import type { AdminVariables } from "../../type/hono-context";

export const majorRouter = new Hono<{ Variables: AdminVariables }>();
const controller = createSimpleMasterDataController(MajorService);

majorRouter.post("/", (c) => controller.create(c));
majorRouter.get("/", (c) => controller.search(c));
majorRouter.patch("/:id", (c) => controller.update(c));
majorRouter.get("/:id", (c) => controller.get(c));
majorRouter.delete("/:id", (c) => controller.remove(c));
