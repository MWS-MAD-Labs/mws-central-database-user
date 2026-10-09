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

  beforeEach(async () => {
    appId = `test-onb-${randomBytes(4).toString("hex")}`;
    await MasterDataTest.create();
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
    expect(status.connection).toEqual({ client_id: null, created: false, last_used_at: null });
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
});
