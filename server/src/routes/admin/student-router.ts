import { Hono } from "hono";
import { StudentController } from "../../controller/admin/student-controller";
import { EnrollmentController } from "../../controller/admin/enrollment-controller";
import type { AdminVariables } from "../../type/hono-context";

export const studentRouter = new Hono<{ Variables: AdminVariables }>();

studentRouter.get("/", (c) => StudentController.search(c));
studentRouter.post("/", (c) => StudentController.create(c));
studentRouter.patch("/:id", (c) => StudentController.update(c));
studentRouter.get("/:id", (c) => StudentController.get(c));
studentRouter.patch("/delete/:id", (c) => StudentController.remove(c));
studentRouter.patch("/restore/:id", (c) => StudentController.restore(c));

studentRouter.post("/:id/enrollments", (c) => EnrollmentController.create(c));
studentRouter.get("/:id/enrollments", (c) =>
  EnrollmentController.getHistory(c),
);
studentRouter.patch("/:id/enrollments/:enrollmentId/promote", (c) =>
  EnrollmentController.promote(c),
);
studentRouter.patch("/:id/enrollments/:enrollmentId/transfer", (c) =>
  EnrollmentController.transfer(c),
);
studentRouter.patch("/:id/enrollments/:enrollmentId/close", (c) =>
  EnrollmentController.close(c),
);
