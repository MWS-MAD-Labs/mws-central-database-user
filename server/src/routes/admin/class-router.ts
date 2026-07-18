import { Hono } from "hono";
import { ClassController } from "../../controller/admin/class-controller";
import type { AdminVariables } from "../../type/hono-context";

export const classRouter = new Hono<{ Variables: AdminVariables }>();

classRouter.post("/", (c) => ClassController.create(c));
classRouter.get("/", (c) => ClassController.search(c));
classRouter.patch("/:id", (c) => ClassController.update(c));
classRouter.get("/:id", (c) => ClassController.get(c));
classRouter.delete("/:id", (c) => ClassController.remove(c));
