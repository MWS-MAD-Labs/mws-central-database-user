import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  AdminUserTest,
  AuditLogTest,
  EmployeeTest,
  InternTest,
  MasterDataTest,
  ParentGuardianTest,
  StudentTest,
  TestRequest,
} from "./test-utils";
import { emailProblem } from "../validation/validation";
import { EmployeeService } from "../service/employee-service";
import { setDirectoryClientForTests } from "../lib/google-workspace";
import { SimulatedDirectoryClient } from "../lib/google-workspace/simulated-directory-client";
import { prismaClient } from "../lib/prisma";
import { AdminRole, EmployeeStatus, EmploymentType, Gender, MaritalStatus, Religion } from "../generated/prisma/client";

describe("the clean email rule", () => {
  it("accepts letters, numbers and single . _ - separators", () => {
    for (const email of ["a@x.id", "a.b-c_d9@x.id", "rizqi@millennia21.id", "ayah.budi@gmail.com", "x1@mail.co.id"]) {
      expect(emailProblem(email)).toBeNull();
    }
  });

  it("refuses symbols, capitals, spaces and badly placed separators", () => {
    for (const email of ["a+b@x.id", "a%b@x.id", "a'b@x.id", "a!b@x.id", "a b@x.id", "a..b@x.id", ".a@x.id", "a.@x.id", "a-@x.id", "_a@x.id", "A@x.id", "a@x", "a@-x.id", "@x.id", "a@", "a@x..id"]) {
      expect(emailProblem(email)).not.toBeNull();
    }
  });
});

describe("email rules and the recovery email on create", () => {
  let master: Awaited<ReturnType<typeof MasterDataTest.create>>;
  let seq = 0;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await ParentGuardianTest.delete();
    await StudentTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await InternTest.delete();
    await MasterDataTest.delete();
    master = await MasterDataTest.create();
    setDirectoryClientForTests(new SimulatedDirectoryClient());
  });
  afterEach(async () => {
    setDirectoryClientForTests(null);
    await AuditLogTest.delete();
    await ParentGuardianTest.delete();
    await StudentTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await InternTest.delete();
    await MasterDataTest.delete();
  });

  const employeeBody = (over: Record<string, unknown> = {}) => {
    seq += 1;
    return {
      full_name: "Email Rule Person",
      nick_name: "Rule",
      email: `test_email_rule_${seq}@millennia21.id`,
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: "1995-01-01T00:00:00.000Z",
      employee_id: `99.99.7${String(seq).padStart(2, "0")}`,
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: master.unit.id,
      job_position_id: master.position.id,
      job_level_id: master.level.id,
      building_id: master.building.id,
      join_date: new Date("2026-01-01").toISOString(),
      ...over,
    };
  };

  it("needs a recovery email to create an employee", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const response = await TestRequest.postRaw("/api/admin/employees", employeeBody(), accessToken);
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain("Recovery email is required");
    expect(await prismaClient.person.count({ where: { email: { startsWith: "test_email_rule_" } } })).toBe(0);
  });

  it("needs a recovery email to create an intern", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const response = await TestRequest.postRaw(
      "/api/admin/interns",
      { full_name: "Intern Rule", nick_name: "Rule", email: "test_email_rule_intern@millennia21.id" },
      accessToken,
    );
    expect(response.status).toBe(400);
  });

  it("refuses a recovery email with symbols or on the organization domain", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    for (const recovery_email of ["me+tag@gmail.com", "me%x@gmail.com", "someone@millennia21.id"]) {
      const response = await TestRequest.postRaw("/api/admin/employees", employeeBody({ recovery_email }), accessToken);
      expect(response.status).toBe(400);
    }
  });

  it("refuses an organization email with symbols or capitals typed in", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const plus = await TestRequest.post("/api/admin/employees", employeeBody({ email: "test.plus+tag@millennia21.id" }), accessToken);
    expect(plus.status).toBe(400);
    const doubled = await TestRequest.post("/api/admin/employees", employeeBody({ email: "test..dots@millennia21.id" }), accessToken);
    expect(doubled.status).toBe(400);
  });

  it("keeps the import path working: no recovery email, no Google account", async () => {
    const admin = await prismaClient.adminUser.create({
      data: { id: "test-email-rule-admin", email: "test_email_rule_admin@millennia21.id", full_name: "Admin", role: AdminRole.SUPER_ADMIN, unit_id: master.unit.id, is_active: true },
    });
    const response = await EmployeeService.create(admin, employeeBody() as never);
    const person = await prismaClient.person.findFirstOrThrow({ where: { employee: { id: response.id } } });
    expect(person.google_user_id).toBeNull();
    expect(person.google_sync_status).toBe("NONE");
  });

  describe("parents", () => {
    it("refuses a new parent email with symbols, and lowercases a good one", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const student = await StudentTest.create({ email: "test_email_rule_student@millennia21.id", nis: "9100099" });
      const url = `/api/admin/students/${student.student!.id}/parents`;
      const bad = await TestRequest.post(url, { type: "FATHER", full_name: "Budi", email: "budi+x@gmail.com" }, accessToken);
      expect(bad.status).toBe(400);
      const good = await TestRequest.post(url, { type: "FATHER", full_name: "Budi", email: "Budi.Santoso@Gmail.com" }, accessToken);
      expect(good.status).toBe(200);
      expect((await good.json()).data.email).toBe("budi.santoso@gmail.com");
    });

    it("lets an old email with symbols stay while other things change, and refuses a new one", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const student = await StudentTest.create({ email: "test_email_rule_student2@millennia21.id", nis: "9100098" });
      const studentId = student.student!.id;
      const parent = await ParentGuardianTest.create({ studentId, email: "old+style@gmail.com" });
      const url = `/api/admin/students/${studentId}/parents/${parent.id}`;

      const same = await TestRequest.patch(url, { full_name: "Renamed", email: "old+style@gmail.com" }, accessToken);
      expect(same.status).toBe(200);
      const changed = await TestRequest.patch(url, { email: "new+style@gmail.com" }, accessToken);
      expect(changed.status).toBe(400);
      const fixed = await TestRequest.patch(url, { email: "new.style@gmail.com" }, accessToken);
      expect(fixed.status).toBe(200);
    });
  });
});
