import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  AuditAction,
  ClassStatus,
  ClassTeacherRole,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import {
  AdminUserTest,
  AcademicYearTest,
  ApiClientTest,
  EmployeeTest,
  InternTest,
  MasterDataTest,
  TestRequest,
  GradeTest,
} from "./test-utils";

const READ_SCOPE = "class_teacher_assignments:read";

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("Class Teacher Assignment API (internal)", () => {
  async function cleanup() {
    await prismaClient.classTeacherAssignment.deleteMany({
      where: {
        OR: [
          { employee: { employee_id: { startsWith: "99.99." } } },
          { intern: { email: { contains: "test_intern_" } } },
        ],
      },
    });
    await prismaClient.class.deleteMany({
      where: { name: { startsWith: "TEST_API_CLASS_" } },
    });
    await prismaClient.masterSubject.deleteMany({
      where: { key: { startsWith: "test-" } },
    });
    await prismaClient.grade.deleteMany({
      where: { name: { startsWith: "TEST_API_GRADE_" } },
    });
    await prismaClient.academicYear.deleteMany({
      where: { name: "2099/2100", classes: { none: {} } },
    });
    await InternTest.delete();
    await EmployeeTest.delete();
    await AdminUserTest.delete();
    await ApiClientTest.delete();
    await MasterDataTest.delete();
  }

  beforeEach(cleanup);
  afterEach(cleanup);

  async function createClass(unitId: string) {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let academicYear = await prismaClient.academicYear.findUnique({
      where: { name: "2099/2100" },
    });
    if (!academicYear) {
      const created = await AcademicYearTest.createStarted();
      academicYear = await prismaClient.academicYear.update({
        where: { id: created.id },
        data: { name: "2099/2100" },
      });
    }
    const grade = await prismaClient.grade.create({
      data: {
        name: `TEST_API_GRADE_${suffix}`,
        level: await GradeTest.freeLevel(),
        unit_id: unitId,
      },
    });
    return prismaClient.class.create({
      data: {
        name: `TEST_API_CLASS_${suffix}`,
        grade_id: grade.id,
        academic_year_id: academicYear.id,
        status: ClassStatus.ACTIVE,
      },
    });
  }

  it("returns employee assignments with workforce metadata and legacy fields", async () => {
    const masterData = await MasterDataTest.create();
    const klass = await createClass(masterData.unit.id);
    const person = await EmployeeTest.create({
      email: "test_class_api_employee@millennia21.id",
      employeeId: "99.99.API1",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
    });
    await prismaClient.classTeacherAssignment.create({
      data: {
        class_id: klass.id,
        start_date: new Date(),
        employee_id: person.employee!.id,
        role: ClassTeacherRole.SUBJECT_TEACHER,
        subject: "Coding",
      },
    });
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
    });

    const response = await TestRequest.get(
      "/api/internal/class-teacher-assignments?size=100",
      undefined,
      authHeader(token),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    const assignment = body.data.find(
      (item: { class_id: string }) => item.class_id === klass.id,
    );
    expect(assignment.workforce_member).toEqual({
      type: "EMPLOYEE",
      id: person.employee!.id,
      member_id: person.employee!.id,
      person_id: person.id,
      full_name: person.full_name,
      email: person.email,
      unit_name: masterData.unit.name,
      job_position: masterData.position.name,
      employee_id: "99.99.API1",
    });
    expect(assignment.unit_id).toBe(masterData.unit.id);
    expect(assignment.grade_id).toBe(klass.grade_id);
    expect(assignment.additional_grade_ids).toEqual([]);
    expect(assignment.employee_id).toBe(person.employee!.id);
    expect(assignment.employee_email).toBe(person.email);
    expect(assignment.academic_year_id).toBe(klass.academic_year_id);
    expect(typeof assignment.academic_year).toBe("string");
    expect(assignment.academic_year.length).toBeGreaterThan(0);
    expect(assignment.academic_year_start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      assignment.academic_year_end_date === null ||
        /^\d{4}-\d{2}-\d{2}$/.test(assignment.academic_year_end_date),
    ).toBe(true);
  });

  it("returns intern assignments with an explicit discriminator", async () => {
    const masterData = await MasterDataTest.create();
    const klass = await createClass(masterData.unit.id);
    await prismaClient.masterJobPosition.update({
      where: { id: masterData.position.id },
      data: { is_teaching_position: true },
    });
    const intern = await InternTest.create({
      email: "test_intern_class_api@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });
    await prismaClient.intern.update({
      where: { id: intern.id },
      data: { end_date: new Date("2027-06-30") },
    });
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const assignResponse = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      {
        intern_id: intern.id,
        role: ClassTeacherRole.SUPPORTING_HOMEROOM,
      },
      accessToken,
    );
    expect(assignResponse.status).toBe(200);
    const assignmentAudit = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AuditAction.ASSIGN_CLASS_TEACHER },
      orderBy: { created_at: "desc" },
    });
    expect(assignmentAudit.new_values).toMatchObject({
      member_type: "INTERN",
      member_id: intern.id,
      member_name: intern.full_name,
      employee_id: null,
      intern_id: intern.id,
    });
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
    });

    const response = await TestRequest.get(
      "/api/internal/class-teacher-assignments?size=100",
      undefined,
      authHeader(token),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    const assignment = body.data.find(
      (item: { class_id: string }) => item.class_id === klass.id,
    );
    expect(assignment.workforce_member).toEqual({
      type: "INTERN",
      id: intern.id,
      member_id: intern.id,
      person_id: intern.person_id,
      full_name: intern.full_name,
      email: intern.email,
      unit_name: masterData.unit.name,
      job_position: masterData.position.name,
      employee_id: null,
    });
    expect(assignment.employee_id).toBeNull();
    expect(assignment.employee_email).toBeNull();
  });

  it("bulk-moves an intern assignment without changing the workforce target", async () => {
    const masterData = await MasterDataTest.create();
    await prismaClient.masterJobPosition.update({
      where: { id: masterData.position.id },
      data: { is_teaching_position: true },
    });
    const sourceClass = await createClass(masterData.unit.id);
    const targetClass = await createClass(masterData.unit.id);
    await prismaClient.class.update({
      where: { id: targetClass.id },
      data: { grade_id: sourceClass.grade_id },
    });
    const intern = await InternTest.create({
      email: "test_intern_bulk_move@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });
    await prismaClient.intern.update({
      where: { id: intern.id },
      data: { end_date: new Date("2027-06-30") },
    });
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const assignResponse = await TestRequest.post(
      `/api/admin/classes/${sourceClass.id}/teachers`,
      {
        intern_id: intern.id,
        role: ClassTeacherRole.SUBJECT_TEACHER,
        subject: "Art",
      },
      accessToken,
    );
    const assignBody = await assignResponse.json();
    expect(assignResponse.status).toBe(200);

    const moveResponse = await TestRequest.patch(
      `/api/admin/classes/${sourceClass.id}/teachers/bulk/move`,
      {
        assignment_ids: [assignBody.data.id],
        target_class_id: targetClass.id,
      },
      accessToken,
    );
    const moveBody = await moveResponse.json();

    expect(moveResponse.status).toBe(200);
    expect(moveBody.data.success_count).toBe(1);
    expect(moveBody.data.items[0].data.workforce_member).toMatchObject({
      id: intern.id,
      type: "INTERN",
    });

    const oldAssignment =
      await prismaClient.classTeacherAssignment.findUniqueOrThrow({
        where: { id: assignBody.data.id },
      });
    const newAssignment =
      await prismaClient.classTeacherAssignment.findFirstOrThrow({
        where: {
          class_id: targetClass.id,
          intern_id: intern.id,
          end_date: null,
          deleted_at: null,
        },
      });
    expect(oldAssignment.end_date).not.toBeNull();
    expect(newAssignment.employee_id).toBeNull();
    expect(newAssignment.subject).toBe("Art");
  });

  describe("subjects", () => {
    async function subjectTeacherSetup() {
      const masterData = await MasterDataTest.create();
      await prismaClient.masterJobPosition.update({
        where: { id: masterData.position.id },
        data: { is_teaching_position: true, is_subject_teacher_position: true },
      });
      await prismaClient.masterJobLevel.update({ where: { id: masterData.level.id }, data: { is_teaching_role: true } });
      const person = await EmployeeTest.create({
        email: "test_class_api_subject@millennia21.id",
        employeeId: "99.99.SUB1",
        unitId: masterData.unit.id,
        jobPositionId: masterData.position.id,
        jobLevelId: masterData.level.id,
        buildingId: masterData.building.id,
      });
      const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
      return { masterData, person, accessToken };
    }

    async function syncRows(classIds: string[]) {
      const { token } = await ApiClientTest.createWithToken({ scopeNames: [READ_SCOPE] });
      const response = await TestRequest.get("/api/internal/class-teacher-assignments?size=100", undefined, authHeader(token));
      const body = await response.json();
      expect(response.status).toBe(200);
      return body.data.filter((item: { class_id: string }) => classIds.includes(item.class_id)) as { class_id: string; subject: string; subject_id: string | null; subject_name: string | null }[];
    }

    it("gives a subject written as text a subject of its own, the same one however it is spaced or cased, and sends its id and name", async () => {
      const { masterData, person, accessToken } = await subjectTeacherSetup();
      const first = await createClass(masterData.unit.id);
      const second = await createClass(masterData.unit.id);
      const assign = (classId: string, subject: string) =>
        TestRequest.post(`/api/admin/classes/${classId}/teachers`, { employee_id: person.employee!.id, role: ClassTeacherRole.SUBJECT_TEACHER, subject }, accessToken);

      expect((await assign(first.id, "TEST_Art")).status).toBe(200);
      expect((await assign(second.id, "  test_ART ")).status).toBe(200);

      const rows = await syncRows([first.id, second.id]);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.subject_id).not.toBeNull();
      expect(rows[0]!.subject_id).toBe(rows[1]!.subject_id);
      expect(rows.map((row) => row.subject_name)).toEqual(["TEST_Art", "TEST_Art"]);
      expect(await prismaClient.masterSubject.count({ where: { key: "test-art" } })).toBe(1);
    });

    it("keeps the id of a subject when it is renamed, and shows the new name everywhere", async () => {
      const { masterData, person, accessToken } = await subjectTeacherSetup();
      const klass = await createClass(masterData.unit.id);
      await TestRequest.post(`/api/admin/classes/${klass.id}/teachers`, { employee_id: person.employee!.id, role: ClassTeacherRole.SUBJECT_TEACHER, subject: "TEST_Math" }, accessToken);
      const before = (await syncRows([klass.id]))[0]!;

      const renamed = await TestRequest.patch(`/api/admin/subjects/${before.subject_id}`, { name: "TEST_Mathematics" }, accessToken);

      expect(renamed.status).toBe(200);
      const after = (await syncRows([klass.id]))[0]!;
      expect(after.subject_id).toBe(before.subject_id);
      expect(after.subject_name).toBe("TEST_Mathematics");
      expect(after.subject).toBe("TEST_Mathematics");
      // The key it was made with does not change, and a similar name is not another subject.
      expect((await prismaClient.masterSubject.findUniqueOrThrow({ where: { id: before.subject_id! } })).key).toBe("test-math");
    });

    it("takes a subject chosen from the list, and refuses one that is not there", async () => {
      const { masterData, person, accessToken } = await subjectTeacherSetup();
      const klass = await createClass(masterData.unit.id);
      const subject = await prismaClient.masterSubject.create({ data: { key: "test-music", name: "TEST_Music" } });
      const assign = (body: Record<string, unknown>) => TestRequest.post(`/api/admin/classes/${klass.id}/teachers`, { employee_id: person.employee!.id, role: ClassTeacherRole.SUBJECT_TEACHER, ...body }, accessToken);

      expect((await assign({ subject_id: "no-such-subject" })).status).toBe(400);
      expect((await assign({ subject_id: subject.id })).status).toBe(200);
      expect((await assign({ subject_id: subject.id })).status).toBe(400);

      const [row] = await syncRows([klass.id]);
      expect(row).toMatchObject({ subject_id: subject.id, subject_name: "TEST_Music" });
    });

    it("sends the name with no id for an assignment written before subjects were rows", async () => {
      const masterData = await MasterDataTest.create();
      const klass = await createClass(masterData.unit.id);
      const person = await EmployeeTest.create({ email: "test_class_api_legacy@millennia21.id", employeeId: "99.99.LEG1", unitId: masterData.unit.id, jobPositionId: masterData.position.id, jobLevelId: masterData.level.id, buildingId: masterData.building.id });
      await prismaClient.classTeacherAssignment.create({ data: { class_id: klass.id, start_date: new Date(), employee_id: person.employee!.id, role: ClassTeacherRole.SUBJECT_TEACHER, subject: "TEST_Legacy" } });

      const [row] = await syncRows([klass.id]);

      expect(row).toMatchObject({ subject: "TEST_Legacy", subject_id: null, subject_name: "TEST_Legacy" });
    });
  });
});
