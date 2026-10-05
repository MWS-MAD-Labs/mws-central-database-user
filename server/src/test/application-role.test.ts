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
    await prismaClient.applicationRole.deleteMany({ where: { application_id: appId } });
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
    expect(keys("daily-checkin")).toEqual(["ADMIN", "EDUCATOR", "PARTICIPANT", "SUPERADMIN", "SUPPORT"]);
    expect(keys("hub")).toEqual(["ADMIN"]);
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
    const granted = await TestRequest.post(
      "/api/admin/application-entitlements",
      { person_id: person.id, application_id: appId, organization_id: "mws", role: "LEAD" },
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
});
