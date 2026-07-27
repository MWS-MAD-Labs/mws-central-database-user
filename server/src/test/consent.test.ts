import { describe, afterEach, beforeEach, it, expect, spyOn } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  StudentTest,
  ConsentTest,
  MasterDataTest,
  AuditLogTest,
} from "./test-utils";
import {
  AuditAction,
  ConsentStatus,
  ConsentType,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";
import { AuditService } from "../service/audit-service";

describe("Consent Record", () => {
  let studentId: string;

  async function cleanup() {
    await AuditLogTest.delete();
    await ConsentTest.delete();
    await StudentTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }

  beforeEach(async () => {
    await cleanup();
    await MasterDataTest.create();

    const student = await StudentTest.create({
      email: "test_consent@millennia21.id",
      nis: "9200001",
    });
    studentId = student.student!.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("POST /api/admin/students/:id/consents", () => {
    it("should create a consent record as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/consents`,
        {
          consent_type: "MEDIA_CONSENT",
          status: "SIGNED",
          signed_by: "Jane Doe",
          notes: "Signed at enrollment",
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.consent_type).toBe("MEDIA_CONSENT");
      expect(body.data.status).toBe("SIGNED");
      expect(body.data.signed_by).toBe("Jane Doe");
      expect(body.data.attachments).toEqual([]);

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.CREATE_CONSENT, admin_id: admin.id },
      });
      expect(auditLog.entity_type).toBe("ConsentRecord");
    });

    it("should roll back consent creation entirely if the audit log write fails", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const auditSpy = spyOn(AuditService, "record").mockRejectedValue(
        new Error("Simulated audit failure"),
      );

      try {
        const response = await TestRequest.post(
          `/api/admin/students/${studentId}/consents`,
          { consent_type: "MEDIA_CONSENT", status: "SIGNED" },
          accessToken,
        );

        expect(response.status).toBe(500);

        const consent = await prismaClient.consentRecord.findFirst({
          where: { student_id: studentId, consent_type: ConsentType.MEDIA_CONSENT },
        });
        expect(consent).toBeNull();
      } finally {
        auditSpy.mockRestore();
      }
    });

    it("should default status to PENDING when omitted", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/consents`,
        { consent_type: "PARENT_CONSENT" },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.status).toBe("PENDING");
    });

    it("should create a consent record as DATABASE_ADMIN with can_write_data", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/consents`,
        { consent_type: "MEDIA_CONSENT" },
        accessToken,
      );

      expect(response.status).toBe(200);
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/consents`,
        { consent_type: "MEDIA_CONSENT" },
        accessToken,
      );

      expect(response.status).toBe(403);

      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.UNAUTHORIZED_ACCESS },
      });
      expect(auditLog.new_values).toMatchObject({
        reason: "blocked consent create",
        student_id: studentId,
      });
    });

    it("should reject (404) for a nonexistent student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/nonexistent-id/consents`,
        { consent_type: "MEDIA_CONSENT" },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (404) for a soft-deleted student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      await TestRequest.patch(
        `/api/admin/students/delete/${studentId}`,
        {},
        accessToken,
      );

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/consents`,
        { consent_type: "MEDIA_CONSENT" },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (400) a duplicate consent_type for the same student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      await TestRequest.post(
        `/api/admin/students/${studentId}/consents`,
        { consent_type: "MEDIA_CONSENT" },
        accessToken,
      );
      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/consents`,
        { consent_type: "MEDIA_CONSENT" },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should allow recreating a consent_type after the previous record was soft-deleted", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const created = await ConsentTest.create({
        studentId,
        consentType: ConsentType.MEDIA_CONSENT,
        deletedAt: new Date(),
      });

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/consents`,
        { consent_type: "MEDIA_CONSENT" },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.id).not.toBe(created.id);
      expect(body.data.consent_type).toBe("MEDIA_CONSENT");
    });
  });

  describe("GET /api/admin/students/:id/consents", () => {
    it("should list consent records for a student, excluding soft-deleted by default", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      await ConsentTest.create({
        studentId,
        consentType: ConsentType.MEDIA_CONSENT,
        status: ConsentStatus.SIGNED,
      });
      await ConsentTest.create({
        studentId,
        consentType: ConsentType.PARENT_CONSENT,
        status: ConsentStatus.DECLINED,
        deletedAt: new Date(),
      });

      const activeResponse = await TestRequest.get(
        `/api/admin/students/${studentId}/consents`,
        accessToken,
      );
      const activeBody = await activeResponse.json();
      logger.debug(activeBody);

      expect(activeResponse.status).toBe(200);
      expect(activeBody.data.length).toBe(1);
      expect(activeBody.data[0].consent_type).toBe("MEDIA_CONSENT");

      const deletedResponse = await TestRequest.get(
        `/api/admin/students/${studentId}/consents?is_deleted=true`,
        accessToken,
      );
      const deletedBody = await deletedResponse.json();

      expect(deletedBody.data.length).toBe(1);
      expect(deletedBody.data[0].consent_type).toBe("PARENT_CONSENT");
      expect(deletedBody.data[0].deleted_at).not.toBeNull();
    });

    it("should reject (404) for a nonexistent student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.get(
        `/api/admin/students/nonexistent-id/consents`,
        accessToken,
      );

      expect(response.status).toBe(404);
    });
  });

  describe("PATCH /api/admin/students/:id/consents/:consentId", () => {
    it("should update a consent record's status", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const consent = await ConsentTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/consents/${consent.id}`,
        { status: "SIGNED", signed_by: "John Doe" },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.status).toBe("SIGNED");
      expect(body.data.signed_by).toBe("John Doe");
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();
      const consent = await ConsentTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/consents/${consent.id}`,
        { status: "SIGNED" },
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (404) for a nonexistent consent record", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/consents/nonexistent-id`,
        { status: "SIGNED" },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (400) updating a soft-deleted consent record", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const consent = await ConsentTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/consents/${consent.id}`,
        { status: "SIGNED" },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (404) updating a consent record when the student is soft-deleted", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const consent = await ConsentTest.create({ studentId });

      await TestRequest.patch(
        `/api/admin/students/delete/${studentId}`,
        {},
        accessToken,
      );

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/consents/${consent.id}`,
        { status: "SIGNED" },
        accessToken,
      );

      expect(response.status).toBe(404);
    });
  });

  describe("PATCH /api/admin/students/:id/consents/delete/:consentId", () => {
    it("should soft-delete a consent record as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const consent = await ConsentTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/consents/delete/${consent.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(200);

      const deleted = await prismaClient.consentRecord.findUniqueOrThrow({
        where: { id: consent.id },
      });
      expect(deleted.deleted_at).not.toBeNull();
    });

    it("should reject (403) for DATABASE_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const consent = await ConsentTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/consents/delete/${consent.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (400) deleting an already-deleted consent record", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const consent = await ConsentTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/consents/delete/${consent.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/students/:id/consents/restore/:consentId", () => {
    it("should restore a soft-deleted consent record as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const consent = await ConsentTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/consents/restore/${consent.id}`,
        {},
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.id).toBe(consent.id);

      const restored = await prismaClient.consentRecord.findUniqueOrThrow({
        where: { id: consent.id },
      });
      expect(restored.deleted_at).toBeNull();
    });

    it("should reject (403) for DATABASE_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const consent = await ConsentTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/consents/restore/${consent.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (400) restoring a consent record that isn't deleted", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const consent = await ConsentTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/consents/restore/${consent.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });
});
