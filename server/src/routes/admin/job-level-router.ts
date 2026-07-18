import { Hono } from "hono";
import { JobLevelController } from "../../controller/admin/job-level-controller";
import type { AdminVariables } from "../../type/hono-context";

export const jobLevelRouter = new Hono<{ Variables: AdminVariables }>();

jobLevelRouter.post("/", (c) => JobLevelController.create(c));
jobLevelRouter.get("/", (c) => JobLevelController.search(c));
jobLevelRouter.patch("/:id", (c) => JobLevelController.update(c));
jobLevelRouter.get("/:id", (c) => JobLevelController.get(c));
jobLevelRouter.delete("/:id", (c) => JobLevelController.remove(c));
