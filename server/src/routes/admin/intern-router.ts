import { Hono } from "hono";
import { InternController } from "../../controller/admin/intern-controller";
import type { AdminVariables } from "../../type/hono-context";
import { InternMutationHistoryController } from "../../controller/admin/intern-mutation-history-controller";

export const internRouter = new Hono<{ Variables: AdminVariables }>();

internRouter.post("/", (c) => InternController.create(c));
internRouter.get("/", InternController.search);
internRouter.get("/count-total", (c) => InternController.countTotal(c));
internRouter.get("/version", (c) => InternController.getVersion(c));
internRouter.patch("/bulk/delete", (c) => InternController.bulkRemove(c));
internRouter.patch("/bulk/restore", (c) => InternController.bulkRestore(c));
internRouter.get("/:id/mutation-history", (c) =>
  InternMutationHistoryController.getHistory(c),
);
internRouter.patch("/:id/mutation-history/:historyId/rollback", (c) =>
  InternMutationHistoryController.rollback(c),
);
internRouter.get("/:id/teaching-assignments", (c) =>
  InternController.getTeachingAssignments(c),
);
internRouter.get("/:id/support-assignments", (c) =>
  InternController.getSupportAssignments(c),
);
internRouter.get("/:id/pc-activity-mentorships", (c) =>
  InternController.getPcActivityMentorships(c),
);
internRouter.post("/:id/sensitive-fields/access", (c) =>
  InternController.revealPii(c),
);
internRouter.patch("/:id", (c) => InternController.update(c));
internRouter.get("/:id", (c) => InternController.get(c));
internRouter.patch("/delete/:id", (c) => InternController.remove(c));
internRouter.patch("/restore/:id", (c) => InternController.restore(c));
