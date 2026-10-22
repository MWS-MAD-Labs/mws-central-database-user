import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  AcademicYearTest,
  AdminUserTest,
  AuditLogTest,
  MasterDataTest,
  ParentGuardianTest,
  StudentTest,
  TestRequest,
} from "./test-utils";
import { AuditAction, Gender, GoogleSyncStatus, Religion, StudentStatus } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { setDirectoryClientForTests } from "../lib/google-workspace";
import { MemoryMailer, setMailerForTests } from "../lib/mailer";
import { resetCheckCooldownForTests, resetSignInEmailLimitForTests } from "../service/google-workspace-service";
import { FakeDirectory } from "./fake-directory";

describe("the Google account of a student", () => {
  let google: FakeDirectory;
  let mailer: MemoryMailer;
  let academicYearId: string;
  let gradeId: string;
  let unitId: string;
  let seq = 0;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await ParentGuardianTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
    await AcademicYearTest.delete();
    const master = await MasterDataTest.create();
    unitId = master.unit.id;
    const year = new Date().getFullYear();
    academicYearId = (await AcademicYearTest.create({ start: new Date(year - 1, 6, 1), end: new Date(year, 5, 30) })).id;
    gradeId = (await prismaClient.grade.create({ data: { name: "TEST_STU_GRADE1", level: 9101, unit_id: unitId } })).id;
    google = new FakeDirectory();
    setDirectoryClientForTests(google);
    mailer = new MemoryMailer();
    setMailerForTests(mailer);
    resetSignInEmailLimitForTests();
    resetCheckCooldownForTests();
    process.env.GOOGLE_WORKSPACE_TEST_PREFIX = "test_google";
  });
  afterEach(async () => {
    delete process.env.GOOGLE_WORKSPACE_TEST_PREFIX;
    setDirectoryClientForTests(null);
    setMailerForTests(null);
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await ParentGuardianTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
    await AcademicYearTest.delete();
    await prismaClient.grade.deleteMany({ where: { name: { startsWith: "TEST_STU_GRADE" } } });
  });

  // A student is made through the API with a parent, like the form. `parent: null` leaves it out.
  const makeStudent = async (token: string, over: Record<string, unknown> = {}) => {
    seq += 1;
    const response = await TestRequest.post(
      "/api/admin/students",
      {
        full_name: "Ari Putra",
        nick_name: "Ari",
        email: `test_google_stu${seq}@millennia21.id`,
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("2012-01-01").toISOString(),
        nis: `90${String(seq).padStart(5, "0")}`,
        entry_type: "PSB",
        current_grade_id: gradeId,
        join_academic_year_id: academicYearId,
        join_grade_id: gradeId,
        parent: { type: "FATHER", full_name: "Budi Santoso", email: "budi.santoso@gmail.com", phone: "081234567890" },
        ...over,
      },
      token,
    );
    expect(response.status).toBe(200);
    return (await response.json()).data.id as string;
  };
  const url = (id: string, path = "") => `/api/admin/students/${id}/google${path}`;
  const personOf = (studentId: string) => prismaClient.person.findFirstOrThrow({ where: { student: { id: studentId } } });
  const letTimePass = async (studentId: string) => {
    const person = await personOf(studentId);
    resetCheckCooldownForTests();
    const earlier = new Date(Date.now() - 10 * 60_000);
    await prismaClient.person.update({ where: { id: person.id }, data: { google_password_issued_at: earlier, google_checked_at: new Date(Date.now() - 60_000) } });
    await prismaClient.auditLog.updateMany({ where: { entity_id: person.id }, data: { created_at: earlier } });
  };

  it("is made with the parent's email as its recovery email, and gives the first password once", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(unitId);
    const id = await makeStudent(accessToken);
    const response = await TestRequest.post(url(id, "/provision"), {}, accessToken);
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data).toMatchObject({ status: "ACTIVE", outcome: "created" });
    expect(data.temporary_password).toHaveLength(16);
    expect(google.created[0]).toMatchObject({ recoveryEmail: "budi.santoso@gmail.com", password: data.temporary_password });
    expect((await personOf(id)).google_sync_status).toBe(GoogleSyncStatus.ACTIVE);
    expect(JSON.stringify(await prismaClient.auditLog.findMany())).not.toContain(data.temporary_password);
  });

  it("is not made for a student with no parent or guardian that has an email", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(unitId);
    // An older student, made before a parent was asked for, or one whose parent has no email.
    const id = await makeStudent(accessToken, { parent: undefined, email: "test_google_old@millennia21.id", nis: "9000999" }).catch(() => null);
    expect(id).toBeNull();

    const { StudentService } = await import("../service/student-service");
    const admin = await prismaClient.adminUser.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
    const created = await StudentService.create(admin, {
      full_name: "Old Student",
      nick_name: "Old",
      email: "test_google_old@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2012-01-01").toISOString(),
      nis: "9000999",
      entry_type: "PSB",
      current_grade_id: gradeId,
      join_academic_year_id: academicYearId,
      join_grade_id: gradeId,
    } as never);
    const refused = await TestRequest.post(url(created.id, "/provision"), {}, accessToken);
    expect(refused.status).toBe(400);
    expect(JSON.stringify(await refused.json())).toContain("Add a parent or guardian with an email first");
    expect(google.created).toHaveLength(0);

    await ParentGuardianTest.create({ studentId: created.id, fullName: "No Email Parent", isPrimary: true });
    expect((await TestRequest.post(url(created.id, "/provision"), {}, accessToken)).status).toBe(400);

    await ParentGuardianTest.create({ studentId: created.id, fullName: "Siti Aminah", email: "siti.aminah@gmail.com" });
    const ok = await TestRequest.post(url(created.id, "/provision"), {}, accessToken);
    expect((await ok.json()).data.outcome).toBe("created");
    expect(google.created[0].recoveryEmail).toBe("siti.aminah@gmail.com");
  });

  it("lists the parents with the email hidden, and the phone only for who may see sensitive data", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(unitId);
    const id = await makeStudent(accessToken);
    const seen = (await (await TestRequest.get(url(id), accessToken)).json()).data;
    expect(seen.guardians).toEqual([
      expect.objectContaining({ type: "FATHER", full_name: "Budi Santoso", is_primary: true, email_hint: "b***@gmail.com", phone: "6281234567890" }),
    ]);
    expect(JSON.stringify(seen)).not.toContain("budi.santoso@gmail.com");

    await AdminUserTest.delete();
    const plain = await AdminUserTest.createDatabaseAdmin(unitId, { canViewSensitiveData: false });
    const hidden = (await (await TestRequest.get(url(id), plain.accessToken)).json()).data;
    expect(hidden.guardians[0].phone).toBeNull();
    expect(hidden.can.create).toBe(true);
  });

  it("mails the details to the parent that was chosen, written to them, and nobody else", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(unitId);
    const id = await makeStudent(accessToken);
    const provisioned = (await (await TestRequest.post(url(id, "/provision"), {}, accessToken)).json()).data;
    const person = await personOf(id);
    const student = await prismaClient.student.findFirstOrThrow({ where: { person_id: person.id } });
    const mother = await ParentGuardianTest.create({ studentId: student.id, type: "MOTHER", fullName: "Siti Aminah", email: "siti.aminah@gmail.com" });
    await letTimePass(id);

    const response = await TestRequest.post(
      url(id, "/send-sign-in"),
      { parent_id: mother.id, language: "id", password: provisioned.temporary_password },
      accessToken,
    );
    expect(response.status).toBe(200);
    expect(mailer.outbox).toHaveLength(1);
    expect(mailer.outbox[0].to).toBe("siti.aminah@gmail.com");
    expect(mailer.outbox[0].text).toContain("Yth. Bapak/Ibu Siti Aminah,");
    expect(mailer.outbox[0].text).toContain("untuk Ari Putra");
    expect(mailer.outbox[0].text).toContain(provisioned.temporary_password);
    const entries = await prismaClient.auditLog.findMany({ where: { action: AuditAction.GOOGLE_SIGNIN_EMAILED } });
    expect(JSON.stringify(entries)).not.toContain("siti.aminah@gmail.com");
    expect(JSON.stringify(entries)).toContain("\"recipient\":\"parent\"");
  });

  it("refuses a parent of another student, an address typed by the browser, and a parent with no email", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(unitId);
    const id = await makeStudent(accessToken);
    const other = await makeStudent(accessToken);
    const provisioned = (await (await TestRequest.post(url(id, "/provision"), {}, accessToken)).json()).data;
    await letTimePass(id);
    const otherStudent = await prismaClient.student.findFirstOrThrow({ where: { person: { email: { contains: `stu${seq}@` } } } });
    const stranger = await prismaClient.parentGuardian.findFirstOrThrow({ where: { student_id: otherStudent.id } });
    const send = (body: Record<string, unknown>) => TestRequest.post(url(id, "/send-sign-in"), { language: "id", password: provisioned.temporary_password, ...body }, accessToken);

    expect((await send({ parent_id: stranger.id })).status).toBe(400);
    expect((await send({ to: "anyone@gmail.com" })).status).toBe(400);
    const student = await prismaClient.student.findFirstOrThrow({ where: { person: { email: { contains: `stu${seq - 1}@` } } } });
    const noMail = await ParentGuardianTest.create({ studentId: student.id, fullName: "No Email" });
    expect((await send({ parent_id: noMail.id })).status).toBe(400);
    expect(mailer.outbox).toHaveLength(0);
    expect(other).toBeDefined();
  });

  it("is made by a Database Admin who may write students in the unit, and not by one who may not or one from another unit", async () => {
    const { accessToken: superToken } = await AdminUserTest.createSuperAdmin(unitId);
    const id = await makeStudent(superToken);
    await AdminUserTest.delete();

    const noWrite = await AdminUserTest.createDatabaseAdmin(unitId, { canWriteStudentData: false });
    expect((await TestRequest.post(url(id, "/provision"), {}, noWrite.accessToken)).status).toBe(403);

    await AdminUserTest.delete();
    const other = await prismaClient.masterUnit.create({ data: { name: `TEST_STUDENT_GOOGLE_OTHER_${Date.now()}` } });
    try {
      const away = await AdminUserTest.createDatabaseAdmin(other.id);
      // Outside their unit the student is not even visible.
      expect((await TestRequest.get(url(id), away.accessToken)).status).toBe(404);
      expect((await TestRequest.post(url(id, "/provision"), {}, away.accessToken)).status).toBe(404);
      expect(google.created).toHaveLength(0);

      await AdminUserTest.delete();
      const inUnit = await AdminUserTest.createDatabaseAdmin(unitId);
      expect((await TestRequest.post(url(id, "/provision"), {}, inUnit.accessToken)).status).toBe(200);
      expect(google.created).toHaveLength(1);
      // The rest stays with the Super Admins: a Database Admin cannot reset the password.
      expect((await TestRequest.post(url(id, "/reset-password"), {}, inUnit.accessToken)).status).toBe(403);
    } finally {
      await AdminUserTest.delete();
      await prismaClient.masterUnit.delete({ where: { id: other.id } }).catch(() => {});
    }
  });

  it("locks a student who withdrew, transferred or was archived, but not one who graduated", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(unitId);
    const id = await makeStudent(accessToken);
    await TestRequest.post(url(id, "/provision"), {}, accessToken);
    const person = await personOf(id);
    const lockedOf = async () => (await (await TestRequest.get(url(id), accessToken)).json()).data.locked as boolean;
    expect(await lockedOf()).toBe(false);

    for (const [status, locked] of [
      [StudentStatus.GRADUATED, false],
      [StudentStatus.WITHDRAWN, true],
      [StudentStatus.TRANSFERRED, true],
      [StudentStatus.ARCHIVED, true],
    ] as const) {
      await prismaClient.student.update({ where: { person_id: person.id }, data: { status } });
      expect(await lockedOf()).toBe(locked);
    }
    await letTimePass(id);
    expect((await TestRequest.post(url(id, "/reset-password"), {}, accessToken)).status).toBe(400);
  });

  it("is not given to a new student whose email Google already has, and not to one renamed onto such an email", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(unitId);
    google.users.set("taken", {
      id: "taken", primaryEmail: "test_google_taken@millennia21.id", givenName: "A", familyName: "B",
      suspended: false, isAdmin: false, changePasswordAtNextLogin: false, lastLoginTime: null,
    });
    await expect(makeStudent(accessToken, { email: "test_google_taken@millennia21.id" })).rejects.toThrow();
    expect(await prismaClient.person.count({ where: { email: "test_google_taken@millennia21.id" } })).toBe(0);

    const id = await makeStudent(accessToken);
    expect((await TestRequest.post(url(id, "/provision"), {}, accessToken)).status).toBe(200);
    const renamed = await TestRequest.patch(`/api/admin/students/${id}`, { email: "test_google_taken@millennia21.id" }, accessToken);
    expect(renamed.status).toBe(400);
    expect((await personOf(id)).email).not.toBe("test_google_taken@millennia21.id");
  });
});
