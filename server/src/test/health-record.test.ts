import { describe, afterEach, beforeEach, it, expect, spyOn } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  StudentTest,
  HealthRecordTest,
  MasterDataTest,
  AuditLogTest,
} from "./test-utils";
import { AuditAction } from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";
import { AuditService } from "../service/audit-service";

describe("Health Record", () => {
  let studentId: string;

  async function cleanup() {
    await AuditLogTest.delete();
    await HealthRecordTest.delete();
    await StudentTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }

  beforeEach(async () => {
    await cleanup();
    await MasterDataTest.create();

    const student = await StudentTest.create({
      email: "test_health_record@millennia21.id",
      nis: "9300001",
    });
    studentId = student.student!.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("POST /api/admin/students/:id/health-record", () => {
    it("should create a health record as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/health-record`,
        { blood_type: "O+", needs_assistance: true },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.blood_type).toBe("O+");
      expect(body.data.needs_assistance).toBe(true);

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.CREATE_HEALTH_RECORD, admin_id: admin.id },
      });
      expect(auditLog.entity_type).toBe("HealthRecord");
    });

    it("should roll back health record creation entirely if the audit log write fails", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const auditSpy = spyOn(AuditService, "record").mockRejectedValue(
        new Error("Simulated audit failure"),
      );

      try {
        const response = await TestRequest.post(
          `/api/admin/students/${studentId}/health-record`,
          { blood_type: "O+", needs_assistance: true },
          accessToken,
        );

        expect(response.status).toBe(500);

        const record = await prismaClient.healthRecord.findFirst({
          where: { student_id: studentId },
        });
        expect(record).toBeNull();
      } finally {
        auditSpy.mockRestore();
      }
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/health-record`,
        { blood_type: "O+" },
        accessToken,
      );

      expect(response.status).toBe(403);

      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.UNAUTHORIZED_ACCESS },
      });
      expect(auditLog.new_values).toMatchObject({
        reason: "blocked health record create",
        student_id: studentId,
      });
    });

    it("should reject (404) for a nonexistent student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/nonexistent-id/health-record`,
        { blood_type: "O+" },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (400) creating a second health record for the same student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      await TestRequest.post(
        `/api/admin/students/${studentId}/health-record`,
        { blood_type: "O+" },
        accessToken,
      );
      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/health-record`,
        { blood_type: "A+" },
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/admin/students/:id/health-record", () => {
    it("should return the health record and write an ACCESS_HEALTH_DATA audit log", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await HealthRecordTest.create({ studentId, bloodType: "B+" });

      const response = await TestRequest.get(
        `/api/admin/students/${studentId}/health-record`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.blood_type).toBe("B+");

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.ACCESS_HEALTH_DATA, admin_id: admin.id },
      });
      expect(auditLog.entity_type).toBe("Student");
      expect(auditLog.entity_id).toBe(studentId);
    });

    it("should reject (404) when no health record exists yet", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.get(
        `/api/admin/students/${studentId}/health-record`,
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should not write an audit log when the record isn't found", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      await TestRequest.get(
        `/api/admin/students/${studentId}/health-record`,
        accessToken,
      );

      const auditLog = await prismaClient.auditLog.findFirst({
        where: { action: AuditAction.ACCESS_HEALTH_DATA },
      });
      expect(auditLog).toBeNull();
    });

    it("should reject (403) a VIEWER without can_view_sensitive_data", async () => {
      const { accessToken } = await AdminUserTest.createViewer();
      await HealthRecordTest.create({ studentId, bloodType: "AB+" });

      const response = await TestRequest.get(
        `/api/admin/students/${studentId}/health-record`,
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should allow a VIEWER granted can_view_sensitive_data to read (but never write)", async () => {
      const { accessToken } = await AdminUserTest.createViewer(undefined, {
        canViewSensitiveData: true,
      });
      await HealthRecordTest.create({ studentId, bloodType: "AB+" });

      const response = await TestRequest.get(
        `/api/admin/students/${studentId}/health-record`,
        accessToken,
      );
      expect(response.status).toBe(200);

      const writeResponse = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-record`,
        { blood_type: "A-" },
        accessToken,
      );
      expect(writeResponse.status).toBe(403);
    });

    it("should reject (403) a DATABASE_ADMIN with can_write_data but without can_view_sensitive_data", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();

      const getResponse = await TestRequest.get(
        `/api/admin/students/${studentId}/health-record`,
        accessToken,
      );
      expect(getResponse.status).toBe(403);

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/health-record`,
        { blood_type: "O+" },
        accessToken,
      );
      expect(createResponse.status).toBe(403);
    });

    it("should allow a DATABASE_ADMIN granted both can_write_data and can_view_sensitive_data to create and read", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin(
        undefined,
        { canViewSensitiveData: true },
      );

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/health-record`,
        { blood_type: "O+" },
        accessToken,
      );
      expect(createResponse.status).toBe(200);

      const getResponse = await TestRequest.get(
        `/api/admin/students/${studentId}/health-record`,
        accessToken,
      );
      expect(getResponse.status).toBe(200);
    });
  });

  describe("PATCH /api/admin/students/:id/health-record", () => {
    it("should update a health record's fields", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await HealthRecordTest.create({ studentId, bloodType: "O+" });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-record`,
        { blood_type: "A-", needs_assistance: true },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.blood_type).toBe("A-");
      expect(body.data.needs_assistance).toBe(true);
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();
      await HealthRecordTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-record`,
        { blood_type: "A-" },
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (404) for a nonexistent health record", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-record`,
        { blood_type: "A-" },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (400) updating a deleted health record", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await HealthRecordTest.create({ studentId, deletedAt: new Date() });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-record`,
        { blood_type: "A-" },
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/students/:id/health-record/delete", () => {
    it("should soft-delete a health record as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const record = await HealthRecordTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-record/delete`,
        {},
        accessToken,
      );

      expect(response.status).toBe(200);

      const deleted = await prismaClient.healthRecord.findUniqueOrThrow({
        where: { id: record.id },
      });
      expect(deleted.deleted_at).not.toBeNull();
    });

    it("should reject (403) for DATABASE_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      await HealthRecordTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-record/delete`,
        {},
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (400) deleting an already-deleted health record", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await HealthRecordTest.create({ studentId, deletedAt: new Date() });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-record/delete`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/students/:id/health-record/restore", () => {
    it("should restore a soft-deleted health record as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const record = await HealthRecordTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-record/restore`,
        {},
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.id).toBe(record.id);

      const restored = await prismaClient.healthRecord.findUniqueOrThrow({
        where: { id: record.id },
      });
      expect(restored.deleted_at).toBeNull();
    });

    it("should reject (403) for DATABASE_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      await HealthRecordTest.create({ studentId, deletedAt: new Date() });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-record/restore`,
        {},
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (400) restoring a health record that isn't deleted", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await HealthRecordTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-record/restore`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should allow creating a fresh health record after Super Admin restores instead of recreating", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await HealthRecordTest.create({ studentId, deletedAt: new Date() });

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/health-record`,
        { blood_type: "O+" },
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });
});
