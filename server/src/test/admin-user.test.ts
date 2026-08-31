import { describe, afterEach, beforeEach, it, expect, spyOn } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  MasterDataTest,
  EmployeeTest,
  AuditLogTest,
} from "./test-utils";
import {
  AdminRole,
  type MasterUnit,
  type MasterJobPosition,
  type MasterJobLevel,
  type MasterBuilding,
} from "../generated/prisma/client";
import { GoogleAuth } from "../utils/google-auth";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

describe("POST /api/admin/admin-users/promote", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
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
      buildingId: masterData.building.id,
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
      buildingId: masterData.building.id,
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
      buildingId: masterData.building.id,
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
      buildingId: masterData.building.id,
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
      buildingId: masterData.building.id,
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

    const { accessToken: employeeToken } = await EmployeeTest.createWithToken({
      email: "about_to_be_promoted@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
    });

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

    const after = await TestRequest.get("/api/auth/employee/me", employeeToken);
    const afterBody = await after.json();
    logger.debug(afterBody);

    expect(after.status).toBe(401);
    expect(afterBody.errors).toContain("upgraded");
  });

  it("should reject re-promoting an existing protected admin at any role", async () => {
    const originalProtected = process.env.PROTECTED_SUPER_ADMIN_EMAILS;
    process.env.PROTECTED_SUPER_ADMIN_EMAILS = "protected_admin@millennia21.id";

    try {
      const { accessToken } = await AdminUserTest.createSuperAdmin(
        masterData.unit.id,
      );
      await prismaClient.adminUser.create({
        data: {
          email: "protected_admin@millennia21.id",
          full_name: "Protected Admin",
          role: AdminRole.SUPER_ADMIN,
          unit_id: masterData.unit.id,
          is_active: false, // deactivated, so promoteEmployee's own is_active
          // guard doesn't short-circuit before reaching the protected check.
        },
      });

      const person = await EmployeeTest.create({
        email: "protected_admin@millennia21.id",
        unitId: masterData.unit.id,
        jobPositionId: masterData.position.id,
        jobLevelId: masterData.level.id,
        buildingId: masterData.building.id,
      });

      const response = await TestRequest.post(
        "/api/admin/admin-users/promote",
        {
          employee_id: person.employee!.id,
          role: AdminRole.SUPER_ADMIN,
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(403);
      expect(body.errors).toContain("protected");
    } finally {
      if (originalProtected === undefined) {
        delete process.env.PROTECTED_SUPER_ADMIN_EMAILS;
      } else {
        process.env.PROTECTED_SUPER_ADMIN_EMAILS = originalProtected;
      }
    }
  });

  it("should reject granting a non-Super-Admin role to a brand-new protected email", async () => {
    const originalProtected = process.env.PROTECTED_SUPER_ADMIN_EMAILS;
    process.env.PROTECTED_SUPER_ADMIN_EMAILS = "future_protected@millennia21.id";

    try {
      const { accessToken } = await AdminUserTest.createSuperAdmin(
        masterData.unit.id,
      );
      const person = await EmployeeTest.create({
        email: "future_protected@millennia21.id",
        unitId: masterData.unit.id,
        jobPositionId: masterData.position.id,
        jobLevelId: masterData.level.id,
        buildingId: masterData.building.id,
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
      expect(body.errors).toContain("reserved for a protected Super Admin");

      const created = await prismaClient.adminUser.findUnique({
        where: { email: "future_protected@millennia21.id" },
      });
      expect(created).toBeNull();
    } finally {
      if (originalProtected === undefined) {
        delete process.env.PROTECTED_SUPER_ADMIN_EMAILS;
      } else {
        process.env.PROTECTED_SUPER_ADMIN_EMAILS = originalProtected;
      }
    }
  });
});

describe("PATCH /api/admin/admin-users/demote/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
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
    expect((auditLog.old_values as { is_active?: boolean })?.is_active).toBe(
      true,
    );
    expect((auditLog.new_values as { is_active?: boolean })?.is_active).toBe(
      false,
    );
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

    const meResponse = await TestRequest.get("/api/auth/me", viewerAccessToken);
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
      buildingId: masterData.building.id,
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

  it("should reject demoting (deactivating) a protected admin", async () => {
    const originalProtected = process.env.PROTECTED_SUPER_ADMIN_EMAILS;
    process.env.PROTECTED_SUPER_ADMIN_EMAILS = "test_viewer@millennia21.id";

    try {
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

      expect(response.status).toBe(403);
      expect(body.errors).toContain("protected");

      const unchanged = await prismaClient.adminUser.findUnique({
        where: { id: target.id },
      });
      expect(unchanged?.is_active).toBe(true);
    } finally {
      if (originalProtected === undefined) {
        delete process.env.PROTECTED_SUPER_ADMIN_EMAILS;
      } else {
        process.env.PROTECTED_SUPER_ADMIN_EMAILS = originalProtected;
      }
    }
  });
});

describe("PATCH /api/admin/admin-users/change-role/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  it("should demote a DATABASE_ADMIN to VIEWER and clear both write flags", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_dbadmin@millennia21.id" },
    });
    expect(target.can_write_employee_data).toBe(true);
    expect(target.can_write_student_data).toBe(true);

    const response = await TestRequest.patch(
      `/api/admin/admin-users/change-role/${target.id}`,
      { role: "VIEWER" },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.role).toBe("VIEWER");
    expect(body.data.can_write_employee_data).toBe(false);
    expect(body.data.can_write_student_data).toBe(false);

    const updated = await prismaClient.adminUser.findUnique({
      where: { id: target.id },
    });
    expect(updated?.role).toBe("VIEWER");
    expect(updated?.can_write_employee_data).toBe(false);
    expect(updated?.can_write_student_data).toBe(false);

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: target.id, action: "ROLE_CHANGE" },
    });
    expect((auditLog.old_values as { role?: string })?.role).toBe(
      "DATABASE_ADMIN",
    );
    expect((auditLog.new_values as { role?: string })?.role).toBe("VIEWER");
  });

  it("should promote a VIEWER to DATABASE_ADMIN without touching an employee record", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createViewer(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_viewer@millennia21.id" },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/change-role/${target.id}`,
      { role: "DATABASE_ADMIN" },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.role).toBe("DATABASE_ADMIN");
    // No write flags granted implicitly - Super Admin still has to enable
    // them separately, same as a fresh promoteEmployee call would leave them.
    expect(body.data.can_write_employee_data).toBe(false);
    expect(body.data.can_write_student_data).toBe(false);
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin(masterData.unit.id);
    await AdminUserTest.createViewer(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_viewer@millennia21.id" },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/change-role/${target.id}`,
      { role: "DATABASE_ADMIN" },
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
      "/api/admin/admin-users/change-role/invalid-cuid-123",
      { role: "VIEWER" },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Admin not found");
  });

  it("should reject changing the role of a deactivated admin", async () => {
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
      `/api/admin/admin-users/change-role/${target.id}`,
      { role: "DATABASE_ADMIN" },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("reactivate before changing role");
  });

  it("should reject changing to the same role the admin already has", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createViewer(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_viewer@millennia21.id" },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/change-role/${target.id}`,
      { role: "VIEWER" },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already has the VIEWER role");
  });

  it("should reject SUPER_ADMIN as a target role", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createViewer(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_viewer@millennia21.id" },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/change-role/${target.id}`,
      { role: "SUPER_ADMIN" },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain(
      "Role must be either DATABASE_ADMIN or VIEWER",
    );
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch(
      "/api/admin/admin-users/change-role/whatever",
      { role: "VIEWER" },
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  it("should reject changing the role of a protected admin", async () => {
    const originalProtected = process.env.PROTECTED_SUPER_ADMIN_EMAILS;
    process.env.PROTECTED_SUPER_ADMIN_EMAILS = "test_viewer@millennia21.id";

    try {
      const { accessToken: superAdminToken } =
        await AdminUserTest.createSuperAdmin(masterData.unit.id);
      await AdminUserTest.createViewer(masterData.unit.id);

      const target = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_viewer@millennia21.id" },
      });

      const response = await TestRequest.patch(
        `/api/admin/admin-users/change-role/${target.id}`,
        { role: "DATABASE_ADMIN" },
        superAdminToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(403);
      expect(body.errors).toContain("protected");

      const unchanged = await prismaClient.adminUser.findUnique({
        where: { id: target.id },
      });
      expect(unchanged?.role).toBe("VIEWER");
    } finally {
      if (originalProtected === undefined) {
        delete process.env.PROTECTED_SUPER_ADMIN_EMAILS;
      } else {
        process.env.PROTECTED_SUPER_ADMIN_EMAILS = originalProtected;
      }
    }
  });
});

