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

  it("should reject (400) promoting to VIEWER with can_write_data: true", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const person = await EmployeeTest.create({
      email: "viewer_cant_write@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.post(
      "/api/admin/admin-users/promote",
      {
        employee_id: person.employee!.id,
        role: AdminRole.VIEWER,
        can_write_data: true,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain(
      "can_write_data only applies to Database Admin accounts",
    );

    const created = await prismaClient.adminUser.findUnique({
      where: { email: "viewer_cant_write@millennia21.id" },
    });
    expect(created).toBeNull();
  });

  it("should reject (400) promoting to SUPER_ADMIN with can_write_data: true", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const person = await EmployeeTest.create({
      email: "superadmin_cant_write_flag@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.post(
      "/api/admin/admin-users/promote",
      {
        employee_id: person.employee!.id,
        role: AdminRole.SUPER_ADMIN,
        can_write_data: true,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain(
      "can_write_data only applies to Database Admin accounts",
    );
  });

  it("should allow promoting to DATABASE_ADMIN with can_write_data: true", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const person = await EmployeeTest.create({
      email: "dbadmin_can_write@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.post(
      "/api/admin/admin-users/promote",
      {
        employee_id: person.employee!.id,
        role: AdminRole.DATABASE_ADMIN,
        can_write_data: true,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.role).toBe(AdminRole.DATABASE_ADMIN);
    expect(body.data.can_write_data).toBe(true);
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

describe("PATCH /api/admin/admin-users/grant-after-hours/:id", () => {
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

  it("should grant a time-boxed after-hours write exception when requested by SUPER_ADMIN", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_dbadmin@millennia21.id" },
    });
    const before = Date.now();

    const response = await TestRequest.patch(
      `/api/admin/admin-users/grant-after-hours/${target.id}`,
      { minutes: 120 },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    const grantedUntil = new Date(body.data.after_hours_write_until).getTime();
    expect(grantedUntil).toBeGreaterThanOrEqual(before + 119 * 60_000);
    expect(grantedUntil).toBeLessThanOrEqual(before + 121 * 60_000);

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: target.id, action: "PERMISSION_CHANGE" },
      orderBy: { created_at: "desc" },
    });
    expect(
      (auditLog.new_values as { granted_minutes?: number })?.granted_minutes,
    ).toBe(120);
  });

  it("should overwrite (not extend) a still-active grant with a fresh window from now", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_dbadmin@millennia21.id" },
    });
    // Only 5 minutes left on the existing grant.
    await prismaClient.adminUser.update({
      where: { id: target.id },
      data: { after_hours_write_until: new Date(Date.now() + 5 * 60_000) },
    });

    const before = Date.now();
    const response = await TestRequest.patch(
      `/api/admin/admin-users/grant-after-hours/${target.id}`,
      { minutes: 60 },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    const grantedUntil = new Date(body.data.after_hours_write_until).getTime();
    // Computed from *now*, not from the old expiry (which would land ~65min out).
    expect(grantedUntil).toBeGreaterThanOrEqual(before + 59 * 60_000);
    expect(grantedUntil).toBeLessThanOrEqual(before + 61 * 60_000);
  });

  it("should overwrite an already-expired grant with a fresh window from now", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_dbadmin@millennia21.id" },
    });
    await prismaClient.adminUser.update({
      where: { id: target.id },
      data: { after_hours_write_until: new Date(Date.now() - 2 * 60 * 60_000) },
    });

    const before = Date.now();
    const response = await TestRequest.patch(
      `/api/admin/admin-users/grant-after-hours/${target.id}`,
      { minutes: 30 },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    const grantedUntil = new Date(body.data.after_hours_write_until).getTime();
    expect(grantedUntil).toBeGreaterThanOrEqual(before + 29 * 60_000);
    expect(grantedUntil).toBeLessThanOrEqual(before + 31 * 60_000);
  });

  it("should reject a grant longer than 4 hours (240 minutes)", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_dbadmin@millennia21.id" },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/grant-after-hours/${target.id}`,
      { minutes: 241 },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("cannot exceed 240");
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const response = await TestRequest.patch(
      `/api/admin/admin-users/grant-after-hours/${"test-db-admin-id"}`,
      { minutes: 60 },
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
      "/api/admin/admin-users/grant-after-hours/invalid-cuid-123",
      { minutes: 60 },
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
      `/api/admin/admin-users/grant-after-hours/${target.id}`,
      { minutes: 60 },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("only apply to Database Admin accounts");
  });

  it("should reject if the target doesn't have can_write_data enabled", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_dbadmin@millennia21.id" },
    });
    await prismaClient.adminUser.update({
      where: { id: target.id },
      data: { can_write_data: false },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/grant-after-hours/${target.id}`,
      { minutes: 60 },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("can_write_data");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch(
      "/api/admin/admin-users/grant-after-hours/whatever",
      { minutes: 60 },
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("GET /api/admin/admin-users", () => {
  beforeEach(async () => {
    await AdminUserTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  it("should list and paginate", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await AdminUserTest.createDatabaseAdmin();
    await AdminUserTest.createViewer();

    const response = await TestRequest.get(
      "/api/admin/admin-users?size=2&page=1",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(2);
    expect(body.paging.total_item).toBe(3);
    expect(body.paging.total_page).toBe(2);
  });

  it("should search by full_name", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await AdminUserTest.createViewer();

    const response = await TestRequest.get(
      "/api/admin/admin-users?search=Viewer",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].full_name).toBe("Test Viewer");
  });

  it("should search by email", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/admin-users?search=superadmin",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].email).toBe("test_superadmin@millennia21.id");
  });

  it("should filter by role", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await AdminUserTest.createViewer();

    const response = await TestRequest.get(
      "/api/admin/admin-users?role=VIEWER",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].role).toBe("VIEWER");
  });

  it("should filter by is_active", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await AdminUserTest.createViewer();

    await prismaClient.adminUser.update({
      where: { email: "test_viewer@millennia21.id" },
      data: { is_active: false },
    });

    const response = await TestRequest.get(
      "/api/admin/admin-users?is_active=false",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].email).toBe("test_viewer@millennia21.id");
  });

  it("should sort by full_name ascending when requested", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await AdminUserTest.createDatabaseAdmin();
    await AdminUserTest.createViewer();

    const response = await TestRequest.get(
      "/api/admin/admin-users?sort_by=full_name&sort_order=asc",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.map((a: { full_name: string }) => a.full_name)).toEqual([
      "Test Database Admin",
      "Test Super Admin",
      "Test Viewer",
    ]);
  });

  it("should be readable by VIEWER", async () => {
    const { accessToken } = await AdminUserTest.createViewer();

    const response = await TestRequest.get(
      "/api/admin/admin-users",
      accessToken,
    );

    expect(response.status).toBe(200);
  });

  it("should reject an invalid sort_by field", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/admin-users?sort_by=not_a_real_field",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject an invalid role filter", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/admin-users?role=NOT_A_ROLE",
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
      "/api/admin/admin-users?page=abc",
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
      "/api/admin/admin-users?size=101",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get("/api/admin/admin-users");
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("GET /api/admin/admin-users/:id", () => {
  beforeEach(async () => {
    await AdminUserTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  it("should be readable by SUPER_ADMIN, DATABASE_ADMIN, and VIEWER alike", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin();
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin();
    const { accessToken: viewerToken } = await AdminUserTest.createViewer();

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });

    for (const token of [superAdminToken, dbAdminToken, viewerToken]) {
      const response = await TestRequest.get(
        `/api/admin/admin-users/${target.id}`,
        token,
      );
      expect(response.status).toBe(200);
    }
  });

  it("should return admin detail", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await AdminUserTest.createViewer();
    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_viewer@millennia21.id" },
    });

    const response = await TestRequest.get(
      `/api/admin/admin-users/${target.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.id).toBe(target.id);
    expect(body.data.email).toBe("test_viewer@millennia21.id");
    expect(body.data.role).toBe("VIEWER");
  });

  it("should reject if the admin does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/admin-users/invalid-cuid-123",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toBeDefined();
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get(
      "/api/admin/admin-users/whatever",
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});
