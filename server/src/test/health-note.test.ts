import { describe, afterEach, beforeEach, it, expect, spyOn } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  StudentTest,
  HealthNoteTest,
  MasterDataTest,
  AuditLogTest,
} from "./test-utils";
import { AuditAction, HealthNoteCategory } from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";
import { AuditService } from "../service/audit-service";

describe("Health Note", () => {
  let studentId: string;

  async function cleanup() {
    await AuditLogTest.delete();
    await HealthNoteTest.delete();
    await StudentTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }

  beforeEach(async () => {
    await cleanup();
    await MasterDataTest.create();

    const student = await StudentTest.create({
      email: "test_health_note@millennia21.id",
      nis: "9300002",
    });
    studentId = student.student!.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("POST /api/admin/students/:id/health-notes", () => {
    it("should create a health note as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/health-notes`,
        { category: "SPECIAL_NEEDS", description: "Needs extra time on tests" },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.category).toBe("SPECIAL_NEEDS");
      expect(body.data.status).toBe("ACTIVE");

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.CREATE_HEALTH_NOTE, admin_id: admin.id },
      });
      expect(auditLog.entity_type).toBe("HealthNote");
    });

    it("should roll back health note creation entirely if the audit log write fails", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const auditSpy = spyOn(AuditService, "record").mockRejectedValue(
        new Error("Simulated audit failure"),
      );

      try {
        const response = await TestRequest.post(
          `/api/admin/students/${studentId}/health-notes`,
          { category: "SPECIAL_NEEDS", description: "Rollback test note" },
          accessToken,
        );

        expect(response.status).toBe(500);

        const note = await prismaClient.healthNote.findFirst({
          where: { student_id: studentId, description: "Rollback test note" },
        });
        expect(note).toBeNull();
      } finally {
        auditSpy.mockRestore();
      }
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/health-notes`,
        { category: "HEALTH_INFO", description: "Allergic to peanuts" },
        accessToken,
      );

      expect(response.status).toBe(403);

      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.UNAUTHORIZED_ACCESS },
      });
      expect(auditLog.new_values).toMatchObject({
        reason: "blocked health note create",
        student_id: studentId,
      });
    });

    it("should reject (404) for a nonexistent student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/nonexistent-id/health-notes`,
        { category: "HEALTH_INFO", description: "Allergic to peanuts" },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should allow multiple notes of the same category for a student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      await TestRequest.post(
        `/api/admin/students/${studentId}/health-notes`,
        { category: "HEALTH_INFO", description: "First note" },
        accessToken,
      );
      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/health-notes`,
        { category: "HEALTH_INFO", description: "Second note" },
        accessToken,
      );

      expect(response.status).toBe(200);
    });
  });

  describe("GET /api/admin/students/:id/health-notes", () => {
    it("should list health notes and write one ACCESS_HEALTH_DATA audit log per call", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      await HealthNoteTest.create({
        studentId,
        category: HealthNoteCategory.HEALTH_INFO,
        description: "Active note",
      });
      await HealthNoteTest.create({
        studentId,
        category: HealthNoteCategory.SPECIAL_NEEDS,
        description: "Deleted note",
        deletedAt: new Date(),
      });

      const activeResponse = await TestRequest.get(
        `/api/admin/students/${studentId}/health-notes`,
        accessToken,
      );
      const activeBody = await activeResponse.json();
      logger.debug(activeBody);

      expect(activeResponse.status).toBe(200);
      expect(activeBody.data.length).toBe(1);
      expect(activeBody.data[0].description).toBe("Active note");

      const deletedResponse = await TestRequest.get(
        `/api/admin/students/${studentId}/health-notes?is_deleted=true`,
        accessToken,
      );
      const deletedBody = await deletedResponse.json();

      expect(deletedBody.data.length).toBe(1);
      expect(deletedBody.data[0].description).toBe("Deleted note");

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLogs = await prismaClient.auditLog.findMany({
        where: { action: AuditAction.ACCESS_HEALTH_DATA, admin_id: admin.id },
      });
      expect(auditLogs.length).toBe(2);
      expect(auditLogs[0]!.entity_type).toBe("Student");
      expect(auditLogs[0]!.entity_id).toBe(studentId);
    });

    it("should reject (404) for a nonexistent student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.get(
        `/api/admin/students/nonexistent-id/health-notes`,
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (403) a VIEWER without can_view_sensitive_data", async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.get(
        `/api/admin/students/${studentId}/health-notes`,
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should allow a VIEWER granted can_view_sensitive_data to read", async () => {
      const { accessToken } = await AdminUserTest.createViewer(undefined, {
        canViewSensitiveData: true,
      });

      const response = await TestRequest.get(
        `/api/admin/students/${studentId}/health-notes`,
        accessToken,
      );

      expect(response.status).toBe(200);
    });
  });

  describe("PATCH /api/admin/students/:id/health-notes/:noteId", () => {
    it("should update a health note's status", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const note = await HealthNoteTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-notes/${note.id}`,
        { status: "RESOLVED", resolved_date: new Date().toISOString() },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.status).toBe("RESOLVED");
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();
      const note = await HealthNoteTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-notes/${note.id}`,
        { status: "RESOLVED" },
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (404) for a nonexistent health note", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-notes/nonexistent-id`,
        { status: "RESOLVED" },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (400) updating a soft-deleted health note", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const note = await HealthNoteTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-notes/${note.id}`,
        { status: "RESOLVED" },
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/students/:id/health-notes/delete/:noteId", () => {
    it("should soft-delete a health note as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const note = await HealthNoteTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-notes/delete/${note.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(200);

      const deleted = await prismaClient.healthNote.findUniqueOrThrow({
        where: { id: note.id },
      });
      expect(deleted.deleted_at).not.toBeNull();
    });

    it("should reject (403) for DATABASE_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const note = await HealthNoteTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-notes/delete/${note.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (400) deleting an already-deleted health note", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const note = await HealthNoteTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-notes/delete/${note.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/students/:id/health-notes/restore/:noteId", () => {
    it("should restore a soft-deleted health note as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const note = await HealthNoteTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-notes/restore/${note.id}`,
        {},
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.id).toBe(note.id);

      const restored = await prismaClient.healthNote.findUniqueOrThrow({
        where: { id: note.id },
      });
      expect(restored.deleted_at).toBeNull();
    });

    it("should reject (403) for DATABASE_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const note = await HealthNoteTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-notes/restore/${note.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (400) restoring a health note that isn't deleted", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const note = await HealthNoteTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/health-notes/restore/${note.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });
});
