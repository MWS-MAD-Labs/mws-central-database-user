import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  ClassTest,
  GradeTest,
  StudentTest,
  EnrollmentTest,
  MasterDataTest,
  AuditLogTest,
} from "./test-utils";
import {
  AcademicYearStatus,
  AuditAction,
  ClassStatus,
  EnrollmentStatus,
  StudentStatus,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

describe("Student Class Enrollment", () => {
  let gradeOneId: string;
  let gradeTwoId: string;
  let yearAId: string;
  let yearBId: string;
  let classGrade1YearA: string;
  let classGrade1YearAAlt: string;
  let classGrade1YearAInactive: string;
  let classGrade1YearAUpcoming: string;
  let classGrade2YearB: string;
  let classGrade2YearBUpcoming: string;
  let classGrade2YearA: string;
  let studentId: string;

  async function cleanup() {
    await AuditLogTest.delete();
    await EnrollmentTest.delete();
    await StudentTest.delete();
    await AdminUserTest.delete();
    await ClassTest.delete();
    await prismaClient.academicYear.deleteMany({
      where: { name: { startsWith: "TEST_ENROLL_YEAR" } },
    });
    await MasterDataTest.delete();
  }

  beforeEach(async () => {
    await cleanup();
    await MasterDataTest.create();

    const gradeOne = await GradeTest.getByName("Grade 1");
    const gradeTwo = await GradeTest.getByName("Grade 2");
    gradeOneId = gradeOne.id;
    gradeTwoId = gradeTwo.id;

    const yearA = await prismaClient.academicYear.create({
      data: {
        name: "TEST_ENROLL_YEAR_A",
        status: AcademicYearStatus.ACTIVE,
        start_date: new Date("2025-07-01"),
      },
    });
    const yearB = await prismaClient.academicYear.create({
      data: {
        name: "TEST_ENROLL_YEAR_B",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date("2026-07-01"),
      },
    });
    yearAId = yearA.id;
    yearBId = yearB.id;

    const classA = await ClassTest.create({
      name: "TEST_Class_A",
      gradeId: gradeOneId,
      academicYearId: yearAId,
      status: ClassStatus.ACTIVE,
    });
    const classAAlt = await ClassTest.create({
      name: "TEST_Class_A_Alt",
      gradeId: gradeOneId,
      academicYearId: yearAId,
      status: ClassStatus.ACTIVE,
    });
    const classAInactive = await ClassTest.create({
      name: "TEST_Class_A_Inactive",
      gradeId: gradeOneId,
      academicYearId: yearAId,
      status: ClassStatus.INACTIVE,
    });
    const classAUpcoming = await ClassTest.create({
      name: "TEST_Class_A_Upcoming",
      gradeId: gradeOneId,
      academicYearId: yearAId,
      status: ClassStatus.UPCOMING,
    });
    const classB = await ClassTest.create({
      name: "TEST_Class_B",
      gradeId: gradeTwoId,
      academicYearId: yearBId,
      status: ClassStatus.ACTIVE,
    });
    const classB2Upcoming = await ClassTest.create({
      name: "TEST_Class_B_Upcoming",
      gradeId: gradeTwoId,
      academicYearId: yearBId,
      status: ClassStatus.UPCOMING,
    });
    const classGrade2InYearA = await ClassTest.create({
      name: "TEST_Class_A_Grade2",
      gradeId: gradeTwoId,
      academicYearId: yearAId,
      status: ClassStatus.ACTIVE,
    });

    classGrade1YearA = classA.id;
    classGrade1YearAAlt = classAAlt.id;
    classGrade1YearAInactive = classAInactive.id;
    classGrade1YearAUpcoming = classAUpcoming.id;
    classGrade2YearB = classB.id;
    classGrade2YearBUpcoming = classB2Upcoming.id;
    classGrade2YearA = classGrade2InYearA.id;

    const student = await StudentTest.create({
      email: "test_enroll_1@millennia21.id",
      nis: "ENR00001",
      status: StudentStatus.REGISTERED,
      currentGradeId: gradeOneId,
      joinGradeId: gradeOneId,
      joinAcademicYearId: yearAId,
    });
    studentId = student.student!.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("POST /api/admin/students/:id/enrollments", () => {
    it("should create an enrollment as SUPER_ADMIN and sync current_class_id", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.class.id).toBe(classGrade1YearA);
      expect(body.data.academic_year.id).toBe(yearAId);
      expect(body.data.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
      expect(body.data.student.id).toBe(studentId);
      expect(body.data.promoted_from_enrollment_id).toBeNull();

      const student = await prismaClient.student.findUniqueOrThrow({
        where: { id: studentId },
      });
      expect(student.current_class_id).toBe(classGrade1YearA);
      expect(student.status).toBe(StudentStatus.ACTIVE);

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.CREATE_ENROLLMENT, admin_id: admin.id },
      });
      expect(auditLog.entity_type).toBe("StudentClassEnrollment");
    });

    it("should default academic_year_id to the currently ACTIVE academic year", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.academic_year.id).toBe(yearAId);
    });

    it("should honor an explicit start_date instead of forcing now()", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const explicitStart = "2025-07-15T00:00:00.000Z";

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        {
          class_id: classGrade1YearA,
          academic_year_id: yearAId,
          start_date: explicitStart,
        },
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.start_date).toBe(explicitStart);
    });

    it("should reject creation (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );

      expect(response.status).toBe(403);
    });

    it("should create an enrollment as DATABASE_ADMIN with can_write_data", async () => {
      const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
        where: { name: "Elementary" },
      });
      const { accessToken } = await AdminUserTest.createDatabaseAdmin(
        elementaryUnit.id,
      );

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );

      expect(response.status).toBe(200);
    });

    it("should reject (403) DATABASE_ADMIN creating an enrollment into a class outside their unit", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(403);
      expect(body.errors).toContain("unit scope");
    });

    it("should reject (404) creating an enrollment for a nonexistent student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/nonexistent-id/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );

      expect(response.status).toBe(404);
    });


    it("should reject (400) when the class's grade does not match the student's grade", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade2YearA, academic_year_id: yearAId },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
    });

    it("should reject (400) when the class belongs to a different academic year", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearBId },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) when the class is not active", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearAInactive, academic_year_id: yearAId },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should allow enrolling into an UPCOMING class (prepped ahead of its academic year going live)", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearAUpcoming, academic_year_id: yearAId },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
    });

    it("should create a legacy enrollment into an inactive class, defaulting to COMPLETED and leaving current_class_id/status untouched", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        {
          class_id: classGrade1YearAInactive,
          academic_year_id: yearAId,
          is_legacy: true,
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.enrollment_status).toBe(EnrollmentStatus.COMPLETED);

      const student = await prismaClient.student.findUniqueOrThrow({
        where: { id: studentId },
      });
      expect(student.current_class_id).toBeNull();
      expect(student.status).toBe(StudentStatus.REGISTERED);
    });

    it("should allow a legacy enrollment into a class whose grade differs from the student's current grade", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      // classGrade2YearA is Grade 2 - studentId's current grade is Grade 1.
      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        {
          class_id: classGrade2YearA,
          academic_year_id: yearAId,
          is_legacy: true,
          status: "TRANSFERRED",
          end_date: "2025-12-01T00:00:00.000Z",
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.enrollment_status).toBe(EnrollmentStatus.TRANSFERRED);
      expect(body.data.end_date).toBe("2025-12-01T00:00:00.000Z");
    });

    it("should reject (400) a legacy enrollment without academic_year_id", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearAInactive, is_legacy: true },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (403) DATABASE_ADMIN creating a legacy enrollment into a class outside their unit", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        {
          class_id: classGrade1YearAInactive,
          academic_year_id: yearAId,
          is_legacy: true,
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(403);
      expect(body.errors).toContain("unit scope");
    });

    it("should reject (400) a duplicate enrollment for the same academic year", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearAAlt, academic_year_id: yearAId },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
    });

    it("should allow re-enrolling for the same academic year after the previous enrollment was soft-deleted", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const created = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const createdBody = await created.json();

      await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/delete/${createdBody.data.id}`,
        {},
        accessToken,
      );

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearAAlt, academic_year_id: yearAId },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.id).not.toBe(createdBody.data.id);
    });

    it("should reject (400) a start_date outside the academic year's date range", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const yearC = await prismaClient.academicYear.create({
        data: {
          name: "TEST_ENROLL_YEAR_C",
          status: AcademicYearStatus.UPCOMING,
          start_date: new Date("2027-07-01"),
          end_date: new Date("2028-06-30"),
        },
      });
      const classGrade1YearC = await ClassTest.create({
        name: "TEST_Class_Grade1_YearC",
        gradeId: gradeOneId,
        academicYearId: yearC.id,
        status: ClassStatus.ACTIVE,
      });

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        {
          class_id: classGrade1YearC.id,
          academic_year_id: yearC.id,
          start_date: "2026-01-01T00:00:00.000Z",
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
    });

    it("should accept a start_date within the academic year's date range", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const yearC = await prismaClient.academicYear.create({
        data: {
          name: "TEST_ENROLL_YEAR_C",
          status: AcademicYearStatus.UPCOMING,
          start_date: new Date("2027-07-01"),
          end_date: new Date("2028-06-30"),
        },
      });
      const classGrade1YearC = await ClassTest.create({
        name: "TEST_Class_Grade1_YearC",
        gradeId: gradeOneId,
        academicYearId: yearC.id,
        status: ClassStatus.ACTIVE,
      });

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        {
          class_id: classGrade1YearC.id,
          academic_year_id: yearC.id,
          start_date: "2027-08-01T00:00:00.000Z",
        },
        accessToken,
      );

      expect(response.status).toBe(200);
    });
  });

  describe("Class capacity", () => {
    it("should reject (400) creating an enrollment when the class is at full capacity", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const fullClass = await ClassTest.create({
        name: "TEST_Class_Full",
        gradeId: gradeOneId,
        academicYearId: yearAId,
        capacity: 1,
      });
      const otherStudent = await StudentTest.create({
        email: "test_enroll_capacity_1@millennia21.id",
        nis: "ENR00002",
        currentGradeId: gradeOneId,
        joinGradeId: gradeOneId,
        joinAcademicYearId: yearAId,
      });

      await TestRequest.post(
        `/api/admin/students/${otherStudent.student!.id}/enrollments`,
        { class_id: fullClass.id, academic_year_id: yearAId },
        accessToken,
      );

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: fullClass.id, academic_year_id: yearAId },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
    });

    it("should allow SUPER_ADMIN to override full capacity with force", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const fullClass = await ClassTest.create({
        name: "TEST_Class_Full",
        gradeId: gradeOneId,
        academicYearId: yearAId,
        capacity: 1,
      });
      const otherStudent = await StudentTest.create({
        email: "test_enroll_capacity_2@millennia21.id",
        nis: "ENR00003",
        currentGradeId: gradeOneId,
        joinGradeId: gradeOneId,
        joinAcademicYearId: yearAId,
      });

      await TestRequest.post(
        `/api/admin/students/${otherStudent.student!.id}/enrollments`,
        { class_id: fullClass.id, academic_year_id: yearAId },
        accessToken,
      );

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: fullClass.id, academic_year_id: yearAId, force: true },
        accessToken,
      );

      expect(response.status).toBe(200);
    });

    it("should reject (400) a DATABASE_ADMIN's force override attempt when the class is full", async () => {
      const superAdmin = await AdminUserTest.createSuperAdmin();
      const fullClass = await ClassTest.create({
        name: "TEST_Class_Full",
        gradeId: gradeOneId,
        academicYearId: yearAId,
        capacity: 1,
      });
      const otherStudent = await StudentTest.create({
        email: "test_enroll_capacity_3@millennia21.id",
        nis: "ENR00004",
        currentGradeId: gradeOneId,
        joinGradeId: gradeOneId,
        joinAcademicYearId: yearAId,
      });

      await TestRequest.post(
        `/api/admin/students/${otherStudent.student!.id}/enrollments`,
        { class_id: fullClass.id, academic_year_id: yearAId },
        superAdmin.accessToken,
      );

      const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
        where: { name: "Elementary" },
      });
      const { accessToken } = await AdminUserTest.createDatabaseAdmin(
        elementaryUnit.id,
      );
      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: fullClass.id, academic_year_id: yearAId, force: true },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should not count a soft-deleted enrollment toward capacity", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const fullClass = await ClassTest.create({
        name: "TEST_Class_Full",
        gradeId: gradeOneId,
        academicYearId: yearAId,
        capacity: 1,
      });
      const otherStudent = await StudentTest.create({
        email: "test_enroll_capacity_4@millennia21.id",
        nis: "ENR00005",
        currentGradeId: gradeOneId,
        joinGradeId: gradeOneId,
        joinAcademicYearId: yearAId,
      });

      const occupying = await TestRequest.post(
        `/api/admin/students/${otherStudent.student!.id}/enrollments`,
        { class_id: fullClass.id, academic_year_id: yearAId },
        accessToken,
      );
      const occupyingBody = await occupying.json();

      await TestRequest.patch(
        `/api/admin/students/${otherStudent.student!.id}/enrollments/delete/${occupyingBody.data.id}`,
        {},
        accessToken,
      );

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: fullClass.id, academic_year_id: yearAId },
        accessToken,
      );

      expect(response.status).toBe(200);
    });

    it("should not count a withdrawn (closed) enrollment toward capacity", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const fullClass = await ClassTest.create({
        name: "TEST_Class_Full",
        gradeId: gradeOneId,
        academicYearId: yearAId,
        capacity: 1,
      });
      const otherStudent = await StudentTest.create({
        email: "test_enroll_capacity_5@millennia21.id",
        nis: "ENR00006",
        currentGradeId: gradeOneId,
        joinGradeId: gradeOneId,
        joinAcademicYearId: yearAId,
      });

      const occupying = await TestRequest.post(
        `/api/admin/students/${otherStudent.student!.id}/enrollments`,
        { class_id: fullClass.id, academic_year_id: yearAId },
        accessToken,
      );
      const occupyingBody = await occupying.json();

      await TestRequest.patch(
        `/api/admin/students/${otherStudent.student!.id}/enrollments/${occupyingBody.data.id}/close`,
        { status: "WITHDRAWN" },
        accessToken,
      );

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: fullClass.id, academic_year_id: yearAId },
        accessToken,
      );

      expect(response.status).toBe(200);
    });

    it("should not overshoot capacity when two enrollments race for the last seat", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const fullClass = await ClassTest.create({
        name: "TEST_Class_Race",
        gradeId: gradeOneId,
        academicYearId: yearAId,
        capacity: 1,
      });
      const studentA = await StudentTest.create({
        email: "test_enroll_capacity_race_a@millennia21.id",
        nis: "ENR00007",
        currentGradeId: gradeOneId,
        joinGradeId: gradeOneId,
        joinAcademicYearId: yearAId,
      });
      const studentB = await StudentTest.create({
        email: "test_enroll_capacity_race_b@millennia21.id",
        nis: "ENR00008",
        currentGradeId: gradeOneId,
        joinGradeId: gradeOneId,
        joinAcademicYearId: yearAId,
      });

      const [responseA, responseB] = await Promise.all([
        TestRequest.post(
          `/api/admin/students/${studentA.student!.id}/enrollments`,
          { class_id: fullClass.id, academic_year_id: yearAId },
          accessToken,
        ),
        TestRequest.post(
          `/api/admin/students/${studentB.student!.id}/enrollments`,
          { class_id: fullClass.id, academic_year_id: yearAId },
          accessToken,
        ),
      ]);

      const statuses = [responseA.status, responseB.status].sort();
      expect(statuses).toEqual([200, 400]);

      const occupied = await prismaClient.studentClassEnrollment.count({
        where: {
          class_id: fullClass.id,
          enrollment_status: EnrollmentStatus.ACTIVE,
          deleted_at: null,
        },
      });
      expect(occupied).toBe(1);
    });

    it("should reject (400) transferring into a class that's at full capacity", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const fullClass = await ClassTest.create({
        name: "TEST_Class_Full",
        gradeId: gradeOneId,
        academicYearId: yearAId,
        capacity: 1,
      });
      const otherStudent = await StudentTest.create({
        email: "test_enroll_capacity_6@millennia21.id",
        nis: "ENR00007",
        currentGradeId: gradeOneId,
        joinGradeId: gradeOneId,
        joinAcademicYearId: yearAId,
      });

      await TestRequest.post(
        `/api/admin/students/${otherStudent.student!.id}/enrollments`,
        { class_id: fullClass.id, academic_year_id: yearAId },
        accessToken,
      );

      const created = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const createdBody = await created.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${createdBody.data.id}/transfer`,
        { class_id: fullClass.id },
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/students/:id/enrollments/:enrollmentId/promote", () => {
    it("should promote a student to a new academic year/grade/class", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        {
          class_id: classGrade1YearA,
          academic_year_id: yearAId,
          start_date: "2025-07-15T00:00:00.000Z",
        },
        accessToken,
      );
      const created = await createResponse.json();

      const effectiveDate = "2026-07-01T00:00:00.000Z";
      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/promote`,
        {
          class_id: classGrade2YearB,
          academic_year_id: yearBId,
          grade_id: gradeTwoId,
          effective_date: effectiveDate,
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.academic_year.id).toBe(yearBId);
      expect(body.data.class.id).toBe(classGrade2YearB);
      expect(body.data.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
      expect(body.data.start_date).toBe(effectiveDate);
      expect(body.data.promoted_from_enrollment_id).toBe(created.data.id);

      const oldEnrollment = await prismaClient.studentClassEnrollment.findUniqueOrThrow(
        { where: { id: created.data.id } },
      );
      expect(oldEnrollment.enrollment_status).toBe(EnrollmentStatus.COMPLETED);
      expect(oldEnrollment.end_date?.toISOString()).toBe(effectiveDate);

      const student = await prismaClient.student.findUniqueOrThrow({
        where: { id: studentId },
      });
      expect(student.current_grade_id).toBe(gradeTwoId);
      expect(student.current_class_id).toBe(classGrade2YearB);

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.PROMOTE_STUDENT, admin_id: admin.id },
      });
      expect(auditLog.entity_type).toBe("StudentClassEnrollment");
      expect(auditLog.old_values).toMatchObject({ academic_year_id: yearAId });
      expect(auditLog.new_values).toMatchObject({ academic_year_id: yearBId });
    });

    it("should allow promoting into an UPCOMING class prepped ahead for next year", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/promote`,
        {
          class_id: classGrade2YearBUpcoming,
          academic_year_id: yearBId,
          grade_id: gradeTwoId,
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.class.id).toBe(classGrade2YearBUpcoming);
      expect(body.data.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
    });

    it("should reject (403) DATABASE_ADMIN promoting into a class outside their unit", async () => {
      const superAdmin = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        superAdmin.accessToken,
      );
      const created = await createResponse.json();

      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/promote`,
        {
          class_id: classGrade2YearB,
          academic_year_id: yearBId,
          grade_id: gradeTwoId,
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(403);
      expect(body.errors).toContain("unit scope");
    });

    it("should reject (400) promoting to an effective_date before the current enrollment's start date", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        {
          class_id: classGrade1YearA,
          academic_year_id: yearAId,
          start_date: "2025-07-15T00:00:00.000Z",
        },
        accessToken,
      );
      const created = await createResponse.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/promote`,
        {
          class_id: classGrade2YearB,
          academic_year_id: yearBId,
          grade_id: gradeTwoId,
          effective_date: "2025-01-01T00:00:00.000Z",
        },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (404) promoting a nonexistent enrollment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/nonexistent-id/promote`,
        {
          class_id: classGrade2YearB,
          academic_year_id: yearBId,
          grade_id: gradeTwoId,
        },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (404) promoting a soft-deleted student's enrollment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      await TestRequest.patch(
        `/api/admin/students/delete/${studentId}`,
        {},
        accessToken,
      );

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/promote`,
        {
          class_id: classGrade2YearB,
          academic_year_id: yearBId,
          grade_id: gradeTwoId,
        },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (400) promoting to a grade lower than the student's join grade", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      const kindergarten = await prismaClient.grade.findFirstOrThrow({
        where: { name: "Kindergarten K2" },
      });
      const kinderClass = await ClassTest.create({
        name: "TEST_Class_Kinder",
        gradeId: kindergarten.id,
        academicYearId: yearBId,
        status: ClassStatus.ACTIVE,
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/promote`,
        {
          class_id: kinderClass.id,
          academic_year_id: yearBId,
          grade_id: kindergarten.id,
        },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) promoting an already-completed enrollment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/promote`,
        {
          class_id: classGrade2YearB,
          academic_year_id: yearBId,
          grade_id: gradeTwoId,
        },
        accessToken,
      );

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/promote`,
        {
          class_id: classGrade2YearB,
          academic_year_id: yearBId,
          grade_id: gradeTwoId,
        },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) promoting to the same grade as the current enrollment without is_retention", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const classGrade1YearB = await ClassTest.create({
        name: "TEST_Class_Grade1_YearB",
        gradeId: gradeOneId,
        academicYearId: yearBId,
        status: ClassStatus.ACTIVE,
      });

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/promote`,
        {
          class_id: classGrade1YearB.id,
          academic_year_id: yearBId,
          grade_id: gradeOneId,
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
    });

    it("should allow promoting to the same grade when is_retention is set with a reason, and persist it", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const classGrade1YearB = await ClassTest.create({
        name: "TEST_Class_Grade1_YearB",
        gradeId: gradeOneId,
        academicYearId: yearBId,
        status: ClassStatus.ACTIVE,
      });

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/promote`,
        {
          class_id: classGrade1YearB.id,
          academic_year_id: yearBId,
          grade_id: gradeOneId,
          is_retention: true,
          retention_reason: "Did not pass final exams",
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.is_retention).toBe(true);
      expect(body.data.retention_reason).toBe("Did not pass final exams");

      const student = await prismaClient.student.findUniqueOrThrow({
        where: { id: studentId },
      });
      expect(student.current_grade_id).toBe(gradeOneId);
    });

    it("should reject (400) is_retention without a retention_reason", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const classGrade1YearB = await ClassTest.create({
        name: "TEST_Class_Grade1_YearB",
        gradeId: gradeOneId,
        academicYearId: yearBId,
        status: ClassStatus.ACTIVE,
      });

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/promote`,
        {
          class_id: classGrade1YearB.id,
          academic_year_id: yearBId,
          grade_id: gradeOneId,
          is_retention: true,
        },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) is_retention into a class in the same academic year as the current enrollment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/promote`,
        {
          class_id: classGrade1YearAAlt,
          academic_year_id: yearAId,
          grade_id: gradeOneId,
          is_retention: true,
          retention_reason: "Did not pass final exams",
        },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) is_retention into a different grade even in a later academic year", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/promote`,
        {
          class_id: classGrade2YearB,
          academic_year_id: yearBId,
          grade_id: gradeTwoId,
          is_retention: true,
          retention_reason: "Did not pass final exams",
        },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) an effective_date outside the new academic year's date range", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const yearC = await prismaClient.academicYear.create({
        data: {
          name: "TEST_ENROLL_YEAR_C",
          status: AcademicYearStatus.UPCOMING,
          start_date: new Date("2027-07-01"),
          end_date: new Date("2028-06-30"),
        },
      });
      const classGrade2YearC = await ClassTest.create({
        name: "TEST_Class_Grade2_YearC",
        gradeId: gradeTwoId,
        academicYearId: yearC.id,
        status: ClassStatus.ACTIVE,
      });

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/promote`,
        {
          class_id: classGrade2YearC.id,
          academic_year_id: yearC.id,
          grade_id: gradeTwoId,
          effective_date: "2026-01-01T00:00:00.000Z",
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/students/:id/enrollments/:enrollmentId/transfer", () => {
    it("should transfer a student to another class in the same academic year", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/transfer`,
        { class_id: classGrade1YearAAlt },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.id).toBe(created.data.id);
      expect(body.data.class.id).toBe(classGrade1YearAAlt);
      expect(body.data.academic_year.id).toBe(yearAId);

      const enrollments = await prismaClient.studentClassEnrollment.findMany({
        where: { student_id: studentId },
      });
      expect(enrollments.length).toBe(1);

      const student = await prismaClient.student.findUniqueOrThrow({
        where: { id: studentId },
      });
      expect(student.current_class_id).toBe(classGrade1YearAAlt);

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: {
          action: AuditAction.TRANSFER_STUDENT_CLASS,
          admin_id: admin.id,
        },
      });
      expect(auditLog.entity_type).toBe("StudentClassEnrollment");
      expect(auditLog.new_values).toMatchObject({
        class_id: classGrade1YearAAlt,
      });
    });

    it("should reject (404) transferring a nonexistent enrollment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/nonexistent-id/transfer`,
        { class_id: classGrade1YearAAlt },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (403) DATABASE_ADMIN transferring into a class outside their unit", async () => {
      const superAdmin = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        superAdmin.accessToken,
      );
      const created = await createResponse.json();

      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/transfer`,
        { class_id: classGrade1YearAAlt },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(403);
      expect(body.errors).toContain("unit scope");
    });

    it("should reject (404) transferring a soft-deleted student's enrollment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      await TestRequest.patch(
        `/api/admin/students/delete/${studentId}`,
        {},
        accessToken,
      );

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/transfer`,
        { class_id: classGrade1YearAAlt },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should allow transferring into a class of a different grade within the same academic year, updating the student's current grade", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/transfer`,
        { class_id: classGrade2YearA },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.class.id).toBe(classGrade2YearA);

      const enrollment = await prismaClient.studentClassEnrollment.findUniqueOrThrow(
        { where: { id: created.data.id } },
      );
      expect(enrollment.grade_level).toBe("Grade 2");

      const student = await prismaClient.student.findUniqueOrThrow({
        where: { id: studentId },
      });
      expect(student.current_grade_id).toBe(gradeTwoId);
    });

    it("should reject (400) transferring into a class of a different academic year", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/transfer`,
        { class_id: classGrade2YearB },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) transferring into a class of a grade lower than the student's join grade", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      const kindergarten = await prismaClient.grade.findFirstOrThrow({
        where: { name: "Kindergarten K2" },
      });
      const kinderClassYearA = await ClassTest.create({
        name: "TEST_Class_Kinder_YearA",
        gradeId: kindergarten.id,
        academicYearId: yearAId,
        status: ClassStatus.ACTIVE,
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/transfer`,
        { class_id: kinderClassYearA.id },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) transferring a non-active enrollment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/close`,
        { status: "WITHDRAWN" },
        accessToken,
      );

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/transfer`,
        { class_id: classGrade1YearAAlt },
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/enrollments/bulk/transfer", () => {
    it("should transfer multiple enrollments in one request, reporting per-item success/failure", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const secondStudent = await StudentTest.create({
        email: "test_enroll_bulk_transfer@millennia21.id",
        nis: "ENR00002",
        status: StudentStatus.REGISTERED,
        currentGradeId: gradeOneId,
        joinGradeId: gradeOneId,
        joinAcademicYearId: yearAId,
      });

      const firstCreate = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const firstEnrollment = await firstCreate.json();

      const secondCreate = await TestRequest.post(
        `/api/admin/students/${secondStudent.student!.id}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const secondEnrollment = await secondCreate.json();

      const response = await TestRequest.patch(
        "/api/admin/enrollments/bulk/transfer",
        {
          enrollment_ids: [firstEnrollment.data.id, secondEnrollment.data.id],
          class_id: classGrade1YearAAlt,
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.total_count).toBe(2);
      expect(body.data.success_count).toBe(2);
      expect(body.data.failed_count).toBe(0);

      const updated = await prismaClient.studentClassEnrollment.findMany({
        where: {
          id: { in: [firstEnrollment.data.id, secondEnrollment.data.id] },
        },
      });
      expect(updated.every((row) => row.class_id === classGrade1YearAAlt)).toBe(
        true,
      );
    });

    it("should report a per-item failure without failing the whole batch", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      const response = await TestRequest.patch(
        "/api/admin/enrollments/bulk/transfer",
        {
          enrollment_ids: [created.data.id, "nonexistent-enrollment-id"],
          class_id: classGrade1YearAAlt,
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.total_count).toBe(2);
      expect(body.data.success_count).toBe(1);
      expect(body.data.failed_count).toBe(1);
      const failedItem = body.data.items.find(
        (item: { status: string }) => item.status === "FAILED",
      );
      expect(failedItem.error).toContain("not found");
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.patch(
        "/api/admin/enrollments/bulk/transfer",
        { enrollment_ids: ["whatever"], class_id: classGrade1YearAAlt },
        accessToken,
      );

      expect(response.status).toBe(403);
    });
  });

  describe("PATCH /api/admin/students/:id/enrollments/:enrollmentId/close", () => {
    it("should close an enrollment as WITHDRAWN and clear current_class_id", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        {
          class_id: classGrade1YearA,
          academic_year_id: yearAId,
          start_date: "2025-07-15T00:00:00.000Z",
        },
        accessToken,
      );
      const created = await createResponse.json();

      const endDate = "2025-12-01T00:00:00.000Z";
      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/close`,
        { status: "WITHDRAWN", end_date: endDate },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.enrollment_status).toBe(EnrollmentStatus.WITHDRAWN);
      expect(body.data.end_date).toBe(endDate);

      const student = await prismaClient.student.findUniqueOrThrow({
        where: { id: studentId },
      });
      expect(student.current_class_id).toBeNull();
      // Closing the only active enrollment can't leave the student ACTIVE
      // (ACTIVE requires an active enrollment) - it follows the enrollment's
      // own closing status instead of staying stuck.
      expect(student.status).toBe(StudentStatus.WITHDRAWN);

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: {
          action: AuditAction.WITHDRAW_STUDENT_ENROLLMENT,
          admin_id: admin.id,
        },
      });
      expect(auditLog.entity_type).toBe("StudentClassEnrollment");
      expect(auditLog.new_values).toMatchObject({
        enrollment_status: EnrollmentStatus.WITHDRAWN,
      });
    });

    it("should close an enrollment as TRANSFERRED", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/close`,
        { status: "TRANSFERRED" },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.enrollment_status).toBe(EnrollmentStatus.TRANSFERRED);

      const student = await prismaClient.student.findUniqueOrThrow({
        where: { id: studentId },
      });
      expect(student.status).toBe(StudentStatus.TRANSFERRED);
    });

    it("should close an enrollment as COMPLETED, set the student GRADUATED, and store graduation_grade/leave_year", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/close`,
        {
          status: "COMPLETED",
          graduation_grade: "Grade 1",
          leave_year: "2025/2026",
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.enrollment_status).toBe(EnrollmentStatus.COMPLETED);

      const student = await prismaClient.student.findUniqueOrThrow({
        where: { id: studentId },
      });
      expect(student.status).toBe(StudentStatus.GRADUATED);
      expect(student.graduation_grade).toBe("Grade 1");
      expect(student.leave_year).toBe("2025/2026");
    });

    it("should keep the student ACTIVE when closing one of two active enrollments", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      // Grade 1 in Year B - same grade as the student (required to enroll),
      // different year from classGrade1YearA (a student can only have one
      // active enrollment per academic year).
      const classGrade1YearB = await ClassTest.create({
        name: "TEST_Class_A_YearB",
        gradeId: gradeOneId,
        academicYearId: yearBId,
        status: ClassStatus.ACTIVE,
      });

      const first = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const firstBody = await first.json();
      const second = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearB.id, academic_year_id: yearBId },
        accessToken,
      );
      expect(second.status).toBe(200);

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${firstBody.data.id}/close`,
        { status: "WITHDRAWN" },
        accessToken,
      );
      expect(response.status).toBe(200);

      const student = await prismaClient.student.findUniqueOrThrow({
        where: { id: studentId },
      });
      expect(student.status).toBe(StudentStatus.ACTIVE);
    });

    it("should reject (400) an end_date before the enrollment's start date", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        {
          class_id: classGrade1YearA,
          academic_year_id: yearAId,
          start_date: "2025-07-15T00:00:00.000Z",
        },
        accessToken,
      );
      const created = await createResponse.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/close`,
        { status: "WITHDRAWN", end_date: "2025-01-01T00:00:00.000Z" },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (404) closing a nonexistent enrollment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/nonexistent-id/close`,
        { status: "WITHDRAWN" },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (403) DATABASE_ADMIN closing an enrollment outside their unit", async () => {
      const superAdmin = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        superAdmin.accessToken,
      );
      const created = await createResponse.json();

      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/close`,
        { status: "WITHDRAWN" },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(403);
      expect(body.errors).toContain("unit scope");
    });

    it("should reject (404) closing a soft-deleted student's enrollment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      await TestRequest.patch(
        `/api/admin/students/delete/${studentId}`,
        {},
        accessToken,
      );

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/close`,
        { status: "WITHDRAWN" },
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (400) closing a non-active enrollment twice", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/close`,
        { status: "WITHDRAWN" },
        accessToken,
      );
      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/close`,
        { status: "WITHDRAWN" },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) an end_date outside the enrollment's own academic year date range", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const yearC = await prismaClient.academicYear.create({
        data: {
          name: "TEST_ENROLL_YEAR_C",
          status: AcademicYearStatus.UPCOMING,
          start_date: new Date("2027-07-01"),
          end_date: new Date("2028-06-30"),
        },
      });
      const classGrade1YearC = await ClassTest.create({
        name: "TEST_Class_Grade1_YearC",
        gradeId: gradeOneId,
        academicYearId: yearC.id,
        status: ClassStatus.ACTIVE,
      });

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        {
          class_id: classGrade1YearC.id,
          academic_year_id: yearC.id,
          start_date: "2027-08-01T00:00:00.000Z",
        },
        accessToken,
      );
      const created = await createResponse.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/close`,
        { status: "WITHDRAWN", end_date: "2029-01-01T00:00:00.000Z" },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
    });

    it("should default a blank end_date to today, clamped into the enrollment's own academic year", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const yearD = await prismaClient.academicYear.create({
        data: {
          name: "TEST_ENROLL_YEAR_D",
          status: AcademicYearStatus.UPCOMING,
          start_date: new Date("2027-07-01"),
          end_date: new Date("2028-06-30"),
        },
      });
      const classGrade1YearD = await ClassTest.create({
        name: "TEST_Class_Grade1_YearD",
        gradeId: gradeOneId,
        academicYearId: yearD.id,
        status: ClassStatus.ACTIVE,
      });

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        {
          class_id: classGrade1YearD.id,
          academic_year_id: yearD.id,
          start_date: "2027-08-01T00:00:00.000Z",
        },
        accessToken,
      );
      const created = await createResponse.json();

      // No end_date given - today's real date falls well before 2027-07-01,
      // which used to make close() reject a request the admin never
      // supplied a date for (see resolveDefaultCloseEndDate).
      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/close`,
        { status: "WITHDRAWN" },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      // Clamped to the enrollment's own start_date, not the academic year's -
      // the enrollment started later than the year itself (mid-year
      // admission), so that's the real floor.
      expect(body.data.end_date).toBe("2027-08-01T00:00:00.000Z");
    });
  });

  describe("PATCH /api/admin/enrollments/bulk/close", () => {
    it("should close multiple enrollments in one request, reporting per-item success/failure", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const secondStudent = await StudentTest.create({
        email: "test_enroll_bulk_close@millennia21.id",
        nis: "ENR00003",
        status: StudentStatus.REGISTERED,
        currentGradeId: gradeOneId,
        joinGradeId: gradeOneId,
        joinAcademicYearId: yearAId,
      });

      const firstCreate = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const firstEnrollment = await firstCreate.json();

      const secondCreate = await TestRequest.post(
        `/api/admin/students/${secondStudent.student!.id}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const secondEnrollment = await secondCreate.json();

      const response = await TestRequest.patch(
        "/api/admin/enrollments/bulk/close",
        {
          enrollment_ids: [firstEnrollment.data.id, secondEnrollment.data.id],
          status: "WITHDRAWN",
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.total_count).toBe(2);
      expect(body.data.success_count).toBe(2);
      expect(body.data.failed_count).toBe(0);

      const updated = await prismaClient.studentClassEnrollment.findMany({
        where: {
          id: { in: [firstEnrollment.data.id, secondEnrollment.data.id] },
        },
      });
      expect(
        updated.every(
          (row) => row.enrollment_status === EnrollmentStatus.WITHDRAWN,
        ),
      ).toBe(true);
    });

    it("should close multiple enrollments as COMPLETED and graduate every student with the same grade/year", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const secondStudent = await StudentTest.create({
        email: "test_enroll_bulk_graduate@millennia21.id",
        nis: "ENR00004",
        status: StudentStatus.REGISTERED,
        currentGradeId: gradeOneId,
        joinGradeId: gradeOneId,
        joinAcademicYearId: yearAId,
      });

      const firstCreate = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const firstEnrollment = await firstCreate.json();

      const secondCreate = await TestRequest.post(
        `/api/admin/students/${secondStudent.student!.id}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const secondEnrollment = await secondCreate.json();

      const response = await TestRequest.patch(
        "/api/admin/enrollments/bulk/close",
        {
          enrollment_ids: [firstEnrollment.data.id, secondEnrollment.data.id],
          status: "COMPLETED",
          graduation_grade: "Grade 1",
          leave_year: "2025/2026",
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.success_count).toBe(2);

      const students = await prismaClient.student.findMany({
        where: { id: { in: [studentId, secondStudent.student!.id] } },
      });
      expect(
        students.every(
          (row) =>
            row.status === StudentStatus.GRADUATED &&
            row.graduation_grade === "Grade 1" &&
            row.leave_year === "2025/2026",
        ),
      ).toBe(true);
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.patch(
        "/api/admin/enrollments/bulk/close",
        { enrollment_ids: ["whatever"], status: "WITHDRAWN" },
        accessToken,
      );

      expect(response.status).toBe(403);
    });
  });

  describe("GET /api/admin/students/:id/enrollments", () => {
    it("should list a student's enrollment history across academic years", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      await EnrollmentTest.create({
        studentId,
        classId: classGrade1YearA,
        academicYearId: yearAId,
        gradeLevel: "Grade 1",
        status: EnrollmentStatus.COMPLETED,
        endDate: new Date("2026-06-01"),
      });
      await EnrollmentTest.create({
        studentId,
        classId: classGrade2YearB,
        academicYearId: yearBId,
        gradeLevel: "Grade 2",
        status: EnrollmentStatus.ACTIVE,
      });

      const response = await TestRequest.get(
        `/api/admin/students/${studentId}/enrollments`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(2);
      expect(body.data[0].academic_year.id).toBe(yearBId);
      expect(body.data[1].academic_year.id).toBe(yearAId);
    });

    it("should reject (404) history for a nonexistent student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.get(
        `/api/admin/students/nonexistent-id/enrollments`,
        accessToken,
      );

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/admin/enrollments (search / roster)", () => {
    it("should find students enrolled in a given academic year regardless of join year", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      await EnrollmentTest.create({
        studentId,
        classId: classGrade1YearA,
        academicYearId: yearAId,
        gradeLevel: "Grade 1",
      });

      const response = await TestRequest.get(
        `/api/admin/enrollments?academic_year_id=${yearAId}`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].student.id).toBe(studentId);
      expect(body.data[0].academic_year.id).toBe(yearAId);
    });

    it("should filter a class roster by class_id + academic_year_id", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      await EnrollmentTest.create({
        studentId,
        classId: classGrade1YearA,
        academicYearId: yearAId,
        gradeLevel: "Grade 1",
      });

      const response = await TestRequest.get(
        `/api/admin/enrollments?class_id=${classGrade1YearAAlt}&academic_year_id=${yearAId}`,
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(0);
    });
  });

  describe("PATCH /api/admin/students/:id/enrollments/delete/:enrollmentId", () => {
    it("should soft-delete an ACTIVE enrollment and clear current_class_id when it matches", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/delete/${created.data.id}`,
        {},
        accessToken,
      );
      logger.debug(await response.json());

      expect(response.status).toBe(200);

      const deleted = await prismaClient.studentClassEnrollment.findUniqueOrThrow(
        { where: { id: created.data.id } },
      );
      expect(deleted.deleted_at).not.toBeNull();

      const student = await prismaClient.student.findUniqueOrThrow({
        where: { id: studentId },
      });
      expect(student.current_class_id).toBeNull();
      // Removing the only ACTIVE enrollment record can't leave the student
      // ACTIVE either. Unlike close(), this is an administrative undo (not
      // a withdrawal/transfer with a "reason"), so it falls back to
      // REGISTERED, the same state as before their first enrollment.
      expect(student.status).toBe(StudentStatus.REGISTERED);

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.DELETE_ENROLLMENT, admin_id: admin.id },
      });
      expect(auditLog.entity_type).toBe("StudentClassEnrollment");
    });

    it("should not clear current_class_id when deleting an enrollment that is no longer current", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/promote`,
        {
          class_id: classGrade2YearB,
          academic_year_id: yearBId,
          grade_id: gradeTwoId,
        },
        accessToken,
      );

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/delete/${created.data.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(200);

      const student = await prismaClient.student.findUniqueOrThrow({
        where: { id: studentId },
      });
      expect(student.current_class_id).toBe(classGrade2YearB);
    });

    it("should reactivate the promoted-from enrollment when dropping a mistaken promote", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        {
          class_id: classGrade1YearA,
          academic_year_id: yearAId,
          start_date: "2025-07-15T00:00:00.000Z",
        },
        accessToken,
      );
      const created = await createResponse.json();

      const promoteResponse = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/promote`,
        {
          class_id: classGrade2YearB,
          academic_year_id: yearBId,
          grade_id: gradeTwoId,
        },
        accessToken,
      );
      const promoted = await promoteResponse.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/delete/${promoted.data.id}`,
        {},
        accessToken,
      );
      logger.debug(await response.json());

      expect(response.status).toBe(200);

      const droppedPromotion =
        await prismaClient.studentClassEnrollment.findUniqueOrThrow({
          where: { id: promoted.data.id },
        });
      expect(droppedPromotion.deleted_at).not.toBeNull();

      const reactivated =
        await prismaClient.studentClassEnrollment.findUniqueOrThrow({
          where: { id: created.data.id },
        });
      expect(reactivated.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
      expect(reactivated.end_date).toBeNull();

      const student = await prismaClient.student.findUniqueOrThrow({
        where: { id: studentId },
      });
      expect(student.status).toBe(StudentStatus.ACTIVE);
      expect(student.current_class_id).toBe(classGrade1YearA);
      expect(student.current_grade_id).toBe(gradeOneId);

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: {
          action: AuditAction.ROLLBACK_PROMOTE_ENROLLMENT,
          admin_id: admin.id,
        },
      });
      expect(auditLog.entity_type).toBe("StudentClassEnrollment");
    });

    it("should reject (403) for VIEWER and a DATABASE_ADMIN outside their unit", async () => {
      const created = await EnrollmentTest.create({
        studentId,
        classId: classGrade1YearA,
        academicYearId: yearAId,
        gradeLevel: "Grade 1",
      });

      const { accessToken: viewerToken } = await AdminUserTest.createViewer();
      const viewerResponse = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/delete/${created.id}`,
        {},
        viewerToken,
      );
      expect(viewerResponse.status).toBe(403);

      const { accessToken: dbAdminToken } =
        await AdminUserTest.createDatabaseAdmin();
      const dbAdminResponse = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/delete/${created.id}`,
        {},
        dbAdminToken,
      );
      expect(dbAdminResponse.status).toBe(403);
    });

    it("should allow a DATABASE_ADMIN with can_write_data to remove an enrollment within their unit", async () => {
      const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
        where: { name: "Elementary" },
      });
      const { accessToken } = await AdminUserTest.createDatabaseAdmin(
        elementaryUnit.id,
      );

      const created = await EnrollmentTest.create({
        studentId,
        classId: classGrade1YearA,
        academicYearId: yearAId,
        gradeLevel: "Grade 1",
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/delete/${created.id}`,
        {},
        accessToken,
      );
      logger.debug(await response.json());

      expect(response.status).toBe(200);

      const deleted = await prismaClient.studentClassEnrollment.findUniqueOrThrow(
        { where: { id: created.id } },
      );
      expect(deleted.deleted_at).not.toBeNull();
    });

    it("should reject (404) deleting a nonexistent enrollment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/delete/nonexistent-id`,
        {},
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (400) deleting an already-deleted enrollment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const created = await EnrollmentTest.create({
        studentId,
        classId: classGrade1YearA,
        academicYearId: yearAId,
        gradeLevel: "Grade 1",
      });

      await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/delete/${created.id}`,
        {},
        accessToken,
      );
      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/delete/${created.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/students/:id/enrollments/restore/:enrollmentId", () => {
    it("should restore a soft-deleted enrollment without touching current_class_id", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/delete/${created.data.id}`,
        {},
        accessToken,
      );

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/restore/${created.data.id}`,
        {},
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.id).toBe(created.data.id);

      const restored = await prismaClient.studentClassEnrollment.findUniqueOrThrow(
        { where: { id: created.data.id } },
      );
      expect(restored.deleted_at).toBeNull();

      const student = await prismaClient.student.findUniqueOrThrow({
        where: { id: studentId },
      });
      expect(student.current_class_id).toBeNull();

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.RESTORE_ENROLLMENT, admin_id: admin.id },
      });
      expect(auditLog.entity_type).toBe("StudentClassEnrollment");
    });

    it("should reject (403) for VIEWER and DATABASE_ADMIN", async () => {
      const created = await EnrollmentTest.create({
        studentId,
        classId: classGrade1YearA,
        academicYearId: yearAId,
        gradeLevel: "Grade 1",
        deletedAt: new Date(),
      });

      const { accessToken: viewerToken } = await AdminUserTest.createViewer();
      const viewerResponse = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/restore/${created.id}`,
        {},
        viewerToken,
      );
      expect(viewerResponse.status).toBe(403);

      const { accessToken: dbAdminToken } =
        await AdminUserTest.createDatabaseAdmin();
      const dbAdminResponse = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/restore/${created.id}`,
        {},
        dbAdminToken,
      );
      expect(dbAdminResponse.status).toBe(403);
    });

    it("should reject (404) restoring a nonexistent enrollment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/restore/nonexistent-id`,
        {},
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (400) restoring an enrollment that isn't deleted", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const created = await EnrollmentTest.create({
        studentId,
        classId: classGrade1YearA,
        academicYearId: yearAId,
        gradeLevel: "Grade 1",
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/restore/${created.id}`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/students/:id/enrollments/:enrollmentId/reactivate", () => {
    it("should reactivate a graduated enrollment back to ACTIVE and clear the student's graduation fields", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/close`,
        {
          status: "COMPLETED",
          graduation_grade: "Grade 1",
          leave_year: "2025/2026",
        },
        accessToken,
      );

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/reactivate`,
        {},
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
      expect(body.data.end_date).toBeNull();

      const student = await prismaClient.student.findUniqueOrThrow({
        where: { id: studentId },
      });
      expect(student.status).toBe(StudentStatus.ACTIVE);
      expect(student.current_class_id).toBe(classGrade1YearA);
      expect(student.graduation_grade).toBeNull();
      expect(student.leave_year).toBeNull();

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.REACTIVATE_ENROLLMENT, admin_id: admin.id },
      });
      expect(auditLog.entity_type).toBe("StudentClassEnrollment");
    });

    it("should reject (403) DATABASE_ADMIN reactivating an enrollment outside their unit", async () => {
      const superAdmin = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        superAdmin.accessToken,
      );
      const created = await createResponse.json();

      await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/close`,
        { status: "COMPLETED", graduation_grade: "Grade 1", leave_year: "2026" },
        superAdmin.accessToken,
      );

      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/reactivate`,
        {},
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(403);
      expect(body.errors).toContain("unit scope");
    });

    it("should reject (400) reactivating an already-active enrollment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/reactivate`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) reactivating while the student is already active in a different class", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/close`,
        { status: "COMPLETED", graduation_grade: "Grade 1", leave_year: "2026" },
        accessToken,
      );

      // Simulate the student already being active elsewhere (e.g. re-enrolled
      // through a different path) rather than juggling a second real
      // enrollment that'd need its own conflict-free academic year/class
      // combo just to exist alongside the first.
      await prismaClient.student.update({
        where: { id: studentId },
        data: {
          current_class_id: classGrade1YearAAlt,
          status: StudentStatus.ACTIVE,
        },
      });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${created.data.id}/reactivate`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (404) reactivating a nonexistent enrollment", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/nonexistent-id/reactivate`,
        {},
        accessToken,
      );

      expect(response.status).toBe(404);
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/whatever/reactivate`,
        {},
        accessToken,
      );

      expect(response.status).toBe(403);
    });
  });

  describe("PATCH /api/admin/enrollments/bulk/reactivate", () => {
    it("should reactivate multiple closed enrollments in one request, reporting per-item success/failure", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const secondStudent = await StudentTest.create({
        email: "test_enroll_bulk_reactivate@millennia21.id",
        nis: "ENR00006",
        status: StudentStatus.REGISTERED,
        currentGradeId: gradeOneId,
        joinGradeId: gradeOneId,
        joinAcademicYearId: yearAId,
      });

      const firstCreate = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const firstEnrollment = await firstCreate.json();
      await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${firstEnrollment.data.id}/close`,
        { status: "WITHDRAWN" },
        accessToken,
      );

      const secondCreate = await TestRequest.post(
        `/api/admin/students/${secondStudent.student!.id}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const secondEnrollment = await secondCreate.json();
      // Left ACTIVE on purpose - reactivating an already-active enrollment
      // should report as a per-item failure, not fail the whole batch.

      const response = await TestRequest.patch(
        "/api/admin/enrollments/bulk/reactivate",
        {
          enrollment_ids: [firstEnrollment.data.id, secondEnrollment.data.id],
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.total_count).toBe(2);
      expect(body.data.success_count).toBe(1);
      expect(body.data.failed_count).toBe(1);

      const reactivated = await prismaClient.studentClassEnrollment.findUniqueOrThrow(
        { where: { id: firstEnrollment.data.id } },
      );
      expect(reactivated.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.patch(
        "/api/admin/enrollments/bulk/reactivate",
        { enrollment_ids: ["whatever"] },
        accessToken,
      );

      expect(response.status).toBe(403);
    });
  });

  describe("PATCH /api/admin/enrollments/bulk/delete", () => {
    it("should drop multiple enrollments in one request - reactivating a promoted one, plain-removing a first one", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const secondStudent = await StudentTest.create({
        email: "test_enroll_bulk_drop@millennia21.id",
        nis: "ENR00005",
        status: StudentStatus.REGISTERED,
        currentGradeId: gradeOneId,
        joinGradeId: gradeOneId,
        joinAcademicYearId: yearAId,
      });

      const firstCreate = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const firstEnrollment = await firstCreate.json();
      const firstPromote = await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/${firstEnrollment.data.id}/promote`,
        {
          class_id: classGrade2YearB,
          academic_year_id: yearBId,
          grade_id: gradeTwoId,
        },
        accessToken,
      );
      const firstPromoted = await firstPromote.json();

      const secondCreate = await TestRequest.post(
        `/api/admin/students/${secondStudent.student!.id}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const secondEnrollment = await secondCreate.json();

      const response = await TestRequest.patch(
        "/api/admin/enrollments/bulk/delete",
        {
          enrollment_ids: [firstPromoted.data.id, secondEnrollment.data.id],
        },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.total_count).toBe(2);
      expect(body.data.success_count).toBe(2);
      expect(body.data.failed_count).toBe(0);

      // First: was a promote, so dropping it reactivates what it was
      // promoted from.
      const firstOldEnrollment =
        await prismaClient.studentClassEnrollment.findUniqueOrThrow({
          where: { id: firstEnrollment.data.id },
        });
      expect(firstOldEnrollment.enrollment_status).toBe(
        EnrollmentStatus.ACTIVE,
      );

      // Second: a first enrollment, nothing to reactivate - falls back to
      // REGISTERED like a plain drop always has.
      const secondStudentRow = await prismaClient.student.findUniqueOrThrow({
        where: { id: secondStudent.student!.id },
      });
      expect(secondStudentRow.status).toBe(StudentStatus.REGISTERED);
      expect(secondStudentRow.current_class_id).toBeNull();
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.patch(
        "/api/admin/enrollments/bulk/delete",
        { enrollment_ids: ["whatever"] },
        accessToken,
      );

      expect(response.status).toBe(403);
    });
  });

  describe("is_deleted filters on history and search", () => {
    it("should exclude soft-deleted enrollments from history by default and include with is_deleted=true", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const createResponse = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );
      const created = await createResponse.json();

      await TestRequest.patch(
        `/api/admin/students/${studentId}/enrollments/delete/${created.data.id}`,
        {},
        accessToken,
      );

      const defaultView = await TestRequest.get(
        `/api/admin/students/${studentId}/enrollments`,
        accessToken,
      );
      expect((await defaultView.json()).data.length).toBe(0);

      const deletedView = await TestRequest.get(
        `/api/admin/students/${studentId}/enrollments?is_deleted=true`,
        accessToken,
      );
      const deletedBody = await deletedView.json();
      expect(deletedBody.data.length).toBe(1);
      expect(deletedBody.data[0].id).toBe(created.data.id);
    });

    it("should exclude soft-deleted enrollments from search by default and include with is_deleted=true", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const created = await EnrollmentTest.create({
        studentId,
        classId: classGrade1YearA,
        academicYearId: yearAId,
        gradeLevel: "Grade 1",
        deletedAt: new Date(),
      });

      const defaultView = await TestRequest.get(
        `/api/admin/enrollments?academic_year_id=${yearAId}`,
        accessToken,
      );
      expect((await defaultView.json()).data.length).toBe(0);

      const deletedView = await TestRequest.get(
        `/api/admin/enrollments?academic_year_id=${yearAId}&is_deleted=true`,
        accessToken,
      );
      const deletedBody = await deletedView.json();
      expect(deletedBody.data.length).toBe(1);
      expect(deletedBody.data[0].id).toBe(created.id);
    });
  });
});
