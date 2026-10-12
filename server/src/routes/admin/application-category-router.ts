import { Hono } from "hono";
import { createSimpleMasterDataController } from "../../controller/admin/simple-master-data-controller";
import { ApplicationCategoryService } from "../../service/master-data-service";
import type { AdminVariables } from "../../type/hono-context";

export const applicationCategoryRouter = new Hono<{ Variables: AdminVariables }>();
const controller = createSimpleMasterDataController(ApplicationCategoryService);

applicationCategoryRouter.post("/", (c) => controller.create(c));
applicationCategoryRouter.get("/", (c) => controller.search(c));
applicationCategoryRouter.patch("/:id", (c) => controller.update(c));
applicationCategoryRouter.get("/:id", (c) => controller.get(c));
applicationCategoryRouter.delete("/:id", (c) => controller.remove(c));
