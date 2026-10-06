import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes } from "crypto";
import { AuditAction } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { AdminUserTest, EmployeeTest, MasterDataTest, TestRequest } from "./test-utils";

const BASE = "/api/admin/application-roles";

describe("application role registry", () => {
  let appId: string;
  let masterData: Awaited<ReturnType<typeof MasterDataTest.create>>;

  beforeEach(async () => {
    appId = `test-app-${randomBytes(4).toString("hex")}`;
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    const roles = await prismaClient.applicationRole.findMany({ where: { application_id: appId } });
    await prismaClient.auditLog.deleteMany({
      where: { entity_id: { in: roles.map((role) => role.id) } },
    });
    await prismaClient.applicationEntitlement.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationAccessRule.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationRole.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationOrganization.deleteMany({ where: { application_id: appId } });
    await EmployeeTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  it("ships the seeded roles for Exima, Daily Check-in and Hub", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const body = await (await TestRequest.get(BASE, accessToken)).json();
    const keys = (app: string) =>
      body.data.filter((r: { application_id: string }) => r.application_id === app).map((r: { key: string }) => r.key);
    expect(keys("exima")).toEqual(["ADMIN", "CASHIER", "RESOURCE", "STAFF"]);
    // Most permissions first.
    expect(keys("daily-checkin")).toEqual(["SUPERADMIN", "ADMIN", "SUPPORT", "EDUCATOR", "PARTICIPANT"]);
    expect(keys("hub")).toEqual(["ADMIN", "MEMBER"]);
  });

  it("is Super Admin only", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    expect((await TestRequest.get(BASE, accessToken)).status).toBe(403);
    const create = await TestRequest.post(BASE, { application_id: appId, key: "ADMIN", label: "Admin", permissions: [] }, accessToken);
    expect(create.status).toBe(403);
  });

  it("creates a role with an exact UPPER_SNAKE key and audits it", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const bad = await TestRequest.post(BASE, { application_id: appId, key: "Lead", label: "Lead", permissions: [] }, accessToken);
    expect(bad.status).toBe(400);

    const created = await TestRequest.post(BASE, { application_id: appId, key: "LEAD", label: "Lead", permissions: ["a.read"] }, accessToken);
    const body = await created.json();
    expect(created.status).toBe(200);
    expect(body.data.key).toBe("LEAD");
    expect(body.data.active_entitlement_count).toBe(0);
    expect(
      await prismaClient.auditLog.findFirst({
        where: { action: AuditAction.APPLICATION_ROLE_CREATE, entity_id: body.data.id },
      }),
    ).not.toBeNull();

    const duplicate = await TestRequest.post(BASE, { application_id: appId, key: "LEAD", label: "Lead", permissions: [] }, accessToken);
    expect(duplicate.status).toBe(400);
  });

  it("pushes permission changes to active entitlements and blocks deactivating a used role", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const role = (await (await TestRequest.post(BASE, { application_id: appId, key: "LEAD", label: "Lead", permissions: ["a.read"] }, accessToken)).json()).data;

    const { position, level, building, unit } = masterData;
    const person = await EmployeeTest.create({
      email: `test_role_${randomBytes(3).toString("hex")}@millennia21.id`,
      unitId: unit.id,
      jobPositionId: position.id,
      jobLevelId: level.id,
      buildingId: building.id,
    });
    await prismaClient.applicationRole.create({
      data: { application_id: appId, key: "BASE", label: "Base", permissions: [] },
    });
    await prismaClient.applicationAccessRule.create({
      data: { application_id: appId, audience: "EMPLOYEES", default_role_key: "BASE", organization_id: "org_test" },
    });
    const granted = await TestRequest.post(
      "/api/admin/application-entitlements",
      { person_id: person.id, application_id: appId, role: "LEAD" },
      accessToken,
    );
    expect(granted.status).toBe(200);

    const blocked = await TestRequest.patch(`${BASE}/${role.id}`, { is_active: false }, accessToken);
    expect(blocked.status).toBe(400);

    const updated = await TestRequest.patch(`${BASE}/${role.id}`, { permissions: ["a.read", "a.write"] }, accessToken);
    expect(updated.status).toBe(200);
    expect((await updated.json()).data.active_entitlement_count).toBe(1);
    const entitlement = await prismaClient.applicationEntitlement.findFirstOrThrow({ where: { application_id: appId } });
    expect(entitlement.permissions).toEqual(["a.read", "a.write"]);
    expect(entitlement.version).toBe(2);
  });

  it("creates the organization of a new application together with its first role", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await TestRequest.post(BASE, { application_id: appId, key: "LEAD", label: "Lead", permissions: [] }, accessToken);
    const organization = await prismaClient.applicationOrganization.findUnique({ where: { application_id: appId } });
    expect(organization?.organization_id).toMatch(/^org_/);
  });

  it("puts a new role at the bottom and reorders the roles of an application", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const post = (key: string) =>
      TestRequest.post(BASE, { application_id: appId, key, label: key, permissions: [`${key.toLowerCase()}.use`] }, accessToken);
    const first = (await (await post("TOP")).json()).data;
    const second = (await (await post("MIDDLE")).json()).data;
    const third = (await (await post("BOTTOM")).json()).data;
    expect([first.rank, second.rank, third.rank]).toEqual([0, 1, 2]);

    const order = (ids: string[]) =>
      TestRequest.patch(`${BASE}/order`, { application_id: appId, role_ids: ids }, accessToken);
    const reordered = await order([third.id, first.id, second.id]);
    expect(reordered.status).toBe(200);
    const body = await reordered.json();
    expect(body.data.map((role: { key: string }) => role.key)).toEqual(["BOTTOM", "TOP", "MIDDLE"]);
    expect(body.data.map((role: { rank: number }) => role.rank)).toEqual([0, 1, 2]);
    expect(
      await prismaClient.auditLog.findFirst({
        where: { action: AuditAction.APPLICATION_ROLE_UPDATE, entity_id: third.id },
      }),
    ).not.toBeNull();

    // Every role of the application, once each, and nothing foreign.
    expect((await order([first.id, second.id])).status).toBe(400);
    expect((await order([first.id, second.id, "someone-elses"])).status).toBe(400);
    expect((await order([first.id, first.id, second.id])).status).toBe(400);

    const dbAdmin = await AdminUserTest.createDatabaseAdmin();
    const forbidden = await TestRequest.patch(
      `${BASE}/order`,
      { application_id: appId, role_ids: [first.id, second.id, third.id] },
      dbAdmin.accessToken,
    );
    expect(forbidden.status).toBe(403);
  });

  it("refuses a second active role with the same permissions", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const post = (key: string, permissions: string[]) =>
      TestRequest.post(BASE, { application_id: appId, key, label: key, permissions }, accessToken);
    const admin = (await (await post("ADMIN", ["a.read", "a.write"])).json()).data;

    // Same set in another order, and the empty set, count as duplicates.
    const twin = await post("BOSS", ["a.write", "a.read"]);
    expect(twin.status).toBe(400);
    expect((await twin.json()).errors).toContain("ADMIN");
    const empty = (await (await post("NONE", [])).json()).data;
    expect((await post("VOID", [])).status).toBe(400);

    // Editing into a duplicate is refused, keeping or relabelling is fine.
    const staff = (await (await post("STAFF", ["a.read"])).json()).data;
    const patch = (id: string, body: object) => TestRequest.patch(`${BASE}/${id}`, body, accessToken);
    expect((await patch(staff.id, { permissions: ["a.write", "a.read"] })).status).toBe(400);
    expect((await patch(staff.id, { label: "Staff member", permissions: ["a.read"] })).status).toBe(200);

    // An inactive role does not block, but bringing it back into a clash does.
    expect((await patch(empty.id, { is_active: false })).status).toBe(200);
    expect((await post("VOID", [])).status).toBe(200);
    expect((await patch(empty.id, { is_active: true })).status).toBe(400);
    expect(admin.key).toBe("ADMIN");
  });
});
