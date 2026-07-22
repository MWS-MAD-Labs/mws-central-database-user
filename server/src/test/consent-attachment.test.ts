import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  StudentTest,
  ConsentTest,
  ConsentAttachmentTest,
  MasterDataTest,
  AuditLogTest,
} from "./test-utils";
import { AuditAction } from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

// No live MinIO in this environment yet, so these cover everything up to that boundary.
describe("Consent Attachment", () => {
  let studentId: string;
  let consentId: string;

  async function cleanup() {
    await AuditLogTest.delete();
    await ConsentAttachmentTest.delete();
    await ConsentTest.delete();
    await StudentTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }

  beforeEach(async () => {
    await cleanup();
    await MasterDataTest.create();

    const student = await StudentTest.create({
      email: "test_consent_attachment@millennia21.id",
      nis: "9400001",
    });
    studentId = student.student!.id;

    const consent = await ConsentTest.create({ studentId });
    consentId = consent.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("POST /api/admin/students/:id/consents/:consentId/attachments", () => {
    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();
      const formData = new FormData();
      formData.append(
        "file",
        new File(["%PDF-1.4"], "letter.pdf", { type: "application/pdf" }),
      );

      const response = await TestRequest.postMultipart(
        `/api/admin/students/${studentId}/consents/${consentId}/attachments`,
        formData,
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (403) a DATABASE_ADMIN without can_view_sensitive_data", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const formData = new FormData();
      formData.append(
        "file",
        new File(["%PDF-1.4"], "letter.pdf", { type: "application/pdf" }),
      );

      const response = await TestRequest.postMultipart(
        `/api/admin/students/${studentId}/consents/${consentId}/attachments`,
        formData,
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (400) when no file field is present", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const formData = new FormData();

      const response = await TestRequest.postMultipart(
        `/api/admin/students/${studentId}/consents/${consentId}/attachments`,
        formData,
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) an unsupported file type", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const formData = new FormData();
      formData.append(
        "file",
        new File(["console.log(1)"], "script.js", {
          type: "application/javascript",
        }),
      );

      const response = await TestRequest.postMultipart(
        `/api/admin/students/${studentId}/consents/${consentId}/attachments`,
        formData,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
    });

    it("should reject (400) a file whose content doesn't match its claimed Content-Type", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const formData = new FormData();
      formData.append(
        "file",
        new File(["#!/bin/sh\nrm -rf /"], "disguised.pdf", {
          type: "application/pdf",
        }),
      );

      const response = await TestRequest.postMultipart(
        `/api/admin/students/${studentId}/consents/${consentId}/attachments`,
        formData,
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) a file over the 5MB limit", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
      const formData = new FormData();
      formData.append(
        "file",
        new File([oversized], "big.pdf", { type: "application/pdf" }),
      );

      const response = await TestRequest.postMultipart(
        `/api/admin/students/${studentId}/consents/${consentId}/attachments`,
        formData,
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (404) for a nonexistent consent record", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const formData = new FormData();
      formData.append(
        "file",
        new File(["%PDF-1.4"], "letter.pdf", { type: "application/pdf" }),
      );

      const response = await TestRequest.postMultipart(
        `/api/admin/students/${studentId}/consents/nonexistent-id/attachments`,
        formData,
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (400) uploading to a soft-deleted consent record", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const deletedConsent = await ConsentTest.create({
        studentId,
        deletedAt: new Date(),
      });
      const formData = new FormData();
      formData.append(
        "file",
        new File(["%PDF-1.4"], "letter.pdf", { type: "application/pdf" }),
      );

      const response = await TestRequest.postMultipart(
        `/api/admin/students/${studentId}/consents/${deletedConsent.id}/attachments`,
        formData,
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/admin/students/:id/consents/:consentId/attachments", () => {
    it("should list attachments, excluding soft-deleted by default", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });

      await ConsentAttachmentTest.create({
        consentId,
        fileName: "active.pdf",
        uploadedBy: admin.id,
      });
      await ConsentAttachmentTest.create({
        consentId,
        fileName: "deleted.pdf",
        uploadedBy: admin.id,
        deletedAt: new Date(),
      });

      const activeResponse = await TestRequest.get(
        `/api/admin/students/${studentId}/consents/${consentId}/attachments`,
        accessToken,
      );
      const activeBody = await activeResponse.json();
      logger.debug(activeBody);

      expect(activeResponse.status).toBe(200);
      expect(activeBody.data.length).toBe(1);
      expect(activeBody.data[0].file_name).toBe("active.pdf");

      const deletedResponse = await TestRequest.get(
        `/api/admin/students/${studentId}/consents/${consentId}/attachments?is_deleted=true`,
        accessToken,
      );
      const deletedBody = await deletedResponse.json();

      expect(deletedBody.data.length).toBe(1);
      expect(deletedBody.data[0].file_name).toBe("deleted.pdf");
    });

    it("should reject (403) a VIEWER without can_view_sensitive_data", async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.get(
        `/api/admin/students/${studentId}/consents/${consentId}/attachments`,
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should allow a VIEWER granted can_view_sensitive_data to read", async () => {
      const { accessToken } = await AdminUserTest.createViewer(undefined, {
        canViewSensitiveData: true,
      });

      const response = await TestRequest.get(
        `/api/admin/students/${studentId}/consents/${consentId}/attachments`,
        accessToken,
      );

      expect(response.status).toBe(200);
    });

    it("should reject (404) for a nonexistent consent record", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.get(
        `/api/admin/students/${studentId}/consents/nonexistent-id/attachments`,
        accessToken,
      );

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/admin/students/:id/consents/:consentId/attachments/:attachmentId/download", () => {
    it("should reject (403) a VIEWER without can_view_sensitive_data", async () => {
      const { accessToken } = await AdminUserTest.createViewer();
      const attachment = await ConsentAttachmentTest.create({
        consentId,
        uploadedBy: "test-super-admin-id",
      });

      const response = await TestRequest.get(
        `/api/admin/students/${studentId}/consents/${consentId}/attachments/${attachment.id}/download`,
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (404) for a soft-deleted attachment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const attachment = await ConsentAttachmentTest.create({
        consentId,
        uploadedBy: "test-super-admin-id",
        deletedAt: new Date(),
      });

      const response = await TestRequest.get(
        `/api/admin/students/${studentId}/consents/${consentId}/attachments/${attachment.id}/download`,
        accessToken,
      );

      expect(response.status).toBe(404);
    });
  });

  describe("PATCH /api/admin/students/:id/consents/:consentId/attachments/delete/:attachmentId", () => {
    it("should soft-delete an attachment as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const attachment = await ConsentAttachmentTest.create({
        consentId,
        uploadedBy: admin.id,
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/consents/${consentId}/attachments/delete/${attachment.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(200);

      const deleted = await prismaClient.consentAttachment.findUniqueOrThrow({
        where: { id: attachment.id },
      });
      expect(deleted.deleted_at).not.toBeNull();

      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.DELETE_ATTACHMENT, admin_id: admin.id },
      });
      expect(auditLog.entity_type).toBe("ConsentAttachment");
    });

    it("should reject (403) for DATABASE_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin(
        undefined,
        { canViewSensitiveData: true },
      );
      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_dbadmin@millennia21.id" },
      });
      const attachment = await ConsentAttachmentTest.create({
        consentId,
        uploadedBy: admin.id,
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/consents/${consentId}/attachments/delete/${attachment.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (400) deleting an already-deleted attachment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const attachment = await ConsentAttachmentTest.create({
        consentId,
        uploadedBy: admin.id,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/consents/${consentId}/attachments/delete/${attachment.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/students/:id/consents/:consentId/attachments/restore/:attachmentId", () => {
    it("should restore a soft-deleted attachment as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const attachment = await ConsentAttachmentTest.create({
        consentId,
        uploadedBy: admin.id,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/consents/${consentId}/attachments/restore/${attachment.id}`,
        {},
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.id).toBe(attachment.id);

      const restored = await prismaClient.consentAttachment.findUniqueOrThrow(
        { where: { id: attachment.id } },
      );
      expect(restored.deleted_at).toBeNull();
    });

    it("should reject (403) for DATABASE_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin(
        undefined,
        { canViewSensitiveData: true },
      );
      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_dbadmin@millennia21.id" },
      });
      const attachment = await ConsentAttachmentTest.create({
        consentId,
        uploadedBy: admin.id,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/consents/${consentId}/attachments/restore/${attachment.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (400) restoring an attachment that isn't deleted", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const attachment = await ConsentAttachmentTest.create({
        consentId,
        uploadedBy: admin.id,
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/consents/${consentId}/attachments/restore/${attachment.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });
});
