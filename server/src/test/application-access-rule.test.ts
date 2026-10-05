import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes } from "crypto";
import { EmployeeStatus, StudentStatus } from "../generated/prisma/client";
import { API_SCOPES } from "../constants/api-scopes";
import { prismaClient } from "../lib/prisma";
import {
  AdminUserTest,
  ApiClientTest,
  EmployeeTest,
  MasterDataTest,
  StudentTest,
  TestRequest,
} from "./test-utils";

const RULES = "/api/admin/application-access-rules";
const ENTITLEMENTS = "/api/admin/application-entitlements";

describe("application baseline access rules", () => {
  let appId: string;
  let masterData: Awaited<ReturnType<typeof MasterDataTest.create>>;
  const apiClientIds: string[] = [];

  beforeEach(async () => {
    appId = `test-baseline-${randomBytes(4).toString("hex")}`;
    masterData = await MasterDataTest.create();
    await prismaClient.applicationRole.createMany({
      data: [
        { application_id: appId, key: "STAFF", label: "Staff", permissions: ["store.use"] },
        { application_id: appId, key: "ADMIN", label: "Admin", permissions: ["store.use", "app.admin"] },
      ],
    });
  });

  afterEach(async () => {
    await prismaClient.auditLog.deleteMany({
      where: { OR: [{ api_client_id: { in: apiClientIds } }, { admin: { email: { contains: "@millennia21.id" } } }] },
    });
    await prismaClient.applicationEntitlement.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationAccessRule.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationRole.deleteMany({ where: { application_id: appId } });
    if (apiClientIds.length) {
      await prismaClient.apiClient.deleteMany({ where: { id: { in: apiClientIds } } });
      apiClientIds.length = 0;
    }
    await StudentTest.delete();
    await EmployeeTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  async function createEmployee(email: string, status: EmployeeStatus = EmployeeStatus.ACTIVE, unitId = masterData.unit.id) {
    return EmployeeTest.create({
      email,
      unitId,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
      status,
    });
  }

  async function lookup(personId: string) {
    const { token, client } = await ApiClientTest.createWithToken({
      scopeNames: [API_SCOPES.APPLICATION_ENTITLEMENTS_READ],
    });
    apiClientIds.push(client.id);
    return TestRequest.get(
      `/api/internal/application-entitlements/lookup?person_id=${personId}&application_id=${appId}`,
      undefined,
      { Authorization: `Bearer ${token}` },
    );
  }

  async function setRule(token: string, body: Record<string, unknown> = {}) {
    return TestRequest.put(
      `${RULES}/${appId}`,
      { audience: "EMPLOYEES", default_role_key: "STAFF", organization_id: "mws", ...body },
      token,
    );
  }

  it("gives every active employee the default role and marks it as baseline", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const person = await createEmployee("test_rule_employee@millennia21.id");

    expect((await lookup(person.id)).status).toBe(404);

    expect((await setRule(accessToken)).status).toBe(200);
    const response = await lookup(person.id);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.role).toBe("STAFF");
    expect(body.data.permissions).toEqual(["store.use"]);
    expect(body.data.is_default).toBe(true);
    expect(body.data.version).toBe(0);
    expect(body.data.organization_id).toBe("mws");
  });

  it("lets an explicit entitlement win and a revoked one block the baseline", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await setRule(accessToken);
    const person = await createEmployee("test_rule_explicit@millennia21.id");

    const granted = await (await TestRequest.post(
      ENTITLEMENTS,
      { person_id: person.id, application_id: appId, organization_id: "mws", role: "ADMIN" },
      accessToken,
    )).json();
    const explicit = (await (await lookup(person.id)).json()).data;
    expect(explicit.role).toBe("ADMIN");
    expect(explicit.is_default).toBeUndefined();

    await TestRequest.patch(`${ENTITLEMENTS}/revoke/${granted.data.id}`, {}, accessToken);
    expect((await lookup(person.id)).status).toBe(404);
  });

  it("follows the audience, unit filter, active status and employee status", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({ email: "test_rule_student@millennia21.id", status: StudentStatus.ACTIVE });
    const otherUnit = await prismaClient.masterUnit.create({ data: { name: `TEST_RULE_OTHER_${randomBytes(3).toString("hex")}` } });
    const inUnit = await createEmployee("test_rule_in@millennia21.id");
    const outUnit = await createEmployee("test_rule_out@millennia21.id", EmployeeStatus.ACTIVE, otherUnit.id);
    const inactive = await createEmployee("test_rule_inactive@millennia21.id", EmployeeStatus.INACTIVE);

    await setRule(accessToken, { audience: "EMPLOYEES", unit_ids: [masterData.unit.id] });
    expect((await lookup(inUnit.id)).status).toBe(200);
    expect((await lookup(outUnit.id)).status).toBe(404);
    expect((await lookup(inactive.id)).status).toBe(404);
    expect((await lookup(student.id)).status).toBe(404);

    await setRule(accessToken, { audience: "EMPLOYEES_AND_STUDENTS", unit_ids: [masterData.unit.id] });
    expect((await lookup(student.id)).status).toBe(200);

    await setRule(accessToken, { audience: "STUDENTS", unit_ids: [] });
    expect((await lookup(inUnit.id)).status).toBe(404);
    expect((await lookup(student.id)).status).toBe(200);

    await setRule(accessToken, { audience: "EMPLOYEES", is_active: false });
    expect((await lookup(inUnit.id)).status).toBe(404);

    await prismaClient.employee.deleteMany({ where: { person_id: outUnit.id } });
  });

  it("validates the rule and is Super Admin only", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    expect((await setRule(accessToken, { default_role_key: "staff" })).status).toBe(400);
    expect((await setRule(accessToken, { default_role_key: "NOPE" })).status).toBe(400);
    expect((await setRule(accessToken, { unit_ids: ["missing-unit"] })).status).toBe(400);

    const dbAdmin = await AdminUserTest.createDatabaseAdmin();
    expect((await setRule(dbAdmin.accessToken)).status).toBe(403);
    expect((await TestRequest.get(RULES, dbAdmin.accessToken)).status).toBe(403);

    expect((await setRule(accessToken)).status).toBe(200);
    const listed = (await (await TestRequest.get(RULES, accessToken)).json()).data;
    expect(listed.some((rule: { application_id: string }) => rule.application_id === appId)).toBe(true);
  });

  it("bulk grants and reports each person that failed", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const a = await createEmployee("test_rule_bulk_a@millennia21.id");
    const b = await createEmployee("test_rule_bulk_b@millennia21.id");
    const inactive = await createEmployee("test_rule_bulk_c@millennia21.id", EmployeeStatus.INACTIVE);

    const response = await TestRequest.post(
      `${ENTITLEMENTS}/bulk`,
      { person_ids: [a.id, b.id, inactive.id], application_id: appId, organization_id: "mws", role: "STAFF" },
      accessToken,
    );
    const body = (await response.json()).data;
    expect(response.status).toBe(200);
    expect(body.success_count).toBe(2);
    expect(body.failed_count).toBe(1);
    expect(body.items.find((item: { id: string }) => item.id === inactive.id).status).toBe("FAILED");

    const unknownRole = await TestRequest.post(
      `${ENTITLEMENTS}/bulk`,
      { person_ids: [a.id], application_id: appId, organization_id: "mws", role: "NOPE" },
      accessToken,
    );
    expect(unknownRole.status).toBe(400);
  });
});
