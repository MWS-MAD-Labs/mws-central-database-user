import { Hono } from "hono";
import { createSimpleMasterDataController } from "../../controller/admin/simple-master-data-controller";
import { SubjectService } from "../../service/master-data-service";
import type { AdminVariables } from "../../type/hono-context";

export const subjectRouter = new Hono<{ Variables: AdminVariables }>();
const controller = createSimpleMasterDataController(SubjectService);

subjectRouter.post("/", (c) => controller.create(c));
subjectRouter.get("/", (c) => controller.search(c));
subjectRouter.patch("/:id", (c) => controller.update(c));
subjectRouter.get("/:id", (c) => controller.get(c));
subjectRouter.delete("/:id", (c) => controller.remove(c));
