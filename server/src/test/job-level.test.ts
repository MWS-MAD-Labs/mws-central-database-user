import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  EmployeeTest,
  MasterDataTest,
  AuditLogTest,
} from "./test-utils";
import {
  AuditAction,
  AuditSource,
  type MasterUnit,
  type MasterJobPosition,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

describe("POST /api/admin/job-levels", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  it("should successfully create a job level when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/job-levels",
      { name: "TEST_Teacher", is_teaching_role: true },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.name).toBe("TEST_Teacher");
    expect(body.data.is_teaching_role).toBe(true);

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: body.data.id },
    });
    logger.debug(auditLog);

    expect(auditLog.action).toBe(AuditAction.CREATE_MASTER_DATA);
    expect(auditLog.source).toBe(AuditSource.UI);
    expect(auditLog.entity_type).toBe("MasterJobLevel");
    expect(auditLog.admin_id).toBe(admin.id);
    expect(auditLog.old_values).toBeNull();
  });

  it("should default is_teaching_role to false when omitted", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/job-levels",
      { name: "TEST_Staff" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.is_teaching_role).toBe(false);
  });

  it("should reject creation (403 Forbidden) when requested by DATABASE_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();

    const response = await TestRequest.post(
      "/api/admin/job-levels",
      { name: "TEST_Blocked" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });

  it("should reject creation (403 Forbidden) when requested by VIEWER", async () => {
    const { accessToken } = await AdminUserTest.createViewer();

    const response = await TestRequest.post(
      "/api/admin/job-levels",
      { name: "TEST_Blocked2" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });

  it("should reject a duplicate name", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await prismaClient.masterJobLevel.create({
      data: { name: "TEST_Duplicate" },
    });

    const response = await TestRequest.post(
      "/api/admin/job-levels",
      { name: "TEST_Duplicate" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already exists");
  });

  it("should reject creation (400 Bad Request) if name is missing", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/job-levels",
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.post("/api/admin/job-levels", {
      name: "TEST_NoAuth",
    });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("PATCH /api/admin/job-levels/:id", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  it("should successfully update a job level's is_teaching_role flag", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const jobLevel = await prismaClient.masterJobLevel.create({
      data: { name: "TEST_Original", is_teaching_role: false },
    });

    const response = await TestRequest.patch(
      `/api/admin/job-levels/${jobLevel.id}`,
      { is_teaching_role: true },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.is_teaching_role).toBe(true);
    expect(body.data.name).toBe("TEST_Original");

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: jobLevel.id },
    });
    logger.debug(auditLog);

    expect(auditLog.action).toBe(AuditAction.UPDATE_MASTER_DATA);
    expect(auditLog.admin_id).toBe(admin.id);
    const oldValues = auditLog.old_values as { is_teaching_role?: boolean };
    const newValues = auditLog.new_values as { is_teaching_role?: boolean };
    expect(oldValues?.is_teaching_role).toBe(false);
    expect(newValues?.is_teaching_role).toBe(true);
  });

  it("should reject update (403 Forbidden) when requested by DATABASE_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const jobLevel = await prismaClient.masterJobLevel.create({
      data: { name: "TEST_Protected" },
    });

    const response = await TestRequest.patch(
      `/api/admin/job-levels/${jobLevel.id}`,
      { name: "TEST_ShouldNotChange" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });

  it("should reject renaming to an already-used name", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const taken = await prismaClient.masterJobLevel.create({
      data: { name: "TEST_Taken" },
    });
    const other = await prismaClient.masterJobLevel.create({
      data: { name: "TEST_ToRename" },
    });

    const response = await TestRequest.patch(
      `/api/admin/job-levels/${other.id}`,
      { name: taken.name },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already exists");
  });

  it("should allow re-saving with the same name (no-op rename)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const jobLevel = await prismaClient.masterJobLevel.create({
      data: { name: "TEST_SameName" },
    });

    const response = await TestRequest.patch(
      `/api/admin/job-levels/${jobLevel.id}`,
      { name: jobLevel.name },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.name).toBe(jobLevel.name);
  });

  it("should reject if the job level does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.patch(
      "/api/admin/job-levels/invalid-cuid-123",
      { name: "TEST_Whatever" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("not found");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch("/api/admin/job-levels/whatever", {
      name: "TEST_Whatever",
    });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("GET /api/admin/job-levels/:id", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  it("should be readable by SUPER_ADMIN, DATABASE_ADMIN, and VIEWER alike", async () => {
    const jobLevel = await prismaClient.masterJobLevel.create({
      data: { name: "TEST_Readable" },
    });
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin();
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin();
    const { accessToken: viewerToken } = await AdminUserTest.createViewer();

    for (const token of [superAdminToken, dbAdminToken, viewerToken]) {
      const response = await TestRequest.get(
        `/api/admin/job-levels/${jobLevel.id}`,
        token,
      );
      expect(response.status).toBe(200);
    }
  });

  it("should reject if the job level does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/job-levels/invalid-cuid-123",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("not found");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get("/api/admin/job-levels/whatever");
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("GET /api/admin/job-levels", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  it("should list and paginate", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await prismaClient.masterJobLevel.create({ data: { name: "TEST_CRUD_A" } });
    await prismaClient.masterJobLevel.create({ data: { name: "TEST_CRUD_B" } });
    await prismaClient.masterJobLevel.create({ data: { name: "TEST_CRUD_C" } });

    const response = await TestRequest.get(
      "/api/admin/job-levels?size=2&page=1&search=TEST_CRUD",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(2);
    expect(body.paging.total_item).toBe(3);
    expect(body.paging.total_page).toBe(2);
  });

  it("should search by name", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await prismaClient.masterJobLevel.create({
      data: { name: "TEST_Sombrero" },
    });
    await prismaClient.masterJobLevel.create({ data: { name: "TEST_Fedora" } });

    const response = await TestRequest.get(
      "/api/admin/job-levels?search=sombrero",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("TEST_Sombrero");
  });

  it("should sort by name descending when requested", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await prismaClient.masterJobLevel.create({
      data: { name: "TEST_CRUD_Alpha" },
    });
    await prismaClient.masterJobLevel.create({
      data: { name: "TEST_CRUD_Zebra" },
    });

    const response = await TestRequest.get(
      "/api/admin/job-levels?search=TEST_CRUD&sort_by=name&sort_order=desc",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.map((e: { name: string }) => e.name)).toEqual([
      "TEST_CRUD_Zebra",
      "TEST_CRUD_Alpha",
    ]);
  });

  it("should be readable by VIEWER", async () => {
    const { accessToken } = await AdminUserTest.createViewer();

    const response = await TestRequest.get(
      "/api/admin/job-levels",
      accessToken,
    );

    expect(response.status).toBe(200);
  });

  it("should reject an invalid sort_by field", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/job-levels?sort_by=not_a_real_field",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject a non-numeric page", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/job-levels?page=abc",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("page must be a valid number");
  });

  it("should reject a size greater than the maximum allowed (100)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/job-levels?size=101",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get("/api/admin/job-levels");
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("DELETE /api/admin/job-levels/:id", () => {
  let masterData: { unit: MasterUnit; position: MasterJobPosition };

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await EmployeeTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  it("should delete a job level not referenced by anything", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const jobLevel = await prismaClient.masterJobLevel.create({
      data: { name: "TEST_Deletable" },
    });

    const response = await TestRequest.delete(
      `/api/admin/job-levels/${jobLevel.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data).toBe(true);

    const stillThere = await prismaClient.masterJobLevel.findUnique({
      where: { id: jobLevel.id },
    });
    expect(stillThere).toBeNull();

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: jobLevel.id },
    });
    logger.debug(auditLog);

    expect(auditLog.action).toBe(AuditAction.DELETE_MASTER_DATA);
    expect(auditLog.admin_id).toBe(admin.id);
  });

  it("should reject deletion (403 Forbidden) when requested by DATABASE_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const jobLevel = await prismaClient.masterJobLevel.create({
      data: { name: "TEST_Protected2" },
    });

    const response = await TestRequest.delete(
      `/api/admin/job-levels/${jobLevel.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });

  it("should reject if the job level does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.delete(
      "/api/admin/job-levels/invalid-cuid-123",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("not found");
  });

  it("should reject deletion when an Employee still references the job level", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetLevel = await prismaClient.masterJobLevel.create({
      data: { name: "TEST_TargetLevel" },
    });
    await EmployeeTest.create({
      email: "test_emp_level_ref@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: targetLevel.id,
    });

    const response = await TestRequest.delete(
      `/api/admin/job-levels/${targetLevel.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("still referenced by");
    expect(body.errors).toContain("employee(s)");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.delete("/api/admin/job-levels/whatever");
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});
