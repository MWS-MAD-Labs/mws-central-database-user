import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes } from "crypto";
import { API_SCOPES } from "../constants/api-scopes";
import { prismaClient } from "../lib/prisma";
import { syncApiScopes } from "../lib/sync-api-scopes";
import { slugifyApplicationId } from "../utils/application-id";
import { decryptSecret } from "../utils/secret-box";
import { deriveAppSecret } from "../utils/hub-app-secret";
import { checkApplicationAddresses, checkOneApplication, healthOf, useExchangeSeenForTest } from "../service/application-health";
import { AdminUserTest, ApiClientTest, EmployeeTest, HubTest, MasterDataTest, TestRequest } from "./test-utils";

const ACCESS = "/api/admin/application-access";

// The secret is never handed out to read, so the tests look at what is kept.
const keptSecret = async (applicationId: string) =>
  decryptSecret((await prismaClient.application.findUniqueOrThrow({ where: { application_id: applicationId } })).hub_internal_secret!);
const ROLES = "/api/admin/application-roles";
const RULES = "/api/admin/application-access-rules";

describe("application onboarding", () => {
  let appId: string;
  let master: Awaited<ReturnType<typeof MasterDataTest.create>>;

  // Connecting needs the scope rows, which the server creates at boot. A database that was only migrated has none.
  beforeAll(async () => {
    await syncApiScopes();
  });

  beforeEach(async () => {
    await HubTest.ensure();
    appId = `test-onb-${randomBytes(4).toString("hex")}`;
    master = await MasterDataTest.create();
  });

  afterEach(async () => {
    await HubTest.cleanup();
    await prismaClient.auditLog.deleteMany({
      where: { OR: [{ entity_type: "Application" }, { entity_type: "ApplicationOrganization" }, { entity_type: "ApplicationIntegrationProfile" }] },
    });
    await prismaClient.applicationAccessRule.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationRole.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationPermission.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationOrganization.deleteMany({ where: { application_id: appId } });
    await prismaClient.application.deleteMany({ where: { application_id: appId } });
    await ApiClientTest.delete();
    // The Hub is always named HUB, so its client is not one of the TEST_ ones.
    await prismaClient.apiClient.deleteMany({ where: { profile: { code: appId } } });
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

  it("turns a regular Super Admin away from every application route", async () => {
    const { accessToken: plain } = await AdminUserTest.createSuperAdmin(undefined, { id: "test-plain-super-id", email: "test_plain_super@millennia21.id", plain: true });
    for (const path of ["application-access/applications", "application-roles", "application-permissions", "application-entitlements", "application-organizations", "application-integration-profiles"]) {
      expect((await TestRequest.get(`/api/admin/${path}`, plain)).status).toBe(403);
    }
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    expect((await TestRequest.get(`${ACCESS}/applications`, accessToken)).status).toBe(200);
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
    expect(status.connection).toEqual({ client_id: null, created: false, created_at: null, last_used_at: null, newest_token_used_at: null });
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

    const group = await TestRequest.post(RULES, { application_id: appId, audiences: ["EMPLOYEES"], default_role_key: "STAFF" }, accessToken);
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
    expect(env.CENTRAL_API_TOKEN).toBe(data.token);
    expect(env.CENTRAL_ORGANIZATION_ID).toMatch(/^org_/);

    const profile = await prismaClient.applicationIntegrationProfile.findUniqueOrThrow({
      where: { code: appId },
      include: { scopes: { include: { scope: true } } },
    });
    expect(profile.scopes.map((item) => item.scope.name).sort()).toEqual(
      [API_SCOPES.APPLICATION_ENTITLEMENTS_READ, API_SCOPES.APPLICATION_PERMISSIONS_WRITE, API_SCOPES.EMPLOYEES_READ].sort(),
    );

    // Behind a proxy the address is the one the proxy forwarded.
    expect(env.CENTRAL_API_BASE_URL).toMatch(/^https?:\/\/[^/]+\/api\/internal$/);

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
    // Not finished: the setup steps are still what the page shows.
    expect((await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data.setup_completed).toBe(false);

    await prismaClient.applicationPermission.create({
      data: { application_id: appId, key: "app.use", source: "MANIFEST", synced_at: new Date() },
    });
    await TestRequest.post(
      ROLES,
      { application_id: appId, key: "STAFF", label: "Staff", permissions: ["app.use"], allows_employees: true },
      accessToken,
    );
    await TestRequest.post(RULES, { application_id: appId, audiences: ["EMPLOYEES"], default_role_key: "STAFF" }, accessToken);
    await TestRequest.patch(`${ACCESS}/apps/${appId}/details`, { launch_url: "https://onb.example.com/auth/sso" }, accessToken);

    const published = await TestRequest.post(`${ACCESS}/apps/${appId}/publish`, {}, accessToken);
    expect(published.status).toBe(200);
    expect((await prismaClient.application.findUniqueOrThrow({ where: { application_id: appId } })).published).toBe(true);

    const hidden = await TestRequest.post(`${ACCESS}/apps/${appId}/unpublish`, {}, accessToken);
    expect(hidden.status).toBe(200);
    expect((await prismaClient.application.findUniqueOrThrow({ where: { application_id: appId } })).published).toBe(false);
    // Hiding it again does not take the setup back: from here on it is managed from Settings.
    expect((await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data.setup_completed).toBe(true);
    // The list knows too, so it can offer Settings instead of the setup steps.
    const listed = (await (await TestRequest.get(`${ACCESS}/applications?search=${appId}`, accessToken)).json()).data;
    expect(listed.find((row: { application_id: string }) => row.application_id === appId)?.setup_completed).toBe(true);
  });

  it("keeps the status and keywords of the card, in clean form", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await create(accessToken);
    const saved = await TestRequest.patch(
      `${ACCESS}/apps/${appId}/details`,
      { hub_status: "coming_soon", hub_keywords: [" Check In ", "check in", "Daily"] },
      accessToken,
    );
    expect(saved.status).toBe(200);
    const row = await prismaClient.application.findUniqueOrThrow({ where: { application_id: appId } });
    expect(row.hub_status).toBe("COMING_SOON");
    expect(row.hub_keywords).toEqual(["check in", "daily"]);
    const bad = await TestRequest.patch(`${ACCESS}/apps/${appId}/details`, { hub_status: "gone" }, accessToken);
    expect(bad.status).toBe(400);
  });

  it("tells the Settings page about the token, the roles and the latest changes", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await create(accessToken);
    const none = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/settings`, accessToken)).json()).data;
    expect(none.token).toBeNull();
    expect(none.access).toMatchObject({ groups: 0, people: 0, roles: [] });

    await prismaClient.applicationPermission.create({ data: { application_id: appId, key: "app.use", source: "MANIFEST", synced_at: new Date() } });
    await TestRequest.post(ROLES, { application_id: appId, key: "STAFF", label: "staff", permissions: ["app.use"], allows_employees: true }, accessToken);
    await TestRequest.patch(`${ACCESS}/apps/${appId}/details`, { hub_status: "maintenance" }, accessToken);
    const connected = await TestRequest.post(`${ACCESS}/apps/${appId}/connect`, {}, accessToken);
    expect(connected.status).toBe(200);

    const data = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/settings`, accessToken)).json()).data;
    expect(data.token.prefix).toMatch(/^mws_/);
    expect(data.access.roles).toEqual([expect.objectContaining({ key: "STAFF", label: "Staff", permission_count: 1, people: 0, groups: 0 })]);
    expect(data.activity.map((item: { summary: string }) => item.summary)).toEqual(expect.arrayContaining(["Changed the card status", "Added the application"]));
    expect(data.activity[0].by).toBeTruthy();
    expect(data.activity.every((item: { summary: string }) => !item.summary.includes("undefined"))).toBe(true);

    // Each change says what it was and what it became.
    const card = data.activity.find((item: { summary: string }) => item.summary === "Changed the card status");
    expect(card.changes).toEqual([{ label: "card status", from: "Active", to: "Maintenance" }].map((row) => expect.objectContaining({ label: row.label, to: expect.stringMatching(/maintenance/i) })));
    expect(card).toMatchObject({ title: "Details Changed", by_email: expect.stringContaining("@"), by_role: "SUPER_ADMIN" });
    expect(data.activity.map((item: { title: string }) => item.title)).toContain("Added");
    // The dates narrow the list: a window in the past holds nothing, and a bad date is refused.
    const empty = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/settings?date_from=2020-01-01T00:00:00.000&date_to=2020-01-02T23:59:59.999`, accessToken)).json()).data;
    expect(empty.activity).toEqual([]);
    const today = new Date().toISOString().slice(0, 10);
    const inRange = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/settings?date_from=${today}T00:00:00.000&date_to=${today}T23:59:59.999`, accessToken)).json()).data;
    expect(inRange.activity.length).toBeGreaterThan(0);
    expect((await TestRequest.get(`${ACCESS}/apps/${appId}/settings?date_from=nope`, accessToken)).status).toBe(400);

    // The changes come a page at a time, newest first.
    expect(data.activity_paging).toMatchObject({ current_page: 1, size: 10 });
    const small = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/settings?page=2&size=1`, accessToken)).json()).data;
    expect(small.activity).toHaveLength(1);
    expect(small.activity_paging).toMatchObject({ current_page: 2, size: 1 });
    expect(small.activity_paging.total_item).toBeGreaterThanOrEqual(3);
    const past = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/settings?page=99&size=1`, accessToken)).json()).data;
    expect(past.activity_paging.current_page).toBe(past.activity_paging.total_page);

    const { accessToken: other } = await AdminUserTest.createDatabaseAdmin();
    expect((await TestRequest.get(`${ACCESS}/apps/${appId}/settings`, other)).status).toBe(403);
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
        hub_status: "MAINTENANCE",
        hub_keywords: ["checkin", "daily"],
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
        scope: null,
        launch_url: "https://onb.example.com/auth/sso",
        logout_url: "https://onb.example.com/auth/logout",
        launch_mode: "sso",
        session_mode: "relay",
        status: "maintenance",
        keywords: ["checkin", "daily"],
        hub_secret: { mode: "shared", version: 1 },
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
        "APP_BASE_URL",
        "CENTRAL_API_BASE_URL",
        "CENTRAL_API_TOKEN",
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
      // The card has room for 50 characters of description.
      expect(await bad({ description: "a".repeat(51) })).toBe(400);
      expect(await bad({ icon: "App Window" })).toBe(400);
      expect(await bad({ icon: "../x" })).toBe(400);
      // The Hub only draws the icons it knows, so a made up name is refused.
      expect(await bad({ icon: "Cash" })).toBe(400);
      expect(await bad({ category: "Finance" })).toBe(400);
      expect(await bad({ scope: "nowhere" })).toBe(400);
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

    it("notes whether the Organization ID an application sends is the one Central made, and never refuses a call for it", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const { data } = await (await create(accessToken, { connect: true })).json();
      const organizationId = data.organization_id;
      const base = { Authorization: `Bearer ${data.connection.token}`, "Content-Type": "application/json" };
      const check = async () => (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data.organization;

      // Nothing sent yet.
      expect(await check()).toMatchObject({ id: organizationId, check: "not_reported", reported: null, checked_at: null });
      const quiet = await TestRequest.get("/api/internal/application-permissions/me", undefined, base);
      expect(quiet.status).toBe(200);
      expect((await check()).check).toBe("not_reported");

      // The right one.
      const right = await TestRequest.get("/api/internal/application-permissions/me", undefined, { ...base, "X-Central-Organization-Id": organizationId });
      expect(right.status).toBe(200);
      expect(await check()).toMatchObject({ check: "matches", reported: organizationId });

      // A wrong one is noted, the call still works, and a call without it leaves the note as it was.
      const wrong = await TestRequest.get("/api/internal/application-permissions/me", undefined, { ...base, "X-Central-Organization-Id": "org_other_aaaaaaaaaaaaaaaaaaaa" });
      expect(wrong.status).toBe(200);
      expect(await check()).toMatchObject({ check: "mismatch", reported: "org_other_aaaaaaaaaaaaaaaaaaaa" });
      await TestRequest.get("/api/internal/application-permissions/me", undefined, base);
      expect((await check()).check).toBe("mismatch");

      // Something that is not an ID is ignored.
      await TestRequest.get("/api/internal/application-permissions/me", undefined, { ...base, "X-Central-Organization-Id": "not an id!" });
      expect((await check()).reported).toBe("org_other_aaaaaaaaaaaaaaaaaaaa");

      // Setting it right again clears the mismatch.
      await TestRequest.get("/api/internal/application-permissions/me", undefined, { ...base, "X-Central-Organization-Id": organizationId });
      expect((await check()).check).toBe("matches");
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
      expect(env).toMatchObject({ HUB_SSO_APP_ID: appId, CENTRAL_API_TOKEN: next });
      expect(env.CENTRAL_API_BASE_URL).toMatch(/\/api\/internal$/);
      expect(env.CENTRAL_ORGANIZATION_ID).toMatch(/^org_/);
      expect(next).not.toBe(data.connection.token);
      // Emergency rotation stops the old token at once.
      expect((await TestRequest.get("/api/internal/applications", undefined, { Authorization: `Bearer ${data.connection.token}` })).status).toBe(401);
      expect((await TestRequest.get("/api/internal/applications", undefined, { Authorization: `Bearer ${next}` })).status).toBe(200);
    });

    it("proves a rotation only when the new token is used, not the old one still running", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const { data } = await (await create(accessToken, { connect: true })).json();
      const rotated = await TestRequest.post(`${ACCESS}/apps/${appId}/rotate`, { grace_hours: 24 }, accessToken);
      const next = (await rotated.json()).data.token as string;
      const used = async () => (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data.connection.newest_token_used_at;
      await TestRequest.get("/api/internal/applications", undefined, { Authorization: `Bearer ${data.connection.token}` });
      expect(await used()).toBeNull();
      await TestRequest.get("/api/internal/applications", undefined, { Authorization: `Bearer ${next}` });
      expect(await used()).not.toBeNull();
    });

    it("tells when an application still calls with a token that was replaced, and clears it once the new one is used", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const { data } = await (await create(accessToken, { connect: true })).json();
      const old = data.connection.token as string;
      const rotated = await TestRequest.post(`${ACCESS}/apps/${appId}/rotate`, { immediate: true }, accessToken);
      const next = (await rotated.json()).data.token as string;
      const health = async () => (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data.health;
      const rejectedAt = async () =>
        (await prismaClient.apiClientCredential.findMany({ where: { client: { profile: { code: appId } }, last_rejected_at: { not: null } } }))[0]?.last_rejected_at ?? null;
      const call = (token: string) => TestRequest.get("/api/internal/applications", undefined, { Authorization: `Bearer ${token}` });

      // A made up secret on the same prefix says nothing, only the real old token does.
      await call(`${old.split(".")[0]}.not-the-secret`);
      expect(await rejectedAt()).toBeNull();
      expect((await call(old)).status).toBe(401);
      const first = await rejectedAt();
      expect(first).not.toBeNull();
      expect((await health()).status).toBe("check_token");
      // Once every five minutes, like the last use.
      await call(old);
      expect((await rejectedAt())?.getTime()).toBe(first!.getTime());

      expect((await call(next)).status).toBe(200);
      expect((await health()).status).toBe("healthy");
    });

    it("marks an application unreachable after two failed checks and clears it on an answer", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken, { connect: true });
      const health = async () => (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data.health;
      await checkApplicationAddresses(async () => "unreachable");
      expect((await health()).status).not.toBe("unreachable");
      await checkApplicationAddresses(async () => "unreachable");
      expect(await health()).toMatchObject({ status: "unreachable", detail: "Not answering at its address" });
      const list = (await (await TestRequest.get(`${ACCESS}/applications?search=${appId}`, accessToken)).json()).data;
      expect(list.find((row: { application_id: string }) => row.application_id === appId).health.status).toBe("unreachable");
      await checkApplicationAddresses(async () => "ok");
      expect((await health()).status).not.toBe("unreachable");
    });

    it("keeps a wrong path at once and Check Now asks right away without waiting for a second miss", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken, { connect: true });
      const health = async () => (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data.health;
      await checkApplicationAddresses(async () => "wrong_path");
      expect(await health()).toMatchObject({ status: "wrong_path", detail: "The sign-in address answers Not Found" });
      await checkApplicationAddresses(async () => "ok");
      expect((await health()).status).not.toBe("wrong_path");

      // One miss does not mark it in the background loop, but Check Now does.
      const row = await prismaClient.application.findUniqueOrThrow({ where: { application_id: appId } });
      await checkOneApplication(row, { check: async () => "unreachable", immediate: true });
      expect((await health()).status).toBe("unreachable");

      const checked = await TestRequest.post(`${ACCESS}/apps/${appId}/check`, {}, accessToken);
      expect(checked.status).toBe(200);
      // Nothing listens at the example address, so it is asked for real and answers with one of the verdicts.
      expect(["ok", "unreachable", "wrong_path"]).toContain((await checked.json()).data.verdict);
      const { accessToken: other } = await AdminUserTest.createDatabaseAdmin();
      expect((await TestRequest.post(`${ACCESS}/apps/${appId}/check`, {}, other)).status).toBe(403);
    });

    it("refuses an address another live application has, and tells a shared origin in the list", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken, { launch_url: "https://shared-origin.example.com/mtss/auth/sso" });
      const twin = `${appId}-twin`;
      const same = await TestRequest.post(`${ACCESS}/applications`, { application_id: twin, name: "TEST_Twin", launch_url: "https://SHARED-origin.example.com/mtss/auth/sso/" }, accessToken);
      expect(same.status).toBe(400);
      expect((await same.json()).errors).toContain("TEST_Onboard already uses this sign-in address");

      const sibling = await TestRequest.post(`${ACCESS}/applications`, { application_id: twin, name: "TEST_Twin", launch_url: "https://shared-origin.example.com/daily/auth/sso" }, accessToken);
      expect(sibling.status).toBe(200);
      try {
        const list = (await (await TestRequest.get(`${ACCESS}/applications?search=${twin}`, accessToken)).json()).data;
        expect(list.find((row: { application_id: string }) => row.application_id === twin).shares_origin_with).toEqual(["TEST_Onboard"]);
        const moved = await TestRequest.patch(`${ACCESS}/apps/${twin}/details`, { launch_url: "https://shared-origin.example.com/mtss/auth/sso" }, accessToken);
        expect(moved.status).toBe(400);
      } finally {
        await prismaClient.application.deleteMany({ where: { application_id: twin } });
        await prismaClient.applicationOrganization.deleteMany({ where: { application_id: twin } });
      }
    });

    it("gives one port on a local host to one application, even when the paths differ, and checks it on every save", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const port = 43000 + Math.floor(Math.random() * 1000);
      await create(accessToken, { launch_url: `http://localhost:${port}/auth/sso` });
      const twin = `${appId}-twin`;
      try {
        const clash = await TestRequest.post(`${ACCESS}/applications`, { application_id: twin, name: "TEST_Twin", launch_url: `http://localhost:${port}/api/v1/auth/sso` }, accessToken);
        expect(clash.status).toBe(400);
        expect((await clash.json()).errors).toContain(`TEST_Onboard already uses localhost:${port}. Each port on this machine belongs to one application`);
        // A row made before the rule, with the very same address, cannot be saved again until it is put right.
        await prismaClient.application.create({ data: { application_id: twin, name: "TEST_Twin", launch_url: `http://localhost:${port}/auth/sso` } });
        const resave = await TestRequest.patch(`${ACCESS}/apps/${twin}/details`, { name: "TEST_Twin 2", launch_url: `http://localhost:${port}/auth/sso` }, accessToken);
        expect(resave.status).toBe(400);
        const moved = await TestRequest.patch(`${ACCESS}/apps/${twin}/details`, { launch_url: `http://localhost:${port + 1}/auth/sso` }, accessToken);
        expect(moved.status).toBe(200);
      } finally {
        await prismaClient.application.deleteMany({ where: { application_id: twin } });
        await prismaClient.applicationOrganization.deleteMany({ where: { application_id: twin } });
      }
    });

    it("waits for proof after the sign-in way changes, from the app's own lookups for shared and from the Hub for code and token", async () => {
      const shared = `test-sess-${randomBytes(3).toString("hex")}`;
      process.env.HUB_APPLICATION_ID = appId;
      try {
        const { accessToken } = await AdminUserTest.createSuperAdmin();
        await create(accessToken, { is_hub: true, application_id: undefined, name: "HUB", hub_base_url: "https://hub.example.com/", hub_secret: "master-secret-0123456789abcdef" });
        const made = await TestRequest.post(`${ACCESS}/applications`, { application_id: shared, name: "TEST_Sess", launch_url: "https://sess.example.com/auth/sso", connect: true }, accessToken);
        const token = (await made.json()).data.connection.token as string;
        const detail = (body: Record<string, unknown>) => TestRequest.patch(`${ACCESS}/apps/${shared}/details`, body, accessToken);
        const setup = async () => (await (await TestRequest.get(`${ACCESS}/apps/${shared}/setup`, accessToken)).json()).data;
        let hubSeen: Date | null = null;
        let hubKnown = true;
        useExchangeSeenForTest(async () => ({ known: hubKnown, seenAt: hubSeen }));

        await TestRequest.get("/api/internal/applications", undefined, { Authorization: `Bearer ${token}` });
        // Never switched: nothing to prove.
        expect((await setup()).session_check).toBeNull();

        // To code and token: the Hub has not seen a code traded yet.
        await detail({ session_mode: "relay" });
        let data = await setup();
        expect(data.session_check).toMatchObject({ mode: "relay", confirmed_at: null, known: true });
        expect(data.health.status).toBe("sign_in_pending");
        hubKnown = false;
        expect((await setup()).session_check.known).toBe(false);
        hubKnown = true;
        hubSeen = new Date(Date.now() - 3_600_000);
        expect((await setup()).session_check.confirmed_at).toBeNull();
        hubSeen = new Date(Date.now() + 60_000);
        data = await setup();
        expect(data.session_check.confirmed_at).not.toBeNull();
        expect(data.health.status).not.toBe("sign_in_pending");

        // Back to shared: the app's own lookup after the switch is the proof, one before it is not.
        const lookup = () => TestRequest.get(`/api/internal/application-entitlements/lookup?person_id=nobody&application_id=${shared}`, undefined, { Authorization: `Bearer ${token}` });
        await lookup();
        await detail({ session_mode: "shared" });
        expect((await setup()).session_check).toMatchObject({ mode: "shared", confirmed_at: null });
        await lookup();
        expect((await setup()).session_check.confirmed_at).not.toBeNull();
      } finally {
        useExchangeSeenForTest(null);
        delete process.env.HUB_APPLICATION_ID;
        await prismaClient.applicationRole.deleteMany({ where: { application_id: shared } });
        await prismaClient.applicationOrganization.deleteMany({ where: { application_id: shared } });
        await prismaClient.application.deleteMany({ where: { application_id: shared } });
        await prismaClient.apiClient.deleteMany({ where: { profile: { code: shared } } });
        await prismaClient.applicationIntegrationProfile.deleteMany({ where: { code: shared } });
      }
    });

    it("works out the health from what Central saw", () => {
      const now = new Date("2026-10-23T10:00:00Z");
      const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
      const live = { status: "ACTIVE", issued_at: ago(100), expires_at: null, revoked_at: null, last_used_at: ago(1), last_rejected_at: null };
      const dead = { status: "REVOKED", issued_at: ago(200), expires_at: null, revoked_at: ago(30), last_used_at: ago(40), last_rejected_at: ago(5) };
      const base = { connected: true, addressStatus: "ok", addressDownSince: null, now };
      expect(healthOf({ ...base, credentials: [live] }).status).toBe("healthy");
      expect(healthOf({ ...base, connected: false, credentials: [{ ...live, last_used_at: null }] }).status).toBe("pending");
      expect(healthOf({ ...base, credentials: [live, dead] }).status).toBe("healthy");
      expect(healthOf({ ...base, credentials: [{ ...live, last_used_at: ago(20) }, dead] }).status).toBe("check_token");
      expect(healthOf({ ...base, credentials: [{ ...live, last_used_at: null }, dead] }).status).toBe("check_token");
      // A rotation whose new token nobody has used yet stays visible, graceful or not.
      const retiring = { status: "RETIRING", issued_at: ago(200), expires_at: new Date(now.getTime() + 3_600_000), revoked_at: null, last_used_at: ago(1), last_rejected_at: null };
      const fresh = { ...live, issued_at: ago(10), last_used_at: null };
      expect(healthOf({ ...base, credentials: [retiring, fresh] })).toMatchObject({ status: "token_pending", since: retiring.expires_at.toISOString() });
      expect(healthOf({ ...base, credentials: [{ ...dead, last_rejected_at: null }, fresh] })).toMatchObject({ status: "token_pending", detail: "The old token has stopped. The app needs the new token now" });
      expect(healthOf({ ...base, credentials: [retiring, { ...fresh, last_used_at: ago(2) }] }).status).toBe("healthy");
      // A sign-in way change nobody has proved yet shows for a week.
      const week = (days: number) => new Date(now.getTime() - days * 86_400_000);
      expect(healthOf({ ...base, credentials: [live], signIn: { changedAt: week(1), confirmedAt: null } }).status).toBe("sign_in_pending");
      expect(healthOf({ ...base, credentials: [live], signIn: { changedAt: week(1), confirmedAt: ago(5) } }).status).toBe("healthy");
      expect(healthOf({ ...base, credentials: [live], signIn: { changedAt: week(8), confirmedAt: null } }).status).toBe("healthy");
      expect(healthOf({ ...base, addressStatus: "unreachable", addressDownSince: ago(10), credentials: [live, dead] })).toMatchObject({ status: "unreachable", since: ago(10).toISOString() });
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
        await prismaClient.application.create({ data: { application_id: hubId, name: "HUB" } });
        await prismaClient.applicationOrganization.create({ data: { application_id: hubId, organization_id: "org_hub_x" } });
        await create(accessToken);
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

  describe("the Hub's .env and sign-in settings", () => {
    const asHub = async <T>(run: (accessToken: string) => Promise<T>) => {
      process.env.HUB_APPLICATION_ID = appId;
      try {
        const { accessToken } = await AdminUserTest.createSuperAdmin();
        return await run(accessToken);
      } finally {
        delete process.env.HUB_APPLICATION_ID;
      }
    };

    it("hands over the names the Hub reads, with warn and the creator as bypass by default", async () => {
      await asHub(async (accessToken) => {
        const response = await TestRequest.post(`${ACCESS}/applications`, { name: "HUB", is_hub: true, connect: true }, accessToken);
        expect(response.status).toBe(200);
        const { data } = await response.json();
        const items = data.connection.env as { key: string; value: string; line: string; secret: boolean }[];
        expect(items.map((item) => item.key)).toEqual([
          "CENTRAL_API_BASE_URL",
          "CENTRAL_API_TOKEN",
          "CENTRAL_ORGANIZATION_ID",
          "HUB_CENTRAL_ACCESS_MODE",
          "HUB_CENTRAL_ACCESS_APP_ID",
          "HUB_CENTRAL_ACCESS_BYPASS_EMAILS",
          "HUB_ACCESS_COOKIE_NAME",
          "HUB_INTERNAL_SECRET",
        ]);
        const byKey = Object.fromEntries(items.map((item) => [item.key, item]));
        expect(byKey.HUB_INTERNAL_SECRET.secret).toBe(true);
        expect(byKey.HUB_INTERNAL_SECRET.value).toMatch(/^[0-9a-f]{64}$/);
        expect(byKey.CENTRAL_API_BASE_URL.value).toMatch(/^https?:\/\/[^/]+\/api\/internal$/);
        expect(byKey.CENTRAL_API_TOKEN.secret).toBe(true);
        expect(byKey.CENTRAL_API_TOKEN.line).toBe(`CENTRAL_API_TOKEN="${data.connection.token}"`);
        expect(byKey.HUB_CENTRAL_ACCESS_MODE.line).toBe('HUB_CENTRAL_ACCESS_MODE="warn"');
        expect(byKey.HUB_CENTRAL_ACCESS_APP_ID.value).toBe(appId);
        expect(byKey.HUB_CENTRAL_ACCESS_BYPASS_EMAILS.value).toMatch(/@/);
      });
    });

    it("keeps the Hub address and secret, hides the secret, and puts both into the .env of an application", async () => {
      const other = `test-hubuse-${randomBytes(3).toString("hex")}`;
      await asHub(async (accessToken) => {
        // No application can be added before the Hub is.
        const before = await create(accessToken, { application_id: other, name: "TEST_Other", connect: true, session_mode: "relay" });
        expect(before.status).toBe(400);
        expect((await before.json()).errors).toContain("Add the Hub first");

        const hub = await TestRequest.post(`${ACCESS}/applications`, { name: "HUB", is_hub: true, hub_base_url: "https://hub.example.com/", connect: true }, accessToken);
        expect(hub.status).toBe(200);
        const stored = await prismaClient.application.findUniqueOrThrow({ where: { application_id: appId } });
        expect(stored.hub_base_url).toBe("https://hub.example.com");
        // Kept encrypted, never as it is.
        expect(stored.hub_internal_secret).toMatch(/^v1:/);

        const setup = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data;
        expect(setup.hub).toEqual({ base_url: "https://hub.example.com", secret_set: true, key_ready: true });
        expect(JSON.stringify(setup)).not.toContain("secret\":\"");
        expect(JSON.stringify(setup)).not.toContain(stored.hub_internal_secret!);

        const secret = await keptSecret(appId);
        expect(secret).toMatch(/^[0-9a-f]{64}$/);
        // There is no way to read it back.
        expect((await TestRequest.get(`${ACCESS}/apps/${appId}/hub-secret`, accessToken)).status).toBe(404);

        const created = await create(accessToken, { application_id: other, name: "TEST_Other", connect: true, session_mode: "relay" });
        const env = (await created.json()).data.connection;
        expect(env.hub_lines_missing).toBe(false);
        const byKey = Object.fromEntries(env.env.map((item: { key: string }) => [item.key, item]));
        expect(byKey.HUB_BASE_URL.value).toBe("https://hub.example.com");
        expect(byKey.HUB_SSO_JWKS_URL.value).toBe("https://hub.example.com/.well-known/jwks.json");
        // The application has a secret of its own, made from the master.
        expect(byKey.HUB_INTERNAL_SECRET.value).toBe(deriveAppSecret(secret, other, 1));
        expect(byKey.HUB_INTERNAL_SECRET.secret).toBe(true);
        const otherKeys = (await (await TestRequest.get(`${ACCESS}/apps/${other}/setup`, accessToken)).json()).data.env_keys.map((item: { key: string }) => item.key);
        expect(otherKeys).toContain("HUB_INTERNAL_SECRET");

        // A new secret replaces it, and one the Hub already runs with can be kept.
        const made = await TestRequest.post(`${ACCESS}/apps/${appId}/hub-secret`, {}, accessToken);
        expect(made.status).toBe(200);
        // A secret Central made is returned this once.
        const next = (await made.json()).data.secret;
        expect(next).toMatch(/^[0-9a-f]{64}$/);
        expect(next).not.toBe(secret);
        expect(await keptSecret(appId)).toBe(next);
        expect((await TestRequest.post(`${ACCESS}/apps/${appId}/hub-secret`, { secret: "short" }, accessToken)).status).toBe(400);
        // One that is pasted is kept and not sent back.
        const pasted = await TestRequest.post(`${ACCESS}/apps/${appId}/hub-secret`, { secret: "kept-from-the-hub-env-0123456789" }, accessToken);
        expect(pasted.status).toBe(200);
        expect((await pasted.json()).data).toEqual({ secret_set: true });
        expect(await keptSecret(appId)).toBe("kept-from-the-hub-env-0123456789");

        // The address has to be an origin.
        const address = (body: unknown) => TestRequest.patch(`${ACCESS}/apps/${appId}/hub-address`, body, accessToken);
        expect((await address({ hub_base_url: "https://hub.example.com/path" })).status).toBe(400);
        expect((await address({ hub_base_url: "http://hub.example.com" })).status).toBe(400);
        expect((await address({ hub_base_url: "http://localhost:4001" })).status).toBe(200);

        // Nothing shows the value in the audit log.
        const logs = await prismaClient.auditLog.findMany({ where: { entity_type: "Application" } });
        expect(JSON.stringify(logs)).not.toContain("kept-from-the-hub-env");
        expect(JSON.stringify(logs)).not.toContain(next);

        // Only the Hub has them.
        expect((await TestRequest.post(`${ACCESS}/apps/${other}/hub-secret`, {}, accessToken)).status).toBe(400);
      });
      await prismaClient.application.deleteMany({ where: { application_id: other } });
      await prismaClient.applicationOrganization.deleteMany({ where: { application_id: other } });
      await prismaClient.applicationRole.deleteMany({ where: { application_id: other } });
      await prismaClient.apiClient.deleteMany({ where: { profile: { code: other } } });
      await prismaClient.applicationIntegrationProfile.deleteMany({ where: { code: other } });
    });

    it("keeps the secret the Hub already runs with when the Hub is added, and tells whether Central can keep one", async () => {
      await asHub(async (accessToken) => {
        const status = await TestRequest.get(`${ACCESS}/secrets-status`, accessToken);
        expect((await status.json()).data).toEqual({ key_ready: true });

        const short = await TestRequest.post(`${ACCESS}/applications`, { name: "HUB", is_hub: true, hub_secret: "short" }, accessToken);
        expect(short.status).toBe(400);
        const response = await TestRequest.post(
          `${ACCESS}/applications`,
          { name: "HUB", is_hub: true, hub_base_url: "https://hub.example.com", hub_secret: "kept-from-the-hub-env-0123456789" },
          accessToken,
        );
        expect(response.status).toBe(200);
        expect(await keptSecret(appId)).toBe("kept-from-the-hub-env-0123456789");

        const original = process.env.APP_SECRETS_KEY;
        delete process.env.APP_SECRETS_KEY;
        try {
          expect((await (await TestRequest.get(`${ACCESS}/secrets-status`, accessToken)).json()).data).toEqual({ key_ready: false });
          const setup = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data;
          expect(setup.hub.key_ready).toBe(false);
        } finally {
          process.env.APP_SECRETS_KEY = original;
        }
      });
    });

    it("changes the settings, validates them, and uses them on the next rotation", async () => {
      await asHub(async (accessToken) => {
        await TestRequest.post(`${ACCESS}/applications`, { name: "HUB", is_hub: true, connect: true }, accessToken);
        const patch = (body: unknown) => TestRequest.patch(`${ACCESS}/apps/${appId}/env-settings`, body, accessToken);
        expect((await patch({ hub_access_mode: "loud", hub_bypass_emails: [] })).status).toBe(400);
        expect((await patch({ hub_access_mode: "warn", hub_bypass_emails: ["not-an-email"] })).status).toBe(400);
        expect((await patch({ hub_access_mode: "warn", hub_bypass_emails: ["a@millennia21.id", "A@millennia21.id"] })).status).toBe(400);
        expect((await patch({ hub_access_mode: "warn", hub_bypass_emails: Array.from({ length: 4 }, (_, i) => `u${i}@millennia21.id`) })).status).toBe(400);
        expect((await patch({ hub_access_mode: "warn", hub_bypass_emails: [`${"a".repeat(40)}@millennia21.id`] })).status).toBe(400);
        expect((await patch({ hub_access_mode: "warn", hub_bypass_emails: ["boss@gmail.com"] })).status).toBe(400);
        expect((await patch({ hub_access_mode: "warn", hub_bypass_emails: ["bo ss@millennia21.id"] })).status).toBe(400);

        expect((await patch({ hub_access_mode: "enforce", hub_bypass_emails: ["Boss@Millennia21.id"] })).status).toBe(200);
        const setup = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data;
        expect(setup.env_settings).toEqual({ hub_access_mode: "enforce", hub_bypass_emails: ["boss@millennia21.id"], hub_access_cookie_name: "hub_at" });

        expect(setup.env_keys.map((item: { key: string }) => item.key)).toContain("HUB_CENTRAL_ACCESS_MODE");
        expect(setup.env_keys.find((item: { key: string }) => item.key === "CENTRAL_API_TOKEN").secret).toBe(true);
        const rotated = (await (await TestRequest.post(`${ACCESS}/apps/${appId}/rotate`, { immediate: true }, accessToken)).json()).data;
        const lines = rotated.env.map((item: { line: string }) => item.line);
        expect(lines).toContain('HUB_CENTRAL_ACCESS_MODE="enforce"');
        expect(lines).toContain('HUB_CENTRAL_ACCESS_BYPASS_EMAILS="boss@millennia21.id"');
      });
    });

    it("sets the cookie name of the shared session once, for the Hub and for the applications that read it", async () => {
      const shared = `test-cookie-${randomBytes(3).toString("hex")}`;
      await asHub(async (accessToken) => {
        await TestRequest.post(`${ACCESS}/applications`, { name: "HUB", is_hub: true, connect: true, hub_base_url: "https://hub.example.com/", hub_secret: "master-secret-0123456789abcdef" }, accessToken);
        const patch = (body: Record<string, unknown>) =>
          TestRequest.patch(`${ACCESS}/apps/${appId}/env-settings`, { hub_access_mode: "warn", hub_bypass_emails: [], ...body }, accessToken);

        // Without the name the usual one stays, and bad names are refused.
        expect((await patch({})).status).toBe(200);
        const plain = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data;
        expect(plain.env_settings.hub_access_cookie_name).toBe("hub_at");
        expect(plain.hub_access_cookie_name).toBe("hub_at");
        for (const bad of ["", "ab", "has space", "hub_rt", "HUB_SESSION", "a;b"]) {
          expect((await patch({ hub_access_cookie_name: bad })).status).toBe(400);
        }

        // An application that reads the shared session.
        const made = await create(accessToken, { application_id: shared, name: "TEST_Cookie", connect: true });
        const line = (env: { key: string; line: string }[]) => env.find((item) => item.key === "HUB_ACCESS_COOKIE_NAME")?.line;
        expect(line((await made.json()).data.connection.env)).toBe('HUB_ACCESS_COOKIE_NAME="hub_at"');

        expect((await patch({ hub_access_cookie_name: "hub_at_stg" })).status).toBe(200);
        const hub = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data;
        expect(hub.env_settings.hub_access_cookie_name).toBe("hub_at_stg");
        const hubRotated = (await (await TestRequest.post(`${ACCESS}/apps/${appId}/rotate`, { immediate: true }, accessToken)).json()).data;
        expect(line(hubRotated.env)).toBe('HUB_ACCESS_COOKIE_NAME="hub_at_stg"');
        // The applications that need the new line are named, with the Hub itself left out.
        const sharedIds = hub.shared_apps.map((app: { application_id: string }) => app.application_id);
        expect(sharedIds).toContain(shared);
        expect(sharedIds).not.toContain(appId);

        const app = (await (await TestRequest.get(`${ACCESS}/apps/${shared}/setup`, accessToken)).json()).data;
        expect(app.hub_access_cookie_name).toBe("hub_at_stg");
        expect(app.env_keys.map((item: { key: string }) => item.key)).toContain("HUB_ACCESS_COOKIE_NAME");
        const appRotated = (await (await TestRequest.post(`${ACCESS}/apps/${shared}/rotate`, { immediate: true }, accessToken)).json()).data;
        expect(line(appRotated.env)).toBe('HUB_ACCESS_COOKIE_NAME="hub_at_stg"');
        expect(app.shared_apps).toBeNull();

        const logs = await prismaClient.auditLog.findMany({ where: { entity_type: "Application" } });
        expect(JSON.stringify(logs.map((log) => log.new_values))).toContain("hub_at_stg");
      });
      await prismaClient.applicationRole.deleteMany({ where: { application_id: shared } });
      await prismaClient.applicationOrganization.deleteMany({ where: { application_id: shared } });
      await prismaClient.application.deleteMany({ where: { application_id: shared } });
      await prismaClient.apiClient.deleteMany({ where: { profile: { code: shared } } });
    });

    it("has no sign-in settings for an ordinary application", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken);
      const patch = await TestRequest.patch(`${ACCESS}/apps/${appId}/env-settings`, { hub_access_mode: "warn", hub_bypass_emails: [] }, accessToken);
      expect(patch.status).toBe(400);
      const setup = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data;
      expect(setup.env_settings).toBeNull();
    });
  });

  describe("the list tells more", () => {
    it("shows the connection, the permissions received and the launch mode of each row", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const { data } = await (await create(accessToken, { connect: true })).json();
      const rowOf = async () => {
        const list = (await (await TestRequest.get(`${ACCESS}/applications?search=${appId}&size=50`, accessToken)).json()).data;
        return list.find((item: { application_id: string }) => item.application_id === appId);
      };
      expect(await rowOf()).toMatchObject({ launch_mode: "sso", connection_created: true, connection_last_used_at: null, permission_count: 0 });
      await TestRequest.put("/api/internal/application-permissions/me", { permissions: [{ key: "a.b" }, { key: "a.c" }] }, undefined, {
        Authorization: `Bearer ${data.connection.token}`,
      });
      const after = await rowOf();
      expect(after.permission_count).toBe(2);
      expect(after.connection_last_used_at).not.toBeNull();
    });

    it("calls the Hub HUB in the list and in the setup, and puts an older row right", async () => {
      process.env.HUB_APPLICATION_ID = appId;
      try {
        const { accessToken } = await AdminUserTest.createSuperAdmin();
        await create(accessToken);
        await prismaClient.application.update({ where: { application_id: appId }, data: { name: "hub" } });
        const list = (await (await TestRequest.get(`${ACCESS}/applications?search=${appId}&size=50`, accessToken)).json()).data;
        expect(list.find((item: { application_id: string }) => item.application_id === appId).name).toBe("HUB");
        const setup = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data;
        expect(setup.application.name).toBe("HUB");
        expect((await prismaClient.application.findUniqueOrThrow({ where: { application_id: appId } })).name).toBe("HUB");
      } finally {
        delete process.env.HUB_APPLICATION_ID;
      }
    });
  });

  describe("a plain link", () => {
    it("has no connection, needs no permissions, and goes to the Hub as a link", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const response = await create(accessToken, { launch_mode: "link", connect: true, launch_url: "https://tools.example.com/report" });
      expect(response.status).toBe(200);
      const { data } = await response.json();
      expect(data.launch_mode).toBe("link");
      // Asked for a connection, but a link has nothing to connect.
      expect(data.connection).toBeNull();
      expect(await prismaClient.applicationIntegrationProfile.count({ where: { code: appId } })).toBe(0);
      expect((await TestRequest.post(`${ACCESS}/apps/${appId}/connect`, {}, accessToken)).status).toBe(400);

      const setup = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data;
      expect(setup.missing).toEqual(["roles", "groups"]);

      await TestRequest.post(ROLES, { application_id: appId, key: "STAFF", label: "Staff", permissions: [], allows_employees: true }, accessToken);
      await TestRequest.post(RULES, { application_id: appId, audiences: ["EMPLOYEES"], default_role_key: "STAFF" }, accessToken);
      expect((await TestRequest.post(`${ACCESS}/apps/${appId}/publish`, {}, accessToken)).status).toBe(200);

      const { token } = await ApiClientTest.createWithToken({ scopeNames: [API_SCOPES.APPLICATION_ENTITLEMENTS_READ] });
      const list = (await (await TestRequest.get("/api/internal/applications", undefined, { Authorization: `Bearer ${token}` })).json()).data;
      expect(list.find((item: { id: string }) => item.id === appId)).toMatchObject({ launch_mode: "link", launch_url: "https://tools.example.com/report" });
    });

    it("can be switched with the details", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken);
      const patched = await TestRequest.patch(`${ACCESS}/apps/${appId}/details`, { launch_mode: "link" }, accessToken);
      expect(patched.status).toBe(200);
      expect((await prismaClient.application.findUniqueOrThrow({ where: { application_id: appId } })).launch_mode).toBe("LINK");
      expect((await TestRequest.patch(`${ACCESS}/apps/${appId}/details`, { launch_mode: "teleport" }, accessToken)).status).toBe(400);
    });
  });

  describe("the Hub itself", () => {
    it("has no show in Hub step, and cannot be removed while other applications are set up", async () => {
      process.env.HUB_APPLICATION_ID = appId;
      try {
        const { accessToken } = await AdminUserTest.createSuperAdmin();
        await create(accessToken);
        const others = await prismaClient.application.count({ where: { application_id: { not: appId } } });
        const setup = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data;
        expect(setup.is_hub).toBe(true);
        expect(setup.can_publish).toBe(false);
        expect((await TestRequest.post(`${ACCESS}/apps/${appId}/publish`, {}, accessToken)).status).toBe(400);
        if (others > 0) {
          const plan = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/removal`, accessToken)).json()).data;
          expect(plan.can_remove).toBe(false);
          expect(plan.retire_available).toBe(false);
          expect(plan.blockers.join(" ")).toMatch(new RegExp(`${others} other applications? (is|are) still set up`));
          expect((await TestRequest.delete(`${ACCESS}/apps/${appId}`, accessToken)).status).toBe(400);
          expect((await TestRequest.post(`${ACCESS}/apps/${appId}/retire`, {}, accessToken)).status).toBe(400);
        }
      } finally {
        delete process.env.HUB_APPLICATION_ID;
      }
    });

    it("can be retired and deleted once it is the only application left", async () => {
      process.env.HUB_APPLICATION_ID = appId;
      // The test database keeps applications from other runs. Set them aside and put them back.
      const kept = await prismaClient.application.findMany({ where: { application_id: { not: appId } } });
      await prismaClient.application.deleteMany({ where: { application_id: { not: appId } } });
      try {
        const { accessToken } = await AdminUserTest.createSuperAdmin();
        await create(accessToken);
        const plan = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/removal`, accessToken)).json()).data;
        expect(plan.can_remove).toBe(true);
        const listed = (await (await TestRequest.get(`${ACCESS}/applications?search=${appId}`, accessToken)).json()).data.find(
          (row: { application_id: string }) => row.application_id === appId,
        );
        expect(listed.can_remove).toBe(true);
        expect((await TestRequest.delete(`${ACCESS}/apps/${appId}`, accessToken)).status).toBe(200);
        expect(await prismaClient.application.count({ where: { application_id: appId } })).toBe(0);

        // With a second application it waits, and retiring waits too.
        await create(accessToken);
        await prismaClient.application.create({ data: { application_id: `${appId}-b`, name: "TEST_Second" } });
        const blocked = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/removal`, accessToken)).json()).data;
        expect(blocked.can_remove).toBe(false);
        expect(blocked.blockers.join(" ")).toContain("1 other application is still set up");
        expect((await TestRequest.post(`${ACCESS}/apps/${appId}/retire`, {}, accessToken)).status).toBe(400);
      } finally {
        delete process.env.HUB_APPLICATION_ID;
        await prismaClient.application.deleteMany({ where: { application_id: `${appId}-b` } });
        if (kept.length > 0) {
          await prismaClient.application.createMany({
            data: kept.map(({ env_settings, ...row }) => (env_settings === null ? row : { ...row, env_settings })),
          });
        }
      }
    });

    it("gives a new application a Hub secret of its own, and lets an older one move to its own", async () => {
      const other = `test-own-${randomBytes(3).toString("hex")}`;
      const old = `test-old-${randomBytes(3).toString("hex")}`;
      process.env.HUB_APPLICATION_ID = appId;
      try {
        const { accessToken } = await AdminUserTest.createSuperAdmin();
        await create(accessToken, { is_hub: true, application_id: undefined, name: "HUB", hub_base_url: "https://hub.example.com", hub_secret: "master-secret-0123456789abcdef" });
        const made = await create(accessToken, { application_id: other, name: "TEST_Own", connect: true, session_mode: "relay" });
        const env = (await made.json()).data.connection.env as { key: string; value: string; heading?: string }[];
        const secret = env.find((item) => item.key === "HUB_INTERNAL_SECRET")!;
        // Made from the master for this application alone, not the master itself.
        expect(secret.value).toBe(deriveAppSecret("master-secret-0123456789abcdef", other, 1));
        expect(secret.value).not.toBe("master-secret-0123456789abcdef");
        expect(secret.heading).toContain("for this application only");

        // An application made before this still uses the master until it is moved.
        await prismaClient.application.create({ data: { application_id: old, name: "TEST_Old", launch_url: "https://old.example.com", hub_secret_mode: "SHARED" } });
        await TestRequest.post(`${ACCESS}/apps/${old}/connect`, {}, accessToken);
        const oldSetup = (await (await TestRequest.get(`${ACCESS}/apps/${old}/setup`, accessToken)).json()).data;
        expect(oldSetup.hub_secret).toEqual({ mode: "shared", version: 1, applies: true });
        const rotatedOld = await TestRequest.post(`${ACCESS}/apps/${old}/rotate`, { immediate: true }, accessToken);
        const shared = (await rotatedOld.json()).data.env.find((item: { key: string }) => item.key === "HUB_INTERNAL_SECRET");
        expect(shared.value).toBe("master-secret-0123456789abcdef");
        expect(shared.heading).toContain("Give this application its own secret");

        const act = (id: string, action: string) => TestRequest.post(`${ACCESS}/apps/${id}/hub-app-secret`, { action }, accessToken);
        expect((await act(old, "rotate")).status).toBe(400);
        expect((await act(other, "own")).status).toBe(400);
        const moved = await act(old, "own");
        expect(moved.status).toBe(200);
        expect((await moved.json()).data).toEqual({ secret: deriveAppSecret("master-secret-0123456789abcdef", old, 1), version: 1 });
        const rotated = await act(old, "rotate");
        expect((await rotated.json()).data).toEqual({ secret: deriveAppSecret("master-secret-0123456789abcdef", old, 2), version: 2 });
        expect((await TestRequest.post(`${ACCESS}/apps/${old}/hub-app-secret`, { action: "nope" }, accessToken)).status).toBe(400);
        expect((await act(appId, "own")).status).toBe(400);

        // The Hub is told the mode and the version of each published application.
        await prismaClient.application.updateMany({ where: { application_id: { in: [old, other] } }, data: { published: true } });
        const { token } = await ApiClientTest.createWithToken({ scopeNames: [API_SCOPES.APPLICATION_ENTITLEMENTS_READ] });
        const list = (await (await TestRequest.get("/api/internal/applications", undefined, { Authorization: `Bearer ${token}` })).json()).data;
        expect(list.find((row: { id: string }) => row.id === old).hub_secret).toEqual({ mode: "own", version: 2 });
        expect(list.find((row: { id: string }) => row.id === other).hub_secret).toEqual({ mode: "own", version: 1 });

        // Nothing logged carries a secret.
        const logs = JSON.stringify(await prismaClient.auditLog.findMany({ where: { entity_type: "Application" } }));
        expect(logs).not.toContain("v2.");
        expect(logs).not.toContain("master-secret-0123456789abcdef");
      } finally {
        delete process.env.HUB_APPLICATION_ID;
        for (const id of [other, old]) {
          await prismaClient.applicationRole.deleteMany({ where: { application_id: id } });
          await prismaClient.applicationOrganization.deleteMany({ where: { application_id: id } });
          await prismaClient.application.deleteMany({ where: { application_id: id } });
          await prismaClient.apiClient.deleteMany({ where: { profile: { code: id } } });
          await prismaClient.applicationIntegrationProfile.deleteMany({ where: { code: id } });
        }
      }
    });

    it("tells the setup which Central this is, its address and where the Hub is, for the guide", async () => {
      const original = process.env.DEPLOYMENT_ENVIRONMENT;
      process.env.DEPLOYMENT_ENVIRONMENT = "staging";
      process.env.HUB_APPLICATION_ID = "test-hub-for-guide";
      try {
        const { accessToken } = await AdminUserTest.createSuperAdmin();
        await prismaClient.application.create({ data: { application_id: "test-hub-for-guide", name: "HUB" } });
        await create(accessToken);
        const before = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data;
        expect(before.environment).toBe("staging");
        expect(before.central_url).toMatch(/^https?:\/\/[^/]+$/);
        expect(before.hub_address).toBeNull();

        await prismaClient.application.update({ where: { application_id: "test-hub-for-guide" }, data: { hub_base_url: "https://hub.example.com" } });
        const after = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/setup`, accessToken)).json()).data;
        expect(after.hub_address).toBe("https://hub.example.com");
        // The Hub has no Hub address to point at.
        const hub = (await (await TestRequest.get(`${ACCESS}/apps/test-hub-for-guide/setup`, accessToken)).json()).data;
        expect(hub.hub_address).toBeNull();
      } finally {
        delete process.env.HUB_APPLICATION_ID;
        if (original === undefined) delete process.env.DEPLOYMENT_ENVIRONMENT;
        else process.env.DEPLOYMENT_ENVIRONMENT = original;
        await prismaClient.applicationOrganization.deleteMany({ where: { application_id: "test-hub-for-guide" } });
        await prismaClient.application.deleteMany({ where: { application_id: "test-hub-for-guide" } });
      }
    });

    it("makes a new application read the Hub session by default, with a shorter .env and no Hub secret", async () => {
      const shared = `test-shared-${randomBytes(3).toString("hex")}`;
      process.env.HUB_APPLICATION_ID = appId;
      try {
        const { accessToken } = await AdminUserTest.createSuperAdmin();
        await create(accessToken, { is_hub: true, application_id: undefined, name: "HUB", hub_base_url: "https://hub.example.com/", hub_secret: "master-secret-0123456789abcdef" });
        const made = await create(accessToken, { application_id: shared, name: "TEST_Shared", connect: true });
        const body = (await made.json()).data;
        expect(body.connection.hub_lines_missing).toBe(false);
        const keys = body.connection.env.map((item: { key: string }) => item.key);
        expect(keys).toEqual(["HUB_SSO_APP_ID", "APP_BASE_URL", "CENTRAL_API_BASE_URL", "CENTRAL_API_TOKEN", "CENTRAL_ORGANIZATION_ID", "HUB_BASE_URL", "HUB_ACCESS_COOKIE_NAME"]);
        expect(keys).not.toContain("HUB_INTERNAL_SECRET");
        expect(keys).not.toContain("HUB_SSO_JWKS_URL");

        const setup = (await (await TestRequest.get(`${ACCESS}/apps/${shared}/setup`, accessToken)).json()).data;
        expect(setup.application.session_mode).toBe("shared");
        expect(setup.hub_secret.applies).toBe(false);
        expect((await TestRequest.post(`${ACCESS}/apps/${shared}/hub-app-secret`, { action: "own" }, accessToken)).status).toBe(400);

        // The Hub reads the mode with the rest of the published details.
        await prismaClient.application.update({ where: { application_id: shared }, data: { published: true } });
        const { token } = await ApiClientTest.createWithToken({ scopeNames: [API_SCOPES.APPLICATION_ENTITLEMENTS_READ] });
        const list = (await (await TestRequest.get("/api/internal/applications", undefined, { Authorization: `Bearer ${token}` })).json()).data;
        expect(list.find((row: { id: string }) => row.id === shared).session_mode).toBe("shared");

        // Moving it to the older way brings the Hub secret lines back, and the change is in the activity.
        const moved = await TestRequest.patch(`${ACCESS}/apps/${shared}/details`, { session_mode: "relay" }, accessToken);
        expect(moved.status).toBe(200);
        const movedData = (await moved.json()).data;
        expect(movedData.session_mode).toBe("relay");
        // The lines to add come back once, with the secret, and the token is not part of it.
        expect(movedData.env_changes.add.map((item: { key: string }) => item.key)).toEqual(["HUB_BASE_URL", "HUB_SSO_JWKS_URL", "HUB_INTERNAL_SECRET"]);
expect(movedData.env_changes.remove).toEqual(["HUB_ACCESS_COOKIE_NAME"]);
        const back = await (await TestRequest.patch(`${ACCESS}/apps/${shared}/details`, { session_mode: "shared" }, accessToken)).json();
        expect(back.data.env_changes.add.map((item: { key: string }) => item.key)).toEqual(["HUB_ACCESS_COOKIE_NAME"]);
        expect(back.data.env_changes.remove).toEqual(["HUB_SSO_JWKS_URL", "HUB_INTERNAL_SECRET"]);
        expect((await (await TestRequest.patch(`${ACCESS}/apps/${shared}/details`, { name: "TEST_Shared2" }, accessToken)).json()).data.env_changes).toBeUndefined();
        await TestRequest.patch(`${ACCESS}/apps/${shared}/details`, { session_mode: "relay" }, accessToken);
        // The secret handed out once never reaches the log.
        const logs = await prismaClient.auditLog.findMany({ where: { entity_type: "Application" } });
        expect(JSON.stringify(logs.map((log) => [log.old_values, log.new_values]))).not.toContain(movedData.env_changes.add[2].value);
        const rotated = await TestRequest.post(`${ACCESS}/apps/${shared}/rotate`, { immediate: true }, accessToken);
        expect((await rotated.json()).data.env.map((item: { key: string }) => item.key)).toContain("HUB_INTERNAL_SECRET");
        expect((await TestRequest.patch(`${ACCESS}/apps/${shared}/details`, { session_mode: "teleport" }, accessToken)).status).toBe(400);
      } finally {
        delete process.env.HUB_APPLICATION_ID;
        await prismaClient.applicationRole.deleteMany({ where: { application_id: shared } });
        await prismaClient.applicationOrganization.deleteMany({ where: { application_id: shared } });
        await prismaClient.application.deleteMany({ where: { application_id: shared } });
        await prismaClient.apiClient.deleteMany({ where: { profile: { code: shared } } });
        await prismaClient.applicationIntegrationProfile.deleteMany({ where: { code: shared } });
      }
    });

    it("leaves the Hub lines out of an application that does not sign in through the Hub", async () => {
      const other = `test-nohub-${randomBytes(3).toString("hex")}`;
      process.env.HUB_APPLICATION_ID = appId;
      try {
        const { accessToken } = await AdminUserTest.createSuperAdmin();
        await create(accessToken, { is_hub: true, application_id: undefined, name: "HUB", hub_base_url: "https://hub.example.com" });
        const withHub = await create(accessToken, { application_id: other, name: "TEST_UsesHub", connect: true, session_mode: "relay" });
        const keys = (await withHub.json()).data.connection.env.map((item: { key: string }) => item.key);
        expect(keys).toContain("HUB_INTERNAL_SECRET");
        const impact = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/hub-secret-impact`, accessToken)).json()).data;
        expect(impact.applications.map((row: { application_id: string }) => row.application_id)).toContain(other);

        await TestRequest.patch(`${ACCESS}/apps/${other}/details`, { uses_hub: false }, accessToken);
        const rotated = await TestRequest.post(`${ACCESS}/apps/${other}/rotate`, { immediate: true }, accessToken);
        const rotatedBody = (await rotated.json()).data;
        expect(rotatedBody.env.map((item: { key: string }) => item.key)).not.toContain("HUB_INTERNAL_SECRET");
        expect(rotatedBody.hub_lines_missing).toBe(false);
        const after = (await (await TestRequest.get(`${ACCESS}/apps/${appId}/hub-secret-impact`, accessToken)).json()).data;
        expect(after.applications.map((row: { application_id: string }) => row.application_id)).not.toContain(other);
      } finally {
        delete process.env.HUB_APPLICATION_ID;
        await prismaClient.applicationRole.deleteMany({ where: { application_id: other } });
        await prismaClient.applicationOrganization.deleteMany({ where: { application_id: other } });
        await prismaClient.application.deleteMany({ where: { application_id: other } });
        await prismaClient.apiClient.deleteMany({ where: { profile: { code: other } } });
        await prismaClient.applicationIntegrationProfile.deleteMany({ where: { code: other } });
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
      const stopped = await gone(token);
      expect(stopped.status).toBe(403);
      expect((await stopped.json()).code).toBe("application_retired");
      // A wrong secret stays a plain 401, so a mistyped token never reads as a retirement.
      const prefix = token.slice(0, token.indexOf("."));
      expect((await gone(`${prefix}.wrong-secret`)).status).toBe(401);
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
      await TestRequest.post(RULES, { application_id: appId, audiences: ["EMPLOYEES"], default_role_key: "STAFF" }, accessToken);
      const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      await prismaClient.apiClient.updateMany({ where: { profile: { code: appId } }, data: { last_used_at: old } });
      await prismaClient.apiClientCredential.updateMany({ where: { client: { profile: { code: appId } } }, data: { last_used_at: old } });

      const plan = (await (await removal(accessToken)).json()).data;
      expect(plan.will_delete).toEqual({ roles: 1, groups: 1, permissions: 1, clients: 1, people: 0 });
      const organizationBefore = (await prismaClient.applicationOrganization.findUniqueOrThrow({ where: { application_id: appId } })).organization_id;
      expect(plan.organization_id).toBe(organizationBefore);
      expect((await remove(accessToken)).status).toBe(200);

      expect(await prismaClient.application.count({ where: { application_id: appId } })).toBe(0);
      expect(await prismaClient.applicationRole.count({ where: { application_id: appId } })).toBe(0);
      expect(await prismaClient.applicationAccessRule.count({ where: { application_id: appId } })).toBe(0);
      expect(await prismaClient.applicationPermission.count({ where: { application_id: appId } })).toBe(0);
      // The application is gone from the live table, and its Organization ID is remembered for when it is added again.
      expect(await prismaClient.applicationOrganization.count({ where: { application_id: appId } })).toBe(0);
      expect((await prismaClient.applicationOrganizationTombstone.findUniqueOrThrow({ where: { application_id: appId } })).organization_id).toBe(organizationBefore);
      const clients = await prismaClient.apiClient.findMany({ where: { profile: { code: appId } } });
      expect(clients).toHaveLength(1);
      expect(clients[0]!.is_active).toBe(false);
      expect(await prismaClient.auditLog.count({ where: { action: "APPLICATION_DELETE", entity_type: "Application" } })).toBe(1);

      // The old token no longer works and the list no longer has it.
      const dead = await TestRequest.get(`/api/internal/applications`, undefined, { Authorization: `Bearer ${data.token}` });
      expect(dead.status).toBe(401);
      const list = (await (await TestRequest.get(`${ACCESS}/applications?search=${appId}`, accessToken)).json()).data;
      expect(list).toHaveLength(0);

      // Same id again, with a new connection, and the same Organization ID.
      const again = await create(accessToken);
      expect(again.status).toBe(200);
      expect((await again.json()).data.organization_id).toBe(organizationBefore);
      expect(await prismaClient.applicationOrganizationTombstone.count({ where: { application_id: appId } })).toBe(0);
      expect((await TestRequest.post(`${ACCESS}/apps/${appId}/connect`, {}, accessToken)).status).toBe(200);
    });

    it("forgets the Organization ID only when asked, and then adding it again makes a new one", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await create(accessToken);
      const before = (await prismaClient.applicationOrganization.findUniqueOrThrow({ where: { application_id: appId } })).organization_id;
      const forgotten = await TestRequest.delete(`${ACCESS}/apps/${appId}?forget_organization_id=true`, accessToken);
      expect(forgotten.status).toBe(200);
      expect(await prismaClient.applicationOrganization.count({ where: { application_id: appId } })).toBe(0);
      expect(await prismaClient.applicationOrganizationTombstone.count({ where: { application_id: appId } })).toBe(0);
      const again = await create(accessToken);
      expect(again.status).toBe(200);
      const after = (await again.json()).data.organization_id;
      expect(after).not.toBe(before);
      expect(after).toMatch(new RegExp(`^org_${appId.replace(/-/g, "_")}_[a-z2-7]{20}$`));
    });
  });
});
