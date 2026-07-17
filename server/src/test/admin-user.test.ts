import { describe, afterEach, beforeEach, it, expect, spyOn } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  MasterDataTest,
  EmployeeTest,
} from "./test-utils";
import {
  AdminRole,
  type MasterUnit,
  type MasterJobPosition,
  type MasterJobLevel,
} from "../generated/prisma/client";
import { GoogleAuth } from "../utils/google-auth";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

describe("POST /api/admin/admin-users/promote", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  it("should promote an active employee to admin when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const person = await EmployeeTest.create({
      email: "promote_me@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.post(
      "/api/admin/admin-users/promote",
      {
        employee_id: person.employee!.id,
        role: AdminRole.VIEWER,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.type).toBe("admin");
    expect(body.data.email).toBe("promote_me@millennia21.id");
    expect(body.data.full_name).toBe("Test Employee");
    expect(body.data.role).toBe(AdminRole.VIEWER);
    expect(body.data.unit_id).toBe(masterData.unit.id);

    const created = await prismaClient.adminUser.findUnique({
      where: { email: "promote_me@millennia21.id" },
    });
    expect(created?.is_active).toBe(true);

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: created!.id, action: "ROLE_CHANGE" },
    });
    const requester = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    expect(auditLog.admin_id).toBe(requester.id);
    expect(auditLog.old_values).toBeNull();
    expect((auditLog.new_values as { role?: string })?.role).toBe(
      AdminRole.VIEWER,
    );
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );

    const person = await EmployeeTest.create({
      email: "cannot_promote@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.post(
      "/api/admin/admin-users/promote",
      {
        employee_id: person.employee!.id,
        role: AdminRole.VIEWER,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });

  it("should reject if employee does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const response = await TestRequest.post(
      "/api/admin/admin-users/promote",
      {
        employee_id: "invalid-cuid-123",
        role: AdminRole.VIEWER,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Employee not found");
  });

  it("should reject if an active admin account already exists for the employee's email", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const person = await EmployeeTest.create({
      email: "test_superadmin@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.post(
      "/api/admin/admin-users/promote",
      {
        employee_id: person.employee!.id,
        role: AdminRole.VIEWER,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already has an active admin account");
  });

  it("should reactivate a previously demoted admin instead of creating a duplicate row", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);

    const person = await EmployeeTest.create({
      email: "reactivate_me@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const firstPromote = await TestRequest.post(
      "/api/admin/admin-users/promote",
      {
        employee_id: person.employee!.id,
        role: AdminRole.VIEWER,
      },
      superAdminToken,
    );
    const firstBody = await firstPromote.json();
    expect(firstPromote.status).toBe(200);

    await TestRequest.patch(
      `/api/admin/admin-users/demote/${firstBody.data.id}`,
      {},
      superAdminToken,
    );

    const secondPromote = await TestRequest.post(
      "/api/admin/admin-users/promote",
      {
        employee_id: person.employee!.id,
        role: AdminRole.DATABASE_ADMIN,
      },
      superAdminToken,
    );
    const secondBody = await secondPromote.json();
    logger.debug(secondBody);

    expect(secondPromote.status).toBe(200);
    expect(secondBody.data.is_active).toBe(true);
    expect(secondBody.data.role).toBe(AdminRole.DATABASE_ADMIN);

    // Reactivated, not duplicated — same row, same admin_no.
    expect(secondBody.data.id).toBe(firstBody.data.id);
    expect(secondBody.data.admin_no).toBe(firstBody.data.admin_no);

    const rowCount = await prismaClient.adminUser.count({
      where: { email: "reactivate_me@millennia21.id" },
    });
    expect(rowCount).toBe(1);
  });

  it("should reject invalid role value", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const person = await EmployeeTest.create({
      email: "bad_role@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.post(
      "/api/admin/admin-users/promote",
      {
        employee_id: person.employee!.id,
        role: "NOT_A_REAL_ROLE",
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.post("/api/admin/admin-users/promote", {
      employee_id: "whatever",
      role: AdminRole.VIEWER,
    });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  it("should invalidate the employee's old self-service token immediately after promotion", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);

    const { accessToken: employeeToken } = await EmployeeTest.createWithToken(
      {
        email: "about_to_be_promoted@millennia21.id",
        unitId: masterData.unit.id,
        jobPositionId: masterData.position.id,
        jobLevelId: masterData.level.id,
      },
    );

    const before = await TestRequest.get(
      "/api/auth/employee/me",
      employeeToken,
    );
    expect(before.status).toBe(200);

    const person = await prismaClient.person.findFirst({
      where: { email: "about_to_be_promoted@millennia21.id" },
      include: { employee: true },
    });

    await TestRequest.post(
      "/api/admin/admin-users/promote",
      {
        employee_id: person!.employee!.id,
        role: AdminRole.VIEWER,
      },
      superAdminToken,
    );

    const after = await TestRequest.get(
      "/api/auth/employee/me",
      employeeToken,
    );
    const afterBody = await after.json();
    logger.debug(afterBody);

    expect(after.status).toBe(401);
    expect(afterBody.errors).toContain("upgraded");
  });
});

describe("PATCH /api/admin/admin-users/demote/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  it("should demote an active admin when requested by SUPER_ADMIN", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createViewer(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_viewer@millennia21.id" },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/demote/${target.id}`,
      {},
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.is_active).toBe(false);

    const updated = await prismaClient.adminUser.findUnique({
      where: { id: target.id },
    });
    expect(updated?.is_active).toBe(false);
    expect(updated?.refresh_token_hash).toBeNull();

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: target.id, action: "ROLE_CHANGE" },
    });
    const requester = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    expect(auditLog.admin_id).toBe(requester.id);
    expect(
      (auditLog.old_values as { is_active?: boolean })?.is_active,
    ).toBe(true);
    expect(
      (auditLog.new_values as { is_active?: boolean })?.is_active,
    ).toBe(false);
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin(masterData.unit.id);
    await AdminUserTest.createViewer(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_viewer@millennia21.id" },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/demote/${target.id}`,
      {},
      dbAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });

  it("should reject if target admin does not exist", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);

    const response = await TestRequest.patch(
      "/api/admin/admin-users/demote/invalid-cuid-123",
      {},
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Admin not found");
  });

  it("should reject demoting an admin that is already deactivated", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createViewer(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_viewer@millennia21.id" },
    });

    await prismaClient.adminUser.update({
      where: { id: target.id },
      data: { is_active: false },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/demote/${target.id}`,
      {},
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already deactivated");
  });

  it("should reject a SUPER_ADMIN attempting to demote their own account", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);

    const self = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/demote/${self.id}`,
      {},
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("cannot demote your own admin account");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch(
      "/api/admin/admin-users/demote/whatever",
      {},
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  it("should immediately invalidate the demoted admin's existing access & refresh tokens", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const { accessToken: viewerAccessToken, refreshToken: viewerRefreshToken } =
      await AdminUserTest.createViewer(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_viewer@millennia21.id" },
    });

    await TestRequest.patch(
      `/api/admin/admin-users/demote/${target.id}`,
      {},
      superAdminToken,
    );

    const meResponse = await TestRequest.get(
      "/api/auth/me",
      viewerAccessToken,
    );
    const meBody = await meResponse.json();
    expect(meResponse.status).toBe(401);
    expect(meBody.errors).toContain("deactivated");

    const refreshResponse = await TestRequest.postWithCookies(
      "/api/auth/refresh",
      {},
      { refresh_token: viewerRefreshToken },
    );
    const refreshBody = await refreshResponse.json();
    expect(refreshResponse.status).toBe(401);
    expect(refreshBody.errors).toContain("Invalid or expired refresh token");
  });

  it("should let a demoted admin fall back to employee self-service login if they are also an active employee", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createViewer(masterData.unit.id);

    await EmployeeTest.create({
      email: "test_viewer@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_viewer@millennia21.id" },
    });

    await TestRequest.patch(
      `/api/admin/admin-users/demote/${target.id}`,
      {},
      superAdminToken,
    );

    const googleSpy = spyOn(GoogleAuth, "verifyCode").mockResolvedValue({
      google_id: "demoted-viewer-123",
      email: "test_viewer@millennia21.id",
      name: "Test Viewer",
      avatar_url: "",
    });

    process.env.ALLOWED_DOMAIN = "millennia21.id";
    const response = await TestRequest.post("/api/auth/google", {
      code: "VALID_CODE",
    });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.type).toBe("employee");

    googleSpy.mockRestore();
  });
});

