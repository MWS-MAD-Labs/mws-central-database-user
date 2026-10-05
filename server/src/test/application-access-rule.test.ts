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
const ACCESS = "/api/admin/application-access";
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
    await prismaClient.applicationOrganization.deleteMany({ where: { application_id: appId } });
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

  // Creates a group access and returns the response.
  async function addRule(token: string, body: Record<string, unknown> = {}) {
    return TestRequest.post(
      RULES,
      { application_id: appId, audience: "EMPLOYEES", default_role_key: "STAFF", ...body },
      token,
    );
  }

  async function ruleId(response: Response) {
    return (await response.json()).data.id as string;
  }

  it("gives every active employee the default role and marks it as group access", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const person = await createEmployee("test_rule_employee@millennia21.id");

    expect((await lookup(person.id)).status).toBe(404);

    expect((await addRule(accessToken)).status).toBe(200);
    const response = await lookup(person.id);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.role).toBe("STAFF");
    expect(body.data.permissions).toEqual(["store.use"]);
    expect(body.data.is_default).toBe(true);
    expect(body.data.version).toBe(0);
    expect(body.data.organization_id).toMatch(/^org_/);
  });

  it("lets an explicit entitlement win and a revoked one block group access", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await addRule(accessToken);
    const person = await createEmployee("test_rule_explicit@millennia21.id");

    const granted = await (await TestRequest.post(
      ENTITLEMENTS,
      { person_id: person.id, application_id: appId, role: "ADMIN" },
      accessToken,
    )).json();
    const explicit = (await (await lookup(person.id)).json()).data;
    expect(explicit.role).toBe("ADMIN");
    expect(explicit.is_default).toBeUndefined();

    await TestRequest.patch(`${ENTITLEMENTS}/revoke/${granted.data.id}`, {}, accessToken);
    expect((await lookup(person.id)).status).toBe(404);
  });

  it("follows the audience, unit, active status and employee status", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({ email: "test_rule_student@millennia21.id", status: StudentStatus.ACTIVE });
    const otherUnit = await prismaClient.masterUnit.create({ data: { name: `TEST_RULE_OTHER_${randomBytes(3).toString("hex")}` } });
    const inUnit = await createEmployee("test_rule_in@millennia21.id");
    const outUnit = await createEmployee("test_rule_out@millennia21.id", EmployeeStatus.ACTIVE, otherUnit.id);
    const inactive = await createEmployee("test_rule_inactive@millennia21.id", EmployeeStatus.INACTIVE);

    const id = await ruleId(await addRule(accessToken, { audience: "EMPLOYEES", unit_ids: [masterData.unit.id] }));
    expect((await lookup(inUnit.id)).status).toBe(200);
    expect((await lookup(outUnit.id)).status).toBe(404);
    expect((await lookup(inactive.id)).status).toBe(404);
    expect((await lookup(student.id)).status).toBe(404);

    await TestRequest.delete(`${RULES}/${id}`, accessToken);
    const both = await ruleId(await addRule(accessToken, { audience: "EMPLOYEES_AND_STUDENTS", unit_ids: [masterData.unit.id] }));
    expect((await lookup(student.id)).status).toBe(200);

    await TestRequest.delete(`${RULES}/${both}`, accessToken);
    const students = await ruleId(await addRule(accessToken, { audience: "STUDENTS" }));
    expect((await lookup(inUnit.id)).status).toBe(404);
    expect((await lookup(student.id)).status).toBe(200);

    await TestRequest.patch(`${RULES}/${students}`, { is_active: false }, accessToken);
    expect((await lookup(student.id)).status).toBe(404);

    await prismaClient.employee.deleteMany({ where: { person_id: outUnit.id } });
  });

  it("gives the most specific matching group access: position, then level, then unit, then everyone", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const position = await prismaClient.masterJobPosition.create({ data: { name: `TEST_RULE_POS_${randomBytes(3).toString("hex")}` } });
    const special = await createEmployee("test_rule_special@millennia21.id");
    await prismaClient.employee.update({ where: { person_id: special.id }, data: { job_position_id: position.id } });
    const regular = await createEmployee("test_rule_regular@millennia21.id");

    await addRule(accessToken, { default_role_key: "STAFF" });
    await addRule(accessToken, { default_role_key: "ADMIN", job_position_ids: [position.id] });

    expect((await (await lookup(special.id)).json()).data.role).toBe("ADMIN");
    expect((await (await lookup(regular.id)).json()).data.role).toBe("STAFF");

    // A unit rule sits between "everyone" and a position rule.
    await addRule(accessToken, { default_role_key: "ADMIN", unit_ids: [masterData.unit.id] });
    expect((await (await lookup(regular.id)).json()).data.role).toBe("ADMIN");
  });

  it("rejects group accesses that cover the same people at the same level of detail", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const otherUnit = await prismaClient.masterUnit.create({ data: { name: `TEST_RULE_OVERLAP_${randomBytes(3).toString("hex")}` } });

    expect((await addRule(accessToken)).status).toBe(200);
    expect((await addRule(accessToken, { default_role_key: "ADMIN" })).status).toBe(400);
    // Students and employees never share a person, so a student-only rule is fine.
    expect((await addRule(accessToken, { audience: "STUDENTS" })).status).toBe(200);

    expect((await addRule(accessToken, { unit_ids: [masterData.unit.id] })).status).toBe(200);
    expect((await addRule(accessToken, { unit_ids: [masterData.unit.id, otherUnit.id] })).status).toBe(400);
    const second = await addRule(accessToken, { unit_ids: [otherUnit.id] });
    expect(second.status).toBe(200);

    // Re-activating a rule runs the same check.
    const id = await ruleId(second);
    await TestRequest.patch(`${RULES}/${id}`, { is_active: false }, accessToken);
    expect((await addRule(accessToken, { unit_ids: [otherUnit.id] })).status).toBe(200);
    expect((await TestRequest.patch(`${RULES}/${id}`, { is_active: true }, accessToken)).status).toBe(400);
  });

  it("validates, audits and restricts group access management to Super Admin", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    expect((await addRule(accessToken, { default_role_key: "staff" })).status).toBe(400);
    expect((await addRule(accessToken, { default_role_key: "NOPE" })).status).toBe(400);
    expect((await addRule(accessToken, { unit_ids: ["missing-unit"] })).status).toBe(400);
    expect((await addRule(accessToken, { job_position_ids: ["missing-position"] })).status).toBe(400);
    expect((await addRule(accessToken, { audience: "STUDENTS", job_level_ids: [masterData.level.id] })).status).toBe(400);

    const dbAdmin = await AdminUserTest.createDatabaseAdmin();
    expect((await addRule(dbAdmin.accessToken)).status).toBe(403);
    expect((await TestRequest.get(ACCESS, dbAdmin.accessToken)).status).toBe(403);

    const created = await addRule(accessToken);
    const id = await ruleId(created);
    expect(await prismaClient.auditLog.findFirst({ where: { action: "APPLICATION_ACCESS_RULE_CREATE", entity_id: id } })).not.toBeNull();
    expect((await TestRequest.patch(`${RULES}/${id}`, { default_role_key: "ADMIN" }, accessToken)).status).toBe(200);
    expect(await prismaClient.auditLog.findFirst({ where: { action: "APPLICATION_ACCESS_RULE_UPDATE", entity_id: id } })).not.toBeNull();
    expect((await TestRequest.delete(`${RULES}/${id}`, accessToken)).status).toBe(200);
    expect(await prismaClient.auditLog.findFirst({ where: { action: "APPLICATION_ACCESS_RULE_DELETE", entity_id: id } })).not.toBeNull();
    expect((await TestRequest.delete(`${RULES}/${id}`, accessToken)).status).toBe(404);
  });

  it("lists group accesses before people in one paged list and filters by type", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await addRule(accessToken);
    await addRule(accessToken, { audience: "STUDENTS" });
    for (const email of ["test_rule_list_a@millennia21.id", "test_rule_list_b@millennia21.id"]) {
      const person = await createEmployee(email);
      await TestRequest.post(
        ENTITLEMENTS,
        { person_id: person.id, application_id: appId, role: "ADMIN" },
        accessToken,
      );
    }
    const url = `${ACCESS}?application_id=${appId}`;

    const first = await (await TestRequest.get(`${url}&size=3`, accessToken)).json();
    expect(first.paging.total_item).toBe(4);
    expect(first.data.map((row: { kind: string }) => row.kind)).toEqual(["GROUP", "GROUP", "PERSON"]);
    expect(first.data[0].group.audience).toBeDefined();
    expect(first.data[0].permissions).toEqual(["store.use"]);
    expect(first.data[2].person.email).toContain("@millennia21.id");

    const second = await (await TestRequest.get(`${url}&size=3&page=2`, accessToken)).json();
    expect(second.data.map((row: { kind: string }) => row.kind)).toEqual(["PERSON"]);

    const groups = await (await TestRequest.get(`${url}&kind=GROUP`, accessToken)).json();
    expect(groups.paging.total_item).toBe(2);
    const people = await (await TestRequest.get(`${url}&kind=PERSON&search=list_a`, accessToken)).json();
    expect(people.data).toHaveLength(1);
    expect((await TestRequest.get(`${ACCESS}?kind=NOPE`, accessToken)).status).toBe(400);
  });

  it("bulk grants and reports each person that failed", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const a = await createEmployee("test_rule_bulk_a@millennia21.id");
    const b = await createEmployee("test_rule_bulk_b@millennia21.id");
    const inactive = await createEmployee("test_rule_bulk_c@millennia21.id", EmployeeStatus.INACTIVE);

    const response = await TestRequest.post(
      `${ENTITLEMENTS}/bulk`,
      { person_ids: [a.id, b.id, inactive.id], application_id: appId, role: "STAFF" },
      accessToken,
    );
    const body = (await response.json()).data;
    expect(response.status).toBe(200);
    expect(body.success_count).toBe(2);
    expect(body.failed_count).toBe(1);
    expect(body.items.find((item: { id: string }) => item.id === inactive.id).status).toBe("FAILED");

    const unknownRole = await TestRequest.post(
      `${ENTITLEMENTS}/bulk`,
      { person_ids: [a.id], application_id: appId, role: "NOPE" },
      accessToken,
    );
    expect(unknownRole.status).toBe(400);
  });

  it("creates one organization per application, keeps it stable and lists it for Super Admin", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const first = await createEmployee("test_rule_org_a@millennia21.id");
    const second = await createEmployee("test_rule_org_b@millennia21.id");

    const one = await (await TestRequest.post(
      ENTITLEMENTS,
      { person_id: first.id, application_id: appId, role: "STAFF" },
      accessToken,
    )).json();
    const two = await (await TestRequest.post(
      ENTITLEMENTS,
      { person_id: second.id, application_id: appId, role: "ADMIN", organization_id: "typed-by-hand" },
      accessToken,
    )).json();
    expect(one.data.organization_id).toMatch(new RegExp(`^org_${appId.replace(/-/g, "_")}_[0-9a-f]{6}$`));
    // Whatever is typed is ignored, the application's own organization is used.
    expect(two.data.organization_id).toBe(one.data.organization_id);

    const rule = await (await addRule(accessToken)).json();
    expect(rule.data.organization_id).toBe(one.data.organization_id);

    const listed = (await (await TestRequest.get("/api/admin/application-organizations", accessToken)).json()).data;
    expect(listed.find((row: { application_id: string }) => row.application_id === appId).organization_id).toBe(
      one.data.organization_id,
    );
    const dbAdmin = await AdminUserTest.createDatabaseAdmin();
    expect((await TestRequest.get("/api/admin/application-organizations", dbAdmin.accessToken)).status).toBe(403);
  });

  it("reads one group access by id", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const id = await ruleId(await addRule(accessToken, { unit_ids: [masterData.unit.id] }));
    const response = await TestRequest.get(`${RULES}/${id}`, accessToken);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.unit_ids).toEqual([masterData.unit.id]);
    expect((await TestRequest.get(`${RULES}/missing`, accessToken)).status).toBe(404);
    const dbAdmin = await AdminUserTest.createDatabaseAdmin();
    expect((await TestRequest.get(`${RULES}/${id}`, dbAdmin.accessToken)).status).toBe(403);
  });
});
