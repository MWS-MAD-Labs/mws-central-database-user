import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  MasterDataTest,
  ApiClientTest,
  AuditLogTest,
} from "./test-utils";
import {
  AuditAction,
  type MasterUnit,
  type MasterJobPosition,
  type MasterJobLevel,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

const READ_SCOPE = "employees:read";

describe("POST /api/admin/api-clients", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await ApiClientTest.delete();
    await AuditLogTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();

    await prismaClient.apiScope.upsert({
      where: { name: READ_SCOPE },
      update: {},
      create: { name: READ_SCOPE },
    });
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await ApiClientTest.delete();
    await AuditLogTest.delete();
    await MasterDataTest.delete();
  });

  it("should create an API client with a plaintext token when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const response = await TestRequest.post(
      "/api/admin/api-clients",
      { name: "TEST_CLIENT_DAILY_CHECKIN", scope_names: [READ_SCOPE] },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.name).toBe("TEST_CLIENT_DAILY_CHECKIN");
    expect(body.data.scopes).toEqual([READ_SCOPE]);
    expect(body.data.is_active).toBe(true);
    expect(typeof body.data.token).toBe("string");
    expect(body.data.token).toContain(body.data.token_prefix);
    expect(body.data.token_hash).toBeUndefined();

    const auditEntry = await prismaClient.auditLog.findFirst({
      where: { action: AuditAction.API_TOKEN_CREATE },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.admin_id).toBeDefined();
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );

    const response = await TestRequest.post(
      "/api/admin/api-clients",
      { name: "TEST_CLIENT_FORBIDDEN", scope_names: [READ_SCOPE] },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });

  it("should reject a duplicate client name", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    await TestRequest.post(
      "/api/admin/api-clients",
      { name: "TEST_CLIENT_DUPLICATE", scope_names: [READ_SCOPE] },
      accessToken,
    );

    const response = await TestRequest.post(
      "/api/admin/api-clients",
      { name: "TEST_CLIENT_DUPLICATE", scope_names: [READ_SCOPE] },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already exists");
  });

  it("should reject an unknown scope name", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const response = await TestRequest.post(
      "/api/admin/api-clients",
      { name: "TEST_CLIENT_BAD_SCOPE", scope_names: ["not_a_real_scope"] },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Unknown scope");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.post("/api/admin/api-clients", {
      name: "TEST_CLIENT_NO_TOKEN",
      scope_names: [READ_SCOPE],
    });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("GET /api/admin/api-clients", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await ApiClientTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await ApiClientTest.delete();
    await MasterDataTest.delete();
  });

  it("should list API clients without exposing token secrets", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    await ApiClientTest.create({ name: "TEST_CLIENT_LIST" });

    const response = await TestRequest.get(
      "/api/admin/api-clients",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    const listed = body.data.find(
      (client: { name: string }) => client.name === "TEST_CLIENT_LIST",
    );
    expect(listed).toBeDefined();
    expect(listed.token).toBeUndefined();
    expect(listed.token_hash).toBeUndefined();
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );

    const response = await TestRequest.get(
      "/api/admin/api-clients",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });
});

describe("PATCH /api/admin/api-clients/revoke/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await ApiClientTest.delete();
    await AuditLogTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await ApiClientTest.delete();
    await AuditLogTest.delete();
    await MasterDataTest.delete();
  });

  it("should revoke an active API client when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const client = await ApiClientTest.create({ name: "TEST_CLIENT_REVOKE" });

    const response = await TestRequest.patch(
      `/api/admin/api-clients/revoke/${client.id}`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.is_active).toBe(false);

    const updated = await prismaClient.apiClient.findUnique({
      where: { id: client.id },
    });
    expect(updated?.is_active).toBe(false);

    const auditEntry = await prismaClient.auditLog.findFirst({
      where: { action: AuditAction.API_TOKEN_REVOKE },
    });
    expect(auditEntry).not.toBeNull();
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );
    const client = await ApiClientTest.create({
      name: "TEST_CLIENT_REVOKE_FORBIDDEN",
    });

    const response = await TestRequest.patch(
      `/api/admin/api-clients/revoke/${client.id}`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });

  it("should reject if the client does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const response = await TestRequest.patch(
      "/api/admin/api-clients/revoke/invalid-cuid-123",
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("not found");
  });

  it("should reject revoking an already-revoked client", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const client = await ApiClientTest.create({
      name: "TEST_CLIENT_ALREADY_REVOKED",
    });
    await prismaClient.apiClient.update({
      where: { id: client.id },
      data: { is_active: false },
    });

    const response = await TestRequest.patch(
      `/api/admin/api-clients/revoke/${client.id}`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already revoked");
  });
});
