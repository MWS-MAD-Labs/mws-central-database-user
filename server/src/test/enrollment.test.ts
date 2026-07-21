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
  let classGrade2YearB: string;
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
    const classB = await ClassTest.create({
      name: "TEST_Class_B",
      gradeId: gradeTwoId,
      academicYearId: yearBId,
      status: ClassStatus.ACTIVE,
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
    classGrade2YearB = classB.id;
    classGrade2YearA = classGrade2InYearA.id;

    const student = await StudentTest.create({
      email: "test_enroll_1@millennia21.id",
      nis: "ENR00001",
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

      const student = await prismaClient.student.findUniqueOrThrow({
        where: { id: studentId },
      });
      expect(student.current_class_id).toBe(classGrade1YearA);

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
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();

      const response = await TestRequest.post(
        `/api/admin/students/${studentId}/enrollments`,
        { class_id: classGrade1YearA, academic_year_id: yearAId },
        accessToken,
      );

      expect(response.status).toBe(200);
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

    it("should reject (400) transferring into a class of a different grade", async () => {
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
});
