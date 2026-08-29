import { Hono } from "hono";
import { InternController } from "../../controller/admin/intern-controller";
import type { AdminVariables } from "../../type/hono-context";

export const internRouter = new Hono<{ Variables: AdminVariables }>();

internRouter.post("/", (c) => InternController.create(c));
internRouter.get("/", InternController.search);
internRouter.get("/count-total", (c) => InternController.countTotal(c));
internRouter.patch("/:id", (c) => InternController.update(c));
internRouter.get("/:id", (c) => InternController.get(c));
internRouter.patch("/delete/:id", (c) => InternController.remove(c));
internRouter.patch("/restore/:id", (c) => InternController.restore(c));
