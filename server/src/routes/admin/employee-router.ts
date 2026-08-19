import { Hono } from "hono";
import { EmployeeController } from "../../controller/admin/employee-controller";
import { ExportController } from "../../controller/admin/export-controller";
import { ImportController } from "../../controller/admin/import-controller";
import { EmployeePhotoController } from "../../controller/admin/employee-photo-controller";
import { EmployeeMutationHistoryController } from "../../controller/admin/employee-mutation-history-controller";
import { DisciplinaryActionController } from "../../controller/admin/disciplinary-action-controller";
import { DisciplinaryActionAttachmentController } from "../../controller/admin/disciplinary-action-attachment-controller";
import {
  attachmentUploadBodyLimit,
  bulkPhotoUploadBodyLimit,
  photoUploadBodyLimit,
} from "../../middleware/upload-body-limit";
import type { AdminVariables } from "../../type/hono-context";

export const employeeRouter = new Hono<{ Variables: AdminVariables }>();

employeeRouter.post("/", (c) => EmployeeController.create(c));
employeeRouter.get("/", EmployeeController.search);
// Must come before /:id - otherwise Hono matches "export"/"import" as the :id param.
employeeRouter.get("/export", (c) => ExportController.exportEmployees(c));
employeeRouter.get("/count-total", (c) => EmployeeController.countTotal(c));
employeeRouter.get("/education-suggestions", (c) =>
  EmployeeController.getEducationSuggestions(c),
);
employeeRouter.post("/import/preview", (c) =>
  ImportController.previewEmployees(c),
);
employeeRouter.post("/import/:jobId/commit", (c) =>
  ImportController.commitEmployees(c),
);
employeeRouter.post("/import/:jobId/rollback", (c) =>
  ImportController.rollbackEmployees(c),
);
// Must come before /import/:jobId - otherwise Hono matches "fields" as jobId.
employeeRouter.get("/import/fields", (c) =>
  ImportController.getEmployeeFields(c),
);
employeeRouter.get("/import/:jobId", (c) => ImportController.getEmployeeJob(c));
employeeRouter.patch("/bulk/delete", (c) => EmployeeController.bulkRemove(c));
employeeRouter.patch("/bulk/restore", (c) => EmployeeController.bulkRestore(c));
employeeRouter.patch("/bulk/update", (c) => EmployeeController.bulkUpdate(c));
employeeRouter.patch("/bulk/extend-contract", (c) =>
  EmployeeController.bulkExtendContract(c),
);
// Must come before /:id - otherwise Hono matches "photos" as the :id param.
employeeRouter.post("/photos/bulk-preview", bulkPhotoUploadBodyLimit, (c) =>
  EmployeePhotoController.bulkPreview(c),
);
employeeRouter.post("/photos/bulk-commit", bulkPhotoUploadBodyLimit, (c) =>
  EmployeePhotoController.bulkCommit(c),
);
employeeRouter.patch("/:id", (c) => EmployeeController.update(c));
employeeRouter.get("/:id", (c) => EmployeeController.get(c));
employeeRouter.patch("/delete/:id", (c) => EmployeeController.remove(c));
employeeRouter.patch("/restore/:id", (c) => EmployeeController.restore(c));
employeeRouter.post("/:id/photo", photoUploadBodyLimit, (c) =>
  EmployeePhotoController.upload(c),
);
employeeRouter.delete("/:id/photo", (c) => EmployeePhotoController.remove(c));
employeeRouter.get("/:id/mutation-history", (c) =>
  EmployeeMutationHistoryController.getHistory(c),
);
employeeRouter.patch("/:id/mutation-history/:historyId/rollback", (c) =>
  EmployeeMutationHistoryController.rollback(c),
);
employeeRouter.get("/:id/teaching-assignments", (c) =>
  EmployeeController.getTeachingAssignments(c),
);
employeeRouter.get("/:id/support-assignments", (c) =>
  EmployeeController.getSupportAssignments(c),
);
employeeRouter.patch("/:id/extend-contract", (c) =>
  EmployeeController.extendContract(c),
);
employeeRouter.get("/:id/disciplinary-actions", (c) =>
  DisciplinaryActionController.list(c),
);
employeeRouter.post("/:id/disciplinary-actions", (c) =>
  DisciplinaryActionController.create(c),
);
employeeRouter.patch("/:id/disciplinary-actions/:actionId", (c) =>
  DisciplinaryActionController.update(c),
);
employeeRouter.patch("/:id/disciplinary-actions/:actionId/resolve", (c) =>
  DisciplinaryActionController.resolve(c),
);
employeeRouter.patch("/:id/disciplinary-actions/:actionId/revoke", (c) =>
  DisciplinaryActionController.revoke(c),
);

employeeRouter.post(
  "/:id/disciplinary-actions/:actionId/attachments",
  attachmentUploadBodyLimit,
  (c) => DisciplinaryActionAttachmentController.upload(c),
);
employeeRouter.get(
  "/:id/disciplinary-actions/:actionId/attachments",
  (c) => DisciplinaryActionAttachmentController.getList(c),
);
employeeRouter.get(
  "/:id/disciplinary-actions/:actionId/attachments/:attachmentId/download",
  (c) => DisciplinaryActionAttachmentController.download(c),
);
employeeRouter.patch(
  "/:id/disciplinary-actions/:actionId/attachments/delete/:attachmentId",
  (c) => DisciplinaryActionAttachmentController.remove(c),
);
employeeRouter.patch(
  "/:id/disciplinary-actions/:actionId/attachments/restore/:attachmentId",
  (c) => DisciplinaryActionAttachmentController.restore(c),
);
