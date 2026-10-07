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
    await prismaClient.applicationPermission.createMany({
      data: ["store.use", "app.admin", "store.refund", "a.read", "b.read"].map((key) => ({ application_id: appId, key })),
    });
    await prismaClient.applicationRole.createMany({
      data: [
        { application_id: appId, key: "STAFF", label: "Staff", permissions: ["store.use"], allows_students: true },
        { application_id: appId, key: "ADMIN", label: "Admin", permissions: ["store.use", "app.admin"], allows_students: true },
        { application_id: appId, key: "MEMBER", label: "Member", permissions: [], allows_students: true },
      ],
    });
  });

  afterEach(async () => {
    await prismaClient.auditLog.deleteMany({
      where: { OR: [{ api_client_id: { in: apiClientIds } }, { admin: { email: { contains: "@millennia21.id" } } }] },
    });
    await prismaClient.applicationPermission.deleteMany({ where: { application_id: appId } });
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

  describe("blocking a person the group covers", () => {
    const BULK = "/api/admin/application-entitlements/bulk";

    it("shuts a group member out without giving them another role", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const person = await createEmployee("test_block_member@millennia21.id");
      const other = await createEmployee("test_block_other@millennia21.id");
      expect((await addRule(accessToken)).status).toBe(200);
      expect((await lookup(person.id)).status).toBe(200);

      const response = await TestRequest.post(BULK, { person_ids: [person.id], application_id: appId, blocked: true }, accessToken);
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(JSON.stringify(body)).not.toContain("FAILED");

      const row = await prismaClient.applicationEntitlement.findFirstOrThrow({ where: { application_id: appId, person_id: person.id } });
      expect(row.is_active).toBe(false);
      // The row keeps the role the group gives.
      expect(row.role).toBe("STAFF");
      // An off row wins over the group, so the lookup finds nobody with access.
      const found = await lookup(person.id);
      expect(found.status === 404 || (await found.json()).data?.is_active === false).toBe(true);
      // Someone else in the group is untouched.
      expect((await (await lookup(other.id)).json()).data.is_active).toBe(true);
    });

    it("refuses someone no group covers, and someone already blocked", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const person = await createEmployee("test_block_twice@millennia21.id");
      // Only students are covered, so the employee has nothing to block.
      await addRule(accessToken, { audience: "STUDENTS", default_role_key: "MEMBER" });
      const uncovered = await TestRequest.post(BULK, { person_ids: [person.id], application_id: appId, blocked: true }, accessToken);
      expect(uncovered.status).toBe(400);
      expect(JSON.stringify(await uncovered.json())).toContain("Set up a group");

      await addRule(accessToken);
      const first = await (await TestRequest.post(BULK, { person_ids: [person.id], application_id: appId, blocked: true }, accessToken)).json();
      expect(JSON.stringify(first)).not.toContain("FAILED");
      const again = await (await TestRequest.post(BULK, { person_ids: [person.id], application_id: appId, blocked: true }, accessToken)).json();
      expect(JSON.stringify(again)).toContain("already blocked");
    });

    it("lifts a block by sending the person back to group access", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const person = await createEmployee("test_unblock_group@millennia21.id");
      await addRule(accessToken);
      await TestRequest.post(BULK, { person_ids: [person.id], application_id: appId, blocked: true }, accessToken);
      const row = await prismaClient.applicationEntitlement.findFirstOrThrow({ where: { application_id: appId, person_id: person.id } });

      const response = await TestRequest.patch(`/api/admin/application-entitlements/unblock/${row.id}`, {}, accessToken);
      expect(response.status).toBe(200);
      expect((await response.json()).data.restored).toBe("GROUP_ACCESS");
      expect(await prismaClient.applicationEntitlement.findUnique({ where: { id: row.id } })).toBeNull();
      const found = await (await lookup(person.id)).json();
      expect(found.data.is_active).toBe(true);
      expect(found.data.role).toBe("STAFF");
      expect(found.data.is_default).toBe(true);
    });

    it("switches a blocked exception back on with the role it had", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const person = await createEmployee("test_unblock_exception@millennia21.id");
      await addRule(accessToken);
      const granted = await TestRequest.post(
        "/api/admin/application-entitlements",
        { person_id: person.id, application_id: appId, role: "ADMIN" },
        accessToken,
      );
      const entitlement = (await granted.json()).data;
      await TestRequest.patch(`/api/admin/application-entitlements/revoke/${entitlement.id}`, {}, accessToken);

      const response = await TestRequest.patch(`/api/admin/application-entitlements/unblock/${entitlement.id}`, {}, accessToken);
      expect(response.status).toBe(200);
      expect((await response.json()).data.restored).toBe("EXCEPTION");
      const row = await prismaClient.applicationEntitlement.findUniqueOrThrow({ where: { id: entitlement.id } });
      expect(row.is_active).toBe(true);
      expect(row.role).toBe("ADMIN");
    });

    it("refuses to unblock someone who is not blocked, and anyone but a Super Admin", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const person = await createEmployee("test_unblock_active@millennia21.id");
      await addRule(accessToken);
      const granted = await TestRequest.post(
        "/api/admin/application-entitlements",
        { person_id: person.id, application_id: appId, role: "ADMIN" },
        accessToken,
      );
      const id = (await granted.json()).data.id;
      expect((await TestRequest.patch(`/api/admin/application-entitlements/unblock/${id}`, {}, accessToken)).status).toBe(400);
      expect((await TestRequest.patch(`/api/admin/application-entitlements/unblock/missing`, {}, accessToken)).status).toBe(404);
      const { accessToken: dbAdmin } = await AdminUserTest.createDatabaseAdmin();
      expect((await TestRequest.patch(`/api/admin/application-entitlements/unblock/${id}`, {}, dbAdmin)).status).toBe(403);
    });

    it("needs a role when it is not a block", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const person = await createEmployee("test_block_norole@millennia21.id");
      await addRule(accessToken);
      const response = await TestRequest.post(BULK, { person_ids: [person.id], application_id: appId }, accessToken);
      expect(response.status).toBe(400);
    });
  });

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
    expect(body.data.version).toBeGreaterThan(1_700_000_000);
    // Nothing changed, so the version stays put.
    expect((await (await lookup(person.id)).json()).data.version).toBe(body.data.version);
    expect(body.data.organization_id).toMatch(/^org_/);
  });

  it("raises the version of group access when the role or the group changes", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const person = await createEmployee("test_rule_version@millennia21.id");
    const rule = await ruleId(await addRule(accessToken));
    const first = (await (await lookup(person.id)).json()).data.version as number;

    // The version counts seconds, so give the clock a full one between changes.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const role = await prismaClient.applicationRole.findFirstOrThrow({ where: { application_id: appId, key: "STAFF" } });
    await TestRequest.patch(`/api/admin/application-roles/${role.id}`, { permissions: ["store.use", "store.refund"] }, accessToken);
    const afterRole = (await (await lookup(person.id)).json()).data.version as number;
    expect(afterRole).toBeGreaterThan(first);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    await TestRequest.patch(`${RULES}/${rule}`, { is_active: false }, accessToken);
    await TestRequest.patch(`${RULES}/${rule}`, { is_active: true }, accessToken);
    const afterGroup = (await (await lookup(person.id)).json()).data.version as number;
    expect(afterGroup).toBeGreaterThan(afterRole);
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

  it("only lets a group hand out roles that are for its audience", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await prismaClient.applicationRole.create({
      data: { application_id: appId, key: "TEACHER_ONLY", label: "Teacher only", permissions: ["a.read"], allows_students: false },
    });
    await prismaClient.applicationRole.create({
      data: { application_id: appId, key: "KIDS_ONLY", label: "Kids only", permissions: ["b.read"], allows_employees: false, allows_students: true },
    });

    const toStudents = await addRule(accessToken, { audience: "STUDENTS", default_role_key: "TEACHER_ONLY" });
    expect(toStudents.status).toBe(400);
    expect(String((await toStudents.json()).errors)).toContain('Role "TEACHER_ONLY" is not for students');
    const toEmployees = await addRule(accessToken, { audience: "EMPLOYEES", default_role_key: "KIDS_ONLY" });
    expect(toEmployees.status).toBe(400);
    expect(String((await toEmployees.json()).errors)).toContain('Role "KIDS_ONLY" is not for employees');

    expect((await addRule(accessToken, { audience: "STUDENTS", default_role_key: "KIDS_ONLY" })).status).toBe(200);
    expect((await addRule(accessToken, { audience: "EMPLOYEES", default_role_key: "TEACHER_ONLY" })).status).toBe(200);

    // The role picker says the same.
    const options = await (await TestRequest.get(
      `/api/admin/application-access/apps/${appId}/role-options?audience=STUDENTS`,
      accessToken,
    )).json();
    const reasons = Object.fromEntries(options.data.unavailable.map((item: { role: string; reason: string }) => [item.role, item.reason]));
    expect(reasons.TEACHER_ONLY).toBe("Not for students");
    expect(reasons.KIDS_ONLY).not.toBe("Not for students");
  });

  it("keeps a student group to units that have grades", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const noGrades = await prismaClient.masterUnit.create({ data: { name: `TEST_RULE_NOSTUDENTS_${randomBytes(3).toString("hex")}` } });

    const refused = await addRule(accessToken, { audience: "STUDENTS", unit_ids: [noGrades.id] });
    expect(refused.status).toBe(400);
    expect(String((await refused.json()).errors)).toContain(`Unit "${noGrades.name}" has no students`);

    // A group is for employees or for students, not both.
    const both = await addRule(accessToken, { audience: "EMPLOYEES_AND_STUDENTS" });
    expect(both.status).toBe(400);
    expect(String((await both.json()).errors)).toContain("one group for employees and another for students");
  });

  it("keeps serving a group of employees and students that was made before they were split", async () => {
    const student = await StudentTest.create({ email: "test_rule_legacy_student@millennia21.id", status: StudentStatus.ACTIVE });
    const employee = await createEmployee("test_rule_legacy_employee@millennia21.id");
    const organization = await prismaClient.applicationOrganization.create({
      data: { application_id: appId, organization_id: `org_legacy_${randomBytes(3).toString("hex")}` },
    });
    await prismaClient.applicationAccessRule.create({
      data: {
        application_id: appId,
        audience: "EMPLOYEES_AND_STUDENTS",
        organization_id: organization.organization_id,
        default_role_key: "STAFF",
      },
    });

    expect((await (await lookup(employee.id)).json()).data.role).toBe("STAFF");
    expect((await (await lookup(student.id)).json()).data.role).toBe("STAFF");
  });

  it("follows the audience, unit, active status and employee status", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({ email: "test_rule_student@millennia21.id", status: StudentStatus.ACTIVE });
    const otherUnit = await prismaClient.masterUnit.create({ data: { name: `TEST_RULE_OTHER_${randomBytes(3).toString("hex")}` } });
    const inUnit = await createEmployee("test_rule_in@millennia21.id");
    const outUnit = await createEmployee("test_rule_out@millennia21.id", EmployeeStatus.ACTIVE, otherUnit.id);
    const inactive = await createEmployee("test_rule_inactive@millennia21.id", EmployeeStatus.INACTIVE);

    const role = async (id: string) => (await (await lookup(id)).json()).data?.role;

    // Employees: baseline ADMIN, a unit narrows it to STAFF.
    expect((await addRule(accessToken, { default_role_key: "ADMIN" })).status).toBe(200);
    const narrow = await ruleId(await addRule(accessToken, { unit_ids: [masterData.unit.id] }));
    expect(await role(inUnit.id)).toBe("STAFF");
    expect(await role(outUnit.id)).toBe("ADMIN");
    expect((await lookup(inactive.id)).status).toBe(404);
    expect((await lookup(student.id)).status).toBe(404);

    // Students have their own baseline, and a unit narrows it too.
    const studentBaseline = await ruleId(await addRule(accessToken, { audience: "STUDENTS", default_role_key: "ADMIN" }));
    expect(await role(student.id)).toBe("ADMIN");
    const studentUnit = await ruleId(await addRule(accessToken, { audience: "STUDENTS", unit_ids: [masterData.unit.id] }));
    expect(await role(student.id)).toBe("STAFF");

    // The baseline cannot go while the narrower group depends on it.
    expect((await TestRequest.patch(`${RULES}/${studentBaseline}`, { is_active: false }, accessToken)).status).toBe(400);
    await TestRequest.delete(`${RULES}/${studentUnit}`, accessToken);
    expect((await TestRequest.patch(`${RULES}/${studentBaseline}`, { is_active: false }, accessToken)).status).toBe(200);
    expect((await lookup(student.id)).status).toBe(404);

    await TestRequest.delete(`${RULES}/${narrow}`, accessToken);
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
    // Students and employees never share a person, so a student-only baseline is fine.
    expect((await addRule(accessToken, { audience: "STUDENTS" })).status).toBe(200);

    expect((await addRule(accessToken, { unit_ids: [masterData.unit.id], default_role_key: "ADMIN" })).status).toBe(200);
    expect((await addRule(accessToken, { unit_ids: [masterData.unit.id, otherUnit.id], default_role_key: "ADMIN" })).status).toBe(400);
    const second = await addRule(accessToken, { unit_ids: [otherUnit.id], default_role_key: "ADMIN" });
    expect(second.status).toBe(200);

    // Re-activating a rule runs the same check.
    const id = await ruleId(second);
    await TestRequest.patch(`${RULES}/${id}`, { is_active: false }, accessToken);
    expect((await addRule(accessToken, { unit_ids: [otherUnit.id], default_role_key: "ADMIN" })).status).toBe(200);
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
    await addRule(accessToken, { default_role_key: "MEMBER" });

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
    const baseline = await (await addRule(accessToken, { default_role_key: "MEMBER" })).json();

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

    expect(baseline.data.organization_id).toBe(one.data.organization_id);

    const listed = (await (await TestRequest.get("/api/admin/application-organizations", accessToken)).json()).data;
    expect(listed.find((row: { application_id: string }) => row.application_id === appId).organization_id).toBe(
      one.data.organization_id,
    );
    const dbAdmin = await AdminUserTest.createDatabaseAdmin();
    expect((await TestRequest.get("/api/admin/application-organizations", dbAdmin.accessToken)).status).toBe(403);
  });

  it("reads one group access by id", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await addRule(accessToken, { default_role_key: "MEMBER" });
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
