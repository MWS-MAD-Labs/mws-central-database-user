import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes } from "crypto";
import { API_SCOPES } from "../constants/api-scopes";
import { prismaClient } from "../lib/prisma";
import { slugifyApplicationId } from "../utils/application-id";
import { AdminUserTest, ApiClientTest, EmployeeTest, MasterDataTest, TestRequest } from "./test-utils";

const ACCESS = "/api/admin/application-access";
const ROLES = "/api/admin/application-roles";
const RULES = "/api/admin/application-access-rules";

describe("application onboarding", () => {
  let appId: string;
  let master: Awaited<ReturnType<typeof MasterDataTest.create>>;

  beforeEach(async () => {
    appId = `test-onb-${randomBytes(4).toString("hex")}`;
    master = await MasterDataTest.create();
  });

  afterEach(async () => {
    await prismaClient.auditLog.deleteMany({
      where: { OR: [{ entity_type: "Application" }, { entity_type: "ApplicationOrganization" }, { entity_type: "ApplicationIntegrationProfile" }] },
    });
    await prismaClient.applicationAccessRule.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationRole.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationPermission.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationOrganization.deleteMany({ where: { application_id: appId } });
    await prismaClient.application.deleteMany({ where: { application_id: appId } });
    await ApiClientTest.delete();
    await prismaClient.applicationIntegrationProfile.deleteMany({ where: { code: appId } });
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  const create = (accessToken: string, extra: Record<string, unknown> = {}) =>
    TestRequest.post(
      `${ACCESS}/applications`,
      { application_id: appId, name: "TEST_Onboard", launch_url: "https://onb.example.com/auth/sso", ...extra },
      accessToken,
    );

  it("creates an application with its details and a long random organization id", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const response = await create(accessToken, { description: "Test app", icon: "Wallet", category: "operations" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.name).toBe("TEST_Onboard");
    expect(body.data.published).toBe(false);
    expect(body.data.organization_id).toMatch(new RegExp(`^org_${appId.replace(/-/g, "_")}_[a-z2-7]{20}$`));

    const row = await prismaClient.application.findUniqueOrThrow({ where: { application_id: appId } });
    expect(row).toMatchObject({ description: "Test app", icon: "Wallet", category: "operations", published: false });

    expect((await create(accessToken)).status).toBe(400);
    const badUrl = await TestRequest.post(
      `${ACCESS}/applications`,
      { application_id: `${appId}-x`, launch_url: "ftp://nope" },
      accessToken,
    );
    expect(badUrl.status).toBe(400);
  });

  it("is Super Admin only", async () => {
    const { accessToken: dbAdmin } = await AdminUserTest.createDatabaseAdmin();
    expect((await create(dbAdmin)).status).toBe(403);
    expect((await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, dbAdmin)).status).toBe(403);
  });

  it("updates the details", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await create(accessToken);
    const patched = await TestRequest.patch(
      `${ACCESS}/apps/${appId}/details`,
      { name: "TEST_Renamed", logout_url: "https://onb.example.com/auth/logout" },
      accessToken,
    );
    expect(patched.status).toBe(200);
    const row = await prismaClient.application.findUniqueOrThrow({ where: { application_id: appId } });
    expect(row.name).toBe("TEST_Renamed");
    expect(row.logout_url).toBe("https://onb.example.com/auth/logout");
  });

  it("reports setup progress step by step", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await create(accessToken);
    const setup = async () => (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data;

    let status = await setup();
    expect(status.connection).toEqual({ client_id: null, created: false, created_at: null, last_used_at: null });
    expect(status.permissions.count).toBe(0);
    expect(status.can_publish).toBe(false);
    expect(status.missing).toEqual(["permissions", "roles", "groups"]);

    await prismaClient.applicationPermission.create({
      data: { application_id: appId, key: "app.use", source: "MANIFEST", synced_at: new Date() },
    });
    status = await setup();
    expect(status.permissions.count).toBe(1);
    expect(status.permissions.synced_at).not.toBeNull();
    expect(status.missing).toEqual(["roles", "groups"]);

    const role = await TestRequest.post(
      ROLES,
      { application_id: appId, key: "STAFF", label: "Staff", permissions: ["app.use"], allows_employees: true },
      accessToken,
    );
    expect(role.status).toBe(200);
    status = await setup();
    expect(status.roles.active_count).toBe(1);

    const group = await TestRequest.post(RULES, { application_id: appId, audience: "EMPLOYEES", default_role_key: "STAFF" }, accessToken);
    expect(group.status).toBe(200);
    status = await setup();
    expect(status.groups.active_count).toBe(1);
    expect(status.can_publish).toBe(true);
    expect(status.missing).toEqual([]);
  });

  it("connects once, shows the token once and reports when the app calls Central", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await create(accessToken);

    const connect = await TestRequest.post(`${ACCESS}/apps/${appId}/connect`, {}, accessToken);
    expect(connect.status).toBe(200);
    const { data } = await connect.json();
    expect(data.token).toMatch(/^[\w-]+\.[\w-]+$/);
    const env = Object.fromEntries(data.env.map((item: { key: string; value: string }) => [item.key, item.value]));
    expect(env.HUB_SSO_APP_ID).toBe(appId);
    expect(env.CENTRAL_DATA_API_TOKEN).toBe(data.token);
    expect(env.CENTRAL_ORGANIZATION_ID).toMatch(/^org_/);

    const profile = await prismaClient.applicationIntegrationProfile.findUniqueOrThrow({
      where: { code: appId },
      include: { scopes: { include: { scope: true } } },
    });
    expect(profile.scopes.map((item) => item.scope.name).sort()).toEqual(
      [API_SCOPES.APPLICATION_ENTITLEMENTS_READ, API_SCOPES.APPLICATION_PERMISSIONS_WRITE, API_SCOPES.EMPLOYEES_READ].sort(),
    );

    // Behind a proxy the address is the one the proxy forwarded.
    expect(env.CENTRAL_DATA_API_BASE_URL).toMatch(/^https?:\/\/[^/]+$/);

    const again = await TestRequest.post(`${ACCESS}/apps/${appId}/connect`, {}, accessToken);
    expect(again.status).toBe(400);
    expect(await prismaClient.applicationIntegrationProfile.count({ where: { code: appId } })).toBe(1);

    let status = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data;
    expect(status.connection.created).toBe(true);
    expect(status.connection.last_used_at).toBeNull();

    // The app's first call with the token.
    const call = await TestRequest.get(`/api/internal/applications`, undefined, { Authorization: `Bearer ${data.token}` });
    expect(call.status).toBe(200);
    status = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data;
    expect(status.connection.last_used_at).not.toBeNull();
  });

  it("refuses to publish until permissions, roles, groups and a launch URL exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await create(accessToken, { launch_url: null });

    const early = await TestRequest.post(`${ACCESS}/apps/${appId}/publish`, {}, accessToken);
    expect(early.status).toBe(400);
    const message = JSON.stringify(await early.json());
    expect(message).toContain("permissions");
    expect(message).toContain("roles");
    expect(message).toContain("groups");
    expect(message).toContain("launch URL");

    await prismaClient.applicationPermission.create({
      data: { application_id: appId, key: "app.use", source: "MANIFEST", synced_at: new Date() },
    });
    await TestRequest.post(
      ROLES,
      { application_id: appId, key: "STAFF", label: "Staff", permissions: ["app.use"], allows_employees: true },
      accessToken,
    );
    await TestRequest.post(RULES, { application_id: appId, audience: "EMPLOYEES", default_role_key: "STAFF" }, accessToken);
    await TestRequest.patch(`${ACCESS}/apps/${appId}/details`, { launch_url: "https://onb.example.com/auth/sso" }, accessToken);

    const published = await TestRequest.post(`${ACCESS}/apps/${appId}/publish`, {}, accessToken);
    expect(published.status).toBe(200);
    expect((await prismaClient.application.findUniqueOrThrow({ where: { application_id: appId } })).published).toBe(true);

    const hidden = await TestRequest.post(`${ACCESS}/apps/${appId}/unpublish`, {}, accessToken);
    expect(hidden.status).toBe(200);
    expect((await prismaClient.application.findUniqueOrThrow({ where: { application_id: appId } })).published).toBe(false);
  });

  it("serves published applications to the Hub and nothing else", async () => {
    await prismaClient.application.create({
      data: {
        application_id: appId,
        name: "TEST_Onboard",
        icon: "Wallet",
        launch_url: "https://onb.example.com/auth/sso",
        logout_url: "https://onb.example.com/auth/logout",
        published: true,
      },
    });
    const draft = `${appId}-draft`;
    await prismaClient.application.create({ data: { application_id: draft, name: "TEST_Draft", launch_url: "https://d.example.com" } });

    try {
      const { token } = await ApiClientTest.createWithToken({ scopeNames: [API_SCOPES.APPLICATION_ENTITLEMENTS_READ] });
      const response = await TestRequest.get(`/api/internal/applications`, undefined, { Authorization: `Bearer ${token}` });
      expect(response.status).toBe(200);
      const { data } = await response.json();
      const mine = data.find((item: { id: string }) => item.id === appId);
      expect(mine).toEqual({
        id: appId,
        name: "TEST_Onboard",
        description: null,
        icon: "Wallet",
        category: null,
        launch_url: "https://onb.example.com/auth/sso",
        logout_url: "https://onb.example.com/auth/logout",
      });
      expect(data.find((item: { id: string }) => item.id === draft)).toBeUndefined();

      const { token: wrong } = await ApiClientTest.createWithToken({ scopeNames: [API_SCOPES.EMPLOYEES_READ] });
      const denied = await TestRequest.get(`/api/internal/applications`, undefined, { Authorization: `Bearer ${wrong}` });
      expect(denied.status).toBe(403);
    } finally {
      await prismaClient.application.deleteMany({ where: { application_id: draft } });
    }
  });

  describe("one step from adding to the token", () => {
    it("makes the connection with the chosen data access and hands over the token", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const response = await create(accessToken, { connect: true, scope_names: [API_SCOPES.STUDENTS_READ] });
      expect(response.status).toBe(200);
      const { data } = await response.json();
      expect(data.connection.token).toMatch(/^[\w-]+\.[\w-]+$/);
      expect(data.connection.env.map((item: { key: string }) => item.key)).toEqual([
        "HUB_SSO_APP_ID",
        "CENTRAL_DATA_API_BASE_URL",
        "CENTRAL_DATA_API_TOKEN",
        "CENTRAL_ORGANIZATION_ID",
      ]);

      const profile = await prismaClient.applicationIntegrationProfile.findUniqueOrThrow({
        where: { code: appId },
        include: { scopes: { include: { scope: true } } },
      });
      expect(profile.scopes.map((item) => item.scope.name).sort()).toEqual(
        [API_SCOPES.APPLICATION_ENTITLEMENTS_READ, API_SCOPES.APPLICATION_PERMISSIONS_WRITE, API_SCOPES.STUDENTS_READ].sort(),
      );

      const headers = { Authorization: `Bearer ${data.connection.token}` };
      expect((await TestRequest.get("/api/internal/applications", undefined, headers)).status).toBe(200);
      expect((await TestRequest.get("/api/internal/students?page=1&size=1", undefined, headers)).status).toBe(200);
      // Employees were not asked for.
      expect((await TestRequest.get("/api/internal/employees?page=1&size=1", undefined, headers)).status).toBe(403);
    });

    it("gives employees only when nothing else is chosen, and makes no connection when not asked", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const first = await (await create(accessToken, { connect: true })).json();
      const profile = await prismaClient.applicationIntegrationProfile.findUniqueOrThrow({
        where: { code: appId },
        include: { scopes: { include: { scope: true } } },
      });
      expect(profile.scopes.map((item) => item.scope.name)).toContain(API_SCOPES.EMPLOYEES_READ);
      expect(first.data.connection.token).toBeTruthy();

      await prismaClient.applicationIntegrationProfile.deleteMany({ where: { code: appId } });
      await prismaClient.application.deleteMany({ where: { application_id: appId } });
      await prismaClient.applicationOrganization.deleteMany({ where: { application_id: appId } });
      const bare = await (await create(accessToken)).json();
      expect(bare.data.connection).toBeNull();
    });

    it("rejects a scope that does not exist", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const response = await create(accessToken, { connect: true, scope_names: ["nope:read"] });
      expect(response.status).toBe(400);
    });

    it("changes the data access later, keeping the two required scopes", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken, { connect: true });
      const patched = await TestRequest.patch(`${ACCESS}/apps/${appId}/connection-scopes`, { scope_names: [API_SCOPES.CLASSES_READ] }, accessToken);
      expect(patched.status).toBe(200);
      const profile = await prismaClient.applicationIntegrationProfile.findUniqueOrThrow({
        where: { code: appId },
        include: { scopes: { include: { scope: true } } },
      });
      expect(profile.scopes.map((item) => item.scope.name).sort()).toEqual(
        [API_SCOPES.APPLICATION_ENTITLEMENTS_READ, API_SCOPES.APPLICATION_PERMISSIONS_WRITE, API_SCOPES.CLASSES_READ].sort(),
      );
      const setup = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data;
      expect(setup.data_access.editable).toBe(true);
      expect(setup.data_access.scope_names).toContain(API_SCOPES.CLASSES_READ);
    });

    it("also changes the data access of a system profile that belongs to the application", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken);
      await prismaClient.applicationIntegrationProfile.create({ data: { code: appId, name: "System", is_system: true } });
      const patched = await TestRequest.patch(`${ACCESS}/apps/${appId}/connection-scopes`, { scope_names: [API_SCOPES.CLASSES_READ] }, accessToken);
      expect(patched.status).toBe(200);
    });

    it("keeps the profile endpoints away from an application's profile", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken, { connect: true });
      const profile = await prismaClient.applicationIntegrationProfile.findUniqueOrThrow({ where: { code: appId } });
      const update = await TestRequest.patch(`/api/admin/application-integration-profiles/${profile.id}`, { scope_names: [API_SCOPES.CLASSES_READ] }, accessToken);
      expect(update.status).toBe(400);
      const createSame = await TestRequest.post(
        "/api/admin/application-integration-profiles",
        { code: appId, name: "Again", scope_names: [API_SCOPES.CLASSES_READ] },
        accessToken,
      );
      expect(createSame.status).toBe(400);
    });
  });

  describe("one audit entry for one flow", () => {
    const flowActions = ["APPLICATION_CREATE", "API_TOKEN_CREATE", "CREATE_MASTER_DATA", "API_TOKEN_REVOKE", "APPLICATION_DELETE"] as const;
    const entries = () =>
      prismaClient.auditLog.findMany({ where: { action: { in: [...flowActions] } }, orderBy: { created_at: "asc" } });

    it("writes one Application Create with the connection inside when an application is added", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const before = (await entries()).length;
      await create(accessToken, { connect: true, scope_names: [API_SCOPES.STUDENTS_READ] });
      const added = (await entries()).slice(before);
      expect(added.map((entry) => entry.action)).toEqual(["APPLICATION_CREATE"]);
      const values = added[0]!.new_values as Record<string, any>;
      expect(values.name).toBe("TEST_Onboard");
      expect(values.connection.profile_code).toBe(appId);
      expect(values.connection.token_prefix).toMatch(/^[\w]+$/);
      expect(values.connection.scopes).toContain(API_SCOPES.STUDENTS_READ);
    });

    it("writes one entry for an application added without a connection, and one for the connection made later", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const before = (await entries()).length;
      await create(accessToken);
      expect((await entries()).slice(before).map((entry) => entry.action)).toEqual(["APPLICATION_CREATE"]);
      const mid = (await entries()).length;
      await TestRequest.post(`${ACCESS}/apps/${appId}/connect`, {}, accessToken);
      expect((await entries()).slice(mid).map((entry) => entry.action)).toEqual(["API_TOKEN_CREATE"]);
    });

    it("writes one Application Delete that lists the clients it revoked", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken, { connect: true });
      const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      await prismaClient.apiClient.updateMany({ where: { profile: { code: appId } }, data: { last_used_at: old } });
      await prismaClient.apiClientCredential.updateMany({ where: { client: { profile: { code: appId } } }, data: { last_used_at: old } });
      const before = (await entries()).length;
      expect((await TestRequest.delete(`${ACCESS}/apps/${appId}`, accessToken)).status).toBe(200);
      const removed = (await entries()).slice(before);
      expect(removed.map((entry) => entry.action)).toEqual(["APPLICATION_DELETE"]);
      expect((removed[0]!.old_values as Record<string, any>).revoked_clients).toHaveLength(1);
    });
  });

  describe("the id and what is typed", () => {
    it("makes the id from the name", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const name = `TEST Onb ${appId.slice(-4)}`;
      const response = await TestRequest.post(`${ACCESS}/applications`, { name, launch_url: "https://onb.example.com/auth" }, accessToken);
      expect(response.status).toBe(200);
      const { data } = await response.json();
      const expected = slugifyApplicationId(name);
      expect(data.application_id).toBe(expected);
      expect(expected).toMatch(/^test-onb-/);
      await prismaClient.applicationOrganization.deleteMany({ where: { application_id: expected } });
      await prismaClient.application.deleteMany({ where: { application_id: expected } });
      await prismaClient.auditLog.deleteMany({ where: { entity_type: { in: ["Application", "ApplicationOrganization"] } } });
    });

    it("refuses a name whose id is taken, or a reserved id, or no usable letters", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken);
      const twin = await TestRequest.post(`${ACCESS}/applications`, { name: appId.replace(/-/g, " ") }, accessToken);
      expect(twin.status).toBe(400);
      expect(JSON.stringify(await twin.json())).toContain("already exists");
      expect((await TestRequest.post(`${ACCESS}/applications`, { name: "Me" }, accessToken)).status).toBe(400);
      expect((await TestRequest.post(`${ACCESS}/applications`, { name: "---" }, accessToken)).status).toBe(400);
    });

    it("keeps symbols out of the name, description, icon and category", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const bad = async (extra: Record<string, unknown>) => (await create(accessToken, extra)).status;
      expect(await bad({ name: "Bad <b>Name</b>" })).toBe(400);
      expect(await bad({ name: "X" })).toBe(400);
      expect(await bad({ description: "hello <script>" })).toBe(400);
      expect(await bad({ icon: "App Window" })).toBe(400);
      expect(await bad({ icon: "../x" })).toBe(400);
      // The Hub only draws the icons it knows, so a made up name is refused.
      expect(await bad({ icon: "Cash" })).toBe(400);
      expect(await bad({ category: "Finance" })).toBe(400);
      // Extra spaces are tidied, not refused.
      const ok = await create(accessToken, { name: "  TEST   Spaced  Name ", description: "a   b\n c" });
      expect(ok.status).toBe(200);
      const row = await prismaClient.application.findUniqueOrThrow({ where: { application_id: appId } });
      expect(row.name).toBe("TEST Spaced Name");
      expect(row.description).toBe("a b c");
    });

    it("checks addresses: no spaces, no credentials, http only for local ones", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const status = async (launch_url: string) => (await create(accessToken, { launch_url })).status;
      expect(await status("https://exa mple.com/auth")).toBe(400);
      expect(await status("https://user:pass@example.com/auth")).toBe(400);
      expect(await status("javascript:alert(1)")).toBe(400);
      expect(await status("http://example.com/auth")).toBe(400);
      expect(await status("https://example.com/<x>")).toBe(400);
      expect(await status("http://localhost:3000/auth/sso")).toBe(200);
    });
  });

  describe("calling without naming the application", () => {
    it("lets the application use me for its own permissions and entitlements", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const { data } = await (await create(accessToken, { connect: true })).json();
      const headers = { Authorization: `Bearer ${data.connection.token}`, "Content-Type": "application/json" };

      const put = await TestRequest.put("/api/internal/application-permissions/me", { permissions: [{ key: "app.use" }] }, undefined, headers);
      expect(put.status).toBe(200);
      expect((await put.json()).data.application_id).toBe(appId);

      const registered = await (await TestRequest.get("/api/internal/application-permissions/me", undefined, headers)).json();
      expect(registered.data.map((item: { key: string }) => item.key)).toEqual(["app.use"]);
      expect((await TestRequest.get("/api/internal/application-permissions/me/usage", undefined, headers)).status).toBe(200);

      // The version and list calls fall back to the same application.
      expect((await TestRequest.get("/api/internal/application-entitlements/version", undefined, headers)).status).toBe(200);
      expect((await TestRequest.get("/api/internal/application-entitlements?page=1&size=1", undefined, headers)).status).toBe(200);
      expect((await TestRequest.get("/api/internal/application-entitlements/version?application_id=me", undefined, headers)).status).toBe(200);

      // Another application is still refused.
      const other = await TestRequest.get("/api/internal/application-permissions/someone-else", undefined, headers);
      expect(other.status).toBe(403);
    });

    it("asks a client with no application to name one, and keeps me reserved", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const { token } = await ApiClientTest.createWithToken({ scopeNames: [API_SCOPES.APPLICATION_ENTITLEMENTS_READ] });
      const headers = { Authorization: `Bearer ${token}` };
      expect((await TestRequest.get("/api/internal/application-permissions/me", undefined, headers)).status).toBe(400);
      expect((await TestRequest.get("/api/internal/application-entitlements/version", undefined, headers)).status).toBe(400);
      expect((await create(accessToken, { application_id: "me" })).status).toBe(400);
    });

    it("tells which application owns a profile", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken, { connect: true });
      const profiles = (await (await TestRequest.get("/api/admin/application-integration-profiles", accessToken)).json()).data;
      const mine = profiles.find((profile: { code: string }) => profile.code === appId);
      expect(mine.application).toEqual({ application_id: appId, name: "TEST_Onboard" });
      const other = profiles.find((profile: { code: string }) => profile.code === "hub");
      if (other) expect(other).toHaveProperty("application");
    });
  });

  describe("the connection belongs to Application Access", () => {
    it("cannot be revoked or made again from the API clients endpoints", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken, { connect: true });
      const client = await prismaClient.apiClient.findFirstOrThrow({ where: { profile: { code: appId } }, include: { credentials: true } });

      const revoke = await TestRequest.patch(`/api/admin/api-clients/revoke/${client.id}`, {}, accessToken);
      expect(revoke.status).toBe(400);
      expect(JSON.stringify(await revoke.json())).toContain("Application Access");
      const credential = await TestRequest.patch(
        `/api/admin/api-clients/${client.id}/credentials/${client.credentials[0]!.id}/revoke`,
        {},
        accessToken,
      );
      expect(credential.status).toBe(400);
      expect((await prismaClient.apiClient.findUniqueOrThrow({ where: { id: client.id } })).is_active).toBe(true);

      const again = await TestRequest.post("/api/admin/api-clients", { profile_code: appId, purpose: "backend" }, accessToken);
      expect(again.status).toBe(400);
    });

    it("still gets rotated through the application, and goes away with it", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const { data } = await (await create(accessToken, { connect: true })).json();
      const rotated = await TestRequest.post(`${ACCESS}/apps/${appId}/rotate`, { immediate: true }, accessToken);
      expect(rotated.status).toBe(200);
      const body = (await rotated.json()).data;
      const next = body.token as string;
      // The whole .env comes back with the new token.
      const env = Object.fromEntries(body.env.map((item: { key: string; value: string }) => [item.key, item.value]));
      expect(env).toMatchObject({ HUB_SSO_APP_ID: appId, CENTRAL_DATA_API_TOKEN: next });
      expect(env.CENTRAL_DATA_API_BASE_URL).toMatch(/^https?:\/\//);
      expect(env.CENTRAL_ORGANIZATION_ID).toMatch(/^org_/);
      expect(next).not.toBe(data.connection.token);
      // Emergency rotation stops the old token at once.
      expect((await TestRequest.get("/api/internal/applications", undefined, { Authorization: `Bearer ${data.connection.token}` })).status).toBe(401);
      expect((await TestRequest.get("/api/internal/applications", undefined, { Authorization: `Bearer ${next}` })).status).toBe(200);
    });

    it("counts a connection of any purpose as the application's connection", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken);
      const profile = await prismaClient.applicationIntegrationProfile.create({ data: { code: appId, name: "Older", is_system: true } });
      await prismaClient.apiClient.create({
        data: {
          name: "TEST_OLD_BACKEND",
          token_prefix: `test_${randomBytes(4).toString("hex")}`,
          token_hash: "x",
          profile_id: profile.id,
          environment: "DEVELOPMENT",
          purpose: "backend",
        },
      });
      const setup = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data;
      expect(setup.connection.created).toBe(true);
      expect((await TestRequest.post(`${ACCESS}/apps/${appId}/connect`, {}, accessToken)).status).toBe(400);
    });
  });

  describe("adding the Hub itself", () => {
    it("takes the Hub id whatever the name is, drops the card and address, and can be added once", async () => {
      process.env.HUB_APPLICATION_ID = appId;
      try {
        const { accessToken } = await AdminUserTest.createSuperAdmin();
        const response = await TestRequest.post(
          `${ACCESS}/applications`,
          { name: "TEST MWS Hub", is_hub: true, launch_url: "https://ignored.example.com", category: "operations", description: "x" },
          accessToken,
        );
        expect(response.status).toBe(200);
        const { data } = await response.json();
        expect(data.application_id).toBe(appId);
        const row = await prismaClient.application.findUniqueOrThrow({ where: { application_id: appId } });
        // Whatever name is sent, the Hub is called HUB.
        expect(row).toMatchObject({ name: "HUB", launch_url: null, category: null, description: null });
        const rename = await TestRequest.patch(`${ACCESS}/apps/${appId}/details`, { name: "Renamed" }, accessToken);
        expect(rename.status).toBe(400);
        expect(JSON.stringify(await rename.json())).toContain("cannot change");
        // An older Hub row spelled otherwise can be put right to HUB.
        await prismaClient.application.update({ where: { application_id: appId }, data: { name: "hub" } });
        const fix = await TestRequest.patch(`${ACCESS}/apps/${appId}/details`, { name: "HUB" }, accessToken);
        expect(fix.status).toBe(200);
        expect((await prismaClient.application.findUniqueOrThrow({ where: { application_id: appId } })).name).toBe("HUB");
        const again = await TestRequest.post(`${ACCESS}/applications`, { name: "Other Hub", is_hub: true }, accessToken);
        expect(again.status).toBe(400);
        expect(JSON.stringify(await again.json())).toContain("already added");
      } finally {
        delete process.env.HUB_APPLICATION_ID;
      }
    });
  });

  describe("what the menu may offer", () => {
    it("says in the setup whether delete is allowed or only retire", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken);
      const unused = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data;
      expect(unused.removal).toEqual({ can_remove: true, retire_available: false });
      await prismaClient.application.update({ where: { application_id: appId }, data: { published: true } });
      const live = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data;
      expect(live.removal).toEqual({ can_remove: false, retire_available: true });
    });

    it("says in the list which rows may be deleted, and puts the Hub first", async () => {
      process.env.HUB_APPLICATION_ID = "hub-first-test";
      const hubId = "hub-first-test";
      try {
        const { accessToken } = await AdminUserTest.createSuperAdmin();
        await create(accessToken);
        await prismaClient.application.create({ data: { application_id: hubId, name: "HUB" } });
        await prismaClient.applicationOrganization.create({ data: { application_id: hubId, organization_id: "org_hub_x" } });
        const rowOf = async () => {
          const list = (await (await TestRequest.get(`${ACCESS}/applications?search=${appId.slice(0, 8)}&size=50`, accessToken)).json()).data;
          return list.find((item: { application_id: string }) => item.application_id === appId);
        };
        expect(await rowOf()).toMatchObject({ can_remove: true, retire_available: false });
        await prismaClient.application.update({ where: { application_id: appId }, data: { published: true } });
        expect(await rowOf()).toMatchObject({ can_remove: false, retire_available: true });
        await prismaClient.application.update({ where: { application_id: appId }, data: { retired_at: new Date(), published: false } });
        expect(await rowOf()).toMatchObject({ can_remove: true, retire_available: false, retired: true });

        const all = (await (await TestRequest.get(`${ACCESS}/applications?size=50`, accessToken)).json()).data;
        expect(all[0]).toMatchObject({ application_id: hubId, is_hub: true, can_remove: false, retire_available: false });
      } finally {
        await prismaClient.applicationOrganization.deleteMany({ where: { application_id: hubId } });
        await prismaClient.application.deleteMany({ where: { application_id: hubId } });
        delete process.env.HUB_APPLICATION_ID;
      }
    });

    it("marks the Hub in the list", async () => {
      process.env.HUB_APPLICATION_ID = appId;
      try {
        const { accessToken } = await AdminUserTest.createSuperAdmin();
        await create(accessToken);
        const list = (await (await TestRequest.get(`${ACCESS}/applications?search=${appId}`, accessToken)).json()).data;
        expect(list[0].is_hub).toBe(true);
      } finally {
        delete process.env.HUB_APPLICATION_ID;
      }
    });
  });

  describe("the Hub itself", () => {
    it("has no show in Hub step and cannot be published or removed", async () => {
      process.env.HUB_APPLICATION_ID = appId;
      try {
        const { accessToken } = await AdminUserTest.createSuperAdmin();
        await create(accessToken);
        const setup = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data;
        expect(setup.is_hub).toBe(true);
        expect(setup.can_publish).toBe(false);
        expect((await TestRequest.post(`${ACCESS}/apps/${appId}/publish`, {}, accessToken)).status).toBe(400);
        const plan = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/removal`, accessToken)).json()).data;
        expect(plan.can_remove).toBe(false);
        expect(plan.blockers.join(" ")).toContain("Hub's own application");
        expect((await TestRequest.delete(`${ACCESS}/apps/${appId}`, accessToken)).status).toBe(400);
      } finally {
        delete process.env.HUB_APPLICATION_ID;
      }
    });
  });

  describe("retiring an application", () => {
    async function liveApplication(accessToken: string) {
      const { data } = await (await create(accessToken, { connect: true })).json();
      await prismaClient.application.update({ where: { application_id: appId }, data: { published: true } });
      return data.connection.token as string;
    }
    const gone = (token: string) => TestRequest.get("/api/internal/applications", undefined, { Authorization: `Bearer ${token}` });

    it("stops the token, hides it from the Hub and keeps the data, in one audit entry", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const token = await liveApplication(accessToken);
      await TestRequest.post(ROLES, { application_id: appId, key: "STAFF", label: "Staff", permissions: [], allows_employees: true }, accessToken);
      expect((await gone(token)).status).toBe(200);
      const before = await prismaClient.auditLog.count({ where: { action: { in: ["APPLICATION_RETIRE", "API_TOKEN_REVOKE"] } } });

      const retired = await TestRequest.post(`${ACCESS}/apps/${appId}/retire`, {}, accessToken);
      expect(retired.status).toBe(200);
      expect((await retired.json()).data.retired_at).not.toBeNull();
      expect((await gone(token)).status).toBe(401);
      const row = await prismaClient.application.findUniqueOrThrow({ where: { application_id: appId } });
      expect(row.published).toBe(false);
      expect(await prismaClient.applicationRole.count({ where: { application_id: appId } })).toBe(1);
      expect(await prismaClient.auditLog.count({ where: { action: { in: ["APPLICATION_RETIRE", "API_TOKEN_REVOKE"] } } })).toBe(before + 1);

      expect((await TestRequest.post(`${ACCESS}/apps/${appId}/retire`, {}, accessToken)).status).toBe(400);
      expect((await TestRequest.post(`${ACCESS}/apps/${appId}/publish`, {}, accessToken)).status).toBe(400);
      expect((await TestRequest.post(`${ACCESS}/apps/${appId}/connect`, {}, accessToken)).status).toBe(400);
      const list = (await (await TestRequest.get(`${ACCESS}/applications?search=${appId}`, accessToken)).json()).data;
      expect(list[0].retired).toBe(true);
    });

    it("gives nobody access while retired and again after a restore", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken, { connect: true });
      const person = await EmployeeTest.create({
        email: "test_onb_retire@millennia21.id",
        unitId: master.unit.id,
        jobPositionId: master.position.id,
        jobLevelId: master.level.id,
        buildingId: master.building.id,
      });
      const organization = await prismaClient.applicationOrganization.findUniqueOrThrow({ where: { application_id: appId } });
      await prismaClient.applicationRole.create({ data: { application_id: appId, key: "STAFF", label: "Staff", permissions: [] } });
      await prismaClient.applicationEntitlement.create({
        data: { person_id: person.id, application_id: appId, organization_id: organization.organization_id, role: "STAFF" },
      });
      const { token } = await ApiClientTest.createWithToken({ scopeNames: [API_SCOPES.APPLICATION_ENTITLEMENTS_READ] });
      const headers = { Authorization: `Bearer ${token}` };
      const lookup = () => TestRequest.get(`/api/internal/application-entitlements/lookup?person_id=${person.id}&application_id=${appId}`, undefined, headers);
      try {
        expect((await lookup()).status).toBe(200);
        await TestRequest.post(`${ACCESS}/apps/${appId}/retire`, {}, accessToken);
        expect((await lookup()).status).toBe(404);
        const version = await TestRequest.get(`/api/internal/application-entitlements/version?application_id=${appId}`, undefined, headers);
        expect((await version.json()).data.total).toBe(0);

        expect((await TestRequest.post(`${ACCESS}/apps/${appId}/restore`, {}, accessToken)).status).toBe(200);
        expect((await lookup()).status).toBe(200);
        expect((await TestRequest.post(`${ACCESS}/apps/${appId}/restore`, {}, accessToken)).status).toBe(400);
        // The old token stays revoked, a new connection is made.
        expect((await TestRequest.post(`${ACCESS}/apps/${appId}/connect`, {}, accessToken)).status).toBe(200);
      } finally {
        await prismaClient.applicationEntitlement.deleteMany({ where: { application_id: appId } });
        await EmployeeTest.delete();
      }
    });

    it("opens the delete once retired, and removes the people who were left", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await liveApplication(accessToken);
      const person = await EmployeeTest.create({
        email: "test_onb_retire2@millennia21.id",
        unitId: master.unit.id,
        jobPositionId: master.position.id,
        jobLevelId: master.level.id,
        buildingId: master.building.id,
      });
      const organization = await prismaClient.applicationOrganization.findUniqueOrThrow({ where: { application_id: appId } });
      await prismaClient.applicationRole.create({ data: { application_id: appId, key: "STAFF", label: "Staff", permissions: [] } });
      await prismaClient.applicationEntitlement.create({
        data: { person_id: person.id, application_id: appId, organization_id: organization.organization_id, role: "STAFF" },
      });
      try {
        const blocked = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/removal`, accessToken)).json()).data;
        expect(blocked.can_remove).toBe(false);
        expect(blocked.retire_available).toBe(true);
        expect((await TestRequest.delete(`${ACCESS}/apps/${appId}`, accessToken)).status).toBe(400);

        await TestRequest.post(`${ACCESS}/apps/${appId}/retire`, {}, accessToken);
        const open = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/removal`, accessToken)).json()).data;
        expect(open).toMatchObject({ can_remove: true, retired: true, retire_available: false });
        expect(open.will_delete.people).toBe(1);

        expect((await TestRequest.delete(`${ACCESS}/apps/${appId}`, accessToken)).status).toBe(200);
        expect(await prismaClient.applicationEntitlement.count({ where: { application_id: appId } })).toBe(0);
      } finally {
        await EmployeeTest.delete();
      }
    });

    it("refuses the Hub", async () => {
      process.env.HUB_APPLICATION_ID = appId;
      try {
        const { accessToken } = await AdminUserTest.createSuperAdmin();
        await create(accessToken);
        expect((await TestRequest.post(`${ACCESS}/apps/${appId}/retire`, {}, accessToken)).status).toBe(400);
        const plan = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/removal`, accessToken)).json()).data;
        expect(plan).toMatchObject({ can_remove: false, retire_available: false, is_hub: true });
      } finally {
        delete process.env.HUB_APPLICATION_ID;
      }
    });
  });

  describe("removing an application", () => {
    const removal = (accessToken: string) => TestRequest.get(`${ACCESS}/apps/${appId}/removal`, accessToken);
    const remove = (accessToken: string) => TestRequest.delete(`${ACCESS}/apps/${appId}`, accessToken);

    it("is Super Admin only", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken);
      const { accessToken: dbAdmin } = await AdminUserTest.createDatabaseAdmin();
      expect((await removal(dbAdmin)).status).toBe(403);
      expect((await remove(dbAdmin)).status).toBe(403);
    });

    it("is refused while it shows in the Hub", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken);
      await prismaClient.application.update({ where: { application_id: appId }, data: { published: true } });
      const plan = (await (await removal(accessToken)).json()).data;
      expect(plan.can_remove).toBe(false);
      expect(plan.blockers.join(" ")).toContain("Hub");
      expect((await remove(accessToken)).status).toBe(400);
      expect(await prismaClient.application.count({ where: { application_id: appId } })).toBe(1);
    });

    it("is refused while people still have access, naming how many", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken);
      const { EmployeeTest } = await import("./test-utils");
      const person = await EmployeeTest.create({
        email: "test_onb_person@millennia21.id",
        unitId: master.unit.id,
        jobPositionId: master.position.id,
        jobLevelId: master.level.id,
        buildingId: master.building.id,
      });
      await prismaClient.applicationRole.create({ data: { application_id: appId, key: "STAFF", label: "Staff", permissions: [] } });
      const organization = await prismaClient.applicationOrganization.findUniqueOrThrow({ where: { application_id: appId } });
      await prismaClient.applicationEntitlement.create({
        data: { person_id: person.id, application_id: appId, organization_id: organization.organization_id, role: "STAFF" },
      });
      try {
        const plan = (await (await removal(accessToken)).json()).data;
        expect(plan.can_remove).toBe(false);
        expect(plan.blockers.join(" ")).toContain("1 person has access");
        expect((await remove(accessToken)).status).toBe(400);
      } finally {
        await prismaClient.applicationEntitlement.deleteMany({ where: { application_id: appId } });
        await EmployeeTest.delete();
      }
    });

    it("is refused while its token was used lately, and allowed once it is old", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken);
      const { data } = await (await TestRequest.post(`${ACCESS}/apps/${appId}/connect`, {}, accessToken)).json();
      await TestRequest.get(`/api/internal/applications`, undefined, { Authorization: `Bearer ${data.token}` });
      const plan = (await (await removal(accessToken)).json()).data;
      expect(plan.can_remove).toBe(false);
      expect(plan.blockers.join(" ")).toContain("30 days");

      const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      await prismaClient.apiClient.updateMany({ where: { profile: { code: appId } }, data: { last_used_at: old } });
      await prismaClient.apiClientCredential.updateMany({ where: { client: { profile: { code: appId } } }, data: { last_used_at: old } });
      expect((await (await removal(accessToken)).json()).data.can_remove).toBe(true);
    });

    it("removes what belongs to the application, revokes its client and can be added again", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken);
      const { data } = await (await TestRequest.post(`${ACCESS}/apps/${appId}/connect`, {}, accessToken)).json();
      await prismaClient.applicationPermission.create({ data: { application_id: appId, key: "app.use", source: "MANIFEST" } });
      await TestRequest.post(ROLES, { application_id: appId, key: "STAFF", label: "Staff", permissions: ["app.use"], allows_employees: true }, accessToken);
      await TestRequest.post(RULES, { application_id: appId, audience: "EMPLOYEES", default_role_key: "STAFF" }, accessToken);
      const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      await prismaClient.apiClient.updateMany({ where: { profile: { code: appId } }, data: { last_used_at: old } });
      await prismaClient.apiClientCredential.updateMany({ where: { client: { profile: { code: appId } } }, data: { last_used_at: old } });

      const plan = (await (await removal(accessToken)).json()).data;
      expect(plan.will_delete).toEqual({ roles: 1, groups: 1, permissions: 1, clients: 1, people: 0 });
      expect((await remove(accessToken)).status).toBe(200);

      expect(await prismaClient.application.count({ where: { application_id: appId } })).toBe(0);
      expect(await prismaClient.applicationRole.count({ where: { application_id: appId } })).toBe(0);
      expect(await prismaClient.applicationAccessRule.count({ where: { application_id: appId } })).toBe(0);
      expect(await prismaClient.applicationPermission.count({ where: { application_id: appId } })).toBe(0);
      expect(await prismaClient.applicationOrganization.count({ where: { application_id: appId } })).toBe(0);
      const clients = await prismaClient.apiClient.findMany({ where: { profile: { code: appId } } });
      expect(clients).toHaveLength(1);
      expect(clients[0]!.is_active).toBe(false);
      expect(await prismaClient.auditLog.count({ where: { action: "APPLICATION_DELETE", entity_type: "Application" } })).toBe(1);

      // The old token no longer works and the list no longer has it.
      const dead = await TestRequest.get(`/api/internal/applications`, undefined, { Authorization: `Bearer ${data.token}` });
      expect(dead.status).toBe(401);
      const list = (await (await TestRequest.get(`${ACCESS}/applications?search=${appId}`, accessToken)).json()).data;
      expect(list).toHaveLength(0);

      // Same id again, with a new connection.
      expect((await create(accessToken)).status).toBe(200);
      expect((await TestRequest.post(`${ACCESS}/apps/${appId}/connect`, {}, accessToken)).status).toBe(200);
    });
  });
});
