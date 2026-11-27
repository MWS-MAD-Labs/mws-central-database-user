import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes } from "crypto";
import { API_SCOPES } from "../constants/api-scopes";
import { prismaClient } from "../lib/prisma";
import { AdminUserTest, ApiClientTest, EmployeeTest, MasterDataTest, TestRequest } from "./test-utils";

describe("application unit assignments", () => {
  let appId: string;

  beforeEach(async () => {
    appId = `test-unit-assignment-${randomBytes(4).toString("hex")}`;
    await EmployeeTest.delete();
    await ApiClientTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  afterEach(async () => {
    await prismaClient.applicationUnitAssignment.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationUnitAssignmentSet.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationEntitlement.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationPermission.deleteMany({ where: { application_id: appId } });
    await prismaClient.auditLog.deleteMany({ where: { entity_type: "ApplicationUnitAssignment" } });
    await EmployeeTest.delete();
    await ApiClientTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  it("replaces one unit role and preserves an explicitly managed empty list", async () => {
    const master = await MasterDataTest.create();
    const person = await EmployeeTest.create({
      email: `unit-assignment-${randomBytes(3).toString("hex")}@millennia21.id`,
      unitId: master.unit.id,
      jobPositionId: master.position.id,
      jobLevelId: master.level.id,
      buildingId: master.building.id,
    });
    await prismaClient.applicationPermission.create({
      data: {
        application_id: appId,
        key: "proofpoint.manager",
        unit_assignment: {
          scope: "unit",
          label: "Managers",
          mode: "explicit",
          exclusive_group: "proofpoint.department_role",
        },
      },
    });
    await prismaClient.applicationEntitlement.create({
      data: {
        application_id: appId,
        person_id: person.id,
        organization_id: `org_${appId}`,
        role: "ADMIN",
        permissions: ["proofpoint.access", "proofpoint.admin"],
      },
    });
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id, {
      id: `test-unit-admin-${randomBytes(3).toString("hex")}`,
      email: `test_unit_admin_${randomBytes(3).toString("hex")}@millennia21.id`,
    });

    const endpoint = `/api/admin/application-access/apps/${appId}/unit-assignments`;
    const assigned = await TestRequest.put(endpoint, {
      unit_id: master.unit.id,
      permission_key: "proofpoint.manager",
      person_ids: [person.id],
    }, accessToken);
    expect(assigned.status).toBe(200);

    const listed = await (await TestRequest.get(endpoint, accessToken)).json();
    const unit = listed.data.units.find((item: { id: string }) => item.id === master.unit.id);
    expect(listed.data.responsibilities).toContainEqual(expect.objectContaining({
      key: "proofpoint.manager",
      mode: "explicit",
    }));
    expect(unit.managed_permission_keys).toContain("proofpoint.manager");
    expect(unit.assignments).toEqual([
      expect.objectContaining({ permission_key: "proofpoint.manager", active: true, person: expect.objectContaining({ id: person.id }) }),
    ]);

    const emptied = await TestRequest.put(endpoint, {
      unit_id: master.unit.id,
      permission_key: "proofpoint.manager",
      person_ids: [],
    }, accessToken);
    expect(emptied.status).toBe(200);

    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [API_SCOPES.APPLICATION_ENTITLEMENTS_READ],
    });
    const internal = await (
      await TestRequest.get(
        `/api/internal/application-entitlements/unit-assignments?application_id=${appId}`,
        undefined,
        { Authorization: `Bearer ${token}` },
      )
    ).json();
    expect(internal.data).toEqual([]);
    expect(internal.managed).toContainEqual({ unit_id: master.unit.id, permission_key: "proofpoint.manager" });
  });
});
