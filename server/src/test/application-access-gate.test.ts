import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes } from "crypto";
import { AuditAction } from "../generated/prisma/client";
import { API_SCOPES } from "../constants/api-scopes";
import { prismaClient } from "../lib/prisma";
import {
  AdminUserTest,
  ApiClientTest,
  EmployeeTest,
  MasterDataTest,
  TestRequest,
} from "./test-utils";

const RULES = "/api/admin/application-access-rules";
const ENTITLEMENTS = "/api/admin/application-entitlements";

describe("application access gate: no redundant access, parent removed last", () => {
  let appId: string;
  let masterData: Awaited<ReturnType<typeof MasterDataTest.create>>;
  const apiClientIds: string[] = [];

  beforeEach(async () => {
    appId = `test-gate-${randomBytes(4).toString("hex")}`;
    masterData = await MasterDataTest.create();
    await prismaClient.applicationRole.createMany({
      data: [
        { application_id: appId, key: "STAFF", label: "Staff", permissions: ["store.use"] },
        { application_id: appId, key: "ADMIN", label: "Admin", permissions: ["store.use", "app.admin"] },
        { application_id: appId, key: "MEMBER", label: "Member", permissions: [] },
      ],
    });
  });

  afterEach(async () => {
    const rules = await prismaClient.applicationAccessRule.findMany({ where: { application_id: appId } });
    const entitlements = await prismaClient.applicationEntitlement.findMany({ where: { application_id: appId } });
    await prismaClient.auditLog.deleteMany({
      where: {
        OR: [
          { api_client_id: { in: apiClientIds } },
          { entity_id: { in: [...rules.map((rule) => rule.id), ...entitlements.map((item) => item.id)] } },
          { admin: { email: { contains: "@millennia21.id" } } },
        ],
      },
    });
    await prismaClient.applicationEntitlement.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationAccessRule.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationRole.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationOrganization.deleteMany({ where: { application_id: appId } });
    if (apiClientIds.length) {
      await prismaClient.apiClient.deleteMany({ where: { id: { in: apiClientIds } } });
      apiClientIds.length = 0;
    }
    await EmployeeTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  async function createEmployee(email: string, positionId = masterData.position.id) {
    return EmployeeTest.create({
      email,
      unitId: masterData.unit.id,
      jobPositionId: positionId,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
    });
  }

  async function addRule(token: string, body: Record<string, unknown> = {}) {
    return TestRequest.post(
      RULES,
      { application_id: appId, audience: "EMPLOYEES", default_role_key: "STAFF", ...body },
      token,
    );
  }

  async function grant(token: string, personId: string, role: string) {
    return TestRequest.post(ENTITLEMENTS, { person_id: personId, application_id: appId, role }, token);
  }

  async function message(response: Response) {
    return String((await response.json()).errors);
  }

  async function lookupRole(personId: string) {
    const { token, client } = await ApiClientTest.createWithToken({
      scopeNames: [API_SCOPES.APPLICATION_ENTITLEMENTS_READ],
    });
    apiClientIds.push(client.id);
    const response = await TestRequest.get(
      `/api/internal/application-entitlements/lookup?person_id=${personId}&application_id=${appId}`,
      undefined,
      { Authorization: `Bearer ${token}` },
    );
    return response.status === 200 ? (await response.json()).data.role : null;
  }

  it("lets people and narrower groups exist without an all-people group", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const person = await createEmployee("test_gate_a@millennia21.id");
    const other = await createEmployee("test_gate_a2@millennia21.id");

    // A restricted app: named people on their own, and a first group that is already narrow.
    expect((await grant(accessToken, person.id, "ADMIN")).status).toBe(200);
    expect((await addRule(accessToken, { unit_ids: [masterData.unit.id], default_role_key: "STAFF" })).status).toBe(200);
    // The person is now covered by the group with a different role, so their own access is an override.
    expect(await lookupRole(person.id)).toBe("ADMIN");
    expect(await lookupRole(other.id)).toBe("STAFF");
  });

  it("refuses a role that the person or group already gets from its parent", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const person = await createEmployee("test_gate_b@millennia21.id");
    await addRule(accessToken);

    const same = await grant(accessToken, person.id, "STAFF");
    expect(same.status).toBe(400);
    expect(await message(same)).toContain("already gets STAFF");
    expect((await addRule(accessToken, { unit_ids: [masterData.unit.id] })).status).toBe(400);

    const granted = await (await grant(accessToken, person.id, "ADMIN")).json();
    const back = await TestRequest.patch(`${ENTITLEMENTS}/${granted.data.id}`, { role: "STAFF" }, accessToken);
    expect(back.status).toBe(400);
    expect(await message(back)).toContain("already gets STAFF");

    // Bulk reports it per person.
    const other = await createEmployee("test_gate_c@millennia21.id");
    const bulk = await (await TestRequest.post(
      `${ENTITLEMENTS}/bulk`,
      { person_ids: [other.id], application_id: appId, role: "STAFF" },
      accessToken,
    )).json();
    expect(bulk.data.failed_count).toBe(1);
  });

  it("does not let a wider group make narrower access redundant", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const person = await createEmployee("test_gate_d@millennia21.id");
    await addRule(accessToken);
    const granted = await (await grant(accessToken, person.id, "ADMIN")).json();

    // The unit group would hand Budi ADMIN, which his own access already does.
    const wider = await addRule(accessToken, { unit_ids: [masterData.unit.id], default_role_key: "ADMIN" });
    expect(wider.status).toBe(400);
    expect(await message(wider)).toContain("1 people and 0 groups already have ADMIN");

    expect((await TestRequest.delete(`${ENTITLEMENTS}/${granted.data.id}`, accessToken)).status).toBe(200);
    expect((await addRule(accessToken, { unit_ids: [masterData.unit.id], default_role_key: "ADMIN" })).status).toBe(200);
  });

  it("does not let a wider group make a narrower group redundant", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await addRule(accessToken);
    const position = await prismaClient.masterJobPosition.create({ data: { name: `TEST_GATE_POS_${randomBytes(3).toString("hex")}` } });
    const narrow = await addRule(accessToken, {
      job_position_ids: [position.id],
      unit_ids: [masterData.unit.id],
      default_role_key: "ADMIN",
    });
    expect(narrow.status).toBe(200);

    // A group of that position with ADMIN would already hand ADMIN to the narrower one.
    const wider = await addRule(accessToken, { job_position_ids: [position.id], default_role_key: "ADMIN" });
    expect(wider.status).toBe(400);
    expect(await message(wider)).toContain("0 people and 1 groups already have ADMIN");

    // A different role on the wider group is a real change.
    expect((await addRule(accessToken, { job_position_ids: [position.id], default_role_key: "MEMBER" })).status).toBe(200);
  });

  it("keeps a group until the specific access under it is handled", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const inside = await createEmployee("test_gate_e@millennia21.id");
    const group = await (await addRule(accessToken, { unit_ids: [masterData.unit.id] })).json();
    const groupId = group.data.id;
    const granted = await (await grant(accessToken, inside.id, "ADMIN")).json();

    const remove = await TestRequest.delete(`${RULES}/${groupId}`, accessToken);
    expect(remove.status).toBe(400);
    expect(await message(remove)).toContain("1 specific access entries still depend on this group");
    expect((await TestRequest.patch(`${RULES}/${groupId}`, { is_active: false }, accessToken)).status).toBe(400);
    // Narrowing it so that it no longer covers the person is gated too.
    const otherUnit = await prismaClient.masterUnit.create({ data: { name: `TEST_GATE_OTHER_${randomBytes(3).toString("hex")}` } });
    expect((await TestRequest.patch(`${RULES}/${groupId}`, { unit_ids: [otherUnit.id] }, accessToken)).status).toBe(400);

    // A blocked person still depends on the group.
    await TestRequest.patch(`${ENTITLEMENTS}/revoke/${granted.data.id}`, {}, accessToken);
    expect((await TestRequest.delete(`${RULES}/${groupId}`, accessToken)).status).toBe(400);

    await TestRequest.delete(`${ENTITLEMENTS}/${granted.data.id}`, accessToken);
    expect((await TestRequest.delete(`${RULES}/${groupId}`, accessToken)).status).toBe(200);
  });

  it("does not hold a group back for people it does not cover", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const outsider = await createEmployee("test_gate_h@millennia21.id");
    const otherUnit = await prismaClient.masterUnit.create({ data: { name: `TEST_GATE_LONE_${randomBytes(3).toString("hex")}` } });
    const group = await (await addRule(accessToken, { unit_ids: [otherUnit.id] })).json();
    // The person is outside the group, so their own access has no parent.
    expect((await grant(accessToken, outsider.id, "ADMIN")).status).toBe(200);
    expect((await TestRequest.delete(`${RULES}/${group.data.id}`, accessToken)).status).toBe(200);
  });

  it("removes a person's own access, audits it and falls back to the group", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const person = await createEmployee("test_gate_f@millennia21.id");
    await addRule(accessToken);
    const granted = await (await grant(accessToken, person.id, "ADMIN")).json();
    expect(await lookupRole(person.id)).toBe("ADMIN");

    const dbAdmin = await AdminUserTest.createDatabaseAdmin();
    expect((await TestRequest.delete(`${ENTITLEMENTS}/${granted.data.id}`, dbAdmin.accessToken)).status).toBe(403);

    expect((await TestRequest.delete(`${ENTITLEMENTS}/${granted.data.id}`, accessToken)).status).toBe(200);
    expect(await lookupRole(person.id)).toBe("STAFF");
    expect(
      await prismaClient.auditLog.findFirst({
        where: { action: AuditAction.APPLICATION_ENTITLEMENT_DELETE, entity_id: granted.data.id },
      }),
    ).not.toBeNull();
    expect((await TestRequest.delete(`${ENTITLEMENTS}/${granted.data.id}`, accessToken)).status).toBe(404);
  });

  it("does not let an older violation block unrelated changes", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const person = await createEmployee("test_gate_g@millennia21.id");
    await addRule(accessToken);
    // Written straight to the table, as data that predates the gate.
    await prismaClient.applicationEntitlement.create({
      data: { person_id: person.id, application_id: appId, organization_id: "org_old", role: "STAFF", permissions: ["store.use"] },
    });
    expect((await addRule(accessToken, { unit_ids: [masterData.unit.id], default_role_key: "ADMIN" })).status).toBe(200);
  });

  it("lists who could be given access with what groups already give them", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const covered = await createEmployee("test_gate_cand_a@millennia21.id");
    const position = await prismaClient.masterJobPosition.create({ data: { name: `TEST_GATE_CAND_${randomBytes(3).toString("hex")}` } });
    const uncovered = await createEmployee("test_gate_cand_b@millennia21.id", position.id);
    const group = await (await addRule(accessToken, { job_position_ids: [masterData.position.id] })).json();
    await grant(accessToken, covered.id, "ADMIN");

    const url = `/api/admin/application-access/candidates?application_id=${appId}`;
    const all = (await (await TestRequest.get(url, accessToken)).json()).data as {
      person_id: string; inherited_role: string | null; inherited_group_id: string | null; own_access: { role: string } | null;
    }[];
    const row = (id: string) => all.find((item) => item.person_id === id)!;
    expect(row(covered.id).inherited_role).toBe("STAFF");
    expect(row(covered.id).inherited_group_id).toBe(group.data.id);
    expect(row(covered.id).own_access?.role).toBe("ADMIN");
    expect(row(uncovered.id).inherited_role).toBeNull();
    expect(row(uncovered.id).own_access).toBeNull();

    const ids = async (query: string) =>
      ((await (await TestRequest.get(`${url}&${query}`, accessToken)).json()).data as { person_id: string }[]).map((item) => item.person_id);
    expect(await ids("coverage=COVERED")).toContain(covered.id);
    expect(await ids("coverage=COVERED")).not.toContain(uncovered.id);
    expect(await ids("coverage=UNCOVERED")).toContain(uncovered.id);
    expect(await ids("coverage=UNCOVERED")).not.toContain(covered.id);
    expect(await ids(`coverage=GROUP&group_id=${group.data.id}`)).toEqual(await ids("coverage=COVERED"));
    expect(await ids(`job_position_id=${position.id}`)).toEqual([uncovered.id]);
    expect((await TestRequest.get(`${url}&coverage=GROUP&group_id=missing`, accessToken)).status).toBe(404);
    expect((await TestRequest.get(`${url}&coverage=NOPE`, accessToken)).status).toBe(400);

    const paged = await (await TestRequest.get(`${url}&size=1`, accessToken)).json();
    expect(paged.data).toHaveLength(1);
    expect(paged.paging.total_item).toBeGreaterThanOrEqual(2);

    const dbAdmin = await AdminUserTest.createDatabaseAdmin();
    expect((await TestRequest.get(url, dbAdmin.accessToken)).status).toBe(403);
  });

  it("treats everyone as uncovered when the application has no groups", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const person = await createEmployee("test_gate_cand_c@millennia21.id");
    const url = `/api/admin/application-access/candidates?application_id=${appId}`;
    const covered = (await (await TestRequest.get(`${url}&coverage=COVERED`, accessToken)).json()).data;
    expect(covered).toHaveLength(0);
    const uncovered = (await (await TestRequest.get(`${url}&coverage=UNCOVERED`, accessToken)).json()).data;
    expect(uncovered.map((item: { person_id: string }) => item.person_id)).toContain(person.id);
  });
});
