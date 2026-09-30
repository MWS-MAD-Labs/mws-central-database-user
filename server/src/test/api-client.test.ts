import { describe, afterEach, beforeEach, it, expect, spyOn } from "bun:test";
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
import { AuditService } from "../service/audit-service";
import { syncApiScopes } from "../lib/sync-api-scopes";
import { API_SCOPES } from "../constants/api-scopes";

const READ_SCOPE = "employees:read";
const SECOND_SCOPE = "students:read";

describe("application integration profiles", () => {
  let masterData: Awaited<ReturnType<typeof MasterDataTest.create>>;

  beforeEach(async () => {
    await AdminUserTest.delete();
    await ApiClientTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
    await syncApiScopes();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await ApiClientTest.delete();
    await MasterDataTest.delete();
  });

  it("lists canonical system profiles with exact scope bundles", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const response = await TestRequest.get(
      "/api/admin/application-integration-profiles",
      accessToken,
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    const hub = body.data.find((profile: { code: string }) => profile.code === "hub");
    expect(hub.is_system).toBe(true);
    expect(hub.scopes.map((scope: { name: string }) => scope.name).sort()).toEqual([
      "application_entitlements:read",
      "employees:read",
      "students:read",
    ]);
    expect(body.environment).toBeDefined();
  });

  it("creates a managed client with server-derived environment and profile scopes", async () => {
    const previous = process.env.DEPLOYMENT_ENVIRONMENT;
    process.env.DEPLOYMENT_ENVIRONMENT = "test";
    try {
      const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
      const response = await TestRequest.post(
        "/api/admin/api-clients",
        {
          profile_code: "hub",
          purpose: "backend",
          name: "TEST_MANAGED_HUB",
          description: "Managed test",
        },
        accessToken,
      );
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.data.profile.code).toBe("hub");
      expect(body.data.environment).toBe("TEST");
      expect(body.data.purpose).toBe("backend");
      expect(body.data.effective_scopes.sort()).toEqual([
        "application_entitlements:read",
        "employees:read",
        "students:read",
      ]);
      expect(body.data.credentials).toHaveLength(1);
      expect(body.data.credentials[0].status).toBe("ACTIVE");
      expect(body.data.token_hash).toBeUndefined();

      const authenticated = await TestRequest.get(
        "/api/internal/employees/lookup?email=none@millennia21.id",
        undefined,
        { Authorization: `Bearer ${body.data.token}` },
      );
      expect(authenticated.status).toBe(404);
    } finally {
      process.env.DEPLOYMENT_ENVIRONMENT = previous;
    }
  });

  it("returns 409 for duplicate profile/environment/purpose", async () => {
    const previous = process.env.DEPLOYMENT_ENVIRONMENT;
    process.env.DEPLOYMENT_ENVIRONMENT = "test";
    try {
      const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
      await TestRequest.post(
        "/api/admin/api-clients",
        { profile_code: "exima", purpose: "duplicate-test", name: "TEST_EXIMA_A" },
        accessToken,
      );
      const response = await TestRequest.post(
        "/api/admin/api-clients",
        { profile_code: "exima", purpose: "duplicate-test", name: "TEST_OTHER_NAME" },
        accessToken,
      );
      expect(response.status).toBe(409);
    } finally {
      process.env.DEPLOYMENT_ENVIRONMENT = previous;
    }
  });

  it("rejects scope edits for managed clients", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const { client } = await ApiClientTest.createManagedWithToken();
    const response = await TestRequest.patch(
      `/api/admin/api-clients/${client.id}/scopes`,
      { scope_names: [READ_SCOPE] },
      accessToken,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).errors).toContain("controlled by their profile");
  });

  it("rotates managed credentials with grace and supports emergency revocation", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const { client, token: oldToken } = await ApiClientTest.createManagedWithToken();
    const rotate = await TestRequest.patch(
      `/api/admin/api-clients/rotate/${client.id}`,
      {},
      accessToken,
    );
    const rotated = await rotate.json();
    expect(rotate.status).toBe(200);
    expect(rotated.data.credentials.map((item: { status: string }) => item.status)).toContain("RETIRING");
    expect((await TestRequest.get(
      "/api/internal/employees/lookup?email=none@millennia21.id",
      undefined,
      { Authorization: `Bearer ${oldToken}` },
    )).status).toBe(404);

    const emergency = await TestRequest.patch(
      `/api/admin/api-clients/rotate/${client.id}`,
      { immediate: true },
      accessToken,
    );
    expect(emergency.status).toBe(200);
    expect((await TestRequest.get(
      "/api/internal/employees/lookup?email=none@millennia21.id",
      undefined,
      { Authorization: `Bearer ${rotated.data.token}` },
    )).status).toBe(401);
    expect((await TestRequest.get(
      "/api/internal/employees/lookup?email=none@millennia21.id",
      undefined,
      { Authorization: `Bearer ${oldToken}` },
    )).status).toBe(401);
  });

  it("preserves disabled profiles and scopes across synchronization", async () => {
    const profile = await prismaClient.applicationIntegrationProfile.findUniqueOrThrow({
      where: { code: "hub" },
    });
    await prismaClient.applicationIntegrationProfile.update({
      where: { id: profile.id },
      data: { status: "DISABLED" },
    });
    await prismaClient.apiScope.update({
      where: { name: READ_SCOPE },
      data: { is_active: false, deprecated_at: new Date() },
    });

    await syncApiScopes();

    expect((await prismaClient.applicationIntegrationProfile.findUniqueOrThrow({
      where: { id: profile.id },
    })).status).toBe("DISABLED");
    const scope = await prismaClient.apiScope.findUniqueOrThrow({ where: { name: READ_SCOPE } });
    expect(scope.is_active).toBe(false);
    expect(scope.deprecated_at).not.toBeNull();

    await prismaClient.applicationIntegrationProfile.update({
      where: { id: profile.id },
      data: { status: "ACTIVE" },
    });
    await prismaClient.apiScope.update({
      where: { name: READ_SCOPE },
      data: { is_active: true, deprecated_at: null },
    });
  });

  it("does not authorize a disabled scope", async () => {
    const { token } = await ApiClientTest.createManagedWithToken({ profileCode: "exima" });
    await prismaClient.apiScope.update({
      where: { name: READ_SCOPE },
      data: { is_active: false },
    });
    const response = await TestRequest.get(
      "/api/internal/employees/lookup?email=none@millennia21.id",
      undefined,
      { Authorization: `Bearer ${token}` },
    );
    expect(response.status).toBe(403);
    await prismaClient.apiScope.update({ where: { name: READ_SCOPE }, data: { is_active: true } });
  });

  it("allows a replacement managed client after the prior client is revoked", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const first = await TestRequest.post(
      "/api/admin/api-clients",
      { profile_code: "exima", purpose: "replaceable", name: "TEST_REPLACEABLE_1" },
      accessToken,
    );
    const firstBody = await first.json();
    await TestRequest.patch(`/api/admin/api-clients/revoke/${firstBody.data.id}`, {}, accessToken);
    const replacement = await TestRequest.post(
      "/api/admin/api-clients",
      { profile_code: "exima", purpose: "replaceable", name: "TEST_REPLACEABLE_2" },
      accessToken,
    );
    expect(replacement.status).toBe(200);
  });

  it("revokes one credential without exposing its hash", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const { client, token } = await ApiClientTest.createManagedWithToken();
    const credential = await prismaClient.apiClientCredential.findFirstOrThrow({
      where: { client_id: client.id },
    });
    const response = await TestRequest.patch(
      `/api/admin/api-clients/${client.id}/credentials/${credential.id}/revoke`,
      {},
      accessToken,
    );
    expect(response.status).toBe(200);
    expect((await TestRequest.get(
      "/api/internal/employees/lookup?email=none@millennia21.id",
      undefined,
      { Authorization: `Bearer ${token}` },
    )).status).toBe(401);
  });
});

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

  it("should roll back client creation entirely if the audit log write fails", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const auditSpy = spyOn(AuditService, "record").mockRejectedValue(
      new Error("Simulated audit failure"),
    );

    try {
      const response = await TestRequest.post(
        "/api/admin/api-clients",
        { name: "TEST_CLIENT_AUDIT_ROLLBACK", scope_names: [READ_SCOPE] },
        accessToken,
      );

      expect(response.status).toBe(500);

      // The failed audit must roll back the client write.
      const client = await prismaClient.apiClient.findUnique({
        where: { name: "TEST_CLIENT_AUDIT_ROLLBACK" },
      });
      expect(client).toBeNull();
    } finally {
      auditSpy.mockRestore();
    }
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

describe("GET /api/admin/api-clients/internal-endpoints", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  it("should list the internal API endpoint manifest for SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const response = await TestRequest.get(
      "/api/admin/api-clients/internal-endpoints",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    const entry = body.data.find(
      (doc: { path: string }) => doc.path === "/api/internal/students",
    );
    expect(entry).toBeDefined();
    expect(entry.method).toBe("GET");
    expect(entry.scope).toBe("students:read");
    expect(entry.title).toBe("List students");
    expect(entry.group).toBe("Students");
    for (const doc of body.data as { title: string; group: string; scope: string }[]) {
      expect(doc.title.length).toBeGreaterThan(0);
      expect(doc.group.length).toBeGreaterThan(0);
      expect((Object.values(API_SCOPES) as string[])).toContain(doc.scope);
    }
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );

    const response = await TestRequest.get(
      "/api/admin/api-clients/internal-endpoints",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get(
      "/api/admin/api-clients/internal-endpoints",
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
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

describe("PATCH /api/admin/api-clients/rotate/:id", () => {
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

  it("should issue a new token and invalidate the old one when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const { client, token: oldToken } = await ApiClientTest.createWithToken({
      name: "TEST_CLIENT_ROTATE",
      scopeNames: [READ_SCOPE],
    });

    const response = await TestRequest.patch(
      `/api/admin/api-clients/rotate/${client.id}`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.id).toBe(client.id);
    expect(body.data.name).toBe("TEST_CLIENT_ROTATE");
    expect(body.data.is_active).toBe(true);
    expect(body.data.scopes).toEqual([READ_SCOPE]);
    expect(typeof body.data.token).toBe("string");
    expect(body.data.token).not.toBe(oldToken);
    expect(body.data.token_prefix).not.toBe(client.token_prefix);

    // Old token no longer authenticates against the internal API.
    const oldTokenResponse = await TestRequest.get(
      "/api/internal/employees/lookup?email=anyone@millennia21.id",
      undefined,
      { Authorization: `Bearer ${oldToken}` },
    );
    expect(oldTokenResponse.status).toBe(401);

    // New token authenticates fine (scopes carried over unchanged).
    const newTokenResponse = await TestRequest.get(
      "/api/internal/employees/lookup?email=anyone@millennia21.id",
      undefined,
      { Authorization: `Bearer ${body.data.token}` },
    );
    expect(newTokenResponse.status).toBe(404); // authenticated, just no matching employee

    const auditEntry = await prismaClient.auditLog.findFirst({
      where: { action: AuditAction.API_TOKEN_ROTATE },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.admin_id).toBeDefined();
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );
    const client = await ApiClientTest.create({
      name: "TEST_CLIENT_ROTATE_FORBIDDEN",
    });

    const response = await TestRequest.patch(
      `/api/admin/api-clients/rotate/${client.id}`,
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
      "/api/admin/api-clients/rotate/invalid-cuid-123",
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("not found");
  });

  it("should reject rotating a revoked client", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const client = await ApiClientTest.create({
      name: "TEST_CLIENT_ROTATE_REVOKED",
    });
    await prismaClient.apiClient.update({
      where: { id: client.id },
      data: { is_active: false },
    });

    const response = await TestRequest.patch(
      `/api/admin/api-clients/rotate/${client.id}`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("revoked");
  });
});

describe("PATCH /api/admin/api-clients/:id/scopes", () => {
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
    await prismaClient.apiScope.upsert({
      where: { name: SECOND_SCOPE },
      update: {},
      create: { name: SECOND_SCOPE },
    });
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await ApiClientTest.delete();
    await AuditLogTest.delete();
    await MasterDataTest.delete();
  });

  it("should replace an active client's scopes when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const { client, token } = await ApiClientTest.createWithToken({
      name: "TEST_CLIENT_UPDATE_SCOPES",
      scopeNames: [READ_SCOPE],
    });

    const response = await TestRequest.patch(
      `/api/admin/api-clients/${client.id}/scopes`,
      { scope_names: [SECOND_SCOPE] },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.id).toBe(client.id);
    expect(body.data.scopes).toEqual([SECOND_SCOPE]);

    // Same token, but the old scope no longer authorizes it - scopes are
    // read fresh from the DB on every request, not cached on the token.
    const oldScopeResponse = await TestRequest.get(
      "/api/internal/employees/lookup?email=anyone@millennia21.id",
      undefined,
      { Authorization: `Bearer ${token}` },
    );
    expect(oldScopeResponse.status).toBe(403);

    const newScopeResponse = await TestRequest.get(
      "/api/internal/students/lookup?email=anyone@millennia21.id",
      undefined,
      { Authorization: `Bearer ${token}` },
    );
    expect(newScopeResponse.status).toBe(404); // authorized, just no matching student

    const auditEntry = await prismaClient.auditLog.findFirst({
      where: { action: AuditAction.API_TOKEN_UPDATE_SCOPES },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.admin_id).toBeDefined();
  });

  it("should fully replace scopes, not merge with the existing set", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const { client } = await ApiClientTest.createWithToken({
      name: "TEST_CLIENT_UPDATE_SCOPES_REPLACE",
      scopeNames: [READ_SCOPE, SECOND_SCOPE],
    });

    const response = await TestRequest.patch(
      `/api/admin/api-clients/${client.id}/scopes`,
      { scope_names: [SECOND_SCOPE] },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.scopes).toEqual([SECOND_SCOPE]);
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );
    const client = await ApiClientTest.create({
      name: "TEST_CLIENT_UPDATE_SCOPES_FORBIDDEN",
    });

    const response = await TestRequest.patch(
      `/api/admin/api-clients/${client.id}/scopes`,
      { scope_names: [SECOND_SCOPE] },
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
      "/api/admin/api-clients/invalid-cuid-123/scopes",
      { scope_names: [SECOND_SCOPE] },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("not found");
  });

  it("should reject changing scopes of a revoked client", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const client = await ApiClientTest.create({
      name: "TEST_CLIENT_UPDATE_SCOPES_REVOKED",
    });
    await prismaClient.apiClient.update({
      where: { id: client.id },
      data: { is_active: false },
    });

    const response = await TestRequest.patch(
      `/api/admin/api-clients/${client.id}/scopes`,
      { scope_names: [SECOND_SCOPE] },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("revoked");
  });

  it("should reject an unknown scope name", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const client = await ApiClientTest.create({
      name: "TEST_CLIENT_UPDATE_SCOPES_BAD_SCOPE",
    });

    const response = await TestRequest.patch(
      `/api/admin/api-clients/${client.id}/scopes`,
      { scope_names: ["not_a_real_scope"] },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Unknown scope");
  });
});

