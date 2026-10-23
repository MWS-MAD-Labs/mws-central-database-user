import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AdminUserTest, AuditLogTest, EmployeeTest, MasterDataTest, TestRequest } from "./test-utils";
import { AuditAction, DisciplinaryActionType, type MasterBuilding, type MasterJobLevel, type MasterJobPosition, type MasterUnit } from "../generated/prisma/client";
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

  describe("linking an admin to the employee with the same email", () => {
    it("links when the profile is opened, whatever the capitals of the email, and not again", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      expect((await (await TestRequest.get("/api/auth/me", accessToken)).json()).data.employee_id).toBeNull();

      // The employee is added after the admin last signed in, with other capitals.
      const { person } = await employee("Test_SuperAdmin@millennia21.id");
      const opened = await (await TestRequest.get("/api/auth/me", accessToken)).json();
      expect(opened.data.employee_id).toBe(person.employee!.id);
      const admin = await prismaClient.adminUser.findFirstOrThrow({ where: { id: "test-super-admin-id" } });
      expect(admin.person_id).toBe(person.id);
    });

    it("leaves a linked admin alone, and does not take an employee who belongs to another admin", async () => {
      const { person } = await employee("test_superadmin@millennia21.id");
      await prismaClient.adminUser.create({
        data: { id: "other-admin", email: "other_admin@millennia21.id", full_name: "Other", role: "VIEWER", unit_id: master.unit.id, person_id: person.id },
      });
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const response = await (await TestRequest.get("/api/auth/me", accessToken)).json();
      expect(response.data.employee_id).toBeNull();
      expect((await prismaClient.adminUser.findFirstOrThrow({ where: { id: "test-super-admin-id" } })).person_id).toBeNull();
      expect((await prismaClient.adminUser.findFirstOrThrow({ where: { id: "other-admin" } })).person_id).toBe(person.id);
    });

    it("does not link to an employee that was deleted", async () => {
      const { person } = await employee("test_superadmin@millennia21.id");
      await prismaClient.employee.update({ where: { id: person.employee!.id }, data: { deleted_at: new Date() } });
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      expect((await (await TestRequest.get("/api/auth/me", accessToken)).json()).data.employee_id).toBeNull();
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

    it("gets the identifiers only by asking, and the asking is not audited", async () => {
      const mine = await employee("test_profile_pii@millennia21.id", { employeeId: "99.99.7003" });
      await prismaClient.employee.update({ where: { id: mine.person.employee!.id }, data: { nik: "3171000000000002" } });

      const response = await TestRequest.post("/api/auth/employee/me/sensitive-fields/access", {}, mine.accessToken);
      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).toContain("3171000000000002");

      const entries = await prismaClient.auditLog.findMany({ where: { action: AuditAction.ACCESS_EMPLOYEE_PII, entity_id: mine.person.employee!.id } });
      expect(entries).toHaveLength(0);
    });

    it("lists their own disciplinary actions, and nobody else's, without an audit entry", async () => {
      const mine = await employee("test_profile_sp@millennia21.id", { employeeId: "99.99.7004" });
      const other = await employee("test_profile_sp_other@millennia21.id", { employeeId: "99.99.7005" });
      const base = { type: DisciplinaryActionType.SURAT_TEGURAN, level: 1, issued_date: new Date(), valid_until: new Date(Date.now() + 86400000) };
      await prismaClient.employeeDisciplinaryAction.create({ data: { ...base, employee_id: mine.person.employee!.id, reason: "Late three times" } });
      await prismaClient.employeeDisciplinaryAction.create({ data: { ...base, employee_id: other.person.employee!.id, reason: "Not mine" } });

      const response = await TestRequest.get("/api/auth/employee/me/disciplinary-actions", mine.accessToken);
      expect(response.status).toBe(200);
      const data = (await response.json()).data;
      expect(data).toHaveLength(1);
      expect(data[0].reason).toBe("Late three times");
      expect(await prismaClient.auditLog.count({ where: { entity_id: mine.person.employee!.id } })).toBe(0);

      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      expect((await TestRequest.get("/api/auth/employee/me/disciplinary-actions", accessToken)).status).toBe(401);

      // An admin made from this employee reads the same list from their own route.
      await prismaClient.adminUser.update({ where: { id: "test-super-admin-id" }, data: { person_id: mine.person.id } });
      const asAdmin = await (await TestRequest.get("/api/auth/me/disciplinary-actions", accessToken)).json();
      expect(asAdmin.data).toHaveLength(1);
    });

    it("has no photo to change for an admin who is not made from an employee", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const form = () => {
        const data = new FormData();
        data.set("file", new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }));
        return data;
      };
      expect((await TestRequest.putMultipart("/api/auth/me/photo", form(), accessToken)).status).toBe(404);
    });

    it("is not open to an admin session or to nobody", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      expect((await TestRequest.get("/api/auth/employee/me/detail", accessToken)).status).toBe(401);
      expect((await TestRequest.post("/api/auth/employee/me/sensitive-fields/access", {}, accessToken)).status).toBe(401);
      expect((await TestRequest.get("/api/auth/employee/me/detail")).status).toBe(401);
    });
  });
});
