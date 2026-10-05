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

describe("application access gate: baseline first, no redundant access", () => {
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

  it("asks for the baseline before any person or narrower group", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const person = await createEmployee("test_gate_a@millennia21.id");

    const noBaseline = await grant(accessToken, person.id, "ADMIN");
    expect(noBaseline.status).toBe(400);
    expect(await message(noBaseline)).toContain("Set up the baseline");
    expect((await addRule(accessToken, { unit_ids: [masterData.unit.id], default_role_key: "ADMIN" })).status).toBe(400);

    // A student baseline does not cover employees.
    await addRule(accessToken, { audience: "STUDENTS" });
    expect((await grant(accessToken, person.id, "ADMIN")).status).toBe(400);

    // The baseline itself is always allowed, and then specific access follows.
    expect((await addRule(accessToken)).status).toBe(200);
    expect((await grant(accessToken, person.id, "ADMIN")).status).toBe(200);
    expect((await addRule(accessToken, { unit_ids: [masterData.unit.id], default_role_key: "MEMBER" })).status).toBe(200);
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

  it("keeps the baseline until specific access is handled", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const person = await createEmployee("test_gate_e@millennia21.id");
    const baseline = await (await addRule(accessToken)).json();
    const baselineId = baseline.data.id;
    const granted = await (await grant(accessToken, person.id, "ADMIN")).json();

    const remove = await TestRequest.delete(`${RULES}/${baselineId}`, accessToken);
    expect(remove.status).toBe(400);
    expect(await message(remove)).toContain("1 specific access entries still depend on this baseline");
    expect((await TestRequest.patch(`${RULES}/${baselineId}`, { is_active: false }, accessToken)).status).toBe(400);
    // Adding a filter turns it into a narrower group, so it is gated as well.
    expect((await TestRequest.patch(`${RULES}/${baselineId}`, { unit_ids: [masterData.unit.id] }, accessToken)).status).toBe(400);

    // A blocked person still depends on the baseline.
    await TestRequest.patch(`${ENTITLEMENTS}/revoke/${granted.data.id}`, {}, accessToken);
    expect((await TestRequest.delete(`${RULES}/${baselineId}`, accessToken)).status).toBe(400);

    await TestRequest.delete(`${ENTITLEMENTS}/${granted.data.id}`, accessToken);
    expect((await TestRequest.delete(`${RULES}/${baselineId}`, accessToken)).status).toBe(200);
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
});
