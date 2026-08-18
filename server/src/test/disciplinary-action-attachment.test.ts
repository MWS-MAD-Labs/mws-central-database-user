import { describe, afterEach, beforeEach, it, expect, spyOn } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  AuditLogTest,
  MasterDataTest,
  EmployeeTest,
  DisciplinaryActionAttachmentTest,
} from "./test-utils";
import {
  AuditAction,
  DisciplinaryActionType,
  EmploymentType,
  Gender,
  Religion,
  type MasterUnit,
  type MasterJobPosition,
  type MasterJobLevel,
  type MasterBuilding,
  EmployeeStatus,
  MaritalStatus,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";
import { AuditService } from "../service/audit-service";
import { DisciplinaryActionService } from "../service/disciplinary-action-service";

describe("Disciplinary action attachments", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
  };
  let employeeId: string;
  let actionId: string;
  // Fixed-id per AdminUserTest.createSuperAdmin() - created once here and
  // reused by every test in this file that needs SUPER_ADMIN, since calling
  // createSuperAdmin() a second time collides on the unique id/email.
  let superAdminToken: string;
  let superAdminId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await DisciplinaryActionAttachmentTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();

    const { accessToken } = await AdminUserTest.createSuperAdmin();
    superAdminToken = accessToken;
    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    superAdminId = admin.id;

    const createResponse = await TestRequest.post(
      "/api/admin/employees",
      {
        full_name: "Test Employee Attachment",
        nick_name: "Emp Attach",
        email: "test_disciplinary_attachment@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("1995-01-01").toISOString(),
        employee_id: "99.99.970",
        marital_status: MaritalStatus.SINGLE,
        status: EmployeeStatus.ACTIVE,
        employment_type: EmploymentType.PERMANENT,
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        job_level_id: masterData.level.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-01-01").toISOString(),
      },
      superAdminToken,
    );
    const createBody = await createResponse.json();
    employeeId = createBody.data.id;

    const action = await DisciplinaryActionService.create(admin, {
      employee_id: employeeId,
      type: DisciplinaryActionType.SURAT_TEGURAN,
      reason: "Late attendance",
    });
    actionId = action.id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await DisciplinaryActionAttachmentTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  describe("POST /api/admin/employees/:id/disciplinary-actions/:actionId/attachments", () => {
    it("should upload an attachment and audit it atomically, with a preview_url", async () => {
      const formData = new FormData();
      formData.append(
        "file",
        new File(["%PDF-1.4 test"], "letter.pdf", { type: "application/pdf" }),
      );

      const response = await TestRequest.postMultipart(
        `/api/admin/employees/${employeeId}/disciplinary-actions/${actionId}/attachments`,
        formData,
        superAdminToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.file_name).toBe("letter.pdf");
      expect(typeof body.data.preview_url).toBe("string");
      expect(body.data.preview_url.length).toBeGreaterThan(0);

      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.UPLOAD_ATTACHMENT, admin_id: superAdminId },
      });
      expect(auditLog.entity_type).toBe("DisciplinaryActionAttachment");

      await DisciplinaryActionAttachmentTest.removeFromMinio(body.data.id);
    });

    it("should roll back the DB row and the uploaded MinIO object if the audit log write fails", async () => {
      const objectsBefore = await DisciplinaryActionAttachmentTest.listMinioObjects(actionId);
      expect(objectsBefore.length).toBe(0);

      const auditSpy = spyOn(AuditService, "record").mockRejectedValue(
        new Error("Simulated audit failure"),
      );

      try {
        const formData = new FormData();
        formData.append(
          "file",
          new File(["%PDF-1.4 rollback"], "rollback.pdf", {
            type: "application/pdf",
          }),
        );

        const response = await TestRequest.postMultipart(
          `/api/admin/employees/${employeeId}/disciplinary-actions/${actionId}/attachments`,
          formData,
          superAdminToken,
        );

        expect(response.status).toBe(500);

        const attachment = await prismaClient.disciplinaryActionAttachment.findFirst({
          where: { disciplinary_action_id: actionId, file_name: "rollback.pdf" },
        });
        expect(attachment).toBeNull();

        const objectsAfter = await DisciplinaryActionAttachmentTest.listMinioObjects(actionId);
        expect(objectsAfter.length).toBe(0);
      } finally {
        auditSpy.mockRestore();
      }
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();
      const formData = new FormData();
      formData.append(
        "file",
        new File(["%PDF-1.4"], "letter.pdf", { type: "application/pdf" }),
      );

      const response = await TestRequest.postMultipart(
        `/api/admin/employees/${employeeId}/disciplinary-actions/${actionId}/attachments`,
        formData,
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should allow a DATABASE_ADMIN with can_write_data in-unit", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin(
        masterData.unit.id,
      );
      const formData = new FormData();
      formData.append(
        "file",
        new File(["%PDF-1.4"], "letter.pdf", { type: "application/pdf" }),
      );

      const response = await TestRequest.postMultipart(
        `/api/admin/employees/${employeeId}/disciplinary-actions/${actionId}/attachments`,
        formData,
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      await DisciplinaryActionAttachmentTest.removeFromMinio(body.data.id);
    });

    it("should reject (400) an unsupported file type", async () => {
      const formData = new FormData();
      formData.append(
        "file",
        new File(["console.log(1)"], "script.js", {
          type: "application/javascript",
        }),
      );

      const response = await TestRequest.postMultipart(
        `/api/admin/employees/${employeeId}/disciplinary-actions/${actionId}/attachments`,
        formData,
        superAdminToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (404) for a nonexistent disciplinary action", async () => {
      const formData = new FormData();
      formData.append(
        "file",
        new File(["%PDF-1.4"], "letter.pdf", { type: "application/pdf" }),
      );

      const response = await TestRequest.postMultipart(
        `/api/admin/employees/${employeeId}/disciplinary-actions/nonexistent-id/attachments`,
        formData,
        superAdminToken,
      );

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/admin/employees/:id/disciplinary-actions/:actionId/attachments", () => {
    it("should list attachments with preview_url, excluding soft-deleted by default", async () => {
      await DisciplinaryActionAttachmentTest.create({
        disciplinaryActionId: actionId,
        fileName: "active.pdf",
        uploadedBy: superAdminId,
      });
      await DisciplinaryActionAttachmentTest.create({
        disciplinaryActionId: actionId,
        fileName: "deleted.pdf",
        uploadedBy: superAdminId,
        deletedAt: new Date(),
      });

      const activeResponse = await TestRequest.get(
        `/api/admin/employees/${employeeId}/disciplinary-actions/${actionId}/attachments`,
        superAdminToken,
      );
      const activeBody = await activeResponse.json();
      logger.debug(activeBody);

      expect(activeResponse.status).toBe(200);
      expect(activeBody.data.length).toBe(1);
      expect(activeBody.data[0].file_name).toBe("active.pdf");
      expect(typeof activeBody.data[0].preview_url).toBe("string");

      const deletedResponse = await TestRequest.get(
        `/api/admin/employees/${employeeId}/disciplinary-actions/${actionId}/attachments?is_deleted=true`,
        superAdminToken,
      );
      const deletedBody = await deletedResponse.json();

      expect(deletedBody.data.length).toBe(1);
      expect(deletedBody.data[0].file_name).toBe("deleted.pdf");
    });

    it("should reject (404) for a DATABASE_ADMIN outside the employee's unit", async () => {
      // TEST_ prefix - afterEach's MasterDataTest.delete() cleans this up
      // (after AdminUserTest.delete() clears the admin referencing it).
      const otherUnit = await prismaClient.masterUnit.create({
        data: { name: "TEST_UNIT_OUTSIDE_ATTACHMENT" },
      });
      const { accessToken } = await AdminUserTest.createDatabaseAdmin(
        otherUnit.id,
      );

      const response = await TestRequest.get(
        `/api/admin/employees/${employeeId}/disciplinary-actions/${actionId}/attachments`,
        accessToken,
      );

      expect(response.status).toBe(404);
    });
  });

  describe("PATCH .../attachments/delete/:attachmentId", () => {
    it("should soft-delete an attachment", async () => {
      const attachment = await DisciplinaryActionAttachmentTest.create({
        disciplinaryActionId: actionId,
        uploadedBy: superAdminId,
      });

      const response = await TestRequest.patch(
        `/api/admin/employees/${employeeId}/disciplinary-actions/${actionId}/attachments/delete/${attachment.id}`,
        {},
        superAdminToken,
      );

      expect(response.status).toBe(200);

      const deleted = await prismaClient.disciplinaryActionAttachment.findUniqueOrThrow({
        where: { id: attachment.id },
      });
      expect(deleted.deleted_at).not.toBeNull();

      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.DELETE_ATTACHMENT, admin_id: superAdminId },
      });
      expect(auditLog.entity_type).toBe("DisciplinaryActionAttachment");
    });

    it("should reject (400) deleting an already-deleted attachment", async () => {
      const attachment = await DisciplinaryActionAttachmentTest.create({
        disciplinaryActionId: actionId,
        uploadedBy: superAdminId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/employees/${employeeId}/disciplinary-actions/${actionId}/attachments/delete/${attachment.id}`,
        {},
        superAdminToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("PATCH .../attachments/restore/:attachmentId", () => {
    it("should restore a soft-deleted attachment", async () => {
      const attachment = await DisciplinaryActionAttachmentTest.create({
        disciplinaryActionId: actionId,
        uploadedBy: superAdminId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/employees/${employeeId}/disciplinary-actions/${actionId}/attachments/restore/${attachment.id}`,
        {},
        superAdminToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.id).toBe(attachment.id);

      const restored = await prismaClient.disciplinaryActionAttachment.findUniqueOrThrow(
        { where: { id: attachment.id } },
      );
      expect(restored.deleted_at).toBeNull();
    });
  });

  describe("GET .../attachments/:attachmentId/download", () => {
    it("should reject (404) for a soft-deleted attachment", async () => {
      const attachment = await DisciplinaryActionAttachmentTest.create({
        disciplinaryActionId: actionId,
        uploadedBy: superAdminId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.get(
        `/api/admin/employees/${employeeId}/disciplinary-actions/${actionId}/attachments/${attachment.id}/download`,
        superAdminToken,
      );

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/admin/employees/:id/disciplinary-actions - attachment_count", () => {
    it("should reflect the current non-deleted attachment count", async () => {
      await DisciplinaryActionAttachmentTest.create({
        disciplinaryActionId: actionId,
        uploadedBy: superAdminId,
      });
      await DisciplinaryActionAttachmentTest.create({
        disciplinaryActionId: actionId,
        uploadedBy: superAdminId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.get(
        `/api/admin/employees/${employeeId}/disciplinary-actions`,
        superAdminToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      const listedAction = body.data.find((entry: { id: string }) => entry.id === actionId);
      expect(listedAction.attachment_count).toBe(1);
    });
  });
});
