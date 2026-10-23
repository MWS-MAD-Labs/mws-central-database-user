import { Hono } from "hono";
import { EmailChangeController } from "../../controller/admin/email-change-controller";
import { InternController } from "../../controller/admin/intern-controller";
import { GoogleAccountController } from "../../controller/admin/google-account-controller";
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
internRouter.post("/:id/change-email", EmailChangeController.change("intern"));
internRouter.get("/:id", (c) => InternController.get(c));
internRouter.patch("/delete/:id", (c) => InternController.remove(c));
internRouter.patch("/restore/:id", (c) => InternController.restore(c));

// Google Workspace account of the person.
internRouter.get("/:id/google", GoogleAccountController.status("intern"));
internRouter.post("/:id/google/provision", GoogleAccountController.provision("intern"));
internRouter.post("/:id/google/reset-password", GoogleAccountController.resetPassword("intern"));
internRouter.post("/:id/google/reset-waiting", GoogleAccountController.resetWaiting("intern"));
internRouter.post("/:id/google/send-sign-in", GoogleAccountController.sendSignIn("intern"));
internRouter.get("/:id/google/recovery-hint", GoogleAccountController.recoveryHint("intern"));
internRouter.post("/:id/google/restore", GoogleAccountController.restore("intern"));
internRouter.post("/:id/google/suspend", GoogleAccountController.suspend("intern", true));
internRouter.post("/:id/google/unsuspend", GoogleAccountController.suspend("intern", false));
internRouter.get("/:id/google/recovery-email", GoogleAccountController.recoveryEmail("intern"));
internRouter.post("/:id/google/recovery-email", GoogleAccountController.changeRecoveryEmail("intern"));
