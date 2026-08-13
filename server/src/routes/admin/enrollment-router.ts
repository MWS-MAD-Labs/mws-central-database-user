import { Hono } from "hono";
import { EnrollmentController } from "../../controller/admin/enrollment-controller";
import type { AdminVariables } from "../../type/hono-context";

export const enrollmentRouter = new Hono<{ Variables: AdminVariables }>();

enrollmentRouter.get("/", (c) => EnrollmentController.search(c));
enrollmentRouter.post("/bulk", (c) => EnrollmentController.bulkCreate(c));
enrollmentRouter.patch("/bulk/promote", (c) =>
  EnrollmentController.bulkPromote(c),
);
enrollmentRouter.patch("/bulk/transfer", (c) =>
  EnrollmentController.bulkTransfer(c),
);
enrollmentRouter.patch("/bulk/close", (c) =>
  EnrollmentController.bulkClose(c),
);
enrollmentRouter.patch("/bulk/delete", (c) =>
  EnrollmentController.bulkRemove(c),
);
