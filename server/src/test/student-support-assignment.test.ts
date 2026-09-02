import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  StudentTest,
  EmployeeTest,
  GradeTest,
  MasterDataTest,
  AuditLogTest,
} from "./test-utils";
import { AuditAction, StudentSupportRole } from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

async function createTeachingEmployee(email: string): Promise<{ id: string }> {
  const masterUnit = await prismaClient.masterUnit.findFirstOrThrow({
    where: { name: { startsWith: "TEST_" } },
  });
  const position = await prismaClient.masterJobPosition.findFirstOrThrow({
    where: { name: { startsWith: "TEST_" } },
  });
  const building = await prismaClient.masterBuilding.findFirstOrThrow({
    where: { name: { startsWith: "TEST_" } },
  });
  const teachingLevel = await prismaClient.masterJobLevel.create({
    data: {
      name: `TEST_LVL_TEACHER_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      is_teaching_role: true,
    },
  });
  const person = await EmployeeTest.create({
    email,
    unitId: masterUnit.id,
    jobPositionId: position.id,
    jobLevelId: teachingLevel.id,
    buildingId: building.id,
  });
  return person.employee!;
}

async function createNonTeachingEmployee(
  email: string,
): Promise<{ id: string }> {
  const masterUnit = await prismaClient.masterUnit.findFirstOrThrow({
    where: { name: { startsWith: "TEST_" } },
  });
  const position = await prismaClient.masterJobPosition.findFirstOrThrow({
    where: { name: { startsWith: "TEST_" } },
  });
  const building = await prismaClient.masterBuilding.findFirstOrThrow({
    where: { name: { startsWith: "TEST_" } },
  });
  const nonTeachingLevel = await prismaClient.masterJobLevel.create({
    data: {
      name: `TEST_LVL_STAFF_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      is_teaching_role: false,
    },
  });
  const person = await EmployeeTest.create({
    email,
    unitId: masterUnit.id,
    jobPositionId: position.id,
    jobLevelId: nonTeachingLevel.id,
    buildingId: building.id,
  });
  return person.employee!;
}

