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
  EnrollmentTest,
} from "./test-utils";
import { AuditAction } from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";
import { PCActivityRoomService } from "../service/pc-activity-room-service";

async function createEligibleMentorEmployee(email: string, unitId: string) {
  const position = await prismaClient.masterJobPosition.findFirstOrThrow({
    where: { name: { startsWith: "TEST_" } },
  });
  const building = await prismaClient.masterBuilding.findFirstOrThrow({
    where: { name: { startsWith: "TEST_" } },
  });
  const level = await prismaClient.masterJobLevel.create({
    data: {
      name: `TEST_LVL_ROOM_MENTOR_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    },
  });
  const person = await EmployeeTest.create({
    email,
    unitId,
    jobPositionId: position.id,
    jobLevelId: level.id,
    buildingId: building.id,
  });
  await prismaClient.employee.update({
    where: { id: person.employee!.id },
    data: { is_pc_mentor_eligible: true },
  });
  return prismaClient.employee.findUniqueOrThrow({
    where: { id: person.employee!.id },
    include: { person: true },
  });
}

async function createEligibleMentorIntern(email: string, unitId: string) {
  const building = await prismaClient.masterBuilding.findFirstOrThrow({
    where: { name: { startsWith: "TEST_" } },
  });
  const position = await prismaClient.masterJobPosition.create({
    data: {
      name: `TEST_ROOM_MENTOR_INTERN_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    },
  });
  const intern = await InternTest.create({
    email,
    unitId,
    jobPositionId: position.id,
    buildingId: building.id,
  });
  return prismaClient.intern.update({
    where: { id: intern.id },
    data: { end_date: new Date("2027-06-30"), is_pc_mentor_eligible: true },
  });
}

async function resolveNextAcademicYear(currentYear: { end_date: Date | null; start_date: Date }) {
  const existing = await prismaClient.academicYear.findFirst({
    where: { start_date: { gt: currentYear.start_date } },
    orderBy: { start_date: "asc" },
  });
  if (existing) return existing;
  return prismaClient.academicYear.create({
    data: {
      name: `TEST_ROOM_NEXT_YEAR_${Date.now()}`,
      start_date: new Date(currentYear.end_date!.getTime() + 24 * 60 * 60 * 1000),
      end_date: new Date(currentYear.end_date!.getTime() + 366 * 24 * 60 * 60 * 1000),
      status: "UPCOMING",
    },
  });
}

