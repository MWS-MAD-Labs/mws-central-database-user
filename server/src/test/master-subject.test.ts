import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ClassStatus, ClassTeacherRole } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { AdminUserTest, AuditLogTest, EmployeeTest, GradeTest, MasterDataTest, TestRequest, AcademicYearTest } from "./test-utils";

const PATH = "/api/admin/subjects";

describe("subjects", () => {
  async function cleanup() {
    await prismaClient.classTeacherAssignment.deleteMany({ where: { employee: { employee_id: { startsWith: "99.99.MS" } } } });
    await prismaClient.class.deleteMany({ where: { name: { startsWith: "TEST_MS_CLASS_" } } });
    await prismaClient.grade.deleteMany({ where: { name: { startsWith: "TEST_MS_GRADE_" } } });
    await prismaClient.masterSubject.deleteMany({ where: { key: { startsWith: "test-" } } });
    await EmployeeTest.delete();
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }

  let masterData: Awaited<ReturnType<typeof MasterDataTest.create>>;
  beforeEach(async () => {
    await cleanup();
    masterData = await MasterDataTest.create();
  });
  afterEach(cleanup);

  it("is made with a key from its name, which does not change when it is renamed", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const created = await TestRequest.post(PATH, { name: "TEST_Science Lab" }, accessToken);
    const body = await created.json();

    expect(created.status).toBe(200);
    expect(body.data).toMatchObject({ name: "TEST_Science Lab", key: "test-science-lab" });
    const renamed = await TestRequest.patch(`${PATH}/${body.data.id}`, { name: "TEST_Natural Science" }, accessToken);
    expect((await renamed.json()).data).toMatchObject({ name: "TEST_Natural Science", key: "test-science-lab" });
  });

  it("refuses a name that is written another way: the same letters in other spacing or case are the same subject", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await TestRequest.post(PATH, { name: "TEST_Art" }, accessToken);

    const again = await TestRequest.post(PATH, { name: "test_ART" }, accessToken);

    expect(again.status).toBe(400);
    expect((await again.json()).errors).toContain("very similar");
  });

  it("is managed only by a super admin, and read by any admin", async () => {
    const viewer = await AdminUserTest.createViewer();
    expect((await TestRequest.post(PATH, { name: "TEST_Blocked" }, viewer.accessToken)).status).toBe(403);
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await TestRequest.post(PATH, { name: "TEST_Readable" }, accessToken);

    const list = await TestRequest.get(`${PATH}?search=TEST_Readable`, viewer.accessToken);

    expect(list.status).toBe(200);
    expect((await list.json()).data.map((row: { name: string }) => row.name)).toEqual(["TEST_Readable"]);
  });

  it("cannot be deleted while a teacher assignment is for it, and can be once none is", async () => {
    await prismaClient.masterJobPosition.update({ where: { id: masterData.position.id }, data: { is_teaching_position: true, is_subject_teacher_position: true } });
    await prismaClient.masterJobLevel.update({ where: { id: masterData.level.id }, data: { is_teaching_role: true } });
    const person = await EmployeeTest.create({ email: "test_master_subject@millennia21.id", employeeId: "99.99.MS1", unitId: masterData.unit.id, jobPositionId: masterData.position.id, jobLevelId: masterData.level.id, buildingId: masterData.building.id });
    const year = await AcademicYearTest.createStarted();
    const grade = await prismaClient.grade.create({ data: { name: `TEST_MS_GRADE_${Date.now()}`, level: await GradeTest.freeLevel(), unit_id: masterData.unit.id } });
    const klass = await prismaClient.class.create({ data: { name: `TEST_MS_CLASS_${Date.now()}`, grade_id: grade.id, academic_year_id: year.id, status: ClassStatus.ACTIVE } });
    const subject = await prismaClient.masterSubject.create({ data: { key: "test-used", name: "TEST_Used" } });
    const assignment = await prismaClient.classTeacherAssignment.create({ data: { class_id: klass.id, start_date: new Date(), employee_id: person.employee!.id, role: ClassTeacherRole.SUBJECT_TEACHER, subject: subject.name, subject_id: subject.id } });
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const refused = await TestRequest.delete(`${PATH}/${subject.id}`, accessToken);
    expect(refused.status).toBe(400);
    expect((await refused.json()).errors).toContain("class teacher assignment");

    await prismaClient.classTeacherAssignment.delete({ where: { id: assignment.id } });
    expect((await TestRequest.delete(`${PATH}/${subject.id}`, accessToken)).status).toBe(200);
  });
});
