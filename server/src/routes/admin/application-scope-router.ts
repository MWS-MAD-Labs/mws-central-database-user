import { Hono } from "hono";
import { createSimpleMasterDataController } from "../../controller/admin/simple-master-data-controller";
import { ApplicationScopeService } from "../../service/master-data-service";
import type { AdminVariables } from "../../type/hono-context";

export const applicationScopeRouter = new Hono<{ Variables: AdminVariables }>();
const controller = createSimpleMasterDataController(ApplicationScopeService);

applicationScopeRouter.post("/", (c) => controller.create(c));
applicationScopeRouter.get("/", (c) => controller.search(c));
applicationScopeRouter.patch("/:id", (c) => controller.update(c));
applicationScopeRouter.get("/:id", (c) => controller.get(c));
applicationScopeRouter.delete("/:id", (c) => controller.remove(c));
