import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  StudentTest,
  StudentPhotoTest,
  MasterDataTest,
  AuditLogTest,
} from "./test-utils";
import { AuditAction } from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

// Smallest possible valid PNG (1x1, transparent) - sharp needs to actually
// decode this, not just see the right magic bytes, so a fabricated buffer
// with the right prefix isn't enough for the "successful upload" cases.
const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("Student Photo", () => {
  let studentId: string;

  async function cleanup() {
    await AuditLogTest.delete();
    await StudentTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }

  beforeEach(async () => {
    await cleanup();
    await MasterDataTest.create();

    const student = await StudentTest.create({
      email: "test_student_photo@millennia21.id",
      nis: "9500001",
    });
    studentId = student.student!.id;
  });

  afterEach(async () => {
    await StudentPhotoTest.removeFromMinio(studentId);
    await cleanup();
  });

  describe("POST /api/admin/students/:id/photo", () => {
    it("should upload a photo as SUPER_ADMIN, resize/convert to avif, and audit it", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const formData = new FormData();
      formData.append(
        "file",
        new File([VALID_PNG], "photo.png", { type: "image/png" }),
      );

      const response = await TestRequest.postMultipart(
        `/api/admin/students/${studentId}/photo`,
        formData,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data).toBe(true);

      const person = await prismaClient.person.findFirstOrThrow({
        where: { student: { id: studentId } },
      });
      expect(person.photo_object_key).not.toBeNull();
      expect(person.photo_object_key).toStartWith(`student-photos/${studentId}/`);
      expect(person.photo_object_key).toEndWith(".avif");

      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.UPLOAD_STUDENT_PHOTO, admin_id: admin.id },
      });
      expect(auditLog.entity_type).toBe("Student");
      expect(auditLog.entity_id).toBe(studentId);
    });

    it("should replace an existing photo and remove the old MinIO object", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const firstUpload = new FormData();
      firstUpload.append(
        "file",
        new File([VALID_PNG], "first.png", { type: "image/png" }),
      );
      await TestRequest.postMultipart(
        `/api/admin/students/${studentId}/photo`,
        firstUpload,
        accessToken,
      );
      const firstPerson = await prismaClient.person.findFirstOrThrow({
        where: { student: { id: studentId } },
      });
      const firstObjectKey = firstPerson.photo_object_key!;

      const secondUpload = new FormData();
      secondUpload.append(
        "file",
        new File([VALID_PNG], "second.png", { type: "image/png" }),
      );
      const response = await TestRequest.postMultipart(
        `/api/admin/students/${studentId}/photo`,
        secondUpload,
        accessToken,
      );
      expect(response.status).toBe(200);

      const secondPerson = await prismaClient.person.findFirstOrThrow({
        where: { student: { id: studentId } },
      });
      expect(secondPerson.photo_object_key).not.toBe(firstObjectKey);

      // Only the new object should remain under this student's prefix.
      const objects = await StudentPhotoTest.listMinioObjects(studentId);
      expect(objects).toEqual([secondPerson.photo_object_key!]);
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();
      const formData = new FormData();
      formData.append(
        "file",
        new File([VALID_PNG], "photo.png", { type: "image/png" }),
      );

      const response = await TestRequest.postMultipart(
        `/api/admin/students/${studentId}/photo`,
        formData,
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (403) a DATABASE_ADMIN with can_write_student_data but without can_view_sensitive_data", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const formData = new FormData();
      formData.append(
        "file",
        new File([VALID_PNG], "photo.png", { type: "image/png" }),
      );

      const response = await TestRequest.postMultipart(
        `/api/admin/students/${studentId}/photo`,
        formData,
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should allow a DATABASE_ADMIN with can_write_student_data and can_view_sensitive_data within their unit", async () => {
      // No explicit unitId - matches the default TEST_UNIT_SHIELD unit that
      // StudentTest.create() (called with no currentGradeId, as above)
      // resolves its fixture grade under.
      const { accessToken } = await AdminUserTest.createDatabaseAdmin(
        undefined,
        { canViewSensitiveData: true },
      );

      const formData = new FormData();
      formData.append(
        "file",
        new File([VALID_PNG], "photo.png", { type: "image/png" }),
      );

      const response = await TestRequest.postMultipart(
        `/api/admin/students/${studentId}/photo`,
        formData,
        accessToken,
      );

      expect(response.status).toBe(200);
    });

    it("should reject (400) when no file field is present", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const formData = new FormData();

      const response = await TestRequest.postMultipart(
        `/api/admin/students/${studentId}/photo`,
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
        `/api/admin/students/${studentId}/photo`,
        formData,
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) a file with valid magic bytes but that isn't a decodable image", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      // Real PNG signature, garbage after it.
      const corrupted = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from("not actually a png"),
      ]);
      const formData = new FormData();
      formData.append(
        "file",
        new File([corrupted], "corrupt.png", { type: "image/png" }),
      );

      const response = await TestRequest.postMultipart(
        `/api/admin/students/${studentId}/photo`,
        formData,
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) a file over the 10MB limit", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
      // Valid PNG magic bytes so this fails on size, not on type detection.
      oversized.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const formData = new FormData();
      formData.append(
        "file",
        new File([oversized], "big.png", { type: "image/png" }),
      );

      const response = await TestRequest.postMultipart(
        `/api/admin/students/${studentId}/photo`,
        formData,
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (404) for a nonexistent student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const formData = new FormData();
      formData.append(
        "file",
        new File([VALID_PNG], "photo.png", { type: "image/png" }),
      );

      const response = await TestRequest.postMultipart(
        "/api/admin/students/nonexistent-id/photo",
        formData,
        accessToken,
      );

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/admin/students/:id/photo", () => {
    it("should delete an uploaded photo as SUPER_ADMIN, remove the MinIO object, and audit it", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });

      const formData = new FormData();
      formData.append(
        "file",
        new File([VALID_PNG], "photo.png", { type: "image/png" }),
      );
      await TestRequest.postMultipart(
        `/api/admin/students/${studentId}/photo`,
        formData,
        accessToken,
      );

      const response = await TestRequest.delete(
        `/api/admin/students/${studentId}/photo`,
        accessToken,
      );
      logger.debug(await response.json());

      expect(response.status).toBe(200);

      const person = await prismaClient.person.findFirstOrThrow({
        where: { student: { id: studentId } },
      });
      expect(person.photo_object_key).toBeNull();

      const objects = await StudentPhotoTest.listMinioObjects(studentId);
      expect(objects.length).toBe(0);

      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.DELETE_STUDENT_PHOTO, admin_id: admin.id },
      });
      expect(auditLog.entity_type).toBe("Student");
    });

    it("should reject (400) when the student has no uploaded photo", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.delete(
        `/api/admin/students/${studentId}/photo`,
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.delete(
        `/api/admin/students/${studentId}/photo`,
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (404) for a nonexistent student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.delete(
        "/api/admin/students/nonexistent-id/photo",
        accessToken,
      );

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/admin/students/photos/bulk-preview", () => {
    it("should match a file name to exactly one student, case-insensitively", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const student = await prismaClient.student.findUniqueOrThrow({
        where: { id: studentId },
        include: { person: true },
      });

      const response = await TestRequest.post(
        "/api/admin/students/photos/bulk-preview",
        { file_names: [`${student.person.full_name.toUpperCase()}.png`] },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].candidates.length).toBe(1);
      expect(body.data[0].candidates[0].id).toBe(studentId);
    });

    it("should report zero candidates for an unmatched name", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        "/api/admin/students/photos/bulk-preview",
        { file_names: ["Nobody Matching.png"] },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data[0].candidates.length).toBe(0);
    });

    it("should report multiple candidates for a name collision", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const first = await prismaClient.person.findFirstOrThrow({
        where: { student: { id: studentId } },
      });
      const duplicate = await StudentTest.create({
        email: "test_student_photo_dup@millennia21.id",
        nis: "9500002",
      });
      await prismaClient.person.update({
        where: { id: duplicate.id },
        data: { full_name: first.full_name },
      });

      const response = await TestRequest.post(
        "/api/admin/students/photos/bulk-preview",
        { file_names: [`${first.full_name}.png`] },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data[0].candidates.length).toBe(2);
    });

    it("should reject (403) a VIEWER without can_view_sensitive_data", async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.post(
        "/api/admin/students/photos/bulk-preview",
        { file_names: ["Anyone.png"] },
        accessToken,
      );

      expect(response.status).toBe(403);
    });
  });

  describe("POST /api/admin/students/photos/bulk-commit", () => {
    it("should upload multiple mapped files, reporting per-item success/failure", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const secondStudent = await StudentTest.create({
        email: "test_student_photo_bulk2@millennia21.id",
        nis: "9500003",
      });

      const formData = new FormData();
      formData.append(
        "mappings",
        JSON.stringify([
          { file_name: "one.png", student_id: studentId },
          { file_name: "two.png", student_id: secondStudent.student!.id },
          { file_name: "missing.png", student_id: studentId },
        ]),
      );
      formData.append(
        "files",
        new File([VALID_PNG], "one.png", { type: "image/png" }),
      );
      formData.append(
        "files",
        new File([VALID_PNG], "two.png", { type: "image/png" }),
      );

      const response = await TestRequest.postMultipart(
        "/api/admin/students/photos/bulk-commit",
        formData,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.total_count).toBe(3);
      expect(body.data.success_count).toBe(2);
      expect(body.data.failed_count).toBe(1);

      const failedItem = body.data.items.find(
        (item: { id: string }) => item.id === "missing.png",
      );
      expect(failedItem.status).toBe("FAILED");

      await StudentPhotoTest.removeFromMinio(secondStudent.student!.id);
    });

    it("should reject (400) when two files share the same name - a Map keyed by filename would silently drop one", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const secondStudent = await StudentTest.create({
        email: "test_student_photo_bulk_dup@millennia21.id",
        nis: "9500005",
      });

      const formData = new FormData();
      formData.append(
        "mappings",
        JSON.stringify([
          { file_name: "dup.png", student_id: studentId },
          { file_name: "dup.png", student_id: secondStudent.student!.id },
        ]),
      );
      formData.append(
        "files",
        new File([VALID_PNG], "dup.png", { type: "image/png" }),
      );
      formData.append(
        "files",
        new File([VALID_PNG], "dup.png", { type: "image/png" }),
      );

      const response = await TestRequest.postMultipart(
        "/api/admin/students/photos/bulk-commit",
        formData,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
      expect(body.errors).toContain("dup.png");

      const person = await prismaClient.person.findFirst({
        where: { student: { id: studentId } },
      });
      expect(person?.photo_object_key).toBeNull();
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();
      const formData = new FormData();
      formData.append(
        "mappings",
        JSON.stringify([{ file_name: "one.png", student_id: studentId }]),
      );
      formData.append(
        "files",
        new File([VALID_PNG], "one.png", { type: "image/png" }),
      );

      const response = await TestRequest.postMultipart(
        "/api/admin/students/photos/bulk-commit",
        formData,
        accessToken,
      );

      expect(response.status).toBe(403);
    });
  });
});
