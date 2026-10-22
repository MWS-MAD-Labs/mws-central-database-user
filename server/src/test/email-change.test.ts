import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AdminUserTest, AuditLogTest, EmployeeTest, InternTest, MasterDataTest, StudentTest, TestRequest } from "./test-utils";
import { AuditAction, GoogleSyncStatus } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { setDirectoryClientForTests } from "../lib/google-workspace";
import { FakeDirectory } from "./fake-directory";

describe("changing an email", () => {
  let master: Awaited<ReturnType<typeof MasterDataTest.create>>;
  let google: FakeDirectory;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await InternTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
    master = await MasterDataTest.create();
    google = new FakeDirectory();
    setDirectoryClientForTests(google);
    process.env.GOOGLE_WORKSPACE_TEST_PREFIX = "test_google";
  });
  afterEach(async () => {
    delete process.env.GOOGLE_WORKSPACE_TEST_PREFIX;
    setDirectoryClientForTests(null);
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await InternTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
  });

  const employee = (email: string) =>
    EmployeeTest.create({ email, unitId: master.unit.id, jobPositionId: master.position.id, jobLevelId: master.level.id, buildingId: master.building.id });
  const url = (kind: string, id: string) => `/api/admin/${kind}/${id}/change-email`;

  it("renames the person and the Google account of an employee, once a Super Admin gives a reason", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const person = await employee("test_google_old@millennia21.id");
    const id = person.employee!.id;
    google.users.set("g-1", {
      id: "g-1", primaryEmail: "test_google_old@millennia21.id", givenName: "A", familyName: "B",
      suspended: false, isAdmin: false, changePasswordAtNextLogin: false, lastLoginTime: null,
    });
    await prismaClient.person.update({ where: { id: person.id }, data: { google_user_id: "g-1", google_sync_status: GoogleSyncStatus.ACTIVE } });

    const response = await TestRequest.post(url("employees", id), { email: "test_google_new@millennia21.id", reason: "Name was misspelt" }, accessToken);
    expect(response.status).toBe(200);
    expect((await prismaClient.person.findUniqueOrThrow({ where: { id: person.id } })).email).toBe("test_google_new@millennia21.id");
    expect(google.users.get("g-1")!.primaryEmail).toBe("test_google_new@millennia21.id");

    const entries = await prismaClient.auditLog.findMany({ where: { entity_id: id, action: AuditAction.UPDATE_EMPLOYEE } });
    expect(JSON.stringify(entries)).toContain("Name was misspelt");
  });

  it("works for an intern and a student too", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const intern = await InternTest.create({ email: "test_intern_old@millennia21.id", unitId: master.unit.id, jobPositionId: master.position.id, buildingId: master.building.id });
    const student = await StudentTest.create({ email: "test_student_old@millennia21.id", nis: "9100201" });
    expect((await TestRequest.post(url("interns", intern.id), { email: "test_intern_new@millennia21.id", reason: "Spelling fixed" }, accessToken)).status).toBe(200);
    expect((await TestRequest.post(url("students", student.student!.id), { email: "test_student_new@millennia21.id", reason: "Spelling fixed" }, accessToken)).status).toBe(200);
    expect((await prismaClient.person.findUniqueOrThrow({ where: { id: student.id } })).email).toBe("test_student_new@millennia21.id");
  });

  it("is for a Super Admin only, and a plain edit cannot change an email", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const person = await employee("test_google_plain@millennia21.id");
    const id = person.employee!.id;
    const dba = await AdminUserTest.createDatabaseAdmin(master.unit.id);
    expect((await TestRequest.post(url("employees", id), { email: "test_google_x@millennia21.id", reason: "Spelling fixed" }, dba.accessToken)).status).toBe(403);

    const edit = await TestRequest.patch(`/api/admin/employees/${id}`, { email: "test_google_x@millennia21.id" }, accessToken);
    expect(edit.status).toBe(400);
    expect(JSON.stringify(await edit.json())).toContain("Change Email");
    // The same email in an edit is not a change.
    expect((await TestRequest.patch(`/api/admin/employees/${id}`, { email: "test_google_plain@millennia21.id", nick_name: "Plain" }, accessToken)).status).toBe(200);
  });

  it("refuses a short reason, the same email, an email in use, and an email Google already has", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const person = await employee("test_google_a@millennia21.id");
    await employee("test_google_b@millennia21.id");
    const id = person.employee!.id;
    await prismaClient.person.update({ where: { id: person.id }, data: { google_user_id: "g-2", google_sync_status: GoogleSyncStatus.ACTIVE } });
    google.users.set("g-2", {
      id: "g-2", primaryEmail: "test_google_a@millennia21.id", givenName: "A", familyName: "B",
      suspended: false, isAdmin: false, changePasswordAtNextLogin: false, lastLoginTime: null,
    });
    google.users.set("g-3", {
      id: "g-3", primaryEmail: "test_google_c@millennia21.id", givenName: "C", familyName: "D",
      suspended: false, isAdmin: false, changePasswordAtNextLogin: false, lastLoginTime: null,
    });
    const send = (email: string, reason = "Spelling fixed") => TestRequest.post(url("employees", id), { email, reason }, accessToken);
    expect((await send("test_google_n@millennia21.id", "no")).status).toBe(400);
    expect((await send("test_google_a@millennia21.id")).status).toBe(400);
    expect((await send("test_google_b@millennia21.id")).status).toBe(400);
    expect((await send("test_google_c@millennia21.id")).status).toBe(400);
    expect((await prismaClient.person.findUniqueOrThrow({ where: { id: person.id } })).email).toBe("test_google_a@millennia21.id");
  });

  it("refuses an admin's own address and a person who is also an admin", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const person = await employee("test_google_admin2@millennia21.id");
    const id = person.employee!.id;
    await prismaClient.adminUser.create({
      data: { id: "test-email-change-admin", email: "test_google_admin2@millennia21.id", full_name: "Admin Two", role: "DATABASE_ADMIN", unit_id: master.unit.id, is_active: true },
    });
    const response = await TestRequest.post(url("employees", id), { email: "test_google_free@millennia21.id", reason: "Spelling fixed" }, accessToken);
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain("also an admin");
  });
});
