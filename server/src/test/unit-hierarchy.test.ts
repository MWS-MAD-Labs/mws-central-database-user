import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OrganizationUnitApiService } from "../service/organization-unit-api-service";
import { AdminUserTest, AuditLogTest, MasterDataTest, TestRequest } from "./test-utils";

describe("Unit hierarchy", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  it("creates child Units and publishes their parent in the organization directory", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const parentResponse = await TestRequest.post("/api/admin/units", { name: "TEST_MAD Lab" }, accessToken);
    const parent = (await parentResponse.json()).data as { id: string };
    const childResponse = await TestRequest.post(
      "/api/admin/units",
      { name: "TEST_IT Support", parent_id: parent.id },
      accessToken,
    );
    const child = (await childResponse.json()).data as { id: string; parent_id: string };

    expect(childResponse.status).toBe(200);
    expect(child.parent_id).toBe(parent.id);
    expect(await OrganizationUnitApiService.list()).toContainEqual(
      expect.objectContaining({ id: child.id, parent_unit_id: parent.id }),
    );
  });

  it("rejects hierarchy cycles and deleting a Unit that still has children", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const parent = (await (await TestRequest.post("/api/admin/units", { name: "TEST_Parent" }, accessToken)).json()).data;
    const child = (await (await TestRequest.post(
      "/api/admin/units",
      { name: "TEST_Child", parent_id: parent.id },
      accessToken,
    )).json()).data;

    const cycle = await TestRequest.patch(`/api/admin/units/${parent.id}`, { parent_id: child.id }, accessToken);
    expect(cycle.status).toBe(400);
    expect((await cycle.json()).errors).toContain("cycle");

    const removed = await TestRequest.delete(`/api/admin/units/${parent.id}`, accessToken);
    expect(removed.status).toBe(400);
    expect((await removed.json()).errors).toContain("child unit");
  });
});
