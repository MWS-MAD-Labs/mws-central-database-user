import { describe, afterEach, beforeEach, it, expect, spyOn } from "bun:test";
import { TestRequest, AdminUserTest } from "./test-utils";
import { GoogleAuth } from "../utils/google-auth";
import { AdminRole } from "../generated/prisma/enums";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

describe("POST /api/auth/google", () => {
  const MOCK_DOMAIN = "millennia21.id";

  beforeEach(async () => {
    process.env.ALLOWED_DOMAIN = MOCK_DOMAIN;
    await AdminUserTest.delete();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
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

  it("should reject login if admin account is deactivated", async () => {
    await prismaClient.adminUser.create({
      data: {
        id: "inactive-admin-id",
        email: "fired_admin@millennia21.id",
        full_name: "Fired Admin",
        role: AdminRole.VIEWER,
        is_active: false,
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
    expect(body.errors).toContain("deactivated");

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
  });

  afterEach(async () => {
    await AdminUserTest.delete();
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
  });

  afterEach(async () => {
    await AdminUserTest.delete();
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
    await AdminUserTest.delete();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
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
