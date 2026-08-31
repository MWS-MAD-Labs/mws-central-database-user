import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  isProtectedSuperAdminEmail,
  assertNotProtectedAdmin,
  assertNotLastActiveSuperAdmin,
} from "../utils/protected-admin";
import { AdminRole } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { AdminUserTest, MasterDataTest, AuditLogTest } from "./test-utils";
import type { MasterUnit } from "../generated/prisma/client";

describe("isProtectedSuperAdminEmail", () => {
  const original = process.env.PROTECTED_SUPER_ADMIN_EMAILS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PROTECTED_SUPER_ADMIN_EMAILS;
    } else {
      process.env.PROTECTED_SUPER_ADMIN_EMAILS = original;
    }
  });

  it("should return false when the env var is unset", () => {
    delete process.env.PROTECTED_SUPER_ADMIN_EMAILS;
    expect(isProtectedSuperAdminEmail("anyone@millennia21.id")).toBe(false);
  });

  it("should return false when the env var is empty", () => {
    process.env.PROTECTED_SUPER_ADMIN_EMAILS = "";
    expect(isProtectedSuperAdminEmail("anyone@millennia21.id")).toBe(false);
  });

  it("should match a single configured email", () => {
    process.env.PROTECTED_SUPER_ADMIN_EMAILS = "founder@millennia21.id";
    expect(isProtectedSuperAdminEmail("founder@millennia21.id")).toBe(true);
    expect(isProtectedSuperAdminEmail("someone-else@millennia21.id")).toBe(
      false,
    );
  });

  it("should match any of several comma-separated emails, ignoring whitespace", () => {
    process.env.PROTECTED_SUPER_ADMIN_EMAILS =
      "founder@millennia21.id, cofounder@millennia21.id ,third@millennia21.id";
    expect(isProtectedSuperAdminEmail("cofounder@millennia21.id")).toBe(true);
    expect(isProtectedSuperAdminEmail("third@millennia21.id")).toBe(true);
    expect(isProtectedSuperAdminEmail("nobody@millennia21.id")).toBe(false);
  });

  it("should match case-insensitively", () => {
    process.env.PROTECTED_SUPER_ADMIN_EMAILS = "Founder@Millennia21.id";
    expect(isProtectedSuperAdminEmail("founder@millennia21.id")).toBe(true);
  });
});

describe("assertNotProtectedAdmin", () => {
  const original = process.env.PROTECTED_SUPER_ADMIN_EMAILS;
  let masterData: { unit: MasterUnit };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await MasterDataTest.delete();
    const created = await MasterDataTest.create();
    masterData = { unit: created.unit };
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await AuditLogTest.delete();
    await MasterDataTest.delete();
    if (original === undefined) {
      delete process.env.PROTECTED_SUPER_ADMIN_EMAILS;
    } else {
      process.env.PROTECTED_SUPER_ADMIN_EMAILS = original;
    }
  });

  it("should resolve without throwing when the target isn't protected", async () => {
    delete process.env.PROTECTED_SUPER_ADMIN_EMAILS;
    const { accessToken: _unused } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    void _unused;
    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });

    await expect(
      assertNotProtectedAdmin(admin, admin, "test action"),
    ).resolves.toBeUndefined();
  });

  it("should throw 403 and write an audit log when the target is protected", async () => {
    process.env.PROTECTED_SUPER_ADMIN_EMAILS = "test_superadmin@millennia21.id";
    const { accessToken: _unused } =
      await AdminUserTest.createSuperAdmin(masterData.unit.id);
    void _unused;
    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });

    await expect(
      assertNotProtectedAdmin(admin, admin, "test action", {
        ip_address: "127.0.0.1",
        user_agent: "test-agent",
      }),
    ).rejects.toThrow("protected");

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { admin_id: admin.id, action: "UNAUTHORIZED_ACCESS" },
    });
    expect(
      (auditLog.new_values as { reason?: string })?.reason,
    ).toContain("test action");
  });
});

describe("assertNotLastActiveSuperAdmin", () => {
  let masterData: { unit: MasterUnit };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await MasterDataTest.delete();
    const created = await MasterDataTest.create();
    masterData = { unit: created.unit };
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  it("should resolve without throwing for a non-Super-Admin target", async () => {
    await AdminUserTest.createViewer(masterData.unit.id);
    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_viewer@millennia21.id" },
    });

    await expect(
      assertNotLastActiveSuperAdmin(target),
    ).resolves.toBeUndefined();
  });

  it("should resolve without throwing for an already-inactive Super Admin", async () => {
    await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const target = await prismaClient.adminUser.update({
      where: { email: "test_superadmin@millennia21.id" },
      data: { is_active: false },
    });

    await expect(
      assertNotLastActiveSuperAdmin(target),
    ).resolves.toBeUndefined();
  });

  it("should resolve without throwing when another active Super Admin exists", async () => {
    await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await prismaClient.adminUser.create({
      data: {
        email: "second_superadmin@millennia21.id",
        full_name: "Second Super Admin",
        role: AdminRole.SUPER_ADMIN,
        unit_id: masterData.unit.id,
        is_active: true,
      },
    });
    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });

    await expect(
      assertNotLastActiveSuperAdmin(target),
    ).resolves.toBeUndefined();
  });

  it("should throw 400 when the target is the only active Super Admin", async () => {
    await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const target = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });

    await expect(assertNotLastActiveSuperAdmin(target)).rejects.toThrow(
      "last active Super Admin",
    );
  });
});
