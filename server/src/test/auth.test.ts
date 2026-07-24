import { describe, afterEach, beforeEach, it, expect, spyOn } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  AuditLogTest,
  MasterDataTest,
  EmployeeTest,
} from "./test-utils";
import { GoogleAuth } from "../utils/google-auth";
import {
  AdminRole,
  AuditAction,
  EmployeeStatus,
  type MasterUnit,
  type MasterJobPosition,
  type MasterJobLevel,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

describe("POST /api/auth/google", () => {
  const MOCK_DOMAIN = "millennia21.id";

  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };

  beforeEach(async () => {
    process.env.ALLOWED_DOMAIN = MOCK_DOMAIN;
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  it("should successfully login and return access & refresh cookies for valid admin", async () => {
    await AdminUserTest.createSuperAdmin();

    const googleSpy = spyOn(GoogleAuth, "verifyCode").mockResolvedValue({
      google_id: "google-12345",
      email: "test_superadmin@millennia21.id",
      name: "Test Super Admin",
      avatar_url: "https://avatar.com/123",
    });

    const response = await TestRequest.post("/api/auth/google", {
      code: "VALID_AUTH_CODE",
    });

    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.email).toBe("test_superadmin@millennia21.id");
    expect(body.data.role).toBe(AdminRole.SUPER_ADMIN);

    const cookies = response.headers.get("Set-Cookie");
    expect(cookies).toBeTruthy();
    expect(cookies).toContain("access_token=");
    expect(cookies).toContain("refresh_token=");
    expect(cookies).toContain("HttpOnly");

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AuditAction.LOGIN, admin_id: admin.id },
    });
    expect(auditLog.new_values).toMatchObject({
      email: "test_superadmin@millennia21.id",
    });

    googleSpy.mockRestore();
  });

  it("should reject login if Google authorization code is invalid", async () => {
    const googleSpy = spyOn(GoogleAuth, "verifyCode").mockResolvedValue(null);

    const response = await TestRequest.post("/api/auth/google", {
      code: "INVALID_CODE",
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
    expect(body.errors).toContain("Invalid Google authorization");

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AuditAction.LOGIN_FAILED },
    });
    expect(auditLog.new_values).toMatchObject({
      reason: "invalid Google authorization code",
    });

    googleSpy.mockRestore();
  });

  it("should reject login if email domain is not allowed (Not MWS)", async () => {
    const googleSpy = spyOn(GoogleAuth, "verifyCode").mockResolvedValue({
      google_id: "hacker-999",
      email: "hacker_private@gmail.com",
      name: "Hacker",
      avatar_url: "",
    });

    const response = await TestRequest.post("/api/auth/google", {
      code: "VALID_CODE_BUT_WRONG_DOMAIN",
    });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only MWS accounts are allowed");

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AuditAction.LOGIN_FAILED },
    });
    expect(auditLog.new_values).toMatchObject({
      attempted_email: "hacker_private@gmail.com",
      reason: "domain not allowed",
    });

    googleSpy.mockRestore();
  });

  it("should reject login if email is MWS domain but NOT registered in database", async () => {
    const googleSpy = spyOn(GoogleAuth, "verifyCode").mockResolvedValue({
      google_id: "new-teacher-123",
      email: "new_teacher@millennia21.id",
      name: "New Teacher",
      avatar_url: "",
    });

    const response = await TestRequest.post("/api/auth/google", {
      code: "VALID_CODE",
    });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("not authorized to access this panel");

    googleSpy.mockRestore();
  });

  it("should reject login if admin account is deactivated and has no active employee record", async () => {
    const unitId = await AdminUserTest.resolveUnitId();

    await prismaClient.adminUser.create({
      data: {
        id: "inactive-admin-id",
        email: "fired_admin@millennia21.id",
        full_name: "Fired Admin",
        role: AdminRole.VIEWER,
        is_active: false,
        unit_id: unitId,
      },
    });

    const googleSpy = spyOn(GoogleAuth, "verifyCode").mockResolvedValue({
      google_id: "fired-123",
      email: "fired_admin@millennia21.id",
      name: "Fired Admin",
      avatar_url: "",
    });

    const response = await TestRequest.post("/api/auth/google", {
      code: "VALID_CODE",
    });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("not authorized to access this panel");

    googleSpy.mockRestore();
  });

  it("should log in with employee self-service access when admin access is deactivated but employee record is still active", async () => {
    await prismaClient.adminUser.create({
      data: {
        id: "demoted-admin-id",
        email: "demoted_admin@millennia21.id",
        full_name: "Demoted Admin",
        role: AdminRole.VIEWER,
        is_active: false,
        unit_id: masterData.unit.id,
      },
    });

    await EmployeeTest.create({
      email: "demoted_admin@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const googleSpy = spyOn(GoogleAuth, "verifyCode").mockResolvedValue({
      google_id: "demoted-123",
      email: "demoted_admin@millennia21.id",
      name: "Demoted Admin",
      avatar_url: "",
    });

    const response = await TestRequest.post("/api/auth/google", {
      code: "VALID_CODE",
    });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.type).toBe("employee");
    expect(body.data.identity.email).toBe("demoted_admin@millennia21.id");

    const cookies = response.headers.get("Set-Cookie");
    expect(cookies).toContain("access_token=");
    expect(cookies).not.toContain("refresh_token=");

    googleSpy.mockRestore();
  });

  it("should log in with employee self-service access when email is not registered as AdminUser but is an active employee", async () => {
    await EmployeeTest.create({
      email: "plain_employee@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const googleSpy = spyOn(GoogleAuth, "verifyCode").mockResolvedValue({
      google_id: "employee-123",
      email: "plain_employee@millennia21.id",
      name: "Plain Employee",
      avatar_url: "",
    });

    const response = await TestRequest.post("/api/auth/google", {
      code: "VALID_CODE",
    });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.type).toBe("employee");
    expect(body.data.employment.unit).toBe("TEST_UNIT_SHIELD");

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AuditAction.LOGIN },
    });
    expect(auditLog.admin_id).toBeNull();
    expect(auditLog.new_values).toMatchObject({
      email: "plain_employee@millennia21.id",
      type: "employee",
    });

    googleSpy.mockRestore();
  });

  it("should reject login if employee record exists but is not ACTIVE", async () => {
    await EmployeeTest.create({
      email: "resigned_employee@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      status: EmployeeStatus.RESIGNED,
    });

    const googleSpy = spyOn(GoogleAuth, "verifyCode").mockResolvedValue({
      google_id: "resigned-123",
      email: "resigned_employee@millennia21.id",
      name: "Resigned Employee",
      avatar_url: "",
    });

    const response = await TestRequest.post("/api/auth/google", {
      code: "VALID_CODE",
    });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("not authorized to access this panel");

    googleSpy.mockRestore();
  });

  it("should reject login if code is empty string", async () => {
    const response = await TestRequest.post("/api/auth/google", { code: "" });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject login if code field is missing", async () => {
    const response = await TestRequest.post("/api/auth/google", {});
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should return admin_no in correct ADM-XXXXX format in login response", async () => {
    await AdminUserTest.createSuperAdmin();

    const googleSpy = spyOn(GoogleAuth, "verifyCode").mockResolvedValue({
      google_id: "google-12345",
      email: "test_superadmin@millennia21.id",
      name: "Test Super Admin",
      avatar_url: "https://avatar.com/123",
    });

    const response = await TestRequest.post("/api/auth/google", {
      code: "VALID_AUTH_CODE",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.admin_no).toMatch(/^ADM-\d{5}$/);

    googleSpy.mockRestore();
  });
});

