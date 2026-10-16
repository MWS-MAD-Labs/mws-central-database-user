import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes } from "crypto";
import { Gender, InternStatus, PersonType, Religion } from "../generated/prisma/client";
import { API_SCOPES } from "../constants/api-scopes";
import { prismaClient } from "../lib/prisma";
import { covers, inheritedRole, ruleMatches, ruleSpecificity, type GateRule, type RuleSubject } from "../service/application-access-gate";
import { clearActiveSnapshotsForTest } from "../service/application-entitlement-service";
import { AdminUserTest, ApiClientTest, EmployeeTest, InternTest, MasterDataTest, TestRequest } from "./test-utils";

const RULES = "/api/admin/application-access-rules";
const ACCESS = "/api/admin/application-access";

const rule = (overrides: Partial<GateRule> = {}): GateRule => ({
  id: "r",
  for_employees: false,
  for_interns: false,
  for_students: false,
  unit_ids: [],
  job_position_ids: [],
  job_level_ids: [],
  default_role_key: "STAFF",
  is_active: true,
  ...overrides,
});

describe("group access for interns (rules)", () => {
  const intern: RuleSubject = { kind: "INTERN", unitId: "u1", positionId: "p1" };
  const employee: RuleSubject = { kind: "EMPLOYEE", unitId: "u1", positionId: "p1", levelId: "l1" };
  const student: RuleSubject = { kind: "STUDENT", unitId: "u1" };

  it("matches an intern by unit and position, never by level, and only when the group is for interns", () => {
    expect(ruleMatches(rule({ for_interns: true }), intern)).toBe(true);
    expect(ruleMatches(rule({ for_employees: true }), intern)).toBe(false);
    expect(ruleMatches(rule({ for_interns: true, unit_ids: ["u2"] }), intern)).toBe(false);
    expect(ruleMatches(rule({ for_interns: true, job_position_ids: ["p2"] }), intern)).toBe(false);
    // A level filter narrows the employees of a group, an intern has none.
    expect(ruleMatches(rule({ for_employees: true, for_interns: true, job_level_ids: ["l2"] }), intern)).toBe(true);
    expect(ruleMatches(rule({ for_employees: true, for_interns: true, job_level_ids: ["l2"] }), employee)).toBe(false);
  });

  it("keeps employees and students out of an intern group, and the other way round", () => {
    const internsOnly = rule({ for_interns: true });
    expect(ruleMatches(internsOnly, employee)).toBe(false);
    expect(ruleMatches(internsOnly, student)).toBe(false);
    expect(ruleMatches(rule({ for_employees: true }), intern)).toBe(false);
    expect(ruleMatches(rule({ for_students: true }), intern)).toBe(false);
  });

  it("does not count a level as narrower for an intern, so two groups cannot compete on it", () => {
    const withLevel = rule({ id: "a", for_employees: true, for_interns: true, job_level_ids: ["l1"], default_role_key: "A" });
    const internsOnly = rule({ id: "b", for_interns: true, default_role_key: "B" });
    expect(ruleSpecificity(withLevel)).toBeGreaterThan(ruleSpecificity(internsOnly));
    expect(ruleSpecificity(withLevel, true)).toBe(ruleSpecificity(internsOnly, true));
    const position = rule({ id: "c", for_interns: true, job_position_ids: ["p1"], default_role_key: "C" });
    expect(inheritedRole(intern, [withLevel, internsOnly, position])?.default_role_key).toBe("C");
  });

  it("says one group covers another only when it includes every kind of person of the inner one", () => {
    const staff = rule({ for_employees: true, for_interns: true });
    expect(covers(staff, rule({ for_interns: true, job_position_ids: ["p1"] }))).toBe(true);
    expect(covers(staff, rule({ for_employees: true }))).toBe(true);
    expect(covers(rule({ for_employees: true }), rule({ for_interns: true }))).toBe(false);
    expect(covers(rule({ for_interns: true, job_position_ids: ["p1"] }), rule({ for_interns: true }))).toBe(false);
    // A level on the outer group does not stop it covering interns.
    expect(covers(rule({ for_employees: true, for_interns: true, job_level_ids: ["l1"] }), rule({ for_interns: true }))).toBe(true);
  });
});

