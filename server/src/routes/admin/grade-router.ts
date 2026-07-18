import { Hono } from "hono";
import { GradeController } from "../../controller/admin/grade-controller";
import type { AdminVariables } from "../../type/hono-context";

export const gradeRouter = new Hono<{ Variables: AdminVariables }>();

gradeRouter.post("/", (c) => GradeController.create(c));
gradeRouter.get("/", (c) => GradeController.search(c));
gradeRouter.patch("/:id", (c) => GradeController.update(c));
gradeRouter.get("/:id", (c) => GradeController.get(c));
gradeRouter.delete("/:id", (c) => GradeController.remove(c));
