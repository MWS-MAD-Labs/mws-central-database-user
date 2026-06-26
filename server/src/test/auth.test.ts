import { describe, afterEach, beforeEach, it, expect, spyOn } from "bun:test";
import { TestRequest, AdminUserTest } from "./test-utils";
import { GoogleAuth } from "../utils/google-auth";
import { AdminRole } from "../generated/prisma/enums";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

describe("POST /api/auth/google", () => {
  const MOCK_DOMAIN = "millennia21.id";

  beforeEach(() => {
    process.env.ALLOWED_DOMAIN = MOCK_DOMAIN;
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
      email: "hacker_pribadi@gmail.com",
      name: "Hacker",
      avatar_url: "",
    });

    const response = await TestRequest.post("/api/auth/google", {
      code: "VALID_CODE_BUT_WRONG_DOMAIN",
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only MWS accounts are allowed");

    googleSpy.mockRestore();
  });

  it("should reject login if email is MWS domain but NOT registered in database", async () => {
    const googleSpy = spyOn(GoogleAuth, "verifyCode").mockResolvedValue({
      google_id: "new-teacher-123",
      email: "guru_baru@millennia21.id",
      name: "Guru Baru",
      avatar_url: "",
    });

    const response = await TestRequest.post("/api/auth/google", {
      code: "VALID_CODE",
    });
    const body = await response.json();

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

    expect(response.status).toBe(403);
    expect(body.errors).toContain("deactivated");

    googleSpy.mockRestore();
  });
});
