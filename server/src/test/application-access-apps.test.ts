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

  it("lists applications paged with counts, searchable, and Super Admin only", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const person = await createEmployee("test_apps_a@millennia21.id");
    const blocked = await createEmployee("test_apps_a2@millennia21.id");
    await TestRequest.post(RULES, { application_id: appId, audience: "EMPLOYEES", default_role_key: "STAFF" }, accessToken);
    await TestRequest.post(ENTITLEMENTS, { person_id: person.id, application_id: appId, role: "ADMIN" }, accessToken);
    const blockedGrant = await (await TestRequest.post(ENTITLEMENTS, { person_id: blocked.id, application_id: appId, role: "ADMIN" }, accessToken)).json();
    await TestRequest.patch(`${ENTITLEMENTS}/revoke/${blockedGrant.data.id}`, {}, accessToken);

    const found = await (await TestRequest.get(`${ACCESS}/applications?search=${appId}`, accessToken)).json();
    expect(found.paging.total_item).toBe(1);
    const row = found.data[0];
    expect(row.application_id).toBe(appId);
    expect(row.role_count).toBe(2);
    expect(row.active_group_count).toBe(1);
    expect(row.exception_count).toBe(1);
    expect(row.blocked_count).toBe(1);
    expect(row.organization_id).toMatch(/^org_/);
    expect(new Date(row.updated_at).getTime()).toBeGreaterThan(0);

    // Paging splits the list.
    const all = await (await TestRequest.get(`${ACCESS}/applications?size=1`, accessToken)).json();
    expect(all.data).toHaveLength(1);
    expect(all.paging.total_item).toBeGreaterThanOrEqual(4);
    expect(all.paging.total_page).toBe(all.paging.total_item);

    const dbAdmin = await AdminUserTest.createDatabaseAdmin();
    expect((await TestRequest.get(`${ACCESS}/applications`, dbAdmin.accessToken)).status).toBe(403);
  });

  it("creates an application with its organization id and refuses duplicates and bad ids", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const fresh = `test-new-${randomBytes(3).toString("hex")}`;
    const created = await TestRequest.post(`${ACCESS}/applications`, { application_id: fresh }, accessToken);
    const body = await created.json();
    expect(created.status).toBe(200);
    expect(body.data.organization_id).toMatch(/^org_/);
    expect(body.data.role_count).toBe(0);

    expect((await TestRequest.post(`${ACCESS}/applications`, { application_id: fresh }, accessToken)).status).toBe(400);
    expect((await TestRequest.post(`${ACCESS}/applications`, { application_id: "Bad Name" }, accessToken)).status).toBe(400);
    const dbAdmin = await AdminUserTest.createDatabaseAdmin();
    expect((await TestRequest.post(`${ACCESS}/applications`, { application_id: "other-app" }, dbAdmin.accessToken)).status).toBe(403);

    const organization = await prismaClient.applicationOrganization.findUniqueOrThrow({ where: { application_id: fresh } });
    expect(
      await prismaClient.auditLog.findFirst({ where: { action: "APPLICATION_CREATE", entity_id: organization.id } }),
    ).not.toBeNull();
    await prismaClient.auditLog.deleteMany({ where: { entity_id: organization.id } });
    await prismaClient.applicationOrganization.delete({ where: { id: organization.id } });
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

    // The detail carries counts only. The rows come from the exceptions endpoint.
    expect(first.exception_count).toBe(1);
    expect(first.blocked_count).toBe(1);
    expect(second.exception_count).toBe(1);
    expect(second.blocked_count).toBe(0);
    expect(detail.other_count).toBe(1);
    // Active people the scope reaches (the test db may hold others): the four
    // active employees here for the baseline, only the position holder below it.
    expect(first.covered_count).toBeGreaterThanOrEqual(4);
    expect(second.covered_count).toBe(1);
    expect(second.covered_count).toBeLessThan(first.covered_count);
    expect(detail.groups[0].exceptions).toBeUndefined();

    const rows = async (groupId: string, query = "") =>
      (await (await TestRequest.get(`${ACCESS}/apps/${appId}/exceptions?group_id=${groupId}${query}`, accessToken)).json()) as {
        data: { email: string; is_active: boolean; job_position: string | null; job_level: string | null; unit: string | null; employment_type: string | null }[];
        paging: { total_item: number };
      };
    const inFirst = await rows(first.id);
    expect(inFirst.data.map((row) => row.email)).toEqual(["test_apps_b@millennia21.id", "test_apps_d@millennia21.id"]);
    // Active people come before the blocked one.
    expect(inFirst.data.map((row) => row.is_active)).toEqual([true, false]);
    expect(inFirst.data[0].job_position).toBe(masterData.position.name);
    expect(inFirst.data[0].job_level).toBe(masterData.level.name);
    expect(inFirst.data[0].unit).toBe(masterData.unit.name);
    expect(inFirst.data[0].employment_type).not.toBeNull();
    expect((await rows(second.id)).data.map((row) => row.email)).toEqual(["test_apps_c@millennia21.id"]);
    expect((await rows("other")).data.map((row) => row.email)).toEqual(["test_apps_f@millennia21.id"]);

    // Searching and paging.
    expect((await rows(first.id, "&search=apps_b")).data.map((row) => row.email)).toEqual(["test_apps_b@millennia21.id"]);
    const paged = await rows(first.id, "&size=1&page=2");
    expect(paged.data).toHaveLength(1);
    expect(paged.paging.total_item).toBe(2);
    expect((await TestRequest.get(`${ACCESS}/apps/${appId}/exceptions?group_id=missing`, accessToken)).status).toBe(404);
    expect((await TestRequest.get(`${ACCESS}/apps/${appId}/exceptions`, accessToken)).status).toBe(400);
    const dbAdmin = await AdminUserTest.createDatabaseAdmin();
    expect((await TestRequest.get(`${ACCESS}/apps/${appId}/exceptions?group_id=other`, dbAdmin.accessToken)).status).toBe(403);
  });

  it("tells what a broad group keeps after a narrower group takes a unit", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const takenUnit = await prismaClient.masterUnit.create({ data: { name: `TEST_APPS_TAKEN_${randomBytes(3).toString("hex")}` } });
    const stays = await createEmployee("test_apps_keep@millennia21.id");
    const moves = await createEmployee("test_apps_take@millennia21.id", masterData.position.id, takenUnit.id);

    const broad = await (await TestRequest.post(RULES, { application_id: appId, audience: "EMPLOYEES", default_role_key: "STAFF" }, accessToken)).json();
    const narrow = await (await TestRequest.post(
      RULES,
      { application_id: appId, audience: "EMPLOYEES", default_role_key: "ADMIN", unit_ids: [takenUnit.id] },
      accessToken,
    )).json();

    const detail = (await (await TestRequest.get(`${ACCESS}/apps/${appId}`, accessToken)).json()).data;
    const [first, second] = detail.groups;
    expect(first.id).toBe(broad.data.id);
    // The broad group no longer reaches the taken unit, and nothing else changed.
    const kept = first.remaining.units.kept.map((unit: { id: string }) => unit.id);
    expect(kept).toContain(masterData.unit.id);
    expect(kept).not.toContain(takenUnit.id);
    expect(first.remaining.units.dropped.map((unit: { id: string }) => unit.id)).toContain(takenUnit.id);
    expect(first.remaining.job_positions).toBeNull();
    expect(first.remaining.job_levels).toBeNull();
    expect(first.own_count).toBe(first.covered_count - 1);
    expect(second.id).toBe(narrow.data.id);
    expect(second.remaining).toEqual({ units: null, job_positions: null, job_levels: null });
    expect(second.own_count).toBe(second.covered_count);

    // Exceptions of the broad group are only for people it still holds.
    const candidates = async (groupId: string) =>
      ((await (await TestRequest.get(
        `${ACCESS}/candidates?application_id=${appId}&coverage=GROUP&group_id=${groupId}&size=100`,
        accessToken,
      )).json()).data as { person_id: string }[]).map((row) => row.person_id);
    const ofBroad = await candidates(broad.data.id);
    expect(ofBroad).toContain(stays.id);
    expect(ofBroad).not.toContain(moves.id);
    expect(await candidates(narrow.data.id)).toContain(moves.id);
  });

  it("keeps scopes to what the master data lets exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const suffix = randomBytes(3).toString("hex");
    const homeUnit = await prismaClient.masterUnit.create({ data: { name: `TEST_APPS_HOME_${suffix}` } });
    const awayUnit = await prismaClient.masterUnit.create({ data: { name: `TEST_APPS_AWAY_${suffix}` } });
    // A position that only exists in the home unit, and a teaching one.
    const homeOnly = await prismaClient.masterJobPosition.create({
      data: { name: `TEST_APPS_HOMEONLY_${suffix}`, units: { create: [{ unit_id: homeUnit.id }] } },
    });
    const teacher = await prismaClient.masterJobPosition.create({
      data: { name: `TEST_APPS_TEACHER_${suffix}`, is_teaching_position: true },
    });
    const post = (body: Record<string, unknown>) =>
      TestRequest.post(RULES, { application_id: appId, audience: "EMPLOYEES", default_role_key: "STAFF", ...body }, accessToken);

    // Dead values are refused: a position not used in the unit, a teaching position with a non-teaching level.
    const wrongUnit = await post({ unit_ids: [awayUnit.id], job_position_ids: [homeOnly.id] });
    expect(wrongUnit.status).toBe(400);
    expect(String((await wrongUnit.json()).errors)).toContain(`"${homeOnly.name}" does not apply`);
    const mismatch = await post({ job_position_ids: [teacher.id], job_level_ids: [masterData.level.id] });
    expect(mismatch.status).toBe(400);

    // The catalog tells a picker what exists where and which pairs match.
    const CATALOG = `${ACCESS}/scope-catalog`;
    const catalog = (await (await TestRequest.get(CATALOG, accessToken)).json()).data;
    const homeOnlyRow = catalog.job_positions.find((item: { id: string }) => item.id === homeOnly.id);
    expect(homeOnlyRow.unit_ids).toEqual([homeUnit.id]);
    expect(catalog.job_positions.find((item: { id: string }) => item.id === teacher.id).unit_ids).toEqual([]);
    expect(catalog.pairs[teacher.id]).not.toContain(masterData.level.id);
    expect(catalog.pairs[masterData.position.id]).toContain(masterData.level.id);
    expect(catalog.units.map((unit: { name: string }) => unit.name)).not.toContain("Unknown / Legacy");
    const dbAdmin = await AdminUserTest.createDatabaseAdmin();
    expect((await TestRequest.get(CATALOG, dbAdmin.accessToken)).status).toBe(403);

    // A broad group loses what only exists inside the unit a narrower group takes,
    // and shows a taken position as dropped.
    const broad = await (await post({})).json();
    const narrow = await (await post({ unit_ids: [homeUnit.id], default_role_key: "ADMIN" })).json();
    const byPosition = await (await post({ job_position_ids: [masterData.position.id], unit_ids: [awayUnit.id], default_role_key: "ADMIN" })).json();
    expect(narrow.data.id).toBeDefined();
    expect(byPosition.data.id).toBeDefined();
    const detail = (await (await TestRequest.get(`${ACCESS}/apps/${appId}`, accessToken)).json()).data;
    const broadCard = detail.groups.find((group: { id: string }) => group.id === broad.data.id);
    expect(broadCard.remaining.job_positions.dropped.map((item: { id: string }) => item.id)).toContain(homeOnly.id);
    expect(broadCard.remaining.units.dropped.map((item: { id: string }) => item.id)).toContain(homeUnit.id);

    // An older group may keep its values while only its switch changes.
    await prismaClient.applicationAccessRule.update({
      where: { id: byPosition.data.id },
      data: { job_position_ids: [homeOnly.id] },
    });
    const off = await TestRequest.patch(`${RULES}/${byPosition.data.id}`, { is_active: false }, accessToken);
    expect(off.status).toBe(200);
  });

  it("answers 404 for an unknown application and 403 for others than Super Admin", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    expect((await TestRequest.get(`${ACCESS}/apps/test-apps-missing`, accessToken)).status).toBe(404);
    const dbAdmin = await AdminUserTest.createDatabaseAdmin();
    expect((await TestRequest.get(`${ACCESS}/apps/${appId}`, dbAdmin.accessToken)).status).toBe(403);
  });
});