describe("PATCH /api/admin/admin-users/demote-super-admin/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  // Second Super Admin, distinct from AdminUserTest.createSuperAdmin()'s
  // fixed "test_superadmin@millennia21.id" - a demote-super-admin target
  // that isn't the acting admin itself.
  async function createSecondSuperAdmin(
    overrides?: Partial<{ email: string; is_active: boolean }>,
  ) {
    return prismaClient.adminUser.create({
      data: {
        email: overrides?.email ?? "test_superadmin2@millennia21.id",
        full_name: "Test Super Admin Two",
        role: AdminRole.SUPER_ADMIN,
        unit_id: masterData.unit.id,
        is_active: overrides?.is_active ?? true,
      },
    });
  }

  it("should demote a Super Admin to DATABASE_ADMIN and clear both write flags", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const target = await createSecondSuperAdmin();

    const response = await TestRequest.patch(
      `/api/admin/admin-users/demote-super-admin/${target.id}`,
      { role: "DATABASE_ADMIN" },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.role).toBe("DATABASE_ADMIN");
    expect(body.data.can_write_employee_data).toBe(false);
    expect(body.data.can_write_student_data).toBe(false);

    const updated = await prismaClient.adminUser.findUnique({
      where: { id: target.id },
    });
    expect(updated?.role).toBe("DATABASE_ADMIN");

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: target.id, action: "ROLE_CHANGE" },
    });
    expect((auditLog.old_values as { role?: string })?.role).toBe(
      "SUPER_ADMIN",
    );
    expect((auditLog.new_values as { role?: string })?.role).toBe(
      "DATABASE_ADMIN",
    );
  });

  it("should demote a Super Admin to VIEWER", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const target = await createSecondSuperAdmin();

    const response = await TestRequest.patch(
      `/api/admin/admin-users/demote-super-admin/${target.id}`,
      { role: "VIEWER" },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.role).toBe("VIEWER");
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin(masterData.unit.id);
    const target = await createSecondSuperAdmin();

    const response = await TestRequest.patch(
      `/api/admin/admin-users/demote-super-admin/${target.id}`,
      { role: "VIEWER" },
      dbAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });

  it("should reject demoting your own Super Admin account", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const requester = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/demote-super-admin/${requester.id}`,
      { role: "VIEWER" },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("cannot demote your own");
  });

  it("should reject if target admin does not exist", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);

    const response = await TestRequest.patch(
      "/api/admin/admin-users/demote-super-admin/invalid-cuid-123",
      { role: "VIEWER" },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Admin not found");
  });

  it("should reject if target is not a Super Admin", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createViewer(masterData.unit.id);
    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_viewer@millennia21.id" },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/demote-super-admin/${target.id}`,
      { role: "DATABASE_ADMIN" },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("not a Super Admin");
  });

  it("should reject if target Super Admin is deactivated", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const target = await createSecondSuperAdmin({ is_active: false });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/demote-super-admin/${target.id}`,
      { role: "VIEWER" },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("reactivate before changing role");
  });

  it("should reject a role other than DATABASE_ADMIN or VIEWER", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const target = await createSecondSuperAdmin();

    const response = await TestRequest.patch(
      `/api/admin/admin-users/demote-super-admin/${target.id}`,
      { role: "SUPER_ADMIN" },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain(
      "Role must be either DATABASE_ADMIN or VIEWER",
    );
  });

  it("should reject demoting a protected Super Admin", async () => {
    const originalProtected = process.env.PROTECTED_SUPER_ADMIN_EMAILS;
    process.env.PROTECTED_SUPER_ADMIN_EMAILS =
      "test_superadmin2@millennia21.id";

    try {
      const { accessToken: superAdminToken } =
        await AdminUserTest.createSuperAdmin(masterData.unit.id);
      const target = await createSecondSuperAdmin();

      const response = await TestRequest.patch(
        `/api/admin/admin-users/demote-super-admin/${target.id}`,
        { role: "VIEWER" },
        superAdminToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(403);
      expect(body.errors).toContain("protected");

      const unchanged = await prismaClient.adminUser.findUnique({
        where: { id: target.id },
      });
      expect(unchanged?.role).toBe("SUPER_ADMIN");
    } finally {
      if (originalProtected === undefined) {
        delete process.env.PROTECTED_SUPER_ADMIN_EMAILS;
      } else {
        process.env.PROTECTED_SUPER_ADMIN_EMAILS = originalProtected;
      }
    }
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch(
      "/api/admin/admin-users/demote-super-admin/whatever",
      { role: "VIEWER" },
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("PATCH /api/admin/admin-users/can-view-sensitive-data/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  it("should flip can_view_sensitive_data when requested by SUPER_ADMIN on a DATABASE_ADMIN", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_dbadmin@millennia21.id" },
    });

    const targetValue = !target.can_view_sensitive_data;

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-view-sensitive-data/${target.id}`,
      { can_view_sensitive_data: targetValue },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.can_view_sensitive_data).toBe(targetValue);

    const updated = await prismaClient.adminUser.findUnique({
      where: { id: target.id },
    });
    expect(updated?.can_view_sensitive_data).toBe(targetValue);

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: target.id, action: "PERMISSION_CHANGE" },
    });
    expect(
      (auditLog.old_values as { can_view_sensitive_data?: boolean })
        ?.can_view_sensitive_data,
    ).toBe(target.can_view_sensitive_data);
    expect(
      (auditLog.new_values as { can_view_sensitive_data?: boolean })
        ?.can_view_sensitive_data,
    ).toBe(targetValue);
  });

  it("should successfully change can_view_sensitive_data for a VIEWER account", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createViewer(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_viewer@millennia21.id" },
    });

    const targetValue = !target.can_view_sensitive_data;

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-view-sensitive-data/${target.id}`,
      { can_view_sensitive_data: targetValue },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.can_view_sensitive_data).toBe(targetValue);
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-view-sensitive-data/${"test-db-admin-id"}`,
      { can_view_sensitive_data: true },
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
      "/api/admin/admin-users/can-view-sensitive-data/invalid-cuid-123",
      { can_view_sensitive_data: true },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Admin not found");
  });

  it("should reject if can_view_sensitive_data already matches the requested value", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_dbadmin@millennia21.id" },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-view-sensitive-data/${target.id}`,
      { can_view_sensitive_data: target.can_view_sensitive_data },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch(
      "/api/admin/admin-users/can-view-sensitive-data/whatever",
      { can_view_sensitive_data: true },
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  // Representative of all 6 targetAdminId-based setters (can-view-*,
  // can-write-*, grant-after-hours) - they all wire the exact same
  // assertNotProtectedAdmin() call the same way, see admin-user-service.ts.
  it("should reject changing a protected admin's permission flags", async () => {
    const originalProtected = process.env.PROTECTED_SUPER_ADMIN_EMAILS;
    process.env.PROTECTED_SUPER_ADMIN_EMAILS = "test_dbadmin@millennia21.id";

    try {
      const { accessToken: superAdminToken } =
        await AdminUserTest.createSuperAdmin(masterData.unit.id);
      await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

      const target = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_dbadmin@millennia21.id" },
      });

      const response = await TestRequest.patch(
        `/api/admin/admin-users/can-view-sensitive-data/${target.id}`,
        { can_view_sensitive_data: true },
        superAdminToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(403);
      expect(body.errors).toContain("protected");
    } finally {
      if (originalProtected === undefined) {
        delete process.env.PROTECTED_SUPER_ADMIN_EMAILS;
      } else {
        process.env.PROTECTED_SUPER_ADMIN_EMAILS = originalProtected;
      }
    }
  });
});

