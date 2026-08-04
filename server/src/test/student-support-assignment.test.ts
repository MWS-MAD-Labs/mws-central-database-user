import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  StudentTest,
  EmployeeTest,
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

    it("should reject when caller is not SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const teacher = await createTeachingEmployee(
        "test_support_teacher_2@millennia21.id",
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

    it("should reject when caller is not SUPER_ADMIN", async () => {
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
