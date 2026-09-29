import { Hono } from "hono";
import { PCActivityRoomController } from "../../controller/admin/pc-activity-room-controller";
import type { AdminVariables } from "../../type/hono-context";

export const pcActivityRoomRouter = new Hono<{ Variables: AdminVariables }>();

pcActivityRoomRouter.get("/", (c) => PCActivityRoomController.search(c));
pcActivityRoomRouter.post("/", (c) => PCActivityRoomController.create(c));

pcActivityRoomRouter.patch("/:id", (c) => PCActivityRoomController.update(c));
pcActivityRoomRouter.delete("/:id", (c) => PCActivityRoomController.remove(c));

pcActivityRoomRouter.get("/:id/mentors", (c) =>
  PCActivityRoomController.listMentors(c),
);
pcActivityRoomRouter.post("/:id/mentors", (c) =>
  PCActivityRoomController.assignMentor(c),
);
pcActivityRoomRouter.post("/:id/mentors/bulk", (c) =>
  PCActivityRoomController.bulkAssignMentors(c),
);
pcActivityRoomRouter.patch("/:id/mentors/:assignmentId/end", (c) =>
  PCActivityRoomController.endMentorAssignment(c),
);
pcActivityRoomRouter.delete("/:id/mentors/:assignmentId", (c) =>
  PCActivityRoomController.removeMentorAssignment(c),
);
pcActivityRoomRouter.patch("/:id/mentors/:assignmentId/reopen", (c) =>
  PCActivityRoomController.reopenMentorAssignment(c),
);
pcActivityRoomRouter.post("/:id/mentors/:assignmentId/move", (c) =>
  PCActivityRoomController.moveMentorAssignment(c),
);
pcActivityRoomRouter.post("/:id/mentors/bulk-end", (c) =>
  PCActivityRoomController.bulkEndMentorAssignments(c),
);
pcActivityRoomRouter.post("/:id/mentors/bulk-remove", (c) =>
  PCActivityRoomController.bulkRemoveMentorAssignments(c),
);
pcActivityRoomRouter.post("/:id/mentors/bulk-reopen", (c) =>
  PCActivityRoomController.bulkReopenMentorAssignments(c),
);
pcActivityRoomRouter.post("/:id/mentors/bulk-move", (c) =>
  PCActivityRoomController.bulkMoveMentorAssignments(c),
);

pcActivityRoomRouter.get("/:id/eligible-students", (c) =>
  PCActivityRoomController.listEligibleStudents(c),
);
pcActivityRoomRouter.get("/:id/students", (c) =>
  PCActivityRoomController.listStudents(c),
);
pcActivityRoomRouter.post("/:id/students/bulk", (c) =>
  PCActivityRoomController.bulkAssignStudents(c),
);
pcActivityRoomRouter.patch("/:id/students/:assignmentId/end", (c) =>
  PCActivityRoomController.endStudentAssignment(c),
);
pcActivityRoomRouter.delete("/:id/students/:assignmentId", (c) =>
  PCActivityRoomController.dropStudentAssignment(c),
);
pcActivityRoomRouter.patch("/:id/students/:assignmentId/reopen", (c) =>
  PCActivityRoomController.reopenStudentAssignment(c),
);
pcActivityRoomRouter.post("/:id/students/:assignmentId/move", (c) =>
  PCActivityRoomController.moveStudent(c),
);
pcActivityRoomRouter.post("/:id/students/bulk-end", (c) =>
  PCActivityRoomController.bulkEndStudentAssignments(c),
);
pcActivityRoomRouter.post("/:id/students/bulk-drop", (c) =>
  PCActivityRoomController.bulkDropStudentAssignments(c),
);
pcActivityRoomRouter.post("/:id/students/bulk-reopen", (c) =>
  PCActivityRoomController.bulkReopenStudentAssignments(c),
);
pcActivityRoomRouter.post("/:id/students/bulk-move", (c) =>
  PCActivityRoomController.bulkMoveStudentAssignments(c),
);
pcActivityRoomRouter.post("/:id/students/:studentId/reassign", (c) =>
  PCActivityRoomController.reassignStudent(c),
);

pcActivityRoomRouter.get("/:id", (c) => PCActivityRoomController.get(c));
