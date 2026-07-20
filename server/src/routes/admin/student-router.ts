import { Hono } from "hono";
import { StudentController } from "../../controller/admin/student-controller";
import type { AdminVariables } from "../../type/hono-context";

export const studentRouter = new Hono<{ Variables: AdminVariables }>();

studentRouter.post("/", (c) => StudentController.create(c));
studentRouter.get("/:id", (c) => StudentController.get(c));
