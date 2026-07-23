import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  StudentTest,
  PCActivityTest,
  EmployeeTest,
  MasterDataTest,
  AuditLogTest,
} from "./test-utils";
import {
  AcademicYearStatus,
  AdminRole,
  AuditAction,
  EmployeeStatus,
  EmploymentType,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

async function createTeachingEmployee(
  email: string,
  employmentType?: EmploymentType,
  status?: EmployeeStatus,
): Promise<{ id: string }> {
  const masterUnit = await prismaClient.masterUnit.findFirstOrThrow({
    where: { name: { startsWith: "TEST_" } },
  });
  const position = await prismaClient.masterJobPosition.findFirstOrThrow({
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
    employmentType,
    status,
  });
  return person.employee!;
}

async function createNonTeachingEmployee(email: string): Promise<{ id: string }> {
  const masterUnit = await prismaClient.masterUnit.findFirstOrThrow({
    where: { name: { startsWith: "TEST_" } },
  });
  const position = await prismaClient.masterJobPosition.findFirstOrThrow({
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
  });
  return person.employee!;
}

describe("PC Activity", () => {
  let studentId: string;

  async function cleanup() {
    await AuditLogTest.delete();
    await PCActivityTest.delete();
    await EmployeeTest.delete();
    await StudentTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
    await prismaClient.academicYear.deleteMany({
      where: { name: { startsWith: "TEST_STUDENT_YEAR_OTHER" } },
    });
  }

  beforeEach(async () => {
    await cleanup();
    await MasterDataTest.create();

    const student = await StudentTest.create({
      email: "test_pc_activity@millennia21.id",
      nis: "9500001",
    });
    studentId = student.student!.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("POST /api/admin/students/:id/pc-activities", () => {
    it("should create a PC activity as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity: "Basketball" },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.day).toBe("MONDAY");
      expect(body.data.activity).toBe("Basketball");
      expect(body.data.mentor_id).toBeNull();

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.CREATE_PC_ACTIVITY, admin_id: admin.id },
      });
      expect(auditLog.entity_type).toBe("PassionConnectionActivity");
    });

    it("should create a PC activity with an eligible mentor", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_pc_mentor_1@millennia21.id",
      );

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity: "Basketball", mentor_id: teacher.id },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.mentor_id).toBe(teacher.id);
    });

    it("should accept a FREELANCE teacher as a mentor", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const freelanceTeacher = await createTeachingEmployee(
        "test_pc_mentor_freelance@millennia21.id",
        EmploymentType.FREELANCE,
      );

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        {
          day: "MONDAY",
          activity: "Basketball",
          mentor_id: freelanceTeacher.id,
        },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.mentor_id).toBe(freelanceTeacher.id);
    });

    it("should reject (400) a mentor who doesn't hold a teaching-eligible job level", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const staff = await createNonTeachingEmployee(
        "test_pc_mentor_2@millennia21.id",
      );

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity: "Basketball", mentor_id: staff.id },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) a nonexistent mentor_id", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity: "Basketball", mentor_id: "nonexistent-id" },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) a nonexistent academic_year_id", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        {
          day: "MONDAY",
          activity: "Basketball",
          academic_year_id: "nonexistent-id",
        },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) a soft-deleted mentor", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_pc_mentor_deleted@millennia21.id",
      );
      await prismaClient.employee.update({
        where: { id: teacher.id },
        data: { deleted_at: new Date() },
      });

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity: "Basketball", mentor_id: teacher.id },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) a mentor whose employment status isn't ACTIVE", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_pc_mentor_inactive@millennia21.id",
        undefined,
        EmployeeStatus.INACTIVE,
      );

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity: "Basketball", mentor_id: teacher.id },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) an invalid day value", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "FRIDAY", activity: "Basketball" },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) an empty activity name", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity: "" },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) an activity name longer than 100 characters", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity: "A".repeat(101) },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) when no active academic year exists and academic_year_id isn't given", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await prismaClient.academicYear.updateMany({
        where: { status: AcademicYearStatus.ACTIVE },
        data: { status: AcademicYearStatus.COMPLETED },
      });

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity: "Basketball" },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should create a PC activity as DATABASE_ADMIN with can_write_data", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity: "Basketball" },
        accessToken,
      );

      expect(response.status).toBe(200);
    });

    it("should reject (403) for DATABASE_ADMIN when can_write_data is false", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      await prismaClient.adminUser.updateMany({
        where: { role: AdminRole.DATABASE_ADMIN },
        data: { can_write_data: false },
      });

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity: "Basketball" },
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity: "Basketball" },
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (404) for a nonexistent student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/nonexistent-id/pc-activities`,
        { day: "MONDAY", activity: "Basketball" },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (400) a duplicate day for the same student and academic year", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity: "Basketball" },
        accessToken,
      );
      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity: "Coding Club" },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should allow two students to have different mentors for the same activity name", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const coachA = await createTeachingEmployee(
        "test_pc_coach_a@millennia21.id",
      );
      const coachB = await createTeachingEmployee(
        "test_pc_coach_b@millennia21.id",
      );
      const otherStudent = await StudentTest.create({
        email: "test_pc_activity_2@millennia21.id",
        nis: "9500002",
      });

      const first = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity: "Basketball", mentor_id: coachA.id },
        accessToken,
      );
      const second = await TestRequest.post(
        `/api/admin/students/${otherStudent.student!.id}/pc-activities`,
        { day: "MONDAY", activity: "Basketball", mentor_id: coachB.id },
        accessToken,
      );
      const firstBody = await first.json();
      const secondBody = await second.json();

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(firstBody.data.mentor_id).toBe(coachA.id);
      expect(secondBody.data.mentor_id).toBe(coachB.id);
    });

    it("should allow the same student and day across two different academic years", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const currentYear = await prismaClient.academicYear.findFirstOrThrow({
        where: { status: AcademicYearStatus.ACTIVE },
      });
      const otherYear = await prismaClient.academicYear.create({
        data: {
          name: `TEST_STUDENT_YEAR_OTHER_${Date.now()}`,
          status: AcademicYearStatus.UPCOMING,
        },
      });

      const first = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        {
          day: "MONDAY",
          activity: "Basketball",
          academic_year_id: currentYear.id,
        },
        accessToken,
      );
      const second = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        {
          day: "MONDAY",
          activity: "Basketball",
          academic_year_id: otherYear.id,
        },
        accessToken,
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
    });
  });

  describe("GET /api/admin/students/:id/pc-activities", () => {
    it("should list PC activities, excluding soft-deleted by default", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      await PCActivityTest.create({
        studentId,
        day: "MONDAY",
        activity: "Basketball",
      });
      await PCActivityTest.create({
        studentId,
        day: "TUESDAY",
        activity: "Coding Club",
        deletedAt: new Date(),
      });

      const activeResponse = await TestRequest.get(
        `/api/admin/students/${studentId}/pc-activities`,
        accessToken,
      );
      const activeBody = await activeResponse.json();
      logger.debug(activeBody);

      expect(activeResponse.status).toBe(200);
      expect(activeBody.data.length).toBe(1);
      expect(activeBody.data[0].activity).toBe("Basketball");

      const deletedResponse = await TestRequest.get(
        `/api/admin/students/${studentId}/pc-activities?is_deleted=true`,
        accessToken,
      );
      const deletedBody = await deletedResponse.json();

      expect(deletedBody.data.length).toBe(1);
      expect(deletedBody.data[0].activity).toBe("Coding Club");
    });

    it("should reject (404) for a nonexistent student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.get(
        `/api/admin/students/nonexistent-id/pc-activities`,
        accessToken,
      );

      expect(response.status).toBe(404);
    });
  });

  describe("PATCH /api/admin/students/:id/pc-activities/:activityId", () => {
    it("should update a PC activity's activity name and mentor", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_pc_mentor_3@millennia21.id",
      );
      const activity = await PCActivityTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/${activity.id}`,
        { activity: "Chess Club", mentor_id: teacher.id },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.activity).toBe("Chess Club");
      expect(body.data.mentor_id).toBe(teacher.id);
    });

    it("should clear the mentor when mentor_id is explicitly null", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_pc_mentor_clear@millennia21.id",
      );
      const activity = await PCActivityTest.create({
        studentId,
        mentorId: teacher.id,
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/${activity.id}`,
        { mentor_id: null },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.mentor_id).toBeNull();
    });

    it("should reject (400) updating to a mentor who doesn't hold a teaching-eligible job level", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const staff = await createNonTeachingEmployee(
        "test_pc_mentor_update_staff@millennia21.id",
      );
      const activity = await PCActivityTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/${activity.id}`,
        { mentor_id: staff.id },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) updating to a soft-deleted mentor", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const teacher = await createTeachingEmployee(
        "test_pc_mentor_update_deleted@millennia21.id",
      );
      await prismaClient.employee.update({
        where: { id: teacher.id },
        data: { deleted_at: new Date() },
      });
      const activity = await PCActivityTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/${activity.id}`,
        { mentor_id: teacher.id },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should ignore a day value sent in the request body (day is immutable after create)", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const activity = await PCActivityTest.create({
        studentId,
        day: "MONDAY",
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/${activity.id}`,
        { day: "TUESDAY", activity: "Chess Club" },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.day).toBe("MONDAY");
    });

    it("should update a PC activity as DATABASE_ADMIN with can_write_data", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const activity = await PCActivityTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/${activity.id}`,
        { activity: "Chess Club" },
        accessToken,
      );

      expect(response.status).toBe(200);
    });

    it("should reject (403) for DATABASE_ADMIN when can_write_data is false", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      await prismaClient.adminUser.updateMany({
        where: { role: AdminRole.DATABASE_ADMIN },
        data: { can_write_data: false },
      });
      const activity = await PCActivityTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/${activity.id}`,
        { activity: "Chess Club" },
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();
      const activity = await PCActivityTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/${activity.id}`,
        { activity: "Chess Club" },
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (404) for a nonexistent PC activity", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/nonexistent-id`,
        { activity: "Chess Club" },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (400) updating a soft-deleted PC activity", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const activity = await PCActivityTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/${activity.id}`,
        { activity: "Chess Club" },
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/students/:id/pc-activities/delete/:activityId", () => {
    it("should soft-delete a PC activity as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const activity = await PCActivityTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/delete/${activity.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(200);

      const deleted =
        await prismaClient.passionConnectionActivity.findUniqueOrThrow({
          where: { id: activity.id },
        });
      expect(deleted.deleted_at).not.toBeNull();
    });

    it("should reject (403) for DATABASE_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const activity = await PCActivityTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/delete/${activity.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (400) deleting an already-deleted PC activity", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const activity = await PCActivityTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/delete/${activity.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/students/:id/pc-activities/restore/:activityId", () => {
    it("should restore a soft-deleted PC activity as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const activity = await PCActivityTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/restore/${activity.id}`,
        {},
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.id).toBe(activity.id);

      const restored =
        await prismaClient.passionConnectionActivity.findUniqueOrThrow({
          where: { id: activity.id },
        });
      expect(restored.deleted_at).toBeNull();
    });

    it("should reject (403) for DATABASE_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const activity = await PCActivityTest.create({
        studentId,
        deletedAt: new Date(),
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/restore/${activity.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (400) restoring a PC activity that isn't deleted", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const activity = await PCActivityTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/restore/${activity.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should allow recreating a day after the previous PC activity was soft-deleted", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const created = await PCActivityTest.create({
        studentId,
        day: "MONDAY",
        deletedAt: new Date(),
      });

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity: "Basketball" },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.id).not.toBe(created.id);
    });
  });
});
