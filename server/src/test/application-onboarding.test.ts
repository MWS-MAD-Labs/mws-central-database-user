import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes } from "crypto";
import { API_SCOPES } from "../constants/api-scopes";
import { prismaClient } from "../lib/prisma";
import { AdminUserTest, ApiClientTest, MasterDataTest, TestRequest } from "./test-utils";

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
    const response = await create(accessToken, { description: "Test app", icon: "Cash", category: "Finance" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.name).toBe("TEST_Onboard");
    expect(body.data.published).toBe(false);
    expect(body.data.organization_id).toMatch(new RegExp(`^org_${appId.replace(/-/g, "_")}_[a-z2-7]{20}$`));

    const row = await prismaClient.application.findUniqueOrThrow({ where: { application_id: appId } });
    expect(row).toMatchObject({ description: "Test app", icon: "Cash", category: "Finance", published: false });

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
        icon: "Cash",
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
        icon: "Cash",
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
      expect(plan.will_delete).toEqual({ roles: 1, groups: 1, permissions: 1, clients: 1 });
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