describe("managed application profiles", () => {
  let masterData: Awaited<ReturnType<typeof MasterDataTest.create>>;

  async function cleanupProfiles() {
    await ApiClientTest.delete();
    await prismaClient.applicationIntegrationProfile.deleteMany({
      where: { code: { startsWith: "test-app-" } },
    });
    await prismaClient.auditLog.deleteMany({
      where: { entity_type: "ApplicationIntegrationProfile" },
    });
  }

  beforeEach(async () => {
    await AdminUserTest.delete();
    await cleanupProfiles();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
    await syncApiScopes();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await cleanupProfiles();
    await MasterDataTest.delete();
  });

  it("creates a custom profile without a code change, and clients created from it get exactly its scopes", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const createResponse = await TestRequest.post(
      "/api/admin/application-integration-profiles",
      {
        code: "test-app-reports",
        name: "Test Reports",
        description: "Reporting app",
        scope_names: [READ_SCOPE, SECOND_SCOPE],
      },
      accessToken,
    );
    const created = await createResponse.json();
    logger.debug(created);
    expect(createResponse.status).toBe(200);
    expect(created.data.is_system).toBe(false);
    expect(created.data.version).toBe(1);
    expect(created.data.scopes.map((scope: { name: string }) => scope.name).sort()).toEqual([
      READ_SCOPE,
      SECOND_SCOPE,
    ]);

    const clientResponse = await TestRequest.post(
      "/api/admin/api-clients",
      { profile_id: created.data.id, purpose: "backend" },
      accessToken,
    );
    const client = await clientResponse.json();
    expect(clientResponse.status).toBe(200);
    expect([...client.data.effective_scopes].sort()).toEqual([READ_SCOPE, SECOND_SCOPE]);

    const audit = await prismaClient.auditLog.findFirst({
      where: { entity_type: "ApplicationIntegrationProfile", entity_id: created.data.id },
    });
    expect(audit?.action).toBe(AuditAction.CREATE_MASTER_DATA);
  });

  it("bumps the version when scopes change and keeps it when only the name changes", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const created = await (
      await TestRequest.post(
        "/api/admin/application-integration-profiles",
        { code: "test-app-versions", name: "Test Versions", scope_names: [READ_SCOPE] },
        accessToken,
      )
    ).json();

    const renamed = await (
      await TestRequest.patch(
        `/api/admin/application-integration-profiles/${created.data.id}`,
        { name: "Renamed" },
        accessToken,
      )
    ).json();
    expect(renamed.data.name).toBe("Renamed");
    expect(renamed.data.version).toBe(1);

    const rescoped = await (
      await TestRequest.patch(
        `/api/admin/application-integration-profiles/${created.data.id}`,
        { scope_names: [READ_SCOPE, SECOND_SCOPE] },
        accessToken,
      )
    ).json();
    expect(rescoped.data.version).toBe(2);
    expect(rescoped.data.scopes).toHaveLength(2);
  });

  it("does not overwrite a seeded profile that was edited from the UI when scopes are synced again", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const list = await (
      await TestRequest.get("/api/admin/application-integration-profiles", accessToken)
    ).json();
    const exima = list.data.find((profile: { code: string }) => profile.code === "exima");
    await TestRequest.patch(
      `/api/admin/application-integration-profiles/${exima.id}`,
      { name: "Exima Edited", scope_names: [READ_SCOPE] },
      accessToken,
    );

    await syncApiScopes();

    const after = await prismaClient.applicationIntegrationProfile.findUniqueOrThrow({
      where: { code: "exima" },
      include: { scopes: { include: { scope: true } } },
    });
    expect(after.name).toBe("Exima Edited");
    expect(after.scopes.map(({ scope }) => scope.name)).toEqual([READ_SCOPE]);

    // Restore the built-in bundle so other suites see the canonical profile.
    await prismaClient.applicationIntegrationProfileScope.deleteMany({
      where: { profile_id: after.id },
    });
    await prismaClient.applicationIntegrationProfile.update({
      where: { id: after.id },
      data: { name: "Exima" },
    });
    await syncApiScopes();
  });

  it("rejects a duplicate code, an unknown scope, and a non-super-admin", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const body = { code: "test-app-dup", name: "Dup", scope_names: [READ_SCOPE] };
    expect(
      (await TestRequest.post("/api/admin/application-integration-profiles", body, accessToken)).status,
    ).toBe(200);
    expect(
      (await TestRequest.post("/api/admin/application-integration-profiles", body, accessToken)).status,
    ).toBe(400);
    expect(
      (
        await TestRequest.post(
          "/api/admin/application-integration-profiles",
          { code: "test-app-bad", name: "Bad", scope_names: ["nope:read"] },
          accessToken,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await TestRequest.post(
          "/api/admin/application-integration-profiles",
          { code: "Bad Code", name: "Bad", scope_names: [READ_SCOPE] },
          accessToken,
        )
      ).status,
    ).toBe(400);

    const dbAdmin = await AdminUserTest.createDatabaseAdmin(masterData.unit.id);
    expect(
      (
        await TestRequest.post(
          "/api/admin/application-integration-profiles",
          { code: "test-app-nope", name: "Nope", scope_names: [READ_SCOPE] },
          dbAdmin.accessToken,
        )
      ).status,
    ).toBe(403);
  });

  it("does not allow editing the unmapped legacy placeholder profile", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const unmapped = await prismaClient.applicationIntegrationProfile.findUnique({
      where: { code: "unmapped" },
    });
    if (!unmapped) return;
    const response = await TestRequest.patch(
      `/api/admin/application-integration-profiles/${unmapped.id}`,
      { scope_names: [READ_SCOPE] },
      accessToken,
    );
    expect(response.status).toBe(400);
  });

  it("lists the scope catalog for the profile picker", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const response = await TestRequest.get(
      "/api/admin/application-integration-profiles/scopes",
      accessToken,
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.map((scope: { name: string }) => scope.name)).toContain(READ_SCOPE);
  });
});
