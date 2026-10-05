import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes } from "crypto";
import { EmployeeStatus } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { AdminUserTest, EmployeeTest, MasterDataTest, TestRequest } from "./test-utils";

const RULES = "/api/admin/application-access-rules";
const ENTITLEMENTS = "/api/admin/application-entitlements";
const ACCESS = "/api/admin/application-access";

describe("application access per application", () => {
  let appId: string;
  let masterData: Awaited<ReturnType<typeof MasterDataTest.create>>;

  beforeEach(async () => {
    appId = `test-apps-${randomBytes(4).toString("hex")}`;
    masterData = await MasterDataTest.create();
    await prismaClient.applicationRole.createMany({
      data: [
        { application_id: appId, key: "STAFF", label: "Staff", permissions: ["store.use"] },
        { application_id: appId, key: "ADMIN", label: "Admin", permissions: ["store.use", "app.admin"] },
      ],
    });
  });

  afterEach(async () => {
    const rules = await prismaClient.applicationAccessRule.findMany({ where: { application_id: appId } });
    const entitlements = await prismaClient.applicationEntitlement.findMany({ where: { application_id: appId } });
    await prismaClient.auditLog.deleteMany({
      where: {
        OR: [
          { entity_id: { in: [...rules.map((rule) => rule.id), ...entitlements.map((item) => item.id)] } },
          { admin: { email: { contains: "@millennia21.id" } } },
        ],
      },
    });
    await prismaClient.applicationEntitlement.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationAccessRule.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationRole.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationOrganization.deleteMany({ where: { application_id: appId } });
    await EmployeeTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  async function createEmployee(email: string, positionId = masterData.position.id, unitId = masterData.unit.id) {
    return EmployeeTest.create({
      email,
      unitId,
      jobPositionId: positionId,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
    });
  }

  it("lists applications with their group and exception counts and is Super Admin only", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const person = await createEmployee("test_apps_a@millennia21.id");
    await TestRequest.post(RULES, { application_id: appId, audience: "EMPLOYEES", default_role_key: "STAFF" }, accessToken);
    await TestRequest.post(ENTITLEMENTS, { person_id: person.id, application_id: appId, role: "ADMIN" }, accessToken);

    const body = await (await TestRequest.get(`${ACCESS}/applications`, accessToken)).json();
    const row = body.data.find((item: { application_id: string }) => item.application_id === appId);
    expect(row.active_group_count).toBe(1);
    expect(row.exception_count).toBe(1);
    expect(row.organization_id).toMatch(/^org_/);

    const dbAdmin = await AdminUserTest.createDatabaseAdmin();
    expect((await TestRequest.get(`${ACCESS}/applications`, dbAdmin.accessToken)).status).toBe(403);
  });

  it("shows groups broad to narrow with the exceptions under the group that covers them", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const position = await prismaClient.masterJobPosition.create({ data: { name: `TEST_APPS_POS_${randomBytes(3).toString("hex")}` } });
    const underBaseline = await createEmployee("test_apps_b@millennia21.id");
    const underNarrow = await createEmployee("test_apps_c@millennia21.id", position.id);
    const blocked = await createEmployee("test_apps_d@millennia21.id");
    const outsider = await createEmployee("test_apps_e@millennia21.id");

    const baseline = await (await TestRequest.post(RULES, { application_id: appId, audience: "EMPLOYEES", default_role_key: "STAFF" }, accessToken)).json();
    const narrow = await (await TestRequest.post(
      RULES,
      { application_id: appId, audience: "EMPLOYEES", default_role_key: "ADMIN", job_position_ids: [position.id] },
      accessToken,
    )).json();
    // The narrow group is ADMIN, so STAFF is a real exception for the person inside it.
    await TestRequest.post(ENTITLEMENTS, { person_id: underBaseline.id, application_id: appId, role: "ADMIN" }, accessToken);
    await TestRequest.post(ENTITLEMENTS, { person_id: underNarrow.id, application_id: appId, role: "STAFF" }, accessToken);
    const blockedGrant = await (await TestRequest.post(ENTITLEMENTS, { person_id: blocked.id, application_id: appId, role: "ADMIN" }, accessToken)).json();
    await TestRequest.patch(`${ENTITLEMENTS}/revoke/${blockedGrant.data.id}`, {}, accessToken);
    // Data from before the rule: someone no group covers (an inactive employee matches no group).
    const farAway = await EmployeeTest.create({
      email: "test_apps_f@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
      status: EmployeeStatus.INACTIVE,
    });
    await prismaClient.applicationEntitlement.create({
      data: { person_id: farAway.id, application_id: appId, organization_id: "org_old", role: "ADMIN", permissions: [] },
    });
    void outsider;

    const response = await TestRequest.get(`${ACCESS}/apps/${appId}`, accessToken);
    const detail = (await response.json()).data;
    expect(response.status).toBe(200);
    expect(detail.organization_id).toMatch(/^org_/);

    const ids = detail.groups.map((group: { id: string }) => group.id);
    expect(ids).toEqual([baseline.data.id, narrow.data.id]);
    const [first, second] = detail.groups;
    expect(first.parent_group_id).toBeNull();
    expect(second.parent_group_id).toBe(baseline.data.id);
    expect(second.job_positions[0].name).toBe(position.name);
    expect(first.permissions).toEqual(["store.use"]);

    const names = (group: { exceptions: { email: string; is_active: boolean }[] }) => group.exceptions.map((row) => row.email);
    expect(names(first)).toEqual(expect.arrayContaining(["test_apps_b@millennia21.id", "test_apps_d@millennia21.id"]));
    expect(first.exceptions.find((row: { email: string }) => row.email === "test_apps_d@millennia21.id").is_active).toBe(false);
    expect(names(second)).toEqual(["test_apps_c@millennia21.id"]);
    expect(detail.other.map((row: { email: string }) => row.email)).toEqual(["test_apps_f@millennia21.id"]);
  });

  it("answers 404 for an unknown application and 403 for others than Super Admin", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    expect((await TestRequest.get(`${ACCESS}/apps/test-apps-missing`, accessToken)).status).toBe(404);
    const dbAdmin = await AdminUserTest.createDatabaseAdmin();
    expect((await TestRequest.get(`${ACCESS}/apps/${appId}`, dbAdmin.accessToken)).status).toBe(403);
  });
});
