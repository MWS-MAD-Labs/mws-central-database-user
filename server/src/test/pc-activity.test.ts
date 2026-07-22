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
import { AuditAction, EmploymentType } from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

async function createTeachingEmployee(
  email: string,
  employmentType?: EmploymentType,
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