describe("Student Support Assignment", () => {
  let studentId: string;

  // Student before Employee: StudentSupportAssignment.student cascades on
  // delete, but the employee_id relation doesn't - deleting the employee
  // first would 500 on the FK while an assignment row still references it.
  async function cleanup() {
    await AuditLogTest.delete();
    await StudentTest.delete();
    await EmployeeTest.delete();
    await AdminUserTest.delete();
    // Grade before MasterUnit - a grade created with an explicit alt unit
    // (see the cross-unit test below) FK-references it.
    await GradeTest.delete();
    await MasterDataTest.delete();
  }

  beforeEach(async () => {
    await cleanup();
    await MasterDataTest.create();

    const student = await StudentTest.create({
      email: "test_support_assignment@millennia21.id",
      nis: "9500002",
    });
    studentId = student.student!.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("POST /api/admin/students/:id/support-assignments", () => {
    it("should assign a student support teacher as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_support_teacher_1@millennia21.id",
      );

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/support-assignments`,
        {
          employee_id: teacher.id,
          role: StudentSupportRole.SPECIAL_ED,
          notes: "Weekly reading support",
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.employee.id).toBe(teacher.id);
      expect(body.data.role).toBe(StudentSupportRole.SPECIAL_ED);
      expect(body.data.notes).toBe("Weekly reading support");
      expect(body.data.end_date).toBeNull();

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: {
          action: AuditAction.ASSIGN_STUDENT_SUPPORT,
          admin_id: admin.id,
        },
      });
      expect(auditLog.entity_type).toBe("StudentSupportAssignment");
    });

    it("should assign as DATABASE_ADMIN with can_write_student_data, within their own unit", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const teacher = await createTeachingEmployee(
        "test_support_teacher_2@millennia21.id",
      );

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/support-assignments`,
        { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.employee.id).toBe(teacher.id);
    });

    it("should reject (403) DATABASE_ADMIN without can_write_student_data", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin(
        undefined,
        { canWriteStudentData: false },
      );
      const teacher = await createTeachingEmployee(
        "test_support_teacher_2b@millennia21.id",
      );

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/support-assignments`,
        { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (403) DATABASE_ADMIN assigning a student outside their unit scope", async () => {
      const teacher = await createTeachingEmployee(
        "test_support_teacher_2c@millennia21.id",
      );
      const otherUnit = await prismaClient.masterUnit.create({
        data: { name: `TEST_UNIT_ALT_${Date.now()}` },
      });
      const { accessToken } = await AdminUserTest.createDatabaseAdmin(
        otherUnit.id,
      );

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/support-assignments`,
        { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(403);
      expect(body.errors).toContain("unit scope");
    });

    it("should reject (403) VIEWER assigning a student support teacher", async () => {
      const { accessToken } = await AdminUserTest.createViewer();
      const teacher = await createTeachingEmployee(
        "test_support_teacher_2d@millennia21.id",
      );

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/support-assignments`,
        { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject an employee whose job level is not a teaching role", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const staff = await createNonTeachingEmployee(
        "test_support_nonteaching@millennia21.id",
      );

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/support-assignments`,
        { employee_id: staff.id, role: StudentSupportRole.SPECIAL_ED },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.errors).toContain("Invalid employee");
    });

    it("should reject when the employee's unit doesn't match the student's grade unit", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_support_teacher_cross_unit@millennia21.id",
      );
      const otherUnit = await prismaClient.masterUnit.create({
        data: { name: `TEST_UNIT_ALT_${Date.now()}` },
      });
      const otherGrade = await prismaClient.grade.create({
        data: {
          name: `TEST_GRADE_ALT_${Date.now()}`,
          level: 9999,
          unit_id: otherUnit.id,
        },
      });
      const otherUnitStudent = await StudentTest.create({
        email: "test_support_cross_unit_student@millennia21.id",
        nis: "9500004",
        currentGradeId: otherGrade.id,
      });

      const response = await TestRequest.post(
        `/api/admin/students/${otherUnitStudent.student!.id}/support-assignments`,
        { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
      expect(body.errors).toContain("unit doesn't match");
    });

    it("should reject a non-existent employee_id", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/support-assignments`,
        { employee_id: "invalid-employee-id", role: StudentSupportRole.SPECIAL_ED },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.errors).toContain("Invalid employee");
    });

    it("should reject a duplicate active assignment for the same student/employee/role", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_support_teacher_dup@millennia21.id",
      );

      await TestRequest.post(
        `/api/admin/students/${studentId}/support-assignments`,
        { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
        accessToken,
      );
      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/support-assignments`,
        { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.errors).toContain("already has an active assignment");
    });

    it("should return 404 when the student does not exist", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_support_teacher_3@millennia21.id",
      );

      const response = await TestRequest.post(
        `/api/admin/students/invalid-cuid-123/support-assignments`,
        { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
        accessToken,
      );

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/admin/students/:id/support-assignments", () => {
    it("should list assignments for a student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_support_teacher_list@millennia21.id",
      );
      await TestRequest.post(
        `/api/admin/students/${studentId}/support-assignments`,
        { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
        accessToken,
      );

      const response = await TestRequest.get(
        `/api/admin/students/${studentId}/support-assignments`,
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].employee.id).toBe(teacher.id);
    });

    it("should return 404 when the student does not exist", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.get(
        `/api/admin/students/invalid-cuid-123/support-assignments`,
        accessToken,
      );

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/admin/employees/:id/support-assignments", () => {
    it("should list a teacher's own caseload across students", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_support_teacher_caseload@millennia21.id",
      );
      const otherStudent = await StudentTest.create({
        email: "test_support_assignment_second@millennia21.id",
        nis: "9500003",
      });
      await TestRequest.post(
        `/api/admin/students/${studentId}/support-assignments`,
        { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
        accessToken,
      );
      await TestRequest.post(
        `/api/admin/students/${otherStudent.student!.id}/support-assignments`,
        { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
        accessToken,
      );

      const response = await TestRequest.get(
        `/api/admin/employees/${teacher.id}/support-assignments`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(2);
      const studentIds = body.data.map((entry: { student: { id: string } }) => entry.student.id)
      expect(studentIds).toContain(studentId)
      expect(studentIds).toContain(otherStudent.student!.id)
    });

    it("should return an empty list for an employee with no assignments", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_support_teacher_empty@millennia21.id",
      );

      const response = await TestRequest.get(
        `/api/admin/employees/${teacher.id}/support-assignments`,
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual([]);
    });

    it("should return 404 when the employee does not exist", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.get(
        `/api/admin/employees/invalid-cuid-123/support-assignments`,
        accessToken,
      );

      expect(response.status).toBe(404);
    });
  });

  describe("PATCH /api/admin/students/:id/support-assignments/:assignmentId/end", () => {
    it("should end an active assignment as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_support_teacher_end@millennia21.id",
      );
      const created = await TestRequest.post(
        `/api/admin/students/${studentId}/support-assignments`,
        { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
        accessToken,
      );
      const createdBody = await created.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/support-assignments/${createdBody.data.id}/end`,
        {},
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.end_date).not.toBeNull();

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: {
          action: AuditAction.END_STUDENT_SUPPORT_ASSIGNMENT,
          admin_id: admin.id,
        },
      });
      expect(auditLog.entity_type).toBe("StudentSupportAssignment");
    });

    it("should reject when caller is VIEWER", async () => {
      const superAdmin = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_support_teacher_end2@millennia21.id",
      );
      const created = await TestRequest.post(
        `/api/admin/students/${studentId}/support-assignments`,
        { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
        superAdmin.accessToken,
      );
      const createdBody = await created.json();

      const { accessToken: viewerToken } = await AdminUserTest.createViewer();
      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/support-assignments/${createdBody.data.id}/end`,
        {},
        viewerToken,
      );

      expect(response.status).toBe(403);
    });

    it("should end an active assignment as DATABASE_ADMIN with can_write_student_data, within their own unit", async () => {
      const superAdmin = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_support_teacher_end4@millennia21.id",
      );
      const created = await TestRequest.post(
        `/api/admin/students/${studentId}/support-assignments`,
        { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
        superAdmin.accessToken,
      );
      const createdBody = await created.json();

      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/support-assignments/${createdBody.data.id}/end`,
        {},
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.end_date).not.toBeNull();
    });

    it("should reject (403) DATABASE_ADMIN without can_write_student_data ending an assignment", async () => {
      const superAdmin = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_support_teacher_end5@millennia21.id",
      );
      const created = await TestRequest.post(
        `/api/admin/students/${studentId}/support-assignments`,
        { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
        superAdmin.accessToken,
      );
      const createdBody = await created.json();

      const { accessToken } = await AdminUserTest.createDatabaseAdmin(
        undefined,
        { canWriteStudentData: false },
      );
      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/support-assignments/${createdBody.data.id}/end`,
        {},
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should return 404 for a non-existent assignment id", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/support-assignments/invalid-cuid-123/end`,
        {},
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject ending an already-ended assignment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_support_teacher_end3@millennia21.id",
      );
      const created = await TestRequest.post(
        `/api/admin/students/${studentId}/support-assignments`,
        { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
        accessToken,
      );
      const createdBody = await created.json();

      await TestRequest.patch(
        `/api/admin/students/${studentId}/support-assignments/${createdBody.data.id}/end`,
        {},
        accessToken,
      );
      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/support-assignments/${createdBody.data.id}/end`,
        {},
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.errors).toContain("already ended");
    });
  });
});

describe("GET /api/admin/support-assignments/caseload", () => {
  async function cleanup() {
    await AuditLogTest.delete();
    await StudentTest.delete();
    await EmployeeTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }

  beforeEach(async () => {
    await cleanup();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should count only active assignments, grouped per employee", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const teacherA = await createTeachingEmployee(
      "test_caseload_teacher_a@millennia21.id",
    );
    const teacherB = await createTeachingEmployee(
      "test_caseload_teacher_b@millennia21.id",
    );
    const studentOne = await StudentTest.create({
      email: "test_caseload_student_1@millennia21.id",
      nis: "9500010",
    });
    const studentTwo = await StudentTest.create({
      email: "test_caseload_student_2@millennia21.id",
      nis: "9500011",
    });
    const studentThree = await StudentTest.create({
      email: "test_caseload_student_3@millennia21.id",
      nis: "9500012",
    });

    // teacherA: 2 active (student 1, 2)
    await TestRequest.post(
      `/api/admin/students/${studentOne.student!.id}/support-assignments`,
      { employee_id: teacherA.id, role: StudentSupportRole.SPECIAL_ED },
      accessToken,
    );
    await TestRequest.post(
      `/api/admin/students/${studentTwo.student!.id}/support-assignments`,
      { employee_id: teacherA.id, role: StudentSupportRole.SPECIAL_ED },
      accessToken,
    );
    // teacherB: 1 active (student 3), 1 ended (student 1's old assignment
    // won't collide since it's a different student) - ended one shouldn't count
    const teacherBAssignment = await TestRequest.post(
      `/api/admin/students/${studentThree.student!.id}/support-assignments`,
      { employee_id: teacherB.id, role: StudentSupportRole.SPECIAL_ED },
      accessToken,
    );
    const teacherBBody = await teacherBAssignment.json();
    await TestRequest.patch(
      `/api/admin/students/${studentThree.student!.id}/support-assignments/${teacherBBody.data.id}/end`,
      {},
      accessToken,
    );

    const response = await TestRequest.get(
      "/api/admin/support-assignments/caseload",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    const teacherAEntry = body.data.find(
      (entry: { employee_id: string }) => entry.employee_id === teacherA.id,
    );
    expect(teacherAEntry.active_student_count).toBe(2);
    const teacherBEntry = body.data.find(
      (entry: { employee_id: string }) => entry.employee_id === teacherB.id,
    );
    expect(teacherBEntry).toBeUndefined();
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get(
      "/api/admin/support-assignments/caseload",
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("GET /api/admin/support-assignments/active-student-ids", () => {
  async function cleanup() {
    await AuditLogTest.delete();
    await StudentTest.delete();
    await EmployeeTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }

  beforeEach(async () => {
    await cleanup();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should return only the student IDs with an active SPECIAL_ED assignment", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const teacher = await createTeachingEmployee(
      "test_active_ids_teacher@millennia21.id",
    );
    const studentWithActive = await StudentTest.create({
      email: "test_active_ids_student_active@millennia21.id",
      nis: "9500013",
    });
    const studentWithEnded = await StudentTest.create({
      email: "test_active_ids_student_ended@millennia21.id",
      nis: "9500014",
    });
    const studentWithNone = await StudentTest.create({
      email: "test_active_ids_student_none@millennia21.id",
      nis: "9500015",
    });

    await TestRequest.post(
      `/api/admin/students/${studentWithActive.student!.id}/support-assignments`,
      { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
      accessToken,
    );
    const endedAssignment = await TestRequest.post(
      `/api/admin/students/${studentWithEnded.student!.id}/support-assignments`,
      { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
      accessToken,
    );
    const endedBody = await endedAssignment.json();
    await TestRequest.patch(
      `/api/admin/students/${studentWithEnded.student!.id}/support-assignments/${endedBody.data.id}/end`,
      {},
      accessToken,
    );

    const studentIds = [
      studentWithActive.student!.id,
      studentWithEnded.student!.id,
      studentWithNone.student!.id,
    ].join(",");

    const response = await TestRequest.get(
      `/api/admin/support-assignments/active-student-ids?student_ids=${studentIds}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    const returnedStudentIds = body.data.map(
      (entry: { student_id: string }) => entry.student_id,
    );
    expect(returnedStudentIds).toContain(studentWithActive.student!.id);
    expect(returnedStudentIds).not.toContain(studentWithEnded.student!.id);
    expect(returnedStudentIds).not.toContain(studentWithNone.student!.id);

    const activeEntry = body.data.find(
      (entry: { student_id: string }) =>
        entry.student_id === studentWithActive.student!.id,
    );
    expect(activeEntry.employee.id).toBe(teacher.id);
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get(
      "/api/admin/support-assignments/active-student-ids?student_ids=whatever",
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});