describe("PATCH /api/admin/admin-users/can-write-data/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  it("should flip can_write_data when requested by SUPER_ADMIN on a DATABASE_ADMIN", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_dbadmin@millennia21.id" },
    });
    expect(target.can_write_data).toBe(true);

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-write-data/${target.id}`,
      { can_write_data: false },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.can_write_data).toBe(false);

    const updated = await prismaClient.adminUser.findUnique({
      where: { id: target.id },
    });
    expect(updated?.can_write_data).toBe(false);

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: target.id, action: "PERMISSION_CHANGE" },
    });
    expect((auditLog.old_values as { can_write_data?: boolean })?.can_write_data).toBe(
      true,
    );
    expect((auditLog.new_values as { can_write_data?: boolean })?.can_write_data).toBe(
      false,
    );
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-write-data/${"test-db-admin-id"}`,
      { can_write_data: false },
      dbAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });

  it("should reject if target admin does not exist", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);

    const response = await TestRequest.patch(
      "/api/admin/admin-users/can-write-data/invalid-cuid-123",
      { can_write_data: true },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Admin not found");
  });

  it("should reject targeting a non-DATABASE_ADMIN account", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createViewer(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_viewer@millennia21.id" },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-write-data/${target.id}`,
      { can_write_data: true },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("only applies to Database Admin accounts");
  });

  it("should reject if can_write_data already matches the requested value", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_dbadmin@millennia21.id" },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-write-data/${target.id}`,
      { can_write_data: true },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already true");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch(
      "/api/admin/admin-users/can-write-data/whatever",
      { can_write_data: true },
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});
