import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  MasterDataTest,
  StudentTest,
  EmployeeTest,
  ApiClientTest,
  AuditLogTest,
} from "./test-utils";
import { StudentSupportRole } from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

const READ_SCOPE = "student_support_assignments:read";

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

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

describe("Student Support Assignment API (internal)", () => {
  let studentId: string;

  // Student before Employee: StudentSupportAssignment.student cascades on
  // delete, but the employee_id relation doesn't - deleting the employee
  // first would 500 on the FK while an assignment row still references it.
  async function cleanup() {
    await AuditLogTest.delete();
    await ApiClientTest.delete();
    await StudentTest.delete();
    await EmployeeTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }

  beforeEach(async () => {
    await cleanup();
    await MasterDataTest.create();

    const student = await StudentTest.create({
      email: "test_seapi_student@millennia21.id",
      nis: "9600001",
    });
    studentId = student.student!.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("GET /api/internal/student-support-assignments", () => {
    it("should list active assignments with employee/student emails", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_seapi_teacher_1@millennia21.id",
      );

      await TestRequest.post(
        `/api/admin/students/${studentId}/support-assignments`,
        { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
        accessToken,
      );

      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });

      const response = await TestRequest.get(
        "/api/internal/student-support-assignments",
        undefined,
        authHeader(token),
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].employee_email).toBe(
        "test_seapi_teacher_1@millennia21.id",
      );
      expect(body.data[0].student_email).toBe(
        "test_seapi_student@millennia21.id",
      );
      expect(body.data[0].role).toBe(StudentSupportRole.SPECIAL_ED);
    });

    it("should not include an assignment that has already ended", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_seapi_teacher_2@millennia21.id",
      );

      const assignResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/support-assignments`,
        { employee_id: teacher.id, role: StudentSupportRole.SPECIAL_ED },
        accessToken,
      );
      const assignBody = await assignResponse.json();

      await TestRequest.patch(
        `/api/admin/students/${studentId}/support-assignments/${assignBody.data.id}/end`,
        {},
        accessToken,
      );

      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });

      const response = await TestRequest.get(
        "/api/internal/student-support-assignments",
        undefined,
        authHeader(token),
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(0);
    });

    it("should reject a client without the required scope", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: ["employees:read"],
      });

      const response = await TestRequest.get(
        "/api/internal/student-support-assignments",
        undefined,
        authHeader(token),
      );

      expect(response.status).toBe(403);
    });

    it("should reject an unauthenticated request", async () => {
      const response = await TestRequest.get(
        "/api/internal/student-support-assignments",
      );

      expect(response.status).toBe(401);
    });
  });
});
