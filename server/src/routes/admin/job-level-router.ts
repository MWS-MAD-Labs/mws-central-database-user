import { Hono } from "hono";
import { createSimpleMasterDataController } from "../../controller/admin/simple-master-data-controller";
import { JobLevelService } from "../../service/master-data-service";
import type { AdminVariables } from "../../type/hono-context";

export const jobLevelRouter = new Hono<{ Variables: AdminVariables }>();
const controller = createSimpleMasterDataController(JobLevelService);

jobLevelRouter.post("/", (c) => controller.create(c));
jobLevelRouter.get("/", (c) => controller.search(c));
jobLevelRouter.patch("/:id", (c) => controller.update(c));
jobLevelRouter.get("/:id", (c) => controller.get(c));
jobLevelRouter.delete("/:id", (c) => controller.remove(c));