describe("GET /api/auth/me", () => {
  beforeEach(async () => {
    await AdminUserTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  it("should return current admin profile when authenticated", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get("/api/auth/me", accessToken);
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.email).toBe("test_superadmin@millennia21.id");
    expect(body.data.role).toBe(AdminRole.SUPER_ADMIN);
    expect(body.data.admin_no).toMatch(/^ADM-\d{5}$/);
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get("/api/auth/me");
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  it("should reject if access token is invalid", async () => {
    const response = await TestRequest.get(
      "/api/auth/me",
      "invalid.token.here",
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("POST /api/auth/refresh", () => {
  beforeEach(async () => {
    await AdminUserTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  it("should return new access_token and rotate refresh_token given a valid refresh_token", async () => {
    const { refreshToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.postWithCookies(
      "/api/auth/refresh",
      {},
      {
        refresh_token: refreshToken,
      },
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data).toBe("Token refreshed successfully");

    const cookies = response.headers.get("Set-Cookie");
    expect(cookies).toContain("access_token=");
    expect(cookies).toContain("refresh_token=");
    expect(cookies).toContain("HttpOnly");
  });

  it("should reject if refresh_token cookie is missing", async () => {
    const response = await TestRequest.post("/api/auth/refresh", {});
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toContain("Refresh token not found");
  });

  it("should reject if refresh_token is invalid", async () => {
    const response = await TestRequest.postWithCookies(
      "/api/auth/refresh",
      {},
      {
        refresh_token: "invalid-token",
      },
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toContain("Invalid or expired refresh token");
  });

  it("should reject if admin is deactivated", async () => {
    const { refreshToken } = await AdminUserTest.createSuperAdmin();

    await prismaClient.adminUser.update({
      where: { email: "test_superadmin@millennia21.id" },
      data: { is_active: false },
    });

    const response = await TestRequest.postWithCookies(
      "/api/auth/refresh",
      {},
      {
        refresh_token: refreshToken,
      },
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("deactivated");
  });

  it("should reject if refresh_token is expired", async () => {
    const { refreshToken } = await AdminUserTest.createSuperAdmin();

    await prismaClient.adminUser.update({
      where: { email: "test_superadmin@millennia21.id" },
      data: { refresh_token_exp: new Date(Date.now() - 1000) },
    });

    const response = await TestRequest.postWithCookies(
      "/api/auth/refresh",
      {},
      { refresh_token: refreshToken },
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toContain("expired");
  });

  it("should invalidate old refresh_token after rotation", async () => {
    const { refreshToken: oldToken } = await AdminUserTest.createSuperAdmin();

    const firstResponse = await TestRequest.postWithCookies(
      "/api/auth/refresh",
      {},
      { refresh_token: oldToken },
    );
    expect(firstResponse.status).toBe(200);

    const secondResponse = await TestRequest.postWithCookies(
      "/api/auth/refresh",
      {},
      { refresh_token: oldToken },
    );
    const body = await secondResponse.json();
    logger.debug(body);

    expect(secondResponse.status).toBe(401);
    expect(body.errors).toContain("Invalid or expired refresh token");
  });
});

describe("POST /api/auth/logout", () => {
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

  it("should successfully logout and clear cookies", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/auth/logout",
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data).toBe("Logged out successfully");

    const cookies = response.headers.get("Set-Cookie");
    expect(cookies).toContain("access_token=;");
    expect(cookies).toContain("refresh_token=;");
  });

  it("should clear refresh_token_hash from database after logout", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    await TestRequest.post("/api/auth/logout", {}, accessToken);

    const admin = await prismaClient.adminUser.findUnique({
      where: { email: "test_superadmin@millennia21.id" },
    });

    expect(admin?.refresh_token_hash).toBeNull();

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AuditAction.LOGOUT, admin_id: admin?.id },
    });
    expect(auditLog).toBeDefined();
    expect(admin?.refresh_token_exp).toBeNull();
  });

  it("should reject logout if no access token provided", async () => {
    const response = await TestRequest.post("/api/auth/logout", {});
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  it("should reject logout if access token is invalid", async () => {
    const response = await TestRequest.post(
      "/api/auth/logout",
      {},
      "invalid.token.here",
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("GET /api/auth/employee/me", () => {
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

  it("should return own profile when authenticated with an employee-scoped token", async () => {
    const { accessToken } = await EmployeeTest.createWithToken({
      email: "self_service@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.get(
      "/api/auth/employee/me",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.type).toBe("employee");
    expect(body.data.identity.email).toBe("self_service@millennia21.id");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get("/api/auth/employee/me");
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  it("should reject an admin-scoped token (dashboard tokens cannot reach employee-self routes)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const response = await TestRequest.get(
      "/api/auth/employee/me",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  it("should reject if the employee record was deactivated after the token was issued", async () => {
    const { accessToken, person } = await EmployeeTest.createWithToken({
      email: "soon_resigned@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    await prismaClient.employee.update({
      where: { id: person.employee!.id },
      data: { status: EmployeeStatus.RESIGNED },
    });

    const response = await TestRequest.get(
      "/api/auth/employee/me",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  it("should reject the old employee token once the employee is promoted to an active AdminUser", async () => {
    const { accessToken, person } = await EmployeeTest.createWithToken({
      email: "promoted_employee@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    // Simulate promotion: an admin creates an AdminUser row for this email
    // while the employee's old access token is still technically unexpired.
    await prismaClient.adminUser.create({
      data: {
        id: "promoted-admin-id",
        email: person.email,
        full_name: "Promoted Employee",
        role: AdminRole.VIEWER,
        is_active: true,
        unit_id: masterData.unit.id,
      },
    });

    const response = await TestRequest.get(
      "/api/auth/employee/me",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toContain("upgraded");
  });
});

describe("Employee-scoped tokens cannot reach admin dashboard routes", () => {
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

  it("should reject an employee-scoped token on GET /api/auth/me", async () => {
    const { accessToken } = await EmployeeTest.createWithToken({
      email: "boundary_me@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.get("/api/auth/me", accessToken);
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  it("should reject an employee-scoped token on GET /api/admin/employees (list)", async () => {
    const { accessToken } = await EmployeeTest.createWithToken({
      email: "boundary_list@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.get("/api/admin/employees", accessToken);
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  it("should reject an employee-scoped token on GET /api/admin/employees/:id (own record)", async () => {
    const { accessToken, person } = await EmployeeTest.createWithToken({
      email: "boundary_get_self@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.get(
      `/api/admin/employees/${person.employee!.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  it("should reject an employee-scoped token on mutating admin routes (PATCH update)", async () => {
    const { accessToken, person } = await EmployeeTest.createWithToken({
      email: "boundary_patch@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.patch(
      `/api/admin/employees/${person.employee!.id}`,
      { building: "Nope" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("POST /api/auth/employee/logout", () => {
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

  it("should successfully logout and clear the access_token cookie", async () => {
    const { accessToken } = await EmployeeTest.createWithToken({
      email: "logout_employee@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.post(
      "/api/auth/employee/logout",
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data).toBe("Logged out successfully");

    const cookies = response.headers.get("Set-Cookie");
    expect(cookies).toContain("access_token=;");
  });
});
