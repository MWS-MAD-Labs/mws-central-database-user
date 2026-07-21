import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  StudentTest,
  ParentGuardianTest,
  MasterDataTest,
  AuditLogTest,
} from "./test-utils";
import { AuditAction, ParentType } from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

describe("Parent / Guardian", () => {
  let studentId: string;

  async function cleanup() {
    await AuditLogTest.delete();
    await ParentGuardianTest.delete();
    await StudentTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }

  beforeEach(async () => {
    await cleanup();
    await MasterDataTest.create();

    const student = await StudentTest.create({
      email: "test_parent_guardian@millennia21.id",
      nis: "9100001",
    });
    studentId = student.student!.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("POST /api/admin/students/:id/parents", () => {
    it("should create a contact as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/parents`,
        {
          type: "FATHER",
          full_name: "John Doe",
          phone: "081234567890",
          email: "john.doe@example.com",
          address: "Jakarta",
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.type).toBe("FATHER");
      expect(body.data.full_name).toBe("John Doe");
      expect(body.data.phone).toBe("6281234567890");
      expect(body.data.is_primary).toBe(false);

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: {
          action: AuditAction.CREATE_PARENT_GUARDIAN,
          admin_id: admin.id,
        },
      });
      expect(auditLog.entity_type).toBe("ParentGuardian");
    });

    it("should create a contact as DATABASE_ADMIN with can_write_data", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/parents`,
        { type: "MOTHER", full_name: "Jane Doe" },
        accessToken,
      );

      expect(response.status).toBe(200);
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/parents`,
        { type: "FATHER", full_name: "John Doe" },
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (404) for a nonexistent student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/nonexistent-id/parents`,
        { type: "FATHER", full_name: "John Doe" },
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
        `/api/admin/students/${studentId}/parents`,
        { type: "FATHER", full_name: "John Doe" },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should auto-unset the previous primary contact when a new one is marked primary", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const first = await TestRequest.post(
        `/api/admin/students/${studentId}/parents`,
        { type: "FATHER", full_name: "John Doe", is_primary: true },
        accessToken,
      );
      const firstBody = await first.json();
      expect(firstBody.data.is_primary).toBe(true);

      const second = await TestRequest.post(
        `/api/admin/students/${studentId}/parents`,
        { type: "MOTHER", full_name: "Jane Doe", is_primary: true },
        accessToken,
      );
      const secondBody = await second.json();
      expect(secondBody.data.is_primary).toBe(true);

      const refreshedFirst = await prismaClient.parentGuardian.findUniqueOrThrow(
        { where: { id: firstBody.data.id } },
      );
      expect(refreshedFirst.is_primary).toBe(false);
    });
  });

  describe("GET /api/admin/students/:id/parents", () => {
    it("should list contacts for a student, excluding soft-deleted by default", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      await ParentGuardianTest.create({
        studentId,
        type: ParentType.FATHER,
        fullName: "Active Father",
      });
      await ParentGuardianTest.create({
        studentId,
        type: ParentType.MOTHER,
        fullName: "Deleted Mother",
        deletedAt: new Date(),
      });

      const activeResponse = await TestRequest.get(
        `/api/admin/students/${studentId}/parents`,
        accessToken,
      );
      const activeBody = await activeResponse.json();
      logger.debug(activeBody);

      expect(activeResponse.status).toBe(200);
      expect(activeBody.data.length).toBe(1);
      expect(activeBody.data[0].full_name).toBe("Active Father");

      const deletedResponse = await TestRequest.get(
        `/api/admin/students/${studentId}/parents?is_deleted=true`,
        accessToken,
      );
      const deletedBody = await deletedResponse.json();

      expect(deletedBody.data.length).toBe(1);
      expect(deletedBody.data[0].full_name).toBe("Deleted Mother");
      expect(deletedBody.data[0].deleted_at).not.toBeNull();
    });

    it("should reject (404) for a nonexistent student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.get(
        `/api/admin/students/nonexistent-id/parents`,
        accessToken,
      );

      expect(response.status).toBe(404);
    });
  });

  describe("PATCH /api/admin/students/:id/parents/:parentId", () => {
    it("should update a contact's fields", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const parent = await ParentGuardianTest.create({
        studentId,
        type: ParentType.GUARDIAN,
        fullName: "Old Name",
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/parents/${parent.id}`,
        { full_name: "New Name", is_primary: true },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.full_name).toBe("New Name");
      expect(body.data.is_primary).toBe(true);
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();
      const parent = await ParentGuardianTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/parents/${parent.id}`,
        { full_name: "New Name" },
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (404) for a nonexistent contact", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/parents/nonexistent-id`,
        { full_name: "New Name" },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (400) updating a soft-deleted contact", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const parent = await ParentGuardianTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/parents/${parent.id}`,
        { full_name: "New Name" },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (404) updating a contact when the student is soft-deleted", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const parent = await ParentGuardianTest.create({ studentId });

      await TestRequest.patch(
        `/api/admin/students/delete/${studentId}`,
        {},
        accessToken,
      );

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/parents/${parent.id}`,
        { full_name: "New Name" },
        accessToken,
      );

      expect(response.status).toBe(404);
    });
  });

  describe("PATCH /api/admin/students/:id/parents/delete/:parentId", () => {
    it("should soft-delete a contact as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const parent = await ParentGuardianTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/parents/delete/${parent.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(200);

      const deleted = await prismaClient.parentGuardian.findUniqueOrThrow({
        where: { id: parent.id },
      });
      expect(deleted.deleted_at).not.toBeNull();
    });

    it("should reject (403) for DATABASE_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const parent = await ParentGuardianTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/parents/delete/${parent.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (400) deleting an already-deleted contact", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const parent = await ParentGuardianTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/parents/delete/${parent.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/students/:id/parents/restore/:parentId", () => {
    it("should restore a soft-deleted contact as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const parent = await ParentGuardianTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/parents/restore/${parent.id}`,
        {},
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.id).toBe(parent.id);

      const restored = await prismaClient.parentGuardian.findUniqueOrThrow({
        where: { id: parent.id },
      });
      expect(restored.deleted_at).toBeNull();
    });

    it("should reject (403) for DATABASE_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const parent = await ParentGuardianTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/parents/restore/${parent.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (400) restoring a contact that isn't deleted", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const parent = await ParentGuardianTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/parents/restore/${parent.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });
});