describe("PC Activity Rooms", () => {
  let unitId: string;
  let gradeId: string;
  let activityId: string;
  let studentId: string;
  let academicYearId: string;
  let classId: string;

  async function cleanup() {
    await AuditLogTest.delete();
    await PCActivityTest.delete();
    // Deleting rooms cascades to their unit/grade scope rows and mentor
    // assignments - must run before Employee/Intern deletion, both FKs on
    // PcActivityRoomMentorAssignment are RESTRICT, not cascade.
    await prismaClient.pcActivityRoom.deleteMany({
      where: { units: { some: { unit: { name: { startsWith: "TEST_" } } } } },
    });
    await EmployeeTest.delete();
    await InternTest.delete();
    await EnrollmentTest.delete();
    // StudentTest.delete() removes TEST_STUDENT_GRADE, which test classes
    // reference - classes and their enrollments must go first.
    await prismaClient.studentClassEnrollment.deleteMany({
      where: { class: { name: { startsWith: "TEST_" } } },
    });
    await prismaClient.studentClassEnrollment.deleteMany({
      where: { academic_year: { name: { startsWith: "TEST_ROOM_NEXT_YEAR_" } } },
    });
    await prismaClient.class.deleteMany({
      where: { grade: { name: { startsWith: "TEST_" } } },
    });
    await prismaClient.class.deleteMany({
      where: { name: { startsWith: "TEST_" } },
    });
    await prismaClient.academicYear.deleteMany({
      where: { name: { startsWith: "TEST_ROOM_NEXT_YEAR_" } },
    });
    await StudentTest.delete();
    // Grade.level is globally unique - delete these outright instead of
    // relying on MasterDataTest.delete()'s reassign-to-unknownLegacy
    // behavior, which would leave the level occupied for the next run.
    await prismaClient.grade.deleteMany({
      where: { name: { startsWith: "TEST_ROOM_" } },
    });
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }

  beforeEach(async () => {
    await cleanup();
    await MasterDataTest.create();

    const student = await StudentTest.create({
      email: "test_pc_room_student@millennia21.id",
      nis: "9500002",
    });
    studentId = student.student!.id;
    await prismaClient.student.update({
      where: { id: studentId },
      data: { status: "ACTIVE" },
    });
    const grade = await prismaClient.grade.findFirstOrThrow({
      where: { name: "TEST_STUDENT_GRADE" },
    });
    gradeId = grade.id;
    unitId = grade.unit_id;
    const academicYear = await prismaClient.academicYear.findFirstOrThrow({
      where: { status: "ACTIVE" },
    });
    academicYearId = academicYear.id;
    const klass = await prismaClient.class.create({
      data: {
        name: "TEST_PC_ROOM_CLASS",
        grade_id: gradeId,
        academic_year_id: academicYearId,
        status: "ACTIVE",
      },
    });
    classId = klass.id;
    await EnrollmentTest.create({
      studentId,
      classId: klass.id,
      academicYearId,
      gradeId,
      gradeLevel: grade.name,
    });

    activityId = await PCActivityTest.resolveActivityId("Basketball");
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("POST /api/admin/pc-activity-rooms", () => {
    it("should create a room with units and grades as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.activity_name).toBe("Basketball");
      expect(body.data.day).toBe("MONDAY");
      expect(body.data.duration_type).toBe("SEMESTER");
      expect(body.data.units.map((u: { id: string }) => u.id)).toEqual([unitId]);
      expect(body.data.grades.map((g: { id: string }) => g.id)).toEqual([gradeId]);
      expect(body.data.mentors).toEqual([]);
      expect(body.data.student_count).toBe(0);
    });

    it("should reject (400) with no units selected", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [],
        },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject an explicitly empty class selection", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          academic_year_id: academicYearId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
          class_ids: [],
        },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.errors).toContain("at least one class");
    });

    it("should reject (400) a grade that doesn't belong to the selected units", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const otherUnit = await prismaClient.masterUnit.create({
        data: { name: `TEST_ROOM_OTHER_UNIT_${Date.now()}` },
      });
      const otherGrade = await prismaClient.grade.create({
        data: { name: `TEST_ROOM_OTHER_GRADE_${Date.now()}`, level: -9998, unit_id: otherUnit.id },
      });

      const response = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [otherGrade.id],
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
      expect(body.errors).toContain("does not belong to one of this room's units");
    });

    it("should allow room scope independent of legacy activity unit scope", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const otherUnit = await prismaClient.masterUnit.create({
        data: { name: `TEST_ROOM_SCOPE_OTHER_${Date.now()}` },
      });
      const restricted = await prismaClient.masterPCActivity.create({
        data: {
          name: `TEST_MASTER_PC_ROOM_SCOPE_${Date.now()}`,
          units: { create: { unit_id: otherUnit.id } },
        },
      });

      const response = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: restricted.id,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.units[0].id).toBe(unitId);
      await prismaClient.pcActivityRoom.delete({ where: { id: body.data.id } });
      await prismaClient.masterPCActivity.delete({ where: { id: restricted.id } });
    });

    it("should allow a DATABASE_ADMIN to create a room within their own unit", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin(unitId, {
        canWriteStudentData: true,
      });

      const response = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );

      expect(response.status).toBe(200);
    });

    it("should reject a DATABASE_ADMIN selecting more than their own single unit", async () => {
      const otherUnit = await prismaClient.masterUnit.create({ data: { name: `TEST_ROOM_DB_MULTI_${Date.now()}` } });
      await prismaClient.grade.create({
        data: { name: `TEST_ROOM_DB_MULTI_GRADE_${Date.now()}`, level: -9993, unit_id: otherUnit.id },
      });
      const { accessToken } = await AdminUserTest.createDatabaseAdmin(unitId, { canWriteStudentData: true });
      const response = await TestRequest.post("/api/admin/pc-activity-rooms", {
        activity_id: activityId,
        academic_year_id: academicYearId,
        day: "MONDAY",
        duration_type: "SEMESTER",
        unit_ids: [unitId, otherUnit.id],
          grade_ids: [gradeId],
      }, accessToken);
      expect(response.status).toBe(403);
    });

    it("uses class scope when listing and assigning eligible students", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const otherClass = await prismaClient.class.create({
        data: { name: `TEST_PC_ROOM_OTHER_CLASS_${Date.now()}`, grade_id: gradeId, academic_year_id: academicYearId },
      });
      const otherStudent = await StudentTest.create({
        email: "test_pc_room_other_class@millennia21.id",
        nis: "9500004",
      });
      await prismaClient.student.update({ where: { id: otherStudent.student!.id }, data: { status: "ACTIVE" } });
      await EnrollmentTest.create({
        studentId: otherStudent.student!.id,
        classId: otherClass.id,
        academicYearId,
        gradeId,
        gradeLevel: "TEST_STUDENT_GRADE",
      });
      const create = await TestRequest.post("/api/admin/pc-activity-rooms", {
        activity_id: activityId,
        academic_year_id: academicYearId,
        day: "MONDAY",
        duration_type: "SEMESTER",
        unit_ids: [unitId],
          grade_ids: [gradeId],
        class_ids: [classId],
      }, accessToken);
      const room = (await create.json()).data;
      expect(room.classes).toEqual([{ id: classId, name: "TEST_PC_ROOM_CLASS" }]);
      const eligible = await TestRequest.get(`/api/admin/pc-activity-rooms/${room.id}/eligible-students`, accessToken);
      const rows = (await eligible.json()).data;
      expect(rows.map((row: { student_id: string }) => row.student_id)).toEqual([studentId]);
      const bulk = await TestRequest.post(`/api/admin/pc-activity-rooms/${room.id}/students/bulk`, {
        student_ids: [otherStudent.student!.id],
      }, accessToken);
      expect((await bulk.json()).data.failed_count).toBe(1);
    });

    it("should reject (403) a DATABASE_ADMIN creating a room outside their own unit", async () => {
      const otherUnit = await prismaClient.masterUnit.create({
        data: { name: `TEST_ROOM_DBADMIN_OTHER_${Date.now()}` },
      });
      const { accessToken } = await AdminUserTest.createDatabaseAdmin(otherUnit.id, {
        canWriteStudentData: true,
      });

      const response = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );

      expect(response.status).toBe(403);
    });
  });

  describe("PATCH /api/admin/pc-activity-rooms/:id", () => {
    it("should reject (400) narrowing scope when it would orphan an active student assignment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const otherUnit = await prismaClient.masterUnit.create({
        data: { name: `TEST_ROOM_NARROW_OTHER_${Date.now()}` },
      });
      // Rooms are limited to academic units - give the extra unit a grade.
      const otherGrade = await prismaClient.grade.create({
        data: {
          name: `TEST_ROOM_NARROW_OTHER_GRADE_${Date.now()}`,
          level: -9995,
          unit_id: otherUnit.id,
        },
      });
      const createResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId, otherUnit.id],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const roomId = (await createResponse.json()).data.id;
      await TestRequest.post(
        `/api/admin/pc-activity-rooms/${roomId}/students/bulk`,
        { student_ids: [studentId] },
        accessToken,
      );

      // Narrowing both unit and grade scope to the other unit orphans the
      // existing assignment (student's own grade is in `unitId`, not here).
      const response = await TestRequest.patch(
        `/api/admin/pc-activity-rooms/${roomId}`,
        { unit_ids: [otherUnit.id], grade_ids: [otherGrade.id] },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
      expect(body.errors).toContain("active student assignment");
    });

    it("should allow widening the unit scope", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const otherUnit = await prismaClient.masterUnit.create({
        data: { name: `TEST_ROOM_WIDEN_OTHER_${Date.now()}` },
      });
      await prismaClient.grade.create({
        data: {
          name: `TEST_ROOM_WIDEN_OTHER_GRADE_${Date.now()}`,
          level: -9994,
          unit_id: otherUnit.id,
        },
      });
      const createResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const roomId = (await createResponse.json()).data.id;

      const response = await TestRequest.patch(
        `/api/admin/pc-activity-rooms/${roomId}`,
        { unit_ids: [unitId, otherUnit.id] },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.units.length).toBe(2);
    });

    it("rejects class scope changes that exclude an active student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const otherClass = await prismaClient.class.create({
        data: { name: `TEST_PC_ROOM_SCOPE_CLASS_${Date.now()}`, grade_id: gradeId, academic_year_id: academicYearId },
      });
      const create = await TestRequest.post("/api/admin/pc-activity-rooms", {
        activity_id: activityId, academic_year_id: academicYearId, day: "MONDAY",
        duration_type: "SEMESTER", unit_ids: [unitId],
          grade_ids: [gradeId],
      }, accessToken);
      const roomId = (await create.json()).data.id;
      await TestRequest.post(`/api/admin/pc-activity-rooms/${roomId}/students/bulk`, { student_ids: [studentId] }, accessToken);
      const response = await TestRequest.patch(`/api/admin/pc-activity-rooms/${roomId}`, { class_ids: [otherClass.id] }, accessToken);
      expect(response.status).toBe(400);
    });

    it("requires a mentor to be eligible for every room unit", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const otherUnit = await prismaClient.masterUnit.create({ data: { name: `TEST_ROOM_MENTOR_SCOPE_${Date.now()}` } });
      await prismaClient.grade.create({
        data: { name: `TEST_ROOM_MENTOR_SCOPE_GRADE_${Date.now()}`, level: -9992, unit_id: otherUnit.id },
      });
      const create = await TestRequest.post("/api/admin/pc-activity-rooms", {
        activity_id: activityId, academic_year_id: academicYearId, day: "MONDAY",
        duration_type: "SEMESTER", unit_ids: [unitId, otherUnit.id],
          grade_ids: [gradeId],
      }, accessToken);
      const roomId = (await create.json()).data.id;
      const employee = await createEligibleMentorEmployee("test_pc_room_scope_mentor@millennia21.id", unitId);
      const response = await TestRequest.post(`/api/admin/pc-activity-rooms/${roomId}/mentors`, { employee_id: employee.id }, accessToken);
      expect(response.status).toBe(400);
      expect((await response.json()).errors).toContain("every target room unit");
    });
  });

  describe("DELETE /api/admin/pc-activity-rooms/:id", () => {
    it("should reject (400) deleting a room with students still assigned", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const createResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const roomId = (await createResponse.json()).data.id;
      await TestRequest.post(
        `/api/admin/pc-activity-rooms/${roomId}/students/bulk`,
        { student_ids: [studentId] },
        accessToken,
      );

      const response = await TestRequest.delete(
        `/api/admin/pc-activity-rooms/${roomId}`,
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should delete an empty room as SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const createResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const roomId = (await createResponse.json()).data.id;

      const response = await TestRequest.delete(
        `/api/admin/pc-activity-rooms/${roomId}`,
        accessToken,
      );

      expect(response.status).toBe(200);
      const room = await prismaClient.pcActivityRoom.findUniqueOrThrow({
        where: { id: roomId },
      });
      expect(room.deleted_at).not.toBeNull();
    });
  });

  describe("Mentors", () => {
    it("should allow multiple concurrent mentors, including an intern", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const createResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const roomId = (await createResponse.json()).data.id;
      const employee = await createEligibleMentorEmployee(
        "test_pc_room_mentor_employee@millennia21.id",
        unitId,
      );
      const intern = await createEligibleMentorIntern(
        "test_intern_pc_room_mentor@millennia21.id",
        unitId,
      );

      const first = await TestRequest.post(
        `/api/admin/pc-activity-rooms/${roomId}/mentors`,
        { employee_id: employee.id },
        accessToken,
      );
      const second = await TestRequest.post(
        `/api/admin/pc-activity-rooms/${roomId}/mentors`,
        { intern_id: intern.id },
        accessToken,
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const list = await TestRequest.get(
        `/api/admin/pc-activity-rooms/${roomId}/mentors`,
        accessToken,
      );
      const listBody = await list.json();
      expect(listBody.data.length).toBe(2);
      expect(
        listBody.data.map((m: { mentor_type: string }) => m.mentor_type).sort(),
      ).toEqual(["EMPLOYEE", "INTERN"]);
      expect(listBody.paging.total_item).toBe(2);
    });

    it("globally sorts and pages eligible employees and interns while excluding conflicts", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const roomResponse = await TestRequest.post("/api/admin/pc-activity-rooms", {
        activity_id: activityId,
        day: "MONDAY",
        duration_type: "SEMESTER",
        unit_ids: [unitId],
        grade_ids: [gradeId],
      }, accessToken);
      const roomId = (await roomResponse.json()).data.id;
      const employee = await createEligibleMentorEmployee("test_pc_room_eligible_zulu@millennia21.id", unitId);
      const intern = await createEligibleMentorIntern("test_pc_room_eligible_alpha@millennia21.id", unitId);

      const firstPage = await TestRequest.get(
        `/api/admin/pc-activity-rooms/${roomId}/eligible-mentors?page=1&size=1&sort_by=name&sort_order=asc`,
        accessToken,
      );
      const firstBody = await firstPage.json();
      expect(firstPage.status).toBe(200);
      expect(firstBody.paging.total_item).toBeGreaterThanOrEqual(2);
      expect(firstBody.data).toHaveLength(1);

      await TestRequest.post(`/api/admin/pc-activity-rooms/${roomId}/mentors`, { employee_id: employee.id }, accessToken);
      const filtered = await TestRequest.get(
        `/api/admin/pc-activity-rooms/${roomId}/eligible-mentors?search=${encodeURIComponent(employee.person?.full_name ?? "")}`,
        accessToken,
      );
      expect((await filtered.json()).paging.total_item).toBe(0);

      const internSearch = await TestRequest.get(
        `/api/admin/pc-activity-rooms/${roomId}/eligible-mentors?search=${encodeURIComponent(intern.full_name)}`,
        accessToken,
      );
      expect((await internSearch.json()).data[0].type).toBe("INTERN");
    });

    it("defaults mentor start_date to room start and supports audited start-date changes", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const roomResponse = await TestRequest.post("/api/admin/pc-activity-rooms", {
        activity_id: activityId,
        day: "MONDAY",
        duration_type: "SEMESTER",
        unit_ids: [unitId],
        grade_ids: [gradeId],
      }, accessToken);
      const room = (await roomResponse.json()).data;
      const employee = await createEligibleMentorEmployee("test_pc_room_mentor_dates@millennia21.id", unitId);
      const assign = await TestRequest.post(`/api/admin/pc-activity-rooms/${room.id}/mentors`, {
        employee_id: employee.id,
      }, accessToken);
      const assignment = (await assign.json()).data;
      expect(assignment.start_date).toBe(room.start_date);

      const nextStart = new Date(new Date(room.start_date).getTime() + 24 * 60 * 60 * 1000).toISOString();
      const patch = await TestRequest.patch(
        `/api/admin/pc-activity-rooms/${room.id}/mentors/${assignment.id}/start-date`,
        { start_date: nextStart },
        accessToken,
      );
      expect(patch.status).toBe(200);
      expect((await patch.json()).data.start_date).toBe(nextStart);
      expect(await prismaClient.auditLog.count({
        where: { action: AuditAction.UPDATE_PC_ACTIVITY_ROOM_MENTOR_START_DATE },
      })).toBe(1);

      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const rejected = await TestRequest.patch(
        `/api/admin/pc-activity-rooms/${room.id}/mentors/${assignment.id}/start-date`,
        { start_date: future },
        accessToken,
      );
      expect(rejected.status).toBe(400);
    });

    it("should reject a 4th mentor once the room already has 3", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const createResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const roomId = (await createResponse.json()).data.id;
      const mentors = [];
      for (const n of [1, 2, 3, 4]) {
        mentors.push(
          await createEligibleMentorEmployee(`test_pc_room_mentor_cap_${n}@millennia21.id`, unitId),
        );
      }
      for (const mentor of mentors.slice(0, 3)) {
        const response = await TestRequest.post(
          `/api/admin/pc-activity-rooms/${roomId}/mentors`,
          { employee_id: mentor.id },
          accessToken,
        );
        expect(response.status).toBe(200);
      }

      const rejected = await TestRequest.post(
        `/api/admin/pc-activity-rooms/${roomId}/mentors`,
        { employee_id: mentors[3].id },
        accessToken,
      );
      const rejectedBody = await rejected.json();

      expect(rejected.status).toBe(400);
      expect(rejectedBody.errors).toContain("maximum of 3 mentors");
    });

    it("should reject a 4th room assignment for the same mentor in one academic year", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const mentor = await createEligibleMentorEmployee(
        "test_pc_room_mentor_year_cap@millennia21.id",
        unitId,
      );
      const roomIds: string[] = [];
      for (const day of ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY"] as const) {
        const response = await TestRequest.post(
          "/api/admin/pc-activity-rooms",
          {
            activity_id: activityId,
            academic_year_id: academicYearId,
            day,
            duration_type: "SEMESTER",
            unit_ids: [unitId],
            grade_ids: [gradeId],
            label: day,
          },
          accessToken,
        );
        roomIds.push((await response.json()).data.id);
      }

      for (const roomId of roomIds.slice(0, 3)) {
        const response = await TestRequest.post(
          `/api/admin/pc-activity-rooms/${roomId}/mentors`,
          { employee_id: mentor.id },
          accessToken,
        );
        expect(response.status).toBe(200);
      }

      const rejected = await TestRequest.post(
        `/api/admin/pc-activity-rooms/${roomIds[3]}/mentors`,
        { employee_id: mentor.id },
        accessToken,
      );
      const rejectedBody = await rejected.json();

      expect(rejected.status).toBe(400);
      expect(rejectedBody.errors).toContain(
        "maximum of 3 room assignments in this academic year",
      );
    });

    it("bulk-assigns multiple mentors, reporting per-target success/failure", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const createResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const roomId = (await createResponse.json()).data.id;
      const employee = await createEligibleMentorEmployee(
        "test_pc_room_bulk_mentor_employee@millennia21.id",
        unitId,
      );
      const intern = await createEligibleMentorIntern(
        "test_intern_pc_room_bulk_mentor@millennia21.id",
        unitId,
      );

      const response = await TestRequest.post(
        `/api/admin/pc-activity-rooms/${roomId}/mentors/bulk`,
        {
          targets: [
            { employee_id: employee.id },
            { intern_id: intern.id },
            { employee_id: "nonexistent_employee_id" },
          ],
        },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.success_count).toBe(2);
      expect(body.data.failed_count).toBe(1);

      const list = await TestRequest.get(
        `/api/admin/pc-activity-rooms/${roomId}/mentors`,
        accessToken,
      );
      const listBody = await list.json();
      expect(listBody.data.length).toBe(2);
    });

    it("should reject (400) a mentor who isn't PC-mentor eligible", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const createResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const roomId = (await createResponse.json()).data.id;
      const position = await prismaClient.masterJobPosition.findFirstOrThrow({
        where: { name: { startsWith: "TEST_" } },
      });
      const building = await prismaClient.masterBuilding.findFirstOrThrow({
        where: { name: { startsWith: "TEST_" } },
      });
      const ineligibleLevel = await prismaClient.masterJobLevel.create({
        data: {
          name: `TEST_LVL_ROOM_INELIGIBLE_${Date.now()}`,
          is_teaching_role: true,
        },
      });
      const person = await EmployeeTest.create({
        email: "test_pc_room_mentor_ineligible@millennia21.id",
        unitId,
        jobPositionId: position.id,
        jobLevelId: ineligibleLevel.id,
        buildingId: building.id,
      });

      const response = await TestRequest.post(
        `/api/admin/pc-activity-rooms/${roomId}/mentors`,
        { employee_id: person.employee!.id },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) a mentor from a unit outside the room's scope", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const otherUnit = await prismaClient.masterUnit.create({
        data: { name: `TEST_ROOM_MENTOR_UNIT_${Date.now()}` },
      });
      const createResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const roomId = (await createResponse.json()).data.id;
      const employee = await createEligibleMentorEmployee(
        "test_pc_room_mentor_wrong_unit@millennia21.id",
        otherUnit.id,
      );

      const response = await TestRequest.post(
        `/api/admin/pc-activity-rooms/${roomId}/mentors`,
        { employee_id: employee.id },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("rejects (400) assigning a mentor to two rooms meeting the same day, but allows different days", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const otherActivityId = await PCActivityTest.resolveActivityId("Chess Club");
      const mondayRoomResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const mondayRoomId = (await mondayRoomResponse.json()).data.id;
      const otherMondayRoomResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: otherActivityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const otherMondayRoomId = (await otherMondayRoomResponse.json()).data.id;
      const tuesdayRoomResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: otherActivityId,
          day: "TUESDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const tuesdayRoomId = (await tuesdayRoomResponse.json()).data.id;
      const employee = await createEligibleMentorEmployee(
        "test_pc_room_mentor_day_conflict@millennia21.id",
        unitId,
      );

      const first = await TestRequest.post(
        `/api/admin/pc-activity-rooms/${mondayRoomId}/mentors`,
        { employee_id: employee.id },
        accessToken,
      );
      const sameDayConflict = await TestRequest.post(
        `/api/admin/pc-activity-rooms/${otherMondayRoomId}/mentors`,
        { employee_id: employee.id },
        accessToken,
      );
      const differentDayOk = await TestRequest.post(
        `/api/admin/pc-activity-rooms/${tuesdayRoomId}/mentors`,
        { employee_id: employee.id },
        accessToken,
      );

      expect(first.status).toBe(200);
      expect(sameDayConflict.status).toBe(400);
      expect(differentDayOk.status).toBe(200);
    });

    it("ends, reopens, and removes a mentor assignment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const createResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const roomId = (await createResponse.json()).data.id;
      const employee = await createEligibleMentorEmployee(
        "test_pc_room_mentor_lifecycle@millennia21.id",
        unitId,
      );
      const assignResponse = await TestRequest.post(
        `/api/admin/pc-activity-rooms/${roomId}/mentors`,
        { employee_id: employee.id },
        accessToken,
      );
      const assignmentId = (await assignResponse.json()).data.id;

      const endResponse = await TestRequest.patch(
        `/api/admin/pc-activity-rooms/${roomId}/mentors/${assignmentId}/end`,
        {},
        accessToken,
      );
      expect(endResponse.status).toBe(200);

      const afterEnd = await prismaClient.pcActivityRoomMentorAssignment.findUniqueOrThrow({
        where: { id: assignmentId },
      });
      expect(afterEnd.end_date).not.toBeNull();

      const reopenResponse = await TestRequest.patch(
        `/api/admin/pc-activity-rooms/${roomId}/mentors/${assignmentId}/reopen`,
        {},
        accessToken,
      );
      expect(reopenResponse.status).toBe(200);
      const afterReopen = await prismaClient.pcActivityRoomMentorAssignment.findUniqueOrThrow({
        where: { id: assignmentId },
      });
      expect(afterReopen.end_date).toBeNull();

      const removeResponse = await TestRequest.delete(
        `/api/admin/pc-activity-rooms/${roomId}/mentors/${assignmentId}`,
        accessToken,
      );
      expect(removeResponse.status).toBe(200);

      const list = await TestRequest.get(
        `/api/admin/pc-activity-rooms/${roomId}/mentors`,
        accessToken,
      );
      expect((await list.json()).data).toHaveLength(0);
    });

    it("revalidates mentor eligibility on reopen and preserves move history", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const roomOne = await TestRequest.post("/api/admin/pc-activity-rooms", {
        activity_id: activityId, academic_year_id: academicYearId, day: "MONDAY",
        duration_type: "SEMESTER", unit_ids: [unitId],
          grade_ids: [gradeId], label: "One",
      }, accessToken);
      const roomTwo = await TestRequest.post("/api/admin/pc-activity-rooms", {
        activity_id: activityId, academic_year_id: academicYearId, day: "MONDAY",
        duration_type: "SEMESTER", unit_ids: [unitId],
          grade_ids: [gradeId], label: "Two",
      }, accessToken);
      const sourceRoomId = (await roomOne.json()).data.id;
      const targetRoomId = (await roomTwo.json()).data.id;
      const employee = await createEligibleMentorEmployee("test_pc_room_mentor_move@millennia21.id", unitId);
      const assigned = await TestRequest.post(`/api/admin/pc-activity-rooms/${sourceRoomId}/mentors`, { employee_id: employee.id }, accessToken);
      const assignmentId = (await assigned.json()).data.id;
      const moved = await TestRequest.post(`/api/admin/pc-activity-rooms/${sourceRoomId}/mentors/${assignmentId}/move`, { target_room_id: targetRoomId }, accessToken);
      expect(moved.status).toBe(200);
      const movedRow = await prismaClient.pcActivityRoomMentorAssignment.findUniqueOrThrow({ where: { id: (await moved.json()).data.id } });
      expect(movedRow.previous_assignment_id).toBe(assignmentId);
      await TestRequest.patch(`/api/admin/pc-activity-rooms/${targetRoomId}/mentors/${movedRow.id}/end`, {}, accessToken);
      await prismaClient.employee.update({ where: { id: employee.id }, data: { status: "INACTIVE" } });
      const reopen = await TestRequest.patch(`/api/admin/pc-activity-rooms/${targetRoomId}/mentors/${movedRow.id}/reopen`, {}, accessToken);
      expect(reopen.status).toBe(400);
    });

    it("schedules next-year mentor rollover and activates it at the target start", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { id: "test-super-admin-id" },
      });
      const currentYear = await prismaClient.academicYear.findUniqueOrThrow({ where: { id: academicYearId } });
      const nextYear = await resolveNextAcademicYear(currentYear);
      const sourceResponse = await TestRequest.post("/api/admin/pc-activity-rooms", {
        activity_id: activityId,
        academic_year_id: academicYearId,
        day: "MONDAY",
        duration_type: "SEMESTER",
        unit_ids: [unitId],
          grade_ids: [gradeId],
      }, accessToken);
      const targetResponse = await TestRequest.post("/api/admin/pc-activity-rooms", {
        activity_id: activityId,
        academic_year_id: nextYear.id,
        day: "TUESDAY",
        duration_type: "SEMESTER",
        unit_ids: [unitId],
          grade_ids: [gradeId],
      }, accessToken);
      const sourceRoomId = (await sourceResponse.json()).data.id;
      const targetBody = (await targetResponse.json()).data;
      const employee = await createEligibleMentorEmployee(
        "test_pc_room_mentor_rollover@millennia21.id",
        unitId,
      );
      const assigned = await TestRequest.post(
        `/api/admin/pc-activity-rooms/${sourceRoomId}/mentors`,
        { employee_id: employee.id },
        accessToken,
      );
      const sourceAssignmentId = (await assigned.json()).data.id;
      const promotionNow = new Date(
        currentYear.end_date!.getTime() - 10 * 24 * 60 * 60 * 1000,
      );
      const moved = await PCActivityRoomService.moveMentorAssignment(
        admin,
        {
          id: sourceAssignmentId,
          room_id: sourceRoomId,
          target_room_id: targetBody.id,
        },
        {},
        promotionNow,
      );
      const targetAssignmentId = moved.id;
      const retried = await PCActivityRoomService.moveMentorAssignment(
        admin,
        {
          id: sourceAssignmentId,
          room_id: sourceRoomId,
          target_room_id: targetBody.id,
        },
        {},
        promotionNow,
      );
      expect(retried.id).toBe(targetAssignmentId);
      const [sourceBeforeStart, targetBeforeStart] = await Promise.all([
        prismaClient.pcActivityRoomMentorAssignment.findUniqueOrThrow({ where: { id: sourceAssignmentId } }),
        prismaClient.pcActivityRoomMentorAssignment.findUniqueOrThrow({ where: { id: targetAssignmentId } }),
      ]);
      expect(sourceBeforeStart.status).toBe("ACTIVE");
      expect(targetBeforeStart.status).toBe("SCHEDULED");

      const activated = await PCActivityRoomService.activateScheduledAssignments(
        new Date(new Date(targetBody.start_date).getTime() + 1),
      );
      expect(activated).toBeGreaterThanOrEqual(1);
      const [sourceAfterStart, targetAfterStart] = await Promise.all([
        prismaClient.pcActivityRoomMentorAssignment.findUniqueOrThrow({ where: { id: sourceAssignmentId } }),
        prismaClient.pcActivityRoomMentorAssignment.findUniqueOrThrow({ where: { id: targetAssignmentId } }),
      ]);
      expect(sourceAfterStart.status).toBe("ENDED");
      expect(targetAfterStart.status).toBe("ACTIVE");
      const retriedAfterActivation = await PCActivityRoomService.moveMentorAssignment(
        admin,
        {
          id: sourceAssignmentId,
          room_id: sourceRoomId,
          target_room_id: targetBody.id,
        },
        {},
        new Date(targetBody.start_date),
      );
      expect(retriedAfterActivation.id).toBe(targetAssignmentId);
      expect(
        await prismaClient.pcActivityRoomMentorAssignment.count({
          where: { previous_assignment_id: sourceAssignmentId },
        }),
      ).toBe(1);
    });

    it("rejects mentor promotion before the 30-day window opens", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { id: "test-super-admin-id" },
      });
      const currentYear = await prismaClient.academicYear.findUniqueOrThrow({ where: { id: academicYearId } });
      const nextYear = await resolveNextAcademicYear(currentYear);
      const sourceRoom = await TestRequest.post("/api/admin/pc-activity-rooms", {
          activity_id: activityId, academic_year_id: academicYearId, day: "MONDAY",
          duration_type: "SEMESTER", unit_ids: [unitId], grade_ids: [gradeId],
        }, accessToken);
      const targetRoom = await prismaClient.pcActivityRoom.create({
          data: {
            activity_id: activityId,
            academic_year_id: nextYear.id,
            day: "TUESDAY",
            duration_type: "SEMESTER",
            start_date: nextYear.start_date,
            end_date: nextYear.end_date!,
            created_by: admin.id,
            units: { create: { unit_id: unitId } },
            grades: { create: { grade_id: gradeId } },
          },
        });
      const sourceRoomId = (await sourceRoom.json()).data.id;
      const employee = await createEligibleMentorEmployee("test_pc_room_mentor_early@millennia21.id", unitId);
      const sourceAssignment = await prismaClient.pcActivityRoomMentorAssignment.create({
        data: { room_id: sourceRoomId, employee_id: employee.id },
      });

      await expect(
        PCActivityRoomService.moveMentorAssignment(
          admin,
          { id: sourceAssignment.id, room_id: sourceRoomId, target_room_id: targetRoom.id },
          {},
          new Date(currentYear.end_date!.getTime() - 31 * 24 * 60 * 60 * 1000),
        ),
      ).rejects.toThrow("Too early to promote");
    });

    it("keeps an independent target-room mentor assignment as a promotion conflict", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { id: "test-super-admin-id" },
      });
      const currentYear = await prismaClient.academicYear.findUniqueOrThrow({ where: { id: academicYearId } });
      const nextYear = await resolveNextAcademicYear(currentYear);
      const sourceResponse = await TestRequest.post("/api/admin/pc-activity-rooms", {
        activity_id: activityId, academic_year_id: academicYearId, day: "MONDAY",
        duration_type: "SEMESTER", unit_ids: [unitId], grade_ids: [gradeId],
      }, accessToken);
      const sourceRoomId = (await sourceResponse.json()).data.id;
      const targetRoom = await prismaClient.pcActivityRoom.create({
        data: {
          activity_id: activityId,
          academic_year_id: nextYear.id,
          day: "TUESDAY",
          duration_type: "SEMESTER",
          start_date: nextYear.start_date,
          end_date: nextYear.end_date!,
          created_by: admin.id,
          units: { create: { unit_id: unitId } },
          grades: { create: { grade_id: gradeId } },
        },
      });
      const employee = await createEligibleMentorEmployee("test_pc_room_mentor_target_conflict@millennia21.id", unitId);
      const sourceAssignment = await prismaClient.pcActivityRoomMentorAssignment.create({
        data: { room_id: sourceRoomId, employee_id: employee.id },
      });
      await prismaClient.pcActivityRoomMentorAssignment.create({
        data: {
          room_id: targetRoom.id,
          employee_id: employee.id,
          status: "SCHEDULED",
          start_date: targetRoom.start_date,
        },
      });

      await expect(
        PCActivityRoomService.moveMentorAssignment(
          admin,
          { id: sourceAssignment.id, room_id: sourceRoomId, target_room_id: targetRoom.id },
          {},
          new Date(currentYear.end_date!.getTime() - 10 * 24 * 60 * 60 * 1000),
        ),
      ).rejects.toThrow(
        "This person already has an active or scheduled mentor assignment on the target room.",
      );
    });
  });

  describe("Students", () => {
    it("should list eligibility and flag an existing assignment via other_activity", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const chessClubId = await PCActivityTest.resolveActivityId("Chess Club");
      const otherRoomResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: chessClubId,
          day: "TUESDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const otherRoomId = (await otherRoomResponse.json()).data.id;
      await TestRequest.post(
        `/api/admin/pc-activity-rooms/${otherRoomId}/students/bulk`,
        { student_ids: [studentId] },
        accessToken,
      );

      const roomResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const roomId = (await roomResponse.json()).data.id;

      const response = await TestRequest.get(
        `/api/admin/pc-activity-rooms/${roomId}/eligible-students`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      const row = body.data.find((r: { student_id: string }) => r.student_id === studentId);
      expect(row.already_assigned).toBe(false);
      expect(row.other_activity.activity_name).toBe("Chess Club");
      expect(row.other_activity.room_id).toBe(otherRoomId);
      // Tuesday assignment doesn't block a Monday room.
      expect(row.other_activity.same_day).toBe(false);
    });

    it("flags a legacy same-activity-and-day row as an EXACT match and attaches it instead of creating a new one on bulk-assign", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const legacyRow = await prismaClient.passionConnectionActivity.create({
        data: {
          student_id: studentId,
          activity_id: activityId,
          day: "MONDAY",
          academic_year_id: academicYearId,
        },
      });

      const roomResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const roomId = (await roomResponse.json()).data.id;

      const eligibleResponse = await TestRequest.get(
        `/api/admin/pc-activity-rooms/${roomId}/eligible-students`,
        accessToken,
      );
      const eligibleBody = await eligibleResponse.json();
      const eligibleRow = eligibleBody.data.find(
        (r: { student_id: string }) => r.student_id === studentId,
      );
      expect(eligibleRow.legacy_match).toBe("EXACT");

      const bulkResponse = await TestRequest.post(
        `/api/admin/pc-activity-rooms/${roomId}/students/bulk`,
        { student_ids: [studentId] },
        accessToken,
      );
      const bulkBody = await bulkResponse.json();
      logger.debug(bulkBody);
      expect(bulkResponse.status).toBe(200);
      expect(bulkBody.data.success_count).toBe(1);
      // Attached, not superseded - same row id, just tagged with the room.
      expect(bulkBody.data.items[0].data.id).toBe(legacyRow.id);
      expect(bulkBody.data.items[0].data.room_id).toBe(roomId);
      expect(bulkBody.data.items[0].data.start_date).toBe(legacyRow.start_date.toISOString());

      const rowCount = await prismaClient.passionConnectionActivity.count({
        where: { student_id: studentId, deleted_at: null },
      });
      expect(rowCount).toBe(1);
    });

    it("pages and filters eligible students while preserving EXACT legacy rows in available_only", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await prismaClient.passionConnectionActivity.create({
        data: {
          student_id: studentId,
          activity_id: activityId,
          day: "MONDAY",
          academic_year_id: academicYearId,
        },
      });
      const roomResponse = await TestRequest.post("/api/admin/pc-activity-rooms", {
        activity_id: activityId,
        day: "MONDAY",
        duration_type: "SEMESTER",
        unit_ids: [unitId],
        grade_ids: [gradeId],
      }, accessToken);
      const roomId = (await roomResponse.json()).data.id;
      const response = await TestRequest.get(
        `/api/admin/pc-activity-rooms/${roomId}/eligible-students?page=1&size=1&search=9500002&grade_id=${gradeId}&available_only=true`,
        accessToken,
      );
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.paging).toMatchObject({ size: 1, current_page: 1, total_item: 1 });
      expect(body.data[0].legacy_match).toBe("EXACT");
    });

    it("flags a legacy same-day-different-activity row as DAY_ONLY and keeps it out of eligible/bulk-assign", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const chessClubId = await PCActivityTest.resolveActivityId("Chess Club");
      await prismaClient.passionConnectionActivity.create({
        data: {
          student_id: studentId,
          activity_id: chessClubId,
          day: "MONDAY",
          academic_year_id: academicYearId,
        },
      });

      const roomResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const roomId = (await roomResponse.json()).data.id;

      const eligibleResponse = await TestRequest.get(
        `/api/admin/pc-activity-rooms/${roomId}/eligible-students`,
        accessToken,
      );
      const eligibleBody = await eligibleResponse.json();
      const eligibleRow = eligibleBody.data.find(
        (r: { student_id: string }) => r.student_id === studentId,
      );
      expect(eligibleRow.legacy_match).toBe("DAY_ONLY");

      const bulkResponse = await TestRequest.post(
        `/api/admin/pc-activity-rooms/${roomId}/students/bulk`,
        { student_ids: [studentId] },
        accessToken,
      );
      const bulkBody = await bulkResponse.json();
      expect(bulkResponse.status).toBe(200);
      expect(bulkBody.data.failed_count).toBe(1);
    });

    it("bulk-assigns eligible students and fails ineligible ones in the same batch", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const otherUnit = await prismaClient.masterUnit.create({
        data: { name: `TEST_ROOM_BULK_OTHER_${Date.now()}` },
      });
      const outOfScopeGrade = await prismaClient.grade.create({
        data: { name: `TEST_ROOM_BULK_GRADE_${Date.now()}`, level: -9997, unit_id: otherUnit.id },
      });
      const outOfScopeStudent = await StudentTest.create({
        email: "test_pc_room_bulk_out_of_scope@millennia21.id",
        nis: "9500003",
        currentGradeId: outOfScopeGrade.id,
      });

      const createResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const roomId = (await createResponse.json()).data.id;

      const response = await TestRequest.post(
        `/api/admin/pc-activity-rooms/${roomId}/students/bulk`,
        { student_ids: [studentId, outOfScopeStudent.student!.id] },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.success_count).toBe(1);
      expect(body.data.failed_count).toBe(1);

      const listResponse = await TestRequest.get(
        `/api/admin/pc-activity-rooms/${roomId}/students`,
        accessToken,
      );
      const listBody = await listResponse.json();
      expect(listBody.data.length).toBe(1);
      expect(listBody.data[0].student_id).toBe(studentId);
      expect(listBody.data[0].status).toBe("ACTIVE");
      expect(listBody.paging.total_item).toBe(1);
    });

    it("defaults student start_date to room start and supports audited single and deduplicated bulk changes", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const roomResponse = await TestRequest.post("/api/admin/pc-activity-rooms", {
        activity_id: activityId,
        day: "MONDAY",
        duration_type: "SEMESTER",
        unit_ids: [unitId],
        grade_ids: [gradeId],
      }, accessToken);
      const room = (await roomResponse.json()).data;
      const bulk = await TestRequest.post(`/api/admin/pc-activity-rooms/${room.id}/students/bulk`, {
        student_ids: [studentId],
      }, accessToken);
      const assignment = (await bulk.json()).data.items[0].data;
      expect(assignment.start_date).toBe(room.start_date);

      const nextStart = new Date(new Date(room.start_date).getTime() + 24 * 60 * 60 * 1000).toISOString();
      const patch = await TestRequest.patch(
        `/api/admin/pc-activity-rooms/${room.id}/students/${assignment.id}/start-date`,
        { start_date: nextStart },
        accessToken,
      );
      expect(patch.status).toBe(200);
      expect((await patch.json()).data.start_date).toBe(nextStart);

      const bulkPatch = await TestRequest.patch(
        `/api/admin/pc-activity-rooms/${room.id}/students/bulk-start-date`,
        { assignment_ids: [assignment.id, assignment.id, "missing-assignment"], start_date: room.start_date },
        accessToken,
      );
      const bulkBody = await bulkPatch.json();
      expect(bulkBody.data.items.length).toBe(2);
      expect(bulkBody.data.success_count).toBe(1);
      expect(bulkBody.data.failed_count).toBe(1);
      expect(await prismaClient.auditLog.count({
        where: { action: AuditAction.UPDATE_PC_ACTIVITY_ROOM_STUDENT_START_DATE },
      })).toBe(2);
    });

    it("ends, reopens, moves, and drops student assignments while preserving history", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const source = await TestRequest.post("/api/admin/pc-activity-rooms", {
        activity_id: activityId, academic_year_id: academicYearId, day: "MONDAY",
        duration_type: "SEMESTER", unit_ids: [unitId],
          grade_ids: [gradeId], label: "Source",
      }, accessToken);
      const target = await TestRequest.post("/api/admin/pc-activity-rooms", {
        activity_id: activityId, academic_year_id: academicYearId, day: "MONDAY",
        duration_type: "SEMESTER", unit_ids: [unitId],
          grade_ids: [gradeId], label: "Target",
      }, accessToken);
      const sourceId = (await source.json()).data.id;
      const targetId = (await target.json()).data.id;
      const bulk = await TestRequest.post(`/api/admin/pc-activity-rooms/${sourceId}/students/bulk`, { student_ids: [studentId] }, accessToken);
      const assignmentId = (await bulk.json()).data.items[0].data.id;
      expect((await TestRequest.patch(`/api/admin/pc-activity-rooms/${sourceId}/students/${assignmentId}/end`, {}, accessToken)).status).toBe(200);
      expect((await TestRequest.patch(`/api/admin/pc-activity-rooms/${sourceId}/students/${assignmentId}/reopen`, {}, accessToken)).status).toBe(200);
      const moved = await TestRequest.post(`/api/admin/pc-activity-rooms/${sourceId}/students/${assignmentId}/move`, { target_room_id: targetId }, accessToken);
      expect(moved.status).toBe(200);
      const movedId = (await moved.json()).data.id;
      const movedRow = await prismaClient.passionConnectionActivity.findUniqueOrThrow({ where: { id: movedId } });
      expect(movedRow.previous_assignment_id).toBe(assignmentId);
      expect((await TestRequest.delete(`/api/admin/pc-activity-rooms/${targetId}/students/${movedId}`, accessToken)).status).toBe(200);
      expect((await prismaClient.passionConnectionActivity.findUniqueOrThrow({ where: { id: movedId } })).deleted_at).not.toBeNull();
    });

    it("schedules next-year student rollover and activates it at the target start", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const admin = await prismaClient.adminUser.findUniqueOrThrow({ where: { id: "test-super-admin-id" } });
      const currentYear = await prismaClient.academicYear.findUniqueOrThrow({ where: { id: academicYearId } });
      const nextYear = await resolveNextAcademicYear(currentYear);
      const nextClass = await prismaClient.class.create({
        data: { name: `TEST_PC_ROOM_NEXT_CLASS_${Date.now()}`, grade_id: gradeId, academic_year_id: nextYear.id },
      });
      await EnrollmentTest.create({
        studentId, classId: nextClass.id, academicYearId: nextYear.id, gradeId, gradeLevel: "TEST_STUDENT_GRADE",
      });
      const source = await TestRequest.post("/api/admin/pc-activity-rooms", {
        activity_id: activityId, academic_year_id: academicYearId, day: "MONDAY", duration_type: "SEMESTER", unit_ids: [unitId],
          grade_ids: [gradeId],
      }, accessToken);
      const target = await TestRequest.post("/api/admin/pc-activity-rooms", {
        activity_id: activityId, academic_year_id: nextYear.id, day: "TUESDAY", duration_type: "SEMESTER", unit_ids: [unitId],
          grade_ids: [gradeId], class_ids: [nextClass.id],
      }, accessToken);
      const sourceId = (await source.json()).data.id;
      const targetBody = (await target.json()).data;
      const bulk = await TestRequest.post(`/api/admin/pc-activity-rooms/${sourceId}/students/bulk`, { student_ids: [studentId] }, accessToken);
      const assignmentId = (await bulk.json()).data.items[0].data.id;
      const response = await PCActivityRoomService.moveStudent(
        admin,
        { room_id: sourceId, assignment_id: assignmentId, target_room_id: targetBody.id },
        {},
        new Date(currentYear.end_date!.getTime() - 10 * 24 * 60 * 60 * 1000),
      );
      const row = await prismaClient.passionConnectionActivity.findUniqueOrThrow({ where: { id: response.id } });
      expect(row.academic_year_id).toBe(nextYear.id);
      expect(row.day).toBe("TUESDAY");
      expect(row.start_date.toISOString()).toBe(targetBody.start_date);
      expect(row.expires_at?.toISOString()).toBe(targetBody.end_date);
      expect(row.status).toBe("SCHEDULED");
      const sourceBeforeStart = await prismaClient.passionConnectionActivity.findUniqueOrThrow({ where: { id: assignmentId } });
      expect(sourceBeforeStart.status).toBe("ACTIVE");

      const activated = await PCActivityRoomService.activateScheduledAssignments(
        new Date(new Date(targetBody.start_date).getTime() + 1),
      );
      expect(activated).toBeGreaterThanOrEqual(1);
      const [sourceAfterStart, targetAfterStart] = await Promise.all([
        prismaClient.passionConnectionActivity.findUniqueOrThrow({ where: { id: assignmentId } }),
        prismaClient.passionConnectionActivity.findUniqueOrThrow({ where: { id: row.id } }),
      ]);
      expect(sourceAfterStart.status).toBe("ENDED");
      expect(targetAfterStart.status).toBe("ACTIVE");
    });

    it("rejects student promotion as too early before checking target enrollment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const admin = await prismaClient.adminUser.findUniqueOrThrow({ where: { id: "test-super-admin-id" } });
      const currentYear = await prismaClient.academicYear.findUniqueOrThrow({ where: { id: academicYearId } });
      const nextYear = await resolveNextAcademicYear(currentYear);
      const source = await TestRequest.post("/api/admin/pc-activity-rooms", {
        activity_id: activityId, academic_year_id: academicYearId, day: "MONDAY",
        duration_type: "SEMESTER", unit_ids: [unitId], grade_ids: [gradeId],
      }, accessToken);
      const target = await prismaClient.pcActivityRoom.create({
        data: {
          activity_id: activityId,
          academic_year_id: nextYear.id,
          day: "TUESDAY",
          duration_type: "SEMESTER",
          start_date: nextYear.start_date,
          end_date: nextYear.end_date!,
          created_by: admin.id,
          units: { create: { unit_id: unitId } },
          grades: { create: { grade_id: gradeId } },
        },
      });
      const sourceId = (await source.json()).data.id;
      const bulk = await TestRequest.post(`/api/admin/pc-activity-rooms/${sourceId}/students/bulk`, { student_ids: [studentId] }, accessToken);
      const assignmentId = (await bulk.json()).data.items[0].data.id;

      await expect(
        PCActivityRoomService.moveStudent(
          admin,
          { room_id: sourceId, assignment_id: assignmentId, target_room_id: target.id },
          {},
          new Date(currentYear.end_date!.getTime() - 31 * 24 * 60 * 60 * 1000),
        ),
      ).rejects.toThrow("Too early to promote");
    });
  });

  describe("Management permissions", () => {
    it("separates student enrollment management from mentor assignment management", async () => {
      const superAdmin = await AdminUserTest.createSuperAdmin();
      const createResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        superAdmin.accessToken,
      );
      const roomId = (await createResponse.json()).data.id;

      const studentAdmin = await AdminUserTest.createDatabaseAdmin(unitId, {
        id: "test-pc-student-admin-id",
        email: "test_pc_student_admin@millennia21.id",
        canManageEnrollments: false,
        canManageTeacherAssignments: true,
      });
      const studentResponse = await TestRequest.post(
        `/api/admin/pc-activity-rooms/${roomId}/students/bulk`,
        { student_ids: [studentId] },
        studentAdmin.accessToken,
      );
      expect(studentResponse.status).toBe(403);
      expect((await studentResponse.json()).errors).toContain(
        "Enrollment management permission",
      );

      const mentor = await createEligibleMentorEmployee(
        "test_pc_room_permission_mentor@millennia21.id",
        unitId,
      );
      const mentorAdmin = await AdminUserTest.createDatabaseAdmin(unitId, {
        id: "test-pc-mentor-admin-id",
        email: "test_pc_mentor_admin@millennia21.id",
        canManageEnrollments: true,
        canManageTeacherAssignments: false,
      });
      const mentorResponse = await TestRequest.post(
        `/api/admin/pc-activity-rooms/${roomId}/mentors`,
        { employee_id: mentor.id },
        mentorAdmin.accessToken,
      );
      expect(mentorResponse.status).toBe(403);
      expect((await mentorResponse.json()).errors).toContain(
        "Teacher assignment permission",
      );
    });
  });

  describe("Expiry", () => {
    it("flips ACTIVE assignments past due to EXPIRED without touching deleted_at, and records one audit row per assignment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const createResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const roomId = (await createResponse.json()).data.id;
      const bulkResponse = await TestRequest.post(
        `/api/admin/pc-activity-rooms/${roomId}/students/bulk`,
        { student_ids: [studentId] },
        accessToken,
      );
      const assignmentId = (await bulkResponse.json()).data.items[0].data.id;

      // Backdate expiry instead of asserting on a made-up future date.
      const pastDue = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await prismaClient.passionConnectionActivity.update({
        where: { id: assignmentId },
        data: { expires_at: pastDue },
      });

      const expiredCount = await PCActivityRoomService.expirePastDueAssignments(new Date());
      expect(expiredCount).toBe(1);

      const row = await prismaClient.passionConnectionActivity.findUniqueOrThrow({
        where: { id: assignmentId },
      });
      expect(row.status).toBe("EXPIRED");
      expect(row.deleted_at).toBeNull();

      const auditRows = await prismaClient.auditLog.findMany({
        where: {
          action: AuditAction.AUTO_EXPIRE_PC_ACTIVITY_ASSIGNMENT,
          entity_id: assignmentId,
        },
      });
      expect(auditRows.length).toBe(1);

      // Running the sweep again is a no-op - the row is no longer ACTIVE.
      const secondRun = await PCActivityRoomService.expirePastDueAssignments(new Date());
      expect(secondRun).toBe(0);
    });

    it("leaves ACTIVE assignments that aren't past due alone", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const createResponse = await TestRequest.post(
        "/api/admin/pc-activity-rooms",
        {
          activity_id: activityId,
          day: "MONDAY",
          duration_type: "SEMESTER",
          unit_ids: [unitId],
          grade_ids: [gradeId],
        },
        accessToken,
      );
      const roomId = (await createResponse.json()).data.id;
      const bulkResponse = await TestRequest.post(
        `/api/admin/pc-activity-rooms/${roomId}/students/bulk`,
        { student_ids: [studentId] },
        accessToken,
      );
      const assignmentId = (await bulkResponse.json()).data.items[0].data.id;

      await PCActivityRoomService.expirePastDueAssignments(new Date());

      const row = await prismaClient.passionConnectionActivity.findUniqueOrThrow({
        where: { id: assignmentId },
      });
      expect(row.status).toBe("ACTIVE");
    });
  });
});
