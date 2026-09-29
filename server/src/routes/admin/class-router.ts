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
// The "bulk" routes below MUST be registered before their same-shaped
// ":assignmentId" siblings. Hono's router resolves same-shape collisions
// (.../X/end where X is either the literal "bulk" or a :param) by
// registration order, not by static-always-wins - registering
// ":assignmentId/end" first previously swallowed "bulk/end" requests with
// assignmentId="bulk", 404ing as "Teacher assignment not found".
classRouter.patch("/:id/teachers/bulk/move", (c) =>
  ClassController.bulkMoveTeacherAssignments(c),
);
classRouter.patch("/:id/teachers/bulk/end", (c) =>
  ClassController.bulkEndTeacherAssignments(c),
);
classRouter.delete("/:id/teachers/bulk", (c) =>
  ClassController.bulkRemoveTeacherAssignments(c),
);
classRouter.patch("/:id/teachers/bulk/reopen", (c) =>
  ClassController.bulkReopenTeacherAssignments(c),
);
classRouter.patch("/:id/teachers/:assignmentId/end", (c) =>
  ClassController.endTeacherAssignment(c),
);
classRouter.delete("/:id/teachers/:assignmentId", (c) =>
  ClassController.removeTeacherAssignment(c),
);
classRouter.patch("/:id/teachers/:assignmentId/reopen", (c) =>
  ClassController.reopenTeacherAssignment(c),
);

classRouter.delete("/:id", (c) => ClassController.remove(c));
