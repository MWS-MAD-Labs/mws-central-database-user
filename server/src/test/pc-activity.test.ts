import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  StudentTest,
  PCActivityTest,
  EmployeeTest,
  InternTest,
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
    // Rooms cascade to their scope rows and mentor assignments - must run
    // before Employee/Intern deletion (both mentor FKs are RESTRICT).
    await prismaClient.pcActivityRoom.deleteMany({
      where: { units: { some: { unit: { name: { startsWith: "TEST_" } } } } },
    });
    await EmployeeTest.delete();
    await InternTest.delete();
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

    it("keeps legacy student PC Activity writes closed", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const activity = await PCActivityTest.create({ studentId });
      const responses = await Promise.all([
        TestRequest.post(
          `/api/admin/students/${studentId}/pc-activities`,
          { day: "MONDAY", activity_id: basketballId },
          accessToken,
        ),
        TestRequest.patch(
          `/api/admin/students/${studentId}/pc-activities/${activity.id}`,
          { activity_id: codingClubId },
          accessToken,
        ),
        TestRequest.patch(
          `/api/admin/students/${studentId}/pc-activities/delete/${activity.id}`,
          {},
          accessToken,
        ),
        TestRequest.patch(
          `/api/admin/students/${studentId}/pc-activities/restore/${activity.id}`,
          {},
          accessToken,
        ),
      ]);

      expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404]);
    });
  });

  describe.skip("legacy student PC Activity write endpoints are removed", () => {
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

  describe.skip("legacy student PC Activity delete endpoint is removed", () => {
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

  describe.skip("legacy student PC Activity restore endpoint is removed", () => {
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

      // Restoring history conflicts with the active replacement slot.
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
      expect(body.errors).toContain("already has an active PC activity on this day");
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
      // Delete restricted mentor rows before master activities.
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

  describe.skip("legacy student PC Activity write scope is internal-only", () => {
    afterEach(async () => {
      await prismaClient.passionConnectionActivity.deleteMany({
        where: { activity: { name: { startsWith: "TEST_MASTER_PC_SCOPE_" } } },
      });
      await prismaClient.masterPCActivity.deleteMany({
        where: { name: { startsWith: "TEST_MASTER_PC_SCOPE_" } },
      });
    });

    it("should reject (400) assigning a student to an activity restricted to a different unit", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const otherUnit = await prismaClient.masterUnit.create({
        data: { name: `TEST_MASTER_PC_SCOPE_OTHER_${Date.now()}` },
      });
      const restricted = await prismaClient.masterPCActivity.create({
        data: {
          name: `TEST_MASTER_PC_SCOPE_${Date.now()}`,
          units: { create: { unit_id: otherUnit.id } },
        },
      });

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity_id: restricted.id },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
      expect(body.errors).toContain("only available to");
      await prismaClient.masterUnit.delete({ where: { id: otherUnit.id } });
    });

    it("should allow assigning a student to an activity restricted to include their own unit", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const shieldUnit = await prismaClient.masterUnit.findFirstOrThrow({
        where: { name: "TEST_UNIT_SHIELD" },
      });
      const restricted = await prismaClient.masterPCActivity.create({
        data: {
          name: `TEST_MASTER_PC_SCOPE_${Date.now()}`,
          units: { create: { unit_id: shieldUnit.id } },
        },
      });

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity_id: restricted.id },
        accessToken,
      );

      expect(response.status).toBe(200);
    });

    it("should allow assigning a student to an unrestricted activity regardless of unit", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const unrestricted = await prismaClient.masterPCActivity.create({
        data: { name: `TEST_MASTER_PC_SCOPE_${Date.now()}` },
      });

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/pc-activities`,
        { day: "MONDAY", activity_id: unrestricted.id },
        accessToken,
      );

      expect(response.status).toBe(200);
    });
  });

  describe("GET /api/admin/employees/:id/pc-activity-mentorships", () => {
    afterEach(async () => {
      // Rooms referencing these grades must go first (grade FK is Restrict),
      // and this describe's afterEach runs before the outer cleanup()'s own
      // room deletion.
      await prismaClient.pcActivityRoom.deleteMany({
        where: { grades: { some: { grade: { name: { startsWith: "TEST_PC_MENTORSHIP_GRADE_" } } } } },
      });
      await prismaClient.grade.deleteMany({
        where: { name: { startsWith: "TEST_PC_MENTORSHIP_GRADE_" } },
      });
    });

    it("lists actual room mentorships with room, schedule, and dates", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const unit = await prismaClient.masterUnit.findFirstOrThrow({
        where: { name: "TEST_UNIT_SHIELD" },
      });
      const grade = await prismaClient.grade.create({
        data: { name: `TEST_PC_MENTORSHIP_GRADE_${Date.now()}`, level: -9989, unit_id: unit.id },
      });
      const mentor = await createTeachingEmployee(
        "test_pc_mentorships_1@millennia21.id",
      );
      await prismaClient.employee.update({
        where: { id: mentor.id },
        data: { is_pc_mentor_eligible: true },
      });
      const roomResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: basketballId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unit.id],
          grade_ids: [grade.id],
        },
        accessToken,
      );
      const roomId = (await roomResponse.json()).data.id;
      await TestRequest.post(
        `/api/admin/pc-activity-rooms/${roomId}/mentors`,
        { employee_id: mentor.id },
        accessToken,
      );

      const response = await TestRequest.get(
        `/api/admin/employees/${mentor.id}/pc-activity-mentorships`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].room_id).toBe(roomId);
      expect(body.data[0].room_name).toBe("Basketball");
      expect(body.data[0].activity_name).toBe("Basketball");
      expect(body.data[0].day).toBe("MONDAY");
      expect(body.data[0].academic_year_name).toBeTruthy();
      expect(body.data[0].start_date).toBeTruthy();
      expect(body.data[0].end_date).toBeNull();
    });

    it("lists one row per room when a mentor covers several rooms", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const unit = await prismaClient.masterUnit.findFirstOrThrow({
        where: { name: "TEST_UNIT_SHIELD" },
      });
      const grade = await prismaClient.grade.create({
        data: { name: `TEST_PC_MENTORSHIP_GRADE_${Date.now()}`, level: -9988, unit_id: unit.id },
      });
      const mentor = await createTeachingEmployee(
        "test_pc_mentorships_multi_room@millennia21.id",
      );
      await prismaClient.employee.update({
        where: { id: mentor.id },
        data: { is_pc_mentor_eligible: true },
      });

      for (const day of ["MONDAY", "TUESDAY"]) {
        const roomResponse = await TestRequest.post(
          "/api/admin/pc-activity-rooms",
          {
            activity_id: basketballId,
            day,
            duration_type: "SEMESTER",
            unit_ids: [unit.id],
            grade_ids: [grade.id],
          },
          accessToken,
        );
        const roomId = (await roomResponse.json()).data.id;
        await TestRequest.post(
          `/api/admin/pc-activity-rooms/${roomId}/mentors`,
          { employee_id: mentor.id },
          accessToken,
        );
      }

      const response = await TestRequest.get(
        `/api/admin/employees/${mentor.id}/pc-activity-mentorships`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(2);
      expect(
        body.data.map((row: { day: string }) => row.day).sort(),
      ).toEqual(["MONDAY", "TUESDAY"]);
    });

    it("follows the employee view scope, and never 403s the support caseload without student access", async () => {
      const employee = await createTeachingEmployee("test_pc_mentorships_scope@millennia21.id");
      const otherUnit = await prismaClient.masterUnit.create({
        data: { name: `TEST_PC_MENTORSHIP_OTHER_${Date.now()}` },
      });
      const homeOnly = await AdminUserTest.createDatabaseAdmin(otherUnit.id, {
        id: "test-mentorship-home-only",
        email: "test_mentorship_home_only@millennia21.id",
      });
      const allEmployeeUnits = await AdminUserTest.createDatabaseAdmin(otherUnit.id, {
        id: "test-mentorship-all-employee-units",
        email: "test_mentorship_all_employee_units@millennia21.id",
        canViewAllEmployeeUnits: true,
        canViewStudentData: false,
      });

      // Own unit only: the employee of another unit stays out of reach.
      const hidden = await TestRequest.get(`/api/admin/employees/${employee.id}/pc-activity-mentorships`, homeOnly.accessToken);
      expect(hidden.status).toBe(404);

      // All employee units: reachable, and the caseload is empty rather than a 403.
      const mentorships = await TestRequest.get(`/api/admin/employees/${employee.id}/pc-activity-mentorships`, allEmployeeUnits.accessToken);
      expect(mentorships.status).toBe(200);
      const caseload = await TestRequest.get(`/api/admin/employees/${employee.id}/support-assignments`, allEmployeeUnits.accessToken);
      expect(caseload.status).toBe(200);
      expect((await caseload.json()).data).toEqual([]);
    });

    it("should return an empty list for an employee who mentors nothing", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const employee = await createTeachingEmployee(
        "test_pc_mentorships_2@millennia21.id",
      );

      const response = await TestRequest.get(
        `/api/admin/employees/${employee.id}/pc-activity-mentorships`,
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual([]);
    });
  });
});
