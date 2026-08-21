import { Hono } from "hono";
import { ClassController } from "../../controller/admin/class-controller";
import type { AdminVariables } from "../../type/hono-context";

export const classRouter = new Hono<{ Variables: AdminVariables }>();

classRouter.post("/", (c) => ClassController.create(c));
classRouter.get("/", (c) => ClassController.search(c));
classRouter.patch("/:id", (c) => ClassController.update(c));
classRouter.get("/:id", (c) => ClassController.get(c));
classRouter.get("/:id/teacher-assignments", (c) =>
  ClassController.getTeacherAssignments(c),
);
classRouter.post("/:id/teachers", (c) => ClassController.assignTeacher(c));
classRouter.patch("/:id/teachers/:assignmentId/end", (c) =>
  ClassController.endTeacherAssignment(c),
);
classRouter.patch("/:id/teachers/bulk/move", (c) =>
  ClassController.bulkMoveTeacherAssignments(c),
);
classRouter.delete("/:id/teachers/:assignmentId", (c) =>
  ClassController.removeTeacherAssignment(c),
);
classRouter.patch("/:id/teachers/:assignmentId/reopen", (c) =>
  ClassController.reopenTeacherAssignment(c),
);
classRouter.delete("/:id", (c) => ClassController.remove(c));
