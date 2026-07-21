import { Hono } from "hono";
import { StudentController } from "../../controller/admin/student-controller";
import { EnrollmentController } from "../../controller/admin/enrollment-controller";
import { ParentGuardianController } from "../../controller/admin/parent-guardian-controller";
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
studentRouter.patch("/:id/enrollments/delete/:enrollmentId", (c) =>
  EnrollmentController.remove(c),
);
studentRouter.patch("/:id/enrollments/restore/:enrollmentId", (c) =>
  EnrollmentController.restore(c),
);

studentRouter.post("/:id/parents", (c) => ParentGuardianController.create(c));
studentRouter.get("/:id/parents", (c) => ParentGuardianController.getList(c));
studentRouter.patch("/:id/parents/:parentId", (c) =>
  ParentGuardianController.update(c),
);
studentRouter.patch("/:id/parents/delete/:parentId", (c) =>
  ParentGuardianController.remove(c),
);
studentRouter.patch("/:id/parents/restore/:parentId", (c) =>
  ParentGuardianController.restore(c),
);
