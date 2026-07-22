import { Hono } from "hono";
import { StudentController } from "../../controller/admin/student-controller";
import { EnrollmentController } from "../../controller/admin/enrollment-controller";
import { ParentGuardianController } from "../../controller/admin/parent-guardian-controller";
import { ConsentController } from "../../controller/admin/consent-controller";
import { HealthRecordController } from "../../controller/admin/health-record-controller";
import { HealthNoteController } from "../../controller/admin/health-note-controller";
import { VaccineRecordController } from "../../controller/admin/vaccine-record-controller";
import { ConsentAttachmentController } from "../../controller/admin/consent-attachment-controller";
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

studentRouter.post("/:id/consents", (c) => ConsentController.create(c));
studentRouter.get("/:id/consents", (c) => ConsentController.getList(c));
studentRouter.patch("/:id/consents/:consentId", (c) =>
  ConsentController.update(c),
);
studentRouter.patch("/:id/consents/delete/:consentId", (c) =>
  ConsentController.remove(c),
);
studentRouter.patch("/:id/consents/restore/:consentId", (c) =>
  ConsentController.restore(c),
);

studentRouter.post("/:id/consents/:consentId/attachments", (c) =>
  ConsentAttachmentController.upload(c),
);
studentRouter.get("/:id/consents/:consentId/attachments", (c) =>
  ConsentAttachmentController.getList(c),
);
studentRouter.get(
  "/:id/consents/:consentId/attachments/:attachmentId/download",
  (c) => ConsentAttachmentController.download(c),
);
studentRouter.patch(
  "/:id/consents/:consentId/attachments/delete/:attachmentId",
  (c) => ConsentAttachmentController.remove(c),
);
studentRouter.patch(
  "/:id/consents/:consentId/attachments/restore/:attachmentId",
  (c) => ConsentAttachmentController.restore(c),
);

studentRouter.post("/:id/health-record", (c) =>
  HealthRecordController.create(c),
);
studentRouter.get("/:id/health-record", (c) => HealthRecordController.get(c));
studentRouter.patch("/:id/health-record", (c) =>
  HealthRecordController.update(c),
);
studentRouter.patch("/:id/health-record/delete", (c) =>
  HealthRecordController.remove(c),
);
studentRouter.patch("/:id/health-record/restore", (c) =>
  HealthRecordController.restore(c),
);

studentRouter.post("/:id/health-notes", (c) => HealthNoteController.create(c));
studentRouter.get("/:id/health-notes", (c) => HealthNoteController.getList(c));
studentRouter.patch("/:id/health-notes/:noteId", (c) =>
  HealthNoteController.update(c),
);
studentRouter.patch("/:id/health-notes/delete/:noteId", (c) =>
  HealthNoteController.remove(c),
);
studentRouter.patch("/:id/health-notes/restore/:noteId", (c) =>
  HealthNoteController.restore(c),
);

studentRouter.post("/:id/vaccine-records", (c) =>
  VaccineRecordController.create(c),
);
studentRouter.get("/:id/vaccine-records", (c) =>
  VaccineRecordController.getList(c),
);
studentRouter.patch("/:id/vaccine-records/:vaccineId", (c) =>
  VaccineRecordController.update(c),
);
studentRouter.patch("/:id/vaccine-records/delete/:vaccineId", (c) =>
  VaccineRecordController.remove(c),
);
studentRouter.patch("/:id/vaccine-records/restore/:vaccineId", (c) =>
  VaccineRecordController.restore(c),
);