describe("PATCH /api/admin/admin-users/can-view-all-units/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  it("should flip can_view_all_units when requested by SUPER_ADMIN on a DATABASE_ADMIN", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_dbadmin@millennia21.id" },
    });

    const targetValue = !target.can_view_all_units;

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-view-all-units/${target.id}`,
      { can_view_all_units: targetValue },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.can_view_all_units).toBe(targetValue);

    const updated = await prismaClient.adminUser.findUnique({
      where: { id: target.id },
    });
    expect(updated?.can_view_all_units).toBe(targetValue);

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: target.id, action: "PERMISSION_CHANGE" },
    });
    expect(
      (auditLog.old_values as { can_view_all_units?: boolean })
        ?.can_view_all_units,
    ).toBe(target.can_view_all_units);
    expect(
      (auditLog.new_values as { can_view_all_units?: boolean })
        ?.can_view_all_units,
    ).toBe(targetValue);
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-view-all-units/${"test-db-admin-id"}`,
      { can_view_all_units: true },
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
      "/api/admin/admin-users/can-view-all-units/invalid-cuid-123",
      { can_view_all_units: true },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Admin not found");
  });

  it("should reject if can_view_all_units already matches the requested value", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_dbadmin@millennia21.id" },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-view-all-units/${target.id}`,
      { can_view_all_units: target.can_view_all_units },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch(
      "/api/admin/admin-users/can-view-all-units/whatever",
      { can_view_all_units: true },
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("PATCH /api/admin/admin-users/can-view-employee-pii/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  it("should flip can_view_employee_pii when requested by SUPER_ADMIN on a DATABASE_ADMIN", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_dbadmin@millennia21.id" },
    });

    const targetValue = !target.can_view_employee_pii;

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-view-employee-pii/${target.id}`,
      { can_view_employee_pii: targetValue },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.can_view_employee_pii).toBe(targetValue);

    const updated = await prismaClient.adminUser.findUnique({
      where: { id: target.id },
    });
    expect(updated?.can_view_employee_pii).toBe(targetValue);

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: target.id, action: "PERMISSION_CHANGE" },
    });
    expect(
      (auditLog.old_values as { can_view_employee_pii?: boolean })
        ?.can_view_employee_pii,
    ).toBe(target.can_view_employee_pii);
    expect(
      (auditLog.new_values as { can_view_employee_pii?: boolean })
        ?.can_view_employee_pii,
    ).toBe(targetValue);
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-view-employee-pii/${"test-db-admin-id"}`,
      { can_view_employee_pii: true },
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
      "/api/admin/admin-users/can-view-employee-pii/invalid-cuid-123",
      { can_view_employee_pii: true },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Admin not found");
  });

  it("should reject if can_view_employee_pii already matches the requested value", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_dbadmin@millennia21.id" },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-view-employee-pii/${target.id}`,
      { can_view_employee_pii: target.can_view_employee_pii },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch(
      "/api/admin/admin-users/can-view-employee-pii/whatever",
      { can_view_employee_pii: true },
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("PATCH /api/admin/admin-users/can-write-employee-data/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  it("should flip can_write_employee_data when requested by SUPER_ADMIN on a DATABASE_ADMIN", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_dbadmin@millennia21.id" },
    });

    const targetValue = !target.can_write_employee_data;

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-write-employee-data/${target.id}`,
      { can_write_employee_data: targetValue },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.can_write_employee_data).toBe(targetValue);

    const updated = await prismaClient.adminUser.findUnique({
      where: { id: target.id },
    });
    expect(updated?.can_write_employee_data).toBe(targetValue);

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: target.id, action: "PERMISSION_CHANGE" },
    });
    expect(
      (auditLog.old_values as { can_write_employee_data?: boolean })
        ?.can_write_employee_data,
    ).toBe(target.can_write_employee_data);
    expect(
      (auditLog.new_values as { can_write_employee_data?: boolean })
        ?.can_write_employee_data,
    ).toBe(targetValue);
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-write-employee-data/${"test-db-admin-id"}`,
      { can_write_employee_data: true },
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
      "/api/admin/admin-users/can-write-employee-data/invalid-cuid-123",
      { can_write_employee_data: true },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Admin not found");
  });

  it("should reject if can_write_employee_data already matches the requested value", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_dbadmin@millennia21.id" },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-write-employee-data/${target.id}`,
      { can_write_employee_data: target.can_write_employee_data },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch(
      "/api/admin/admin-users/can-write-employee-data/whatever",
      { can_write_employee_data: true },
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("PATCH /api/admin/admin-users/can-write-student-data/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  it("should flip can_write_student_data when requested by SUPER_ADMIN on a DATABASE_ADMIN", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_dbadmin@millennia21.id" },
    });

    const targetValue = !target.can_write_student_data;

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-write-student-data/${target.id}`,
      { can_write_student_data: targetValue },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.can_write_student_data).toBe(targetValue);

    const updated = await prismaClient.adminUser.findUnique({
      where: { id: target.id },
    });
    expect(updated?.can_write_student_data).toBe(targetValue);

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: target.id, action: "PERMISSION_CHANGE" },
    });
    expect(
      (auditLog.old_values as { can_write_student_data?: boolean })
        ?.can_write_student_data,
    ).toBe(target.can_write_student_data);
    expect(
      (auditLog.new_values as { can_write_student_data?: boolean })
        ?.can_write_student_data,
    ).toBe(targetValue);
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-write-student-data/${"test-db-admin-id"}`,
      { can_write_student_data: true },
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
      "/api/admin/admin-users/can-write-student-data/invalid-cuid-123",
      { can_write_student_data: true },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Admin not found");
  });

  it("should reject if can_write_student_data already matches the requested value", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_dbadmin@millennia21.id" },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/can-write-student-data/${target.id}`,
      { can_write_student_data: target.can_write_student_data },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch(
      "/api/admin/admin-users/can-write-student-data/whatever",
      { can_write_student_data: true },
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
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
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

  it("should reject if the target has neither write flag enabled", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await AdminUserTest.createDatabaseAdmin(masterData.unit.id, {
      canWriteEmployeeData: false,
      canWriteStudentData: false,
    });

    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_dbadmin@millennia21.id" },
    });

    const response = await TestRequest.patch(
      `/api/admin/admin-users/grant-after-hours/${target.id}`,
      { minutes: 60 },
      superAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("doesn't have any write access enabled");
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
    await AuditLogTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await MasterDataTest.delete();
  });

  it("should list and paginate", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await AdminUserTest.createDatabaseAdmin();
    await AdminUserTest.createViewer();

    const response = await TestRequest.get(
      // search=Test scopes this to the 3 admins this test just created -
      // without it, any other admin already sitting in the same database
      // (e.g. a real dev account outside the "Test ..." naming convention)
      // would inflate the count and break this assertion.
      "/api/admin/admin-users?size=2&page=1&search=Test",
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
      // search=Test scopes out any other inactive admin already sitting in
      // the database (e.g. a real dev account) that would otherwise also
      // match is_active=false and inflate this result.
      "/api/admin/admin-users?is_active=false&search=Test",
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
      // search=Test scopes this to just the 3 admins this test created, so
      // sorting isn't thrown off by any other admin already in the database.
      "/api/admin/admin-users?sort_by=full_name&sort_order=asc&search=Test",
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

  it("should flag is_protected only for a configured protected email", async () => {
    const originalProtected = process.env.PROTECTED_SUPER_ADMIN_EMAILS;
    process.env.PROTECTED_SUPER_ADMIN_EMAILS =
      "test_superadmin@millennia21.id";

    try {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await AdminUserTest.createViewer();

      const response = await TestRequest.get(
        "/api/admin/admin-users?search=Test",
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      const superAdminRow = body.data.find(
        (a: { email: string }) => a.email === "test_superadmin@millennia21.id",
      );
      const viewerRow = body.data.find(
        (a: { email: string }) => a.email === "test_viewer@millennia21.id",
      );
      expect(superAdminRow.is_protected).toBe(true);
      expect(viewerRow.is_protected).toBe(false);
    } finally {
      if (originalProtected === undefined) {
        delete process.env.PROTECTED_SUPER_ADMIN_EMAILS;
      } else {
        process.env.PROTECTED_SUPER_ADMIN_EMAILS = originalProtected;
      }
    }
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
    await AuditLogTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
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
    const response = await TestRequest.get("/api/admin/admin-users/whatever");
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});