describe("group access for interns (API)", () => {
  let appId: string;
  let masterData: Awaited<ReturnType<typeof MasterDataTest.create>>;
  const apiClientIds: string[] = [];

  beforeEach(async () => {
    appId = `test-interns-${randomBytes(4).toString("hex")}`;
    masterData = await MasterDataTest.create();
    await prismaClient.applicationPermission.createMany({
      data: ["store.use", "app.admin"].map((key) => ({ application_id: appId, key })),
    });
    await prismaClient.applicationRole.createMany({
      data: [
        { application_id: appId, key: "STAFF", label: "Staff", permissions: ["store.use"] },
        { application_id: appId, key: "INTERN_ONLY", label: "Intern Only", permissions: ["store.use"], allows_employees: false, allows_interns: true },
        { application_id: appId, key: "LEAD", label: "Lead", permissions: ["store.use", "app.admin"], allows_interns: true },
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
    clearActiveSnapshotsForTest();
    await InternTest.delete();
    await EmployeeTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  const addRule = (token: string, body: Record<string, unknown> = {}) =>
    TestRequest.post(RULES, { application_id: appId, audiences: ["INTERNS"], default_role_key: "INTERN_ONLY", ...body }, token);

  async function addIntern(email: string) {
    return InternTest.create({
      email,
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });
  }

  it("makes a person of every new intern, and keeps it in step when the intern changes", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const created = await TestRequest.post(
      "/api/admin/interns",
      {
        full_name: "Test Intern Person",
        nick_name: "Person",
        email: "test_intern_person@millennia21.id",
        gender: Gender.FEMALE,
        religion: Religion.ISLAM,
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-07-01").toISOString(),
        end_date: new Date("2026-12-31").toISOString(),
      },
      accessToken,
    );
    expect(created.status).toBe(200);
    const id = (await created.json()).data.id;
    const intern = await prismaClient.intern.findUniqueOrThrow({ where: { id }, include: { person: true } });
    expect(intern.person).toMatchObject({ person_type: PersonType.INTERN, email: "test_intern_person@millennia21.id", full_name: "Test Intern Person" });
    // A blank birth place and date get the placeholders.
    expect(intern.person.birth_place).toBe("Unknown");

    const updated = await TestRequest.patch(`/api/admin/interns/${id}`, { full_name: "Test Intern Renamed", email: "test_intern_renamed@millennia21.id" }, accessToken);
    expect(updated.status).toBe(200);
    const person = await prismaClient.person.findUniqueOrThrow({ where: { id: intern.person_id } });
    expect(person).toMatchObject({ full_name: "Test Intern Renamed", email: "test_intern_renamed@millennia21.id" });
  });

  it("refuses an intern whose email already belongs to another person", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    await EmployeeTest.create({
      email: "test_intern_taken@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
    });
    const response = await TestRequest.post(
      "/api/admin/interns",
      {
        full_name: "Test Intern Taken",
        nick_name: "Taken",
        email: "test_intern_taken@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-07-01").toISOString(),
        end_date: new Date("2026-12-31").toISOString(),
      },
      accessToken,
    );
    expect(response.status).toBe(400);
  });

  it("makes a group of interns only with a role that is for interns, and no level", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    expect((await addRule(accessToken, { default_role_key: "STAFF" })).status).toBe(400);
    expect((await addRule(accessToken, { job_level_ids: [masterData.level.id] })).status).toBe(400);
    expect((await addRule(accessToken)).status).toBe(200);
  });

  it("makes one group for employees and interns together, with the role fitting both", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    expect((await addRule(accessToken, { audiences: ["EMPLOYEES", "INTERNS"], default_role_key: "INTERN_ONLY" })).status).toBe(400);
    const both = await addRule(accessToken, { audiences: ["EMPLOYEES", "INTERNS"], default_role_key: "LEAD", job_level_ids: [masterData.level.id] });
    expect(both.status).toBe(200);
    expect((await both.json()).data.audiences).toEqual(["EMPLOYEES", "INTERNS"]);
  });

  it("does not mix interns or employees with students", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    expect((await addRule(accessToken, { audiences: ["INTERNS", "STUDENTS"] })).status).toBe(400);
    expect((await addRule(accessToken, { audiences: ["EMPLOYEES", "INTERNS", "STUDENTS"] })).status).toBe(400);
  });

  it("refuses two groups that give the same interns different roles", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    expect((await addRule(accessToken)).status).toBe(200);
    const overlap = await addRule(accessToken, { audiences: ["EMPLOYEES", "INTERNS"], default_role_key: "LEAD", job_level_ids: [masterData.level.id] });
    // The group with a level is narrower for employees but not for interns, so they compete for the same interns.
    expect(overlap.status).toBe(400);
    expect(String((await overlap.json()).errors)).toContain("overlap");
  });

  it("counts the interns a group covers, and lists them as candidates for an exception", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const one = await addIntern("test_intern_cov1@millennia21.id");
    await addIntern("test_intern_cov2@millennia21.id");
    await addIntern("test_intern_ended@millennia21.id").then((row) => prismaClient.intern.update({ where: { id: row.id }, data: { status: InternStatus.COMPLETED } }));
    const rule = await addRule(accessToken);
    expect(rule.status).toBe(200);
    const groupId = (await rule.json()).data.id;

    const detail = (await (await TestRequest.get(`${ACCESS}/apps/${appId}`, accessToken)).json()).data;
    const card = detail.groups.find((group: { id: string }) => group.id === groupId);
    expect(card.audiences).toEqual(["INTERNS"]);
    expect(card.covered_count).toBe(2);

    const candidates = await (
      await TestRequest.get(`${ACCESS}/candidates?application_id=${appId}&coverage=GROUP&group_id=${groupId}`, accessToken)
    ).json();
    expect(candidates.data.map((item: { person_id: string }) => item.person_id)).toContain(one.person_id);
    expect(candidates.data.every((item: { kind: string }) => item.kind === "INTERN")).toBe(true);
    expect(candidates.data).toHaveLength(2);
  });

  it("lets an intern have an exception, with a role that is for interns", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const intern = await addIntern("test_intern_exception@millennia21.id");
    expect((await addRule(accessToken)).status).toBe(200);
    const grant = (role: string) =>
      TestRequest.post("/api/admin/application-entitlements", { person_id: intern.person_id, application_id: appId, role }, accessToken);
    // STAFF is for employees only.
    const refused = await grant("STAFF");
    expect(refused.status).toBe(400);
    expect(String((await refused.json()).errors)).toContain("not for interns");
    expect((await grant("LEAD")).status).toBe(200);
  });

  it("keeps interns out of what the applications read, until they can look an intern up", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const intern = await addIntern("test_intern_hidden@millennia21.id");
    const employee = await EmployeeTest.create({
      email: "test_intern_employee@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
    });
    expect((await addRule(accessToken, { audiences: ["EMPLOYEES", "INTERNS"], default_role_key: "LEAD" })).status).toBe(200);
    const { token, client } = await ApiClientTest.createWithToken({ scopeNames: [API_SCOPES.APPLICATION_ENTITLEMENTS_READ] });
    apiClientIds.push(client.id);
    const list = await (
      await TestRequest.get(`/api/internal/application-entitlements?application_id=${appId}`, undefined, { Authorization: `Bearer ${token}` })
    ).json();
    const ids = list.data.map((item: { person_id: string }) => item.person_id);
    expect(ids).toContain(employee.id);
    expect(ids).not.toContain(intern.person_id);
    const lookup = await TestRequest.get(
      `/api/internal/application-entitlements/lookup?person_id=${intern.person_id}&application_id=${appId}`,
      undefined,
      { Authorization: `Bearer ${token}` },
    );
    expect(lookup.status).toBe(404);
  });
});
