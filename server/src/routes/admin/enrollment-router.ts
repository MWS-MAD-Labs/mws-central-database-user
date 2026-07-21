import { Hono } from "hono";
import { EnrollmentController } from "../../controller/admin/enrollment-controller";
import type { AdminVariables } from "../../type/hono-context";

export const enrollmentRouter = new Hono<{ Variables: AdminVariables }>();

enrollmentRouter.get("/", (c) => EnrollmentController.search(c));
