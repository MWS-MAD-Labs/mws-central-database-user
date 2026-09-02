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

describe("PC Activity", () => {
  let studentId: string;
  let basketballId: string;
  let codingClubId: string;
  let chessClubId: string;

  async function cleanup() {
    await AuditLogTest.delete();
    await PCActivityTest.delete();
    // Must run before EmployeeTest.delete()/MasterDataTest.delete() below -
    // both mentor_id and unit_id on this row are RESTRICT FKs.
    await prismaClient.pCActivityDefaultMentor.deleteMany({
      where: { unit: { name: { startsWith: "TEST_" } } },
    });
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

    basketballId = await PCActivityTest.resolveActivityId("Basketball");
    codingClubId = await PCActivityTest.resolveActivityId("Coding Club");
    chessClubId = await PCActivityTest.resolveActivityId("Chess Club");
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("POST /api/admin/students/:id/pc-activities", () => {
    it("should create a PC activity as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity_id: basketballId },
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

    it("should show the activity's default mentor for the student's unit in the response", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const unit = await prismaClient.masterUnit.findFirstOrThrow({
        where: { name: "TEST_UNIT_SHIELD" },
      });
      const defaultMentor = await createTeachingEmployee(
        "test_pc_default_mentor_1@millennia21.id",
      );
      await prismaClient.pCActivityDefaultMentor.create({
        data: {
          activity_id: basketballId,
          unit_id: unit.id,
          mentor_id: defaultMentor.id,
        },
      });

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity_id: basketballId },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.mentor_id).toBe(defaultMentor.id);
      expect(body.data.mentor_name).toBeTruthy();
    });

    it("should not apply a default mentor set for a different unit", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const otherUnit = await prismaClient.masterUnit.create({
        data: { name: `TEST_UNIT_OTHER_${Date.now()}` },
      });
      const mentorForOtherUnit = await createTeachingEmployee(
        "test_pc_default_mentor_other_unit@millennia21.id",
      );
      await prismaClient.pCActivityDefaultMentor.create({
        data: {
          activity_id: basketballId,
          unit_id: otherUnit.id,
          mentor_id: mentorForOtherUnit.id,
        },
      });

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity_id: basketballId },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.mentor_id).toBeNull();
      // otherUnit and its PCActivityDefaultMentor row are cleaned up by the
      // shared cleanup() afterEach (both match the "TEST_" unit-name filter).
    });

    it("should reject (400) a nonexistent academic_year_id", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        {
          day: "MONDAY",
          activity_id: basketballId,
          academic_year_id: "nonexistent-id",
        },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) an invalid day value", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "FRIDAY", activity_id: basketballId },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) an empty activity_id", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity_id: "" },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) a nonexistent activity_id", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity_id: "nonexistent-activity-id" },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

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
        { day: "MONDAY", activity_id: basketballId },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should create a PC activity as DATABASE_ADMIN with can_write_student_data", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity_id: basketballId },
        accessToken,
      );

      expect(response.status).toBe(200);
    });

    it("should reject (403) for DATABASE_ADMIN when can_write_student_data is false", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin(
        undefined,
        { canWriteStudentData: false },
      );

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity_id: basketballId },
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity_id: basketballId },
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (403) for DATABASE_ADMIN when the student is outside their unit", async () => {
      const juniorHighUnit = await prismaClient.masterUnit.findUniqueOrThrow({
        where: { name: "Junior High" },
      });
      const { accessToken } =
        await AdminUserTest.createDatabaseAdmin(juniorHighUnit.id);

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity_id: basketballId },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(403);
      expect(body.errors).toContain("unit scope");
    });

    it("should reject (404) for a nonexistent student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/nonexistent-id/pc-activities`,
        { day: "MONDAY", activity_id: basketballId },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (400) a duplicate day for the same student and academic year", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity_id: basketballId },
        accessToken,
      );
      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity_id: codingClubId },
        accessToken,
      );

      expect(response.status).toBe(400);
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
          start_date: new Date("2026-01-01"),
        },
      });

      const first = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        {
          day: "MONDAY",
          activity_id: basketballId,
          academic_year_id: currentYear.id,
        },
        accessToken,
      );
      const second = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        {
          day: "MONDAY",
          activity_id: basketballId,
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
    it("should update a PC activity's activity", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const activity = await PCActivityTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/${activity.id}`,
        { activity_id: chessClubId },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.activity).toBe("Chess Club");
    });

    it("closes the old row and creates a new one instead of editing in place (mutation history)", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const activity = await PCActivityTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/${activity.id}`,
        { activity_id: chessClubId },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      // A genuinely new row, not the same one edited in place.
      expect(body.data.id).not.toBe(activity.id);

      const oldRow = await prismaClient.passionConnectionActivity.findUniqueOrThrow(
        { where: { id: activity.id } },
      );
      expect(oldRow.deleted_at).not.toBeNull();

      const newRow = await prismaClient.passionConnectionActivity.findUniqueOrThrow(
        { where: { id: body.data.id } },
      );
      expect(newRow.deleted_at).toBeNull();
      expect(newRow.activity_id).toBe(chessClubId);

      // Old row shows up in the "history" view (same toggle the UI already
      // has for the trash bin).
      const historyResponse = await TestRequest.get(
        `/api/admin/students/${studentId}/pc-activities?is_deleted=true`,
        accessToken,
      );
      const historyBody = await historyResponse.json();
      expect(
        historyBody.data.some((row: { id: string }) => row.id === activity.id),
      ).toBe(true);
    });

    it("should reject (400) when there's nothing to change", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const activity = await PCActivityTest.create({
        studentId,
        activity: "Chess Club",
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/${activity.id}`,
        { activity_id: chessClubId },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
      expect(body.errors).toContain("No changes to apply");
    });

    it("should ignore a day value sent in the request body (day is immutable after create)", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const activity = await PCActivityTest.create({
        studentId,
        day: "MONDAY",
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/${activity.id}`,
        { day: "TUESDAY", activity_id: chessClubId },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.day).toBe("MONDAY");
    });

    it("should update a PC activity as DATABASE_ADMIN with can_write_student_data", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const activity = await PCActivityTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/${activity.id}`,
        { activity_id: chessClubId },
        accessToken,
      );

      expect(response.status).toBe(200);
    });

    it("should reject (403) for DATABASE_ADMIN when can_write_student_data is false", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin(
        undefined,
        { canWriteStudentData: false },
      );
      const activity = await PCActivityTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/${activity.id}`,
        { activity_id: chessClubId },
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();
      const activity = await PCActivityTest.create({ studentId });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/${activity.id}`,
        { activity_id: chessClubId },
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (404) for a nonexistent PC activity", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/nonexistent-id`,
        { activity_id: chessClubId },
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
        { activity_id: chessClubId },
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

    it("should reject (400) restoring a superseded row while a newer one for the same day/year is active", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const activity = await PCActivityTest.create({ studentId });

      // update() closes `activity` and opens a new active row for the same
      // (student, day, academic_year) slot - restoring the old one now
      // conflicts with that new one under the partial unique index.
      await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/${activity.id}`,
        { activity_id: chessClubId },
        accessToken,
      );

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/pc-activities/restore/${activity.id}`,
        {},
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
      expect(body.errors).toContain("already has a PC activity recorded");
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
        { day: "MONDAY", activity_id: basketballId },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.id).not.toBe(created.id);
    });
  });

  describe("PC Activity Master Data (/api/admin/pc-activities-master)", () => {
    afterEach(async () => {
      // Must run before masterPCActivity.deleteMany below - both FKs on
      // this row are RESTRICT, and the outer describe's cleanup() only
      // runs after this inner afterEach.
      await prismaClient.pCActivityDefaultMentor.deleteMany({
        where: { activity: { name: { startsWith: "TEST_MASTER_PC_" } } },
      });
      await prismaClient.passionConnectionActivity.deleteMany({
        where: { activity: { name: { startsWith: "TEST_MASTER_PC_" } } },
      });
      await prismaClient.masterPCActivity.deleteMany({
        where: { name: { startsWith: "TEST_MASTER_PC_" } },
      });
    });

    function uniqueName() {
      return `TEST_MASTER_PC_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    it("should create a PC activity as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const name = uniqueName();

      const response = await TestRequest.post(
        "/api/admin/pc-activities-master",
        { name },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.name).toBe(name);
    });

    it("should reject (400) a duplicate name", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const name = uniqueName();
      await prismaClient.masterPCActivity.create({ data: { name } });

      const response = await TestRequest.post(
        "/api/admin/pc-activities-master",
        { name },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (403) create for DATABASE_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();

      const response = await TestRequest.post(
        "/api/admin/pc-activities-master",
        { name: uniqueName() },
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should reject (400) deleting a PC activity still referenced by PC activity records", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const created = await prismaClient.masterPCActivity.create({
        data: { name: uniqueName() },
      });
      await PCActivityTest.create({ studentId, activity: created.name });

      const response = await TestRequest.delete(
        `/api/admin/pc-activities-master/${created.id}`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
      expect(body.errors).toContain("still referenced");
    });

    it("should delete an unreferenced PC activity as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const created = await prismaClient.masterPCActivity.create({
        data: { name: uniqueName() },
      });

      const response = await TestRequest.delete(
        `/api/admin/pc-activities-master/${created.id}`,
        accessToken,
      );

      expect(response.status).toBe(200);

      const remaining = await prismaClient.masterPCActivity.findUnique({
        where: { id: created.id },
      });
      expect(remaining).toBeNull();
    });
  });

  describe("PC Activity Default Mentor (/api/admin/pc-activities-master/:activityId/default-mentors)", () => {
    let activityId: string;
    let unitId: string;

    beforeEach(async () => {
      const activity = await prismaClient.masterPCActivity.create({
        data: { name: `TEST_MASTER_PC_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` },
      });
      activityId = activity.id;
      const unit = await prismaClient.masterUnit.findFirstOrThrow({
        where: { name: "TEST_UNIT_SHIELD" },
      });
      unitId = unit.id;
    });

    afterEach(async () => {
      await prismaClient.pCActivityDefaultMentor.deleteMany({
        where: { activity: { name: { startsWith: "TEST_MASTER_PC_" } } },
      });
      await prismaClient.masterPCActivity.deleteMany({
        where: { name: { startsWith: "TEST_MASTER_PC_" } },
      });
    });

    it("should set a default mentor for a unit as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const mentor = await createTeachingEmployee(
        "test_pc_default_mentor_set_1@millennia21.id",
      );

      const response = await TestRequest.patch(
        `/api/admin/pc-activities-master/${activityId}/default-mentors/${unitId}`,
        { mentor_id: mentor.id },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.mentor_id).toBe(mentor.id);
      expect(body.data.unit_id).toBe(unitId);
      expect(body.data.activity_id).toBe(activityId);
    });

    it("should accept a FREELANCE teacher as a default mentor", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const freelanceTeacher = await createTeachingEmployee(
        "test_pc_default_mentor_freelance@millennia21.id",
        EmploymentType.FREELANCE,
      );

      const response = await TestRequest.patch(
        `/api/admin/pc-activities-master/${activityId}/default-mentors/${unitId}`,
        { mentor_id: freelanceTeacher.id },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.mentor_id).toBe(freelanceTeacher.id);
    });

    it("should replace an existing default mentor for the same unit (upsert)", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const firstMentor = await createTeachingEmployee(
        "test_pc_default_mentor_set_2@millennia21.id",
      );
      const secondMentor = await createTeachingEmployee(
        "test_pc_default_mentor_set_3@millennia21.id",
      );
      await prismaClient.pCActivityDefaultMentor.create({
        data: { activity_id: activityId, unit_id: unitId, mentor_id: firstMentor.id },
      });

      const response = await TestRequest.patch(
        `/api/admin/pc-activities-master/${activityId}/default-mentors/${unitId}`,
        { mentor_id: secondMentor.id },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.mentor_id).toBe(secondMentor.id);

      const rows = await prismaClient.pCActivityDefaultMentor.findMany({
        where: { activity_id: activityId, unit_id: unitId },
      });
      expect(rows.length).toBe(1);
    });

    it("should reject (400) a mentor who doesn't hold a teaching-eligible job level", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const staff = await createNonTeachingEmployee(
        "test_pc_default_mentor_staff_1@millennia21.id",
      );

      const response = await TestRequest.patch(
        `/api/admin/pc-activities-master/${activityId}/default-mentors/${unitId}`,
        { mentor_id: staff.id },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) an unknown unit", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const mentor = await createTeachingEmployee(
        "test_pc_default_mentor_set_4@millennia21.id",
      );

      const response = await TestRequest.patch(
        `/api/admin/pc-activities-master/${activityId}/default-mentors/nonexistent-unit`,
        { mentor_id: mentor.id },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (403) set for DATABASE_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const mentor = await createTeachingEmployee(
        "test_pc_default_mentor_set_5@millennia21.id",
      );

      const response = await TestRequest.patch(
        `/api/admin/pc-activities-master/${activityId}/default-mentors/${unitId}`,
        { mentor_id: mentor.id },
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should list default mentors for an activity across units", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const mentor = await createTeachingEmployee(
        "test_pc_default_mentor_list_1@millennia21.id",
      );
      await prismaClient.pCActivityDefaultMentor.create({
        data: { activity_id: activityId, unit_id: unitId, mentor_id: mentor.id },
      });

      const response = await TestRequest.get(
        `/api/admin/pc-activities-master/${activityId}/default-mentors`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].mentor_id).toBe(mentor.id);
      expect(body.data[0].unit_name).toBe("TEST_UNIT_SHIELD");
      expect(body.data[0].mentor_name).toBeTruthy();
    });

    it("should clear a default mentor as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const mentor = await createTeachingEmployee(
        "test_pc_default_mentor_clear_1@millennia21.id",
      );
      await prismaClient.pCActivityDefaultMentor.create({
        data: { activity_id: activityId, unit_id: unitId, mentor_id: mentor.id },
      });

      const response = await TestRequest.delete(
        `/api/admin/pc-activities-master/${activityId}/default-mentors/${unitId}`,
        accessToken,
      );

      expect(response.status).toBe(200);

      const remaining = await prismaClient.pCActivityDefaultMentor.findUnique({
        where: { activity_id_unit_id: { activity_id: activityId, unit_id: unitId } },
      });
      expect(remaining).toBeNull();
    });

    it("should reject (404) clearing a default mentor that isn't set", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.delete(
        `/api/admin/pc-activities-master/${activityId}/default-mentors/${unitId}`,
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (403) clear for DATABASE_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const mentor = await createTeachingEmployee(
        "test_pc_default_mentor_clear_2@millennia21.id",
      );
      await prismaClient.pCActivityDefaultMentor.create({
        data: { activity_id: activityId, unit_id: unitId, mentor_id: mentor.id },
      });

      const response = await TestRequest.delete(
        `/api/admin/pc-activities-master/${activityId}/default-mentors/${unitId}`,
        accessToken,
      );

      expect(response.status).toBe(403);
    });
  });
});
