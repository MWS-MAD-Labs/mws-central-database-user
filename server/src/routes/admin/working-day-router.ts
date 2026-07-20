import { Hono } from "hono";
import { WorkingDayController } from "../../controller/admin/working-day-controller";
import type { AdminVariables } from "../../type/hono-context";

export const workingDayRouter = new Hono<{ Variables: AdminVariables }>();

workingDayRouter.post("/", (c) => WorkingDayController.create(c));
workingDayRouter.get("/", (c) => WorkingDayController.list(c));
workingDayRouter.delete("/:id", (c) => WorkingDayController.remove(c));
