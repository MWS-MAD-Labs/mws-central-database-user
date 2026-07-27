import { describe, afterEach, beforeEach, it, expect, spyOn } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  StudentTest,
  VaccineRecordTest,
  MasterDataTest,
  AuditLogTest,
} from "./test-utils";
import { AuditAction, VaccineType } from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";
import { AuditService } from "../service/audit-service";

describe("Vaccine Record", () => {
  let studentId: string;

  async function cleanup() {
    await AuditLogTest.delete();
    await VaccineRecordTest.delete();
    await StudentTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }

  beforeEach(async () => {
    await cleanup();
    await MasterDataTest.create();

    const student = await StudentTest.create({
      email: "test_vaccine_record@millennia21.id",
      nis: "9300003",
    });
    studentId = student.student!.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("POST /api/admin/students/:id/vaccine-records", () => {
    it("should create a vaccine record as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/vaccine-records`,
        { vaccine_type: "POLIO", received: true },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.vaccine_type).toBe("POLIO");
      expect(body.data.received).toBe(true);

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: {
          action: AuditAction.CREATE_VACCINE_RECORD,
          admin_id: admin.id,
        },
      });
      expect(auditLog.entity_type).toBe("VaccineRecord");
    });

    it("should roll back vaccine record creation entirely if the audit log write fails", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const auditSpy = spyOn(AuditService, "record").mockRejectedValue(
        new Error("Simulated audit failure"),
      );

      try {
        const response = await TestRequest.post(
          `/api/admin/students/${studentId}/vaccine-records`,
          { vaccine_type: "POLIO", received: true },
          accessToken,
        );

        expect(response.status).toBe(500);

        const record = await prismaClient.vaccineRecord.findFirst({
          where: { student_id: studentId, vaccine_type: VaccineType.POLIO },
        });
        expect(record).toBeNull();
      } finally {
        auditSpy.mockRestore();
      }
    });

    it("should default received to false when omitted", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/vaccine-records`,
        { vaccine_type: "DPT" },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.received).toBe(false);
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/vaccine-records`,
        { vaccine_type: "POLIO" },
        accessToken,
      );

      expect(response.status).toBe(403);

      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.UNAUTHORIZED_ACCESS },
      });
      expect(auditLog.new_values).toMatchObject({
        reason: "blocked vaccine record create",
        student_id: studentId,
      });
    });

    it("should reject (404) for a nonexistent student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/nonexistent-id/vaccine-records`,
        { vaccine_type: "POLIO" },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (400) a duplicate vaccine_type for the same student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      await TestRequest.post(
        `/api/admin/students/${studentId}/vaccine-records`,
        { vaccine_type: "POLIO" },
        accessToken,
      );
      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/vaccine-records`,
        { vaccine_type: "POLIO" },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should allow recreating a vaccine_type after the previous record was soft-deleted", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const created = await VaccineRecordTest.create({
        studentId,
        vaccineType: VaccineType.POLIO,
        deletedAt: new Date(),
      });

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/vaccine-records`,
        { vaccine_type: "POLIO" },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.id).not.toBe(created.id);
    });
  });

  describe("GET /api/admin/students/:id/vaccine-records", () => {
    it("should list vaccine records, excluding soft-deleted by default, and write one ACCESS_HEALTH_DATA audit log", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      await VaccineRecordTest.create({
        studentId,
        vaccineType: VaccineType.POLIO,
        received: true,
      });
      await VaccineRecordTest.create({
        studentId,
        vaccineType: VaccineType.DPT,
        deletedAt: new Date(),
      });

      const activeResponse = await TestRequest.get(
        `/api/admin/students/${studentId}/vaccine-records`,
        accessToken,
      );
      const activeBody = await activeResponse.json();
      logger.debug(activeBody);

      expect(activeResponse.status).toBe(200);
      expect(activeBody.data.length).toBe(1);
      expect(activeBody.data[0].vaccine_type).toBe("POLIO");

      const deletedResponse = await TestRequest.get(
        `/api/admin/students/${studentId}/vaccine-records?is_deleted=true`,
        accessToken,
      );
      const deletedBody = await deletedResponse.json();

      expect(deletedBody.data.length).toBe(1);
      expect(deletedBody.data[0].vaccine_type).toBe("DPT");

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLogs = await prismaClient.auditLog.findMany({
        where: { action: AuditAction.ACCESS_HEALTH_DATA, admin_id: admin.id },
      });
      expect(auditLogs.length).toBe(2);
    });

    it("should reject (404) for a nonexistent student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.get(
        `/api/admin/students/nonexistent-id/vaccine-records`,
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (403) a VIEWER without can_view_sensitive_data", async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.get(
        `/api/admin/students/${studentId}/vaccine-records`,
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should allow a VIEWER granted can_view_sensitive_data to read", async () => {
      const { accessToken } = await AdminUserTest.createViewer(undefined, {
        canViewSensitiveData: true,
      });

      const response = await TestRequest.get(
        `/api/admin/students/${studentId}/vaccine-records`,
        accessToken,
      );

      expect(response.status).toBe(200);
    });
  });

  describe("PATCH /api/admin/students/:id/vaccine-records/:vaccineId", () => {
    it("should update a vaccine record's received status", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const record = await VaccineRecordTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/vaccine-records/${record.id}`,
        { received: true, date: new Date().toISOString() },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.received).toBe(true);
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();
      const record = await VaccineRecordTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/vaccine-records/${record.id}`,
        { received: true },
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (404) for a nonexistent vaccine record", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/vaccine-records/nonexistent-id`,
        { received: true },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (400) updating a soft-deleted vaccine record", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const record = await VaccineRecordTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/vaccine-records/${record.id}`,
        { received: true },
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/students/:id/vaccine-records/delete/:vaccineId", () => {
    it("should soft-delete a vaccine record as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const record = await VaccineRecordTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/vaccine-records/delete/${record.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(200);

      const deleted = await prismaClient.vaccineRecord.findUniqueOrThrow({
        where: { id: record.id },
      });
      expect(deleted.deleted_at).not.toBeNull();
    });

    it("should reject (403) for DATABASE_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const record = await VaccineRecordTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/vaccine-records/delete/${record.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (400) deleting an already-deleted vaccine record", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const record = await VaccineRecordTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/vaccine-records/delete/${record.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/students/:id/vaccine-records/restore/:vaccineId", () => {
    it("should restore a soft-deleted vaccine record as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const record = await VaccineRecordTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/vaccine-records/restore/${record.id}`,
        {},
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.id).toBe(record.id);

      const restored = await prismaClient.vaccineRecord.findUniqueOrThrow({
        where: { id: record.id },
      });
      expect(restored.deleted_at).toBeNull();
    });

    it("should reject (403) for DATABASE_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const record = await VaccineRecordTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/vaccine-records/restore/${record.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (400) restoring a vaccine record that isn't deleted", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const record = await VaccineRecordTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/vaccine-records/restore/${record.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });
});
