import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes } from "crypto";
import { API_SCOPES } from "../constants/api-scopes";
import { AuditAction } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { AdminUserTest, ApiClientTest, MasterDataTest, TestRequest } from "./test-utils";

const ROLES = "/api/admin/application-roles";
const PERMISSIONS = "/api/admin/application-permissions";

describe("application permission catalog", () => {
  let appId: string;
  const profileIds: string[] = [];

  beforeEach(async () => {
    appId = `test-perm-${randomBytes(4).toString("hex")}`;
    await MasterDataTest.create();
  });

  afterEach(async () => {
    const roles = await prismaClient.applicationRole.findMany({ where: { application_id: appId } });
    await prismaClient.auditLog.deleteMany({
      where: { OR: [{ entity_id: { in: [...roles.map((role) => role.id), appId] } }, { entity_type: "ApplicationPermission" }] },
    });
    await prismaClient.applicationRole.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationOrganization.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationPermission.deleteMany({ where: { application_id: appId } });
    await ApiClientTest.delete();
    await prismaClient.applicationIntegrationProfile.deleteMany({ where: { id: { in: profileIds } } });
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  async function publisher(code: string) {
    const profile = await prismaClient.applicationIntegrationProfile.create({
      data: { code: `${code}-${randomBytes(2).toString("hex")}`, name: "Test" },
    });
    profileIds.push(profile.id);
    const { client, token } = await ApiClientTest.createWithToken({
      scopeNames: [API_SCOPES.APPLICATION_PERMISSIONS_WRITE, API_SCOPES.APPLICATION_ENTITLEMENTS_READ],
    });
    // With a profile the client gets the profile's scopes, so the profile holds the ones the tests need.
    for (const name of [API_SCOPES.APPLICATION_PERMISSIONS_WRITE, API_SCOPES.APPLICATION_ENTITLEMENTS_READ]) {
      const scope = await prismaClient.apiScope.findUniqueOrThrow({ where: { name } });
      await prismaClient.applicationIntegrationProfileScope.create({ data: { profile_id: profile.id, scope_id: scope.id } });
    }
    await prismaClient.apiClient.update({ where: { id: client.id }, data: { profile_id: profile.id } });
    return { token, profileCode: profile.code };
  }

  const sync = (
    token: string,
    application: string,
    permissions: { key: string; description?: string; requires?: string[] }[],
    extra: Record<string, unknown> = {},
  ) =>
    TestRequest.put(`/api/internal/application-permissions/${application}`, { permissions, ...extra }, undefined, {
      Authorization: `Bearer ${token}`,
    });

  it("is Super Admin only and lists what an application registered", async () => {
    const { accessToken: dbAdmin } = await AdminUserTest.createDatabaseAdmin();
    expect((await TestRequest.get(`${PERMISSIONS}?application_id=${appId}`, dbAdmin)).status).toBe(403);

    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const created = await TestRequest.post(PERMISSIONS, { application_id: appId, key: "tab.a", description: "Opens tab A" }, accessToken);
    expect(created.status).toBe(200);
    const body = await (await TestRequest.get(`${PERMISSIONS}?application_id=${appId}`, accessToken)).json();
    expect(body.data.has_manifest).toBe(false);
    expect(body.data.permissions).toEqual([
      { key: "tab.a", description: "Opens tab A", requires: [], source: "MANUAL", deprecated: false, role_count: 0 },
    ]);
    expect(await prismaClient.auditLog.count({ where: { action: AuditAction.APPLICATION_PERMISSION_CREATE } })).toBeGreaterThan(0);

    const twice = await TestRequest.post(PERMISSIONS, { application_id: appId, key: "tab.a" }, accessToken);
    expect(twice.status).toBe(400);
    const badKey = await TestRequest.post(PERMISSIONS, { application_id: appId, key: "Tab A" }, accessToken);
    expect(badKey.status).toBe(400);
  });

  it("refuses a role with a permission the application did not register", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await TestRequest.post(PERMISSIONS, { application_id: appId, key: "tab.a" }, accessToken);

    const typo = await TestRequest.post(ROLES, { application_id: appId, key: "CASHIER", label: "Cashier", permissions: ["tab.b"] }, accessToken);
    const typoBody = await typo.json();
    expect(typo.status).toBe(400);
    expect(typoBody.errors).toContain(`"tab.b" is not registered for ${appId}`);
    expect(typoBody.errors).toContain("Known: tab.a");

    const ok = await TestRequest.post(ROLES, { application_id: appId, key: "CASHIER", label: "Cashier", permissions: ["tab.a"] }, accessToken);
    expect(ok.status).toBe(200);
    const role = (await ok.json()).data;

    const patch = await TestRequest.patch(`${ROLES}/${role.id}`, { permissions: ["tab.a", "tab.zzz"] }, accessToken);
    expect(patch.status).toBe(400);
  });

  it("counts the roles that carry a permission", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await TestRequest.post(PERMISSIONS, { application_id: appId, key: "tab.a" }, accessToken);
    await TestRequest.post(ROLES, { application_id: appId, key: "CASHIER", label: "Cashier", permissions: ["tab.a"] }, accessToken);
    const body = await (await TestRequest.get(`${PERMISSIONS}?application_id=${appId}`, accessToken)).json();
    expect(body.data.permissions[0].role_count).toBe(1);
  });

  it("publishes a manifest, deprecates what is dropped and brings it back", async () => {
    const { token, profileCode } = await publisher("pub");
    appId = profileCode;
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const first = await sync(token, appId, [{ key: "tab.a", description: "Tab A" }, { key: "tab.b" }]);
    expect(first.status).toBe(200);
    expect((await first.json()).data).toMatchObject({ total: 2, added: 2, deprecated: [] });

    const again = await sync(token, appId, [{ key: "tab.a", description: "Tab A" }, { key: "tab.b" }]);
    expect((await again.json()).data).toMatchObject({ added: 0, deprecated: [] });

    const role = (await (await TestRequest.post(ROLES, { application_id: appId, key: "RES", label: "Res", permissions: ["tab.b"] }, accessToken)).json()).data;

    const dropped = await sync(token, appId, [{ key: "tab.a" }]);
    expect((await dropped.json()).data.deprecated).toEqual(["tab.b"]);
    const listed = await (await TestRequest.get(`${PERMISSIONS}?application_id=${appId}`, accessToken)).json();
    expect(listed.data.has_manifest).toBe(true);
    expect(listed.data.last_synced_at).not.toBeNull();
    expect(listed.data.permissions.find((p: { key: string }) => p.key === "tab.b")).toMatchObject({ deprecated: true, role_count: 1 });

    // A new role cannot pick it, the old role keeps it and can still be saved.
    const fresh = await TestRequest.post(ROLES, { application_id: appId, key: "NEW", label: "New", permissions: ["tab.b"] }, accessToken);
    expect(fresh.status).toBe(400);
    const keep = await TestRequest.patch(`${ROLES}/${role.id}`, { label: "Resource" }, accessToken);
    expect(keep.status).toBe(200);
    const keepSame = await TestRequest.patch(`${ROLES}/${role.id}`, { permissions: ["tab.b"] }, accessToken);
    expect(keepSame.status).toBe(200);

    await sync(token, appId, [{ key: "tab.a" }, { key: "tab.b" }]);
    const back = await (await TestRequest.get(`${PERMISSIONS}?application_id=${appId}`, accessToken)).json();
    expect(back.data.permissions.find((p: { key: string }) => p.key === "tab.b").deprecated).toBe(false);

    const usage = await TestRequest.get(`/api/internal/application-permissions/${appId}/usage`, undefined, { Authorization: `Bearer ${token}` });
    expect((await usage.json()).data).toEqual(["tab.b"]);
  });

  it("stops hand registration once the application publishes its own", async () => {
    const { token, profileCode } = await publisher("own");
    appId = profileCode;
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await sync(token, appId, [{ key: "tab.a" }]);
    const manual = await TestRequest.post(PERMISSIONS, { application_id: appId, key: "tab.x" }, accessToken);
    expect(manual.status).toBe(400);
  });

  it("lets a client publish only for its own application, with the write scope", async () => {
    const { token, profileCode } = await publisher("mine");
    const other = await sync(token, `${profileCode}-other`, [{ key: "tab.a" }]);
    expect(other.status).toBe(403);
    appId = profileCode;

    const { token: readOnly } = await ApiClientTest.createWithToken({ scopeNames: [API_SCOPES.APPLICATION_ENTITLEMENTS_READ] });
    expect((await sync(readOnly, profileCode, [{ key: "tab.a" }])).status).toBe(403);
    expect((await sync(token, profileCode, [])).status).toBe(400);
  });

  describe("permissions that need others", () => {
    const manifest = [
      { key: "inv.read", description: "Opens the inventory tab" },
      { key: "inv.manage", description: "Adds, edits and deletes items", requires: ["inv.read"] },
      { key: "inv.export", requires: ["inv.manage"] },
    ];

    it("refuses a role that carries a permission without what it needs", async () => {
      const { token, profileCode } = await publisher("dep");
      appId = profileCode;
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      expect((await sync(token, appId, manifest)).status).toBe(200);

      const alone = await TestRequest.post(ROLES, { application_id: appId, key: "KEEPER", label: "Keeper", permissions: ["inv.manage"] }, accessToken);
      expect(alone.status).toBe(400);
      expect((await alone.json()).errors).toContain('Permission "inv.manage" needs "inv.read"');

      // Needs reach through the ones it needs.
      const deep = await TestRequest.post(ROLES, { application_id: appId, key: "KEEPER", label: "Keeper", permissions: ["inv.export", "inv.manage"] }, accessToken);
      expect((await deep.json()).errors).toContain('Permission "inv.export" needs "inv.read"');

      const whole = await TestRequest.post(ROLES, { application_id: appId, key: "KEEPER", label: "Keeper", permissions: ["inv.read", "inv.manage"] }, accessToken);
      expect(whole.status).toBe(200);
      expect((await whole.json()).data.missing_permissions).toEqual([]);

      const role = (await prismaClient.applicationRole.findFirstOrThrow({ where: { application_id: appId, key: "KEEPER" } }));
      const dropRead = await TestRequest.patch(`${ROLES}/${role.id}`, { permissions: ["inv.manage"] }, accessToken);
      expect(dropRead.status).toBe(400);
    });

    it("flags an old role that misses something but still lets its label change", async () => {
      const { token, profileCode } = await publisher("old");
      appId = profileCode;
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await sync(token, appId, [{ key: "inv.read" }, { key: "inv.manage" }]);
      const role = await prismaClient.applicationRole.create({
        data: { application_id: appId, key: "OLD", label: "Old", permissions: ["inv.manage"] },
      });
      // The application starts saying manage needs read.
      await sync(token, appId, [{ key: "inv.read" }, { key: "inv.manage", requires: ["inv.read"] }]);

      const list = await (await TestRequest.get(`${ROLES}?application_id=${appId}`, accessToken)).json();
      expect(list.data.find((item: { key: string }) => item.key === "OLD").missing_permissions).toEqual(["inv.read"]);

      const relabel = await TestRequest.patch(`${ROLES}/${role.id}`, { label: "Older" }, accessToken);
      expect(relabel.status).toBe(200);
      expect((await relabel.json()).data.missing_permissions).toEqual(["inv.read"]);
      const complete = await TestRequest.patch(`${ROLES}/${role.id}`, { permissions: ["inv.manage", "inv.read"] }, accessToken);
      expect(complete.status).toBe(200);
    });

    it("rejects a manifest whose needs do not exist, loop, or point at themselves", async () => {
      const { token, profileCode } = await publisher("bad");
      appId = profileCode;
      const unknown = await sync(token, appId, [{ key: "a.read" }, { key: "a.manage", requires: ["a.missing"] }]);
      expect(unknown.status).toBe(400);
      const self = await sync(token, appId, [{ key: "a.read", requires: ["a.read"] }]);
      expect(self.status).toBe(400);
      const loop = await sync(token, appId, [{ key: "a.x", requires: ["a.y"] }, { key: "a.y", requires: ["a.x"] }]);
      expect(loop.status).toBe(400);
      expect(await prismaClient.applicationPermission.count({ where: { application_id: appId } })).toBe(0);
    });

    it("shows what each permission needs", async () => {
      const { token, profileCode } = await publisher("show");
      appId = profileCode;
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await sync(token, appId, manifest);
      const body = await (await TestRequest.get(`${PERMISSIONS}?application_id=${appId}`, accessToken)).json();
      expect(body.data.permissions.find((p: { key: string }) => p.key === "inv.manage").requires).toEqual(["inv.read"]);
    });
  });

  describe("safe syncing", () => {
    it("names the active roles that still carry what a sync drops", async () => {
      const { token, profileCode } = await publisher("aff");
      appId = profileCode;
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await sync(token, appId, [{ key: "a.read" }, { key: "a.write" }, { key: "a.old" }]);
      await TestRequest.post(ROLES, { application_id: appId, key: "KEEPER", label: "Keeper", permissions: ["a.old"] }, accessToken);
      const dropped = await sync(token, appId, [{ key: "a.read" }, { key: "a.write" }]);
      expect((await dropped.json()).data).toMatchObject({
        deprecated: ["a.old"],
        affected_roles: [{ role: "KEEPER", permissions: ["a.old"] }],
      });
    });

    it("refuses a list that drops most of what was published unless confirmed", async () => {
      const { token, profileCode } = await publisher("half");
      appId = profileCode;
      await sync(token, appId, [{ key: "a.1" }, { key: "a.2" }, { key: "a.3" }, { key: "a.4" }]);
      const refused = await sync(token, appId, [{ key: "a.1" }]);
      expect(refused.status).toBe(409);
      expect(await prismaClient.applicationPermission.count({ where: { application_id: appId, deprecated_at: null } })).toBe(4);
      const confirmed = await sync(token, appId, [{ key: "a.1" }], { confirm_removals: true });
      expect(confirmed.status).toBe(200);
    });

    it("takes turns when the same application is synced twice at once", async () => {
      const { token, profileCode } = await publisher("race");
      appId = profileCode;
      const list = [{ key: "a.1" }, { key: "a.2" }, { key: "a.3" }];
      const results = await Promise.all([sync(token, appId, list), sync(token, appId, list), sync(token, appId, list)]);
      expect(results.map((response) => response.status)).toEqual([200, 200, 200]);
      expect(await prismaClient.applicationPermission.count({ where: { application_id: appId } })).toBe(3);
    });

    it("lets a client read only the permissions of its own application", async () => {
      const { token, profileCode } = await publisher("own2");
      appId = profileCode;
      await sync(token, appId, [{ key: "a.1", description: "One" }]);
      const own = await TestRequest.get(`/api/internal/application-permissions/${appId}`, undefined, { Authorization: `Bearer ${token}` });
      expect((await own.json()).data).toEqual([
        { key: "a.1", description: "One", requires: [], source: "MANIFEST", deprecated: false },
      ]);

      const other = await publisher("other2");
      const foreign = await TestRequest.get(`/api/internal/application-permissions/${appId}`, undefined, { Authorization: `Bearer ${other.token}` });
      expect(foreign.status).toBe(403);
      const foreignUsage = await TestRequest.get(`/api/internal/application-permissions/${appId}/usage`, undefined, { Authorization: `Bearer ${other.token}` });
      expect(foreignUsage.status).toBe(403);
    });
  });
});
