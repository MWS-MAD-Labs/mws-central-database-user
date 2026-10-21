import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AdminUserTest, AuditLogTest, EmployeeTest, MasterDataTest, TestRequest } from "./test-utils";
import { AuditAction, type MasterBuilding, type MasterJobLevel, type MasterJobPosition, type MasterUnit } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";

describe("the signed-in person's own record, for the Profile page", () => {
  let master: { unit: MasterUnit; position: MasterJobPosition; level: MasterJobLevel; building: MasterBuilding };

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    master = await MasterDataTest.create();
  });
  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  const employee = (email: string, over: { employeeId?: string } = {}) =>
    EmployeeTest.createWithToken({
      email,
      unitId: master.unit.id,
      jobPositionId: master.position.id,
      jobLevelId: master.level.id,
      buildingId: master.building.id,
      ...over,
    });

  describe("an admin made from an employee", () => {
    it("is told which employee record is theirs, and nothing when there is none", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const alone = await (await TestRequest.get("/api/auth/me", accessToken)).json();
      expect(alone.data.employee_id).toBeNull();

      const { person } = await employee("test_profile_admin@millennia21.id");
      await prismaClient.adminUser.update({ where: { id: "test-super-admin-id" }, data: { person_id: person.id } });
      const linked = await (await TestRequest.get("/api/auth/me", accessToken)).json();
      expect(linked.data.employee_id).toBe(person.employee!.id);

      // Reading their own record goes through the route that already exists, with the self rule.
      const own = await TestRequest.get(`/api/admin/employees/${person.employee!.id}`, accessToken);
      expect(own.status).toBe(200);
      expect((await own.json()).data.identity.is_self).toBe(true);
    });
  });

  describe("an employee signed in", () => {
    it("reads their own record, without the identifiers, and nobody else's", async () => {
      const mine = await employee("test_profile_me@millennia21.id", { employeeId: "99.99.7001" });
      const other = await employee("test_profile_other@millennia21.id", { employeeId: "99.99.7002" });
      await prismaClient.employee.update({ where: { id: mine.person.employee!.id }, data: { nik: "3171000000000001" } });

      const response = await TestRequest.get("/api/auth/employee/me/detail", mine.accessToken);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.json();
      expect(body.data.identity.email).toBe("test_profile_me@millennia21.id");
      expect(body.data.identity.is_self).toBe(true);
      expect(JSON.stringify(body)).not.toContain("3171000000000001");
      expect(JSON.stringify(body)).not.toContain("test_profile_other");

      const theirs = await (await TestRequest.get("/api/auth/employee/me/detail", other.accessToken)).json();
      expect(theirs.data.identity.email).toBe("test_profile_other@millennia21.id");
    });

    it("gets the identifiers only by asking, and the asking is recorded", async () => {
      const mine = await employee("test_profile_pii@millennia21.id", { employeeId: "99.99.7003" });
      await prismaClient.employee.update({ where: { id: mine.person.employee!.id }, data: { nik: "3171000000000002" } });

      const response = await TestRequest.post("/api/auth/employee/me/sensitive-fields/access", {}, mine.accessToken);
      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).toContain("3171000000000002");

      const entries = await prismaClient.auditLog.findMany({ where: { action: AuditAction.ACCESS_EMPLOYEE_PII, entity_id: mine.person.employee!.id } });
      expect(entries).toHaveLength(1);
      expect(entries[0].admin_id).toBeNull();
      expect(JSON.stringify(entries[0].new_values)).toContain("\"self\":true");
      expect(JSON.stringify(entries[0].new_values)).not.toContain("3171000000000002");
    });

    it("is not open to an admin session or to nobody", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      expect((await TestRequest.get("/api/auth/employee/me/detail", accessToken)).status).toBe(401);
      expect((await TestRequest.post("/api/auth/employee/me/sensitive-fields/access", {}, accessToken)).status).toBe(401);
      expect((await TestRequest.get("/api/auth/employee/me/detail")).status).toBe(401);
    });
  });
});
