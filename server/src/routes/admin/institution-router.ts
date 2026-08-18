import { Hono } from "hono";
import { createSimpleMasterDataController } from "../../controller/admin/simple-master-data-controller";
import { InstitutionService } from "../../service/master-data-service";
import type { AdminVariables } from "../../type/hono-context";

export const institutionRouter = new Hono<{ Variables: AdminVariables }>();
const controller = createSimpleMasterDataController(InstitutionService);

institutionRouter.post("/", (c) => controller.create(c));
institutionRouter.get("/", (c) => controller.search(c));
institutionRouter.patch("/:id", (c) => controller.update(c));
institutionRouter.get("/:id", (c) => controller.get(c));
institutionRouter.delete("/:id", (c) => controller.remove(c));
