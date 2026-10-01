import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  StudentTest,
  MasterDataTest,
  AuditLogTest,
} from "./test-utils";
import { AuditAction } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";

describe("POST /api/admin/students/:id/sensitive-fields/access", () => {
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
      email: "test_student_pii_access@millennia21.id",
      nis: "9300101",
    });
    studentId = student.student!.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("records an ACCESS_STUDENT_PII audit entry for a Super Admin", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      `/api/admin/students/${studentId}/sensitive-fields/access`,
      {},
      accessToken,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.birth_place).toBeDefined();
    expect(body.data.birth_date).toBeDefined();

    const log = await prismaClient.auditLog.findFirst({
      where: { action: AuditAction.ACCESS_STUDENT_PII, entity_id: studentId },
    });
    expect(log).not.toBeNull();
    expect(log?.entity_type).toBe("Student");
    expect(log?.new_values).toMatchObject({ resource: "StudentSensitiveFields" });
  });

  it("rejects (403) an admin without sensitive-data permission and logs the attempt", async () => {
    const unit = await prismaClient.masterUnit.findFirstOrThrow({
      where: { name: { startsWith: "TEST_" } },
    });
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(unit.id, {
      canViewSensitiveData: false,
    });

    const response = await TestRequest.post(
      `/api/admin/students/${studentId}/sensitive-fields/access`,
      {},
      accessToken,
    );
    expect(response.status).toBe(403);

    expect(
      await prismaClient.auditLog.count({
        where: { action: AuditAction.ACCESS_STUDENT_PII },
      }),
    ).toBe(0);
    expect(
      await prismaClient.auditLog.count({
        where: { action: AuditAction.UNAUTHORIZED_ACCESS },
      }),
    ).toBeGreaterThan(0);
  });

  it("allows a Database Admin who has the sensitive-data permission", async () => {
    const unit = await prismaClient.masterUnit.findFirstOrThrow({
      where: { name: { startsWith: "TEST_" } },
    });
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(unit.id, {
      canViewSensitiveData: true,
    });

    const response = await TestRequest.post(
      `/api/admin/students/${studentId}/sensitive-fields/access`,
      {},
      accessToken,
    );
    expect(response.status).toBe(200);
  });

  it("returns 404 for an unknown student", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/students/nonexistent-id/sensitive-fields/access",
      {},
      accessToken,
    );
    expect(response.status).toBe(404);
  });

  it("rejects an unauthenticated request", async () => {
    const response = await TestRequest.post(
      `/api/admin/students/${studentId}/sensitive-fields/access`,
      {},
    );
    expect(response.status).toBe(401);
  });

  it("keeps birth details and health summary out of the detail response", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(`/api/admin/students/${studentId}`, accessToken);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.identity.full_name).toBeDefined();
    expect(body.data.identity.birth_place).toBeUndefined();
    expect(body.data.identity.birth_date).toBeUndefined();
    expect(body.data.health).toBeUndefined();
    expect(
      await prismaClient.auditLog.count({
        where: { action: AuditAction.ACCESS_STUDENT_PII },
      }),
    ).toBe(0);
  });

  it("records the access when the parent contact list is read", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      `/api/admin/students/${studentId}/parents`,
      accessToken,
    );
    expect(response.status).toBe(200);

    const log = await prismaClient.auditLog.findFirst({
      where: { action: AuditAction.ACCESS_STUDENT_PII, entity_id: studentId },
    });
    expect(log).not.toBeNull();
  });
});
