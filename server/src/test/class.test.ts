import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  AcademicYearTest,
  ClassTest,
  EnrollmentTest,
  GradeTest,
  EmployeeTest,
  MasterDataTest,
  StudentTest,
  AuditLogTest,
} from "./test-utils";
import {
  AcademicYearStatus,
  AuditAction,
  AuditSource,
  ClassStatus,
  ClassTeacherRole,
  EmployeeStatus,
  EnrollmentStatus,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

// Grade 1/Grade 2 (used throughout this file's teacher-assignment tests)
// both belong to the real seeded "Elementary" unit (see the Grade.unit_id
// migration/backfill) - default new teaching employees to that same unit
// so assertTeacherUnitMatchesClass doesn't reject them. Pass unitId to get
// an employee in a different unit (e.g. to test the cross-unit rejection).
async function resolveDefaultTeacherUnitId(): Promise<string> {
  const elementary = await prismaClient.masterUnit.findUniqueOrThrow({
    where: { name: "Elementary" },
  });
  return elementary.id;
}

// class-service.ts's assertHasHomeroomPosition requires the job position
// name to be exactly "Homeroom Teacher" for HOMEROOM/SUPPORTING_HOMEROOM
// assignment - this is the fixture callers use for those roles, so it
// needs the real seeded position, not a generic "TEST_"-prefixed one.
async function createTeachingEmployee(
  email: string,
  unitId?: string,
): Promise<{ id: string }> {
  const resolvedUnitId = unitId ?? (await resolveDefaultTeacherUnitId());
  const position = await prismaClient.masterJobPosition.findUniqueOrThrow({
    where: { name: "Homeroom Teacher" },
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
    unitId: resolvedUnitId,
    jobPositionId: position.id,
    jobLevelId: teachingLevel.id,
    buildingId: building.id,
  });
  return person.employee!;
}

// class-service.ts's assertHasSubjectTeacherPosition rejects "Homeroom
// Teacher" and "Special Education Teacher" specifically - createTeachingEmployee's
// real Homeroom Teacher position doesn't qualify.
async function createSubjectTeacherEmployee(
  email: string,
  unitId?: string,
): Promise<{ id: string }> {
  const resolvedUnitId = unitId ?? (await resolveDefaultTeacherUnitId());
  const building = await prismaClient.masterBuilding.findFirstOrThrow({
    where: { name: { startsWith: "TEST_" } },
  });
  const subjectTeacherPosition = await prismaClient.masterJobPosition.create({
    data: {
      name: `TEST_POS_SUBJECT_TEACHER_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      is_teaching_position: true,
    },
  });
  const teachingLevel = await prismaClient.masterJobLevel.create({
    data: {
      name: `TEST_LVL_TEACHER_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      is_teaching_role: true,
    },
  });
  const person = await EmployeeTest.create({
    email,
    unitId: resolvedUnitId,
    jobPositionId: subjectTeacherPosition.id,
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

describe("POST /api/admin/classes", () => {
  let gradeOneId: string;
  let gradeTwoId: string;
  let academicYearId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await ClassTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();

    const gradeOne = await GradeTest.getByName("Grade 1");
    const gradeTwo = await GradeTest.getByName("Grade 2");
    gradeOneId = gradeOne.id;
    gradeTwoId = gradeTwo.id;
    const year = await AcademicYearTest.create();
    academicYearId = year.id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await ClassTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should successfully create a class when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_Andromeda",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
        status: ClassStatus.ACTIVE,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.name).toBe("TEST_Andromeda");
    expect(body.data.grade.name).toBe("Grade 1");
    expect(body.data.academic_year.id).toBe(academicYearId);
    expect(body.data.status).toBe(ClassStatus.ACTIVE);

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: body.data.id },
    });
    logger.debug(auditLog);

    expect(auditLog.action).toBe(AuditAction.CREATE_CLASS);
    expect(auditLog.source).toBe(AuditSource.UI);
    expect(auditLog.entity_type).toBe("Class");
    expect(auditLog.admin_id).toBe(admin.id);
    expect(auditLog.old_values).toBeNull();
    expect((auditLog.new_values as { name?: string })?.name).toBe(
      "TEST_Andromeda",
    );
  });

  it("should create a class with a capacity and default to 30 when omitted", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const withCapacity = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_Capacity_A",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
        capacity: 30,
      },
      accessToken,
    );
    const withCapacityBody = await withCapacity.json();
    expect(withCapacity.status).toBe(200);
    expect(withCapacityBody.data.capacity).toBe(30);

    const withoutCapacity = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_Capacity_B",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
      },
      accessToken,
    );
    const withoutCapacityBody = await withoutCapacity.json();
    expect(withoutCapacity.status).toBe(200);
    expect(withoutCapacityBody.data.capacity).toBe(30);
  });

  it("should default to ACTIVE status when status is omitted", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_Minimal",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(ClassStatus.ACTIVE);
  });

  it("should default to UPCOMING status when status is omitted and the academic year is UPCOMING", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const upcomingYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Upcoming",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date("2026-01-01"),
      },
    });

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_NotYetLive",
        grade_id: gradeOneId,
        academic_year_id: upcomingYear.id,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(ClassStatus.UPCOMING);
  });

  it("should default to INACTIVE status when status is omitted and the academic year is COMPLETED", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const completedYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Completed For Default",
        status: AcademicYearStatus.COMPLETED,
        start_date: new Date("2020-01-01"),
      },
    });

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_PastYearDefault",
        grade_id: gradeOneId,
        academic_year_id: completedYear.id,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(ClassStatus.INACTIVE);
  });

  it("should reject explicitly setting ACTIVE when the academic year is UPCOMING", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const upcomingYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Upcoming Explicit Active",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date("2026-01-01"),
      },
    });

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_NotYetLiveExplicit",
        grade_id: gradeOneId,
        academic_year_id: upcomingYear.id,
        status: ClassStatus.ACTIVE,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("is UPCOMING, not ACTIVE");
  });

  it("should reject explicitly setting UPCOMING when the academic year is COMPLETED", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const completedYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Completed Explicit Upcoming",
        status: AcademicYearStatus.COMPLETED,
        start_date: new Date("2020-01-01"),
      },
    });

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_PastYearUpcoming",
        grade_id: gradeOneId,
        academic_year_id: completedYear.id,
        status: ClassStatus.UPCOMING,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("is COMPLETED");
  });

  it("should reject explicitly setting ACTIVE when the academic year is COMPLETED", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const completedYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Completed",
        status: AcademicYearStatus.COMPLETED,
        start_date: new Date("2026-01-01"),
      },
    });

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_PastYear",
        grade_id: gradeOneId,
        academic_year_id: completedYear.id,
        status: ClassStatus.ACTIVE,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("is COMPLETED, not ACTIVE");
  });

  it("should allow creating an INACTIVE class for a non-ACTIVE academic year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const upcomingYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Upcoming",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date("2026-01-01"),
      },
    });

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_NotYetLive",
        grade_id: gradeOneId,
        academic_year_id: upcomingYear.id,
        status: ClassStatus.INACTIVE,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(ClassStatus.INACTIVE);
  });

  it("should allow creating an UPCOMING class while its academic year is ACTIVE", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_PreppedAhead",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
        status: ClassStatus.UPCOMING,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(ClassStatus.UPCOMING);
  });

  it("should reject creation (403) when DATABASE_ADMIN's unit doesn't match the grade's unit", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_Blocked",
        grade_id: gradeOneId, // Grade 1 -> Elementary, default test admin -> TEST_UNIT_SHIELD
        academic_year_id: academicYearId,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("unit scope");
  });

  it("should allow DATABASE_ADMIN with matching unit and write access to create a class", async () => {
    const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Elementary" },
    });
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      elementaryUnit.id,
    );

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_DbAdminCreated",
        grade_id: gradeOneId, // Grade 1 -> Elementary, same unit as this admin
        academic_year_id: academicYearId,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.name).toBe("TEST_DbAdminCreated");
  });

  it("should reject creation (403) when DATABASE_ADMIN lacks write access, even with a matching unit", async () => {
    const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Elementary" },
    });
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      elementaryUnit.id,
    );
    await prismaClient.adminUser.update({
      where: { email: "test_dbadmin@millennia21.id" },
      data: { can_write_data: false },
    });

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_NoWriteAccess",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("permission");
  });

  it("should reject creation (403 Forbidden) when requested by VIEWER", async () => {
    const { accessToken } = await AdminUserTest.createViewer();

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_Blocked2",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Viewer cannot create data");
  });

  it("should reject a duplicate name within the same academic year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await ClassTest.create({
      name: "TEST_Duplicate",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_Duplicate",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already exists");
  });

  it("should allow the same class name in a different academic year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await ClassTest.create({
      name: "TEST_Reused",
      gradeId: gradeOneId,
      academicYearId,
    });
    const otherYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Other",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date("2026-01-01"),
      },
    });

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_Reused",
        grade_id: gradeOneId,
        academic_year_id: otherYear.id,
        // otherYear is UPCOMING, not ACTIVE - a class there can't default to
        // ACTIVE (see "Class status must follow its academic year" tests).
        status: ClassStatus.INACTIVE,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.name).toBe("TEST_Reused");
  });

  it("should reject an invalid grade_id", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_BadGrade",
        grade_id: "invalid-grade-id",
        academic_year_id: academicYearId,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("grade");
  });

  it("should reject an invalid academic_year_id", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_BadYear",
        grade_id: gradeOneId,
        academic_year_id: "invalid-year-id",
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("academic year");
  });

  it("should reject creation (400 Bad Request) if name is missing", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/classes",
      { grade_id: gradeOneId, academic_year_id: academicYearId },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject creation (400 Bad Request) if grade_id is missing", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/classes",
      { name: "TEST_NoGrade", academic_year_id: academicYearId },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject creation (400 Bad Request) if name exceeds 100 characters", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: `TEST_${"X".repeat(100)}`,
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.post("/api/admin/classes", {
      name: "TEST_NoAuth",
      grade_id: gradeOneId,
      academic_year_id: academicYearId,
    });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("PATCH /api/admin/classes/:id", () => {
  let gradeOneId: string;
  let gradeTwoId: string;
  let academicYearId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EnrollmentTest.delete();
    await StudentTest.delete();
    await ClassTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();

    gradeOneId = (await GradeTest.getByName("Grade 1")).id;
    gradeTwoId = (await GradeTest.getByName("Grade 2")).id;
    academicYearId = (await AcademicYearTest.create()).id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EnrollmentTest.delete();
    await StudentTest.delete();
    await ClassTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should successfully update a class when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_Original",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}`,
      { status: ClassStatus.INACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(ClassStatus.INACTIVE);

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: klass.id },
    });
    logger.debug(auditLog);

    expect(auditLog.action).toBe(AuditAction.UPDATE_CLASS);
    expect(auditLog.admin_id).toBe(admin.id);
    const oldValues = auditLog.old_values as { status?: string };
    const newValues = auditLog.new_values as { status?: string };
    expect(oldValues?.status).toBe(ClassStatus.ACTIVE);
    expect(newValues?.status).toBe(ClassStatus.INACTIVE);
  });

  it("should reject setting a class ACTIVE when its academic year isn't ACTIVE", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_ToDeactivate",
      gradeId: gradeOneId,
      academicYearId,
      status: ClassStatus.INACTIVE,
    });
    await prismaClient.academicYear.update({
      where: { id: academicYearId },
      data: { status: AcademicYearStatus.COMPLETED },
    });

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}`,
      { status: ClassStatus.ACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("is COMPLETED, not ACTIVE");
  });

  it("should reject moving a class into a non-ACTIVE academic year while leaving it ACTIVE", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_MovingClass",
      gradeId: gradeOneId,
      academicYearId,
    });
    const upcomingYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Upcoming",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date("2026-01-01"),
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}`,
      { academic_year_id: upcomingYear.id },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("is UPCOMING, not ACTIVE");
  });

  it("should reject changing a class's academic year once it has an enrollment, even a closed one", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_HasEnrollment",
      gradeId: gradeOneId,
      academicYearId,
    });
    const student = await StudentTest.create({
      email: "test_class_update_enrollment@millennia21.id",
      currentGradeId: gradeOneId,
      joinGradeId: gradeOneId,
      joinAcademicYearId: academicYearId,
    });
    await EnrollmentTest.create({
      studentId: student.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "Grade 1",
      status: EnrollmentStatus.WITHDRAWN,
    });
    const otherYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Other",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date("2026-01-01"),
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}`,
      { academic_year_id: otherYear.id },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Cannot change academic year");

    const unchanged = await prismaClient.class.findUniqueOrThrow({
      where: { id: klass.id },
    });
    expect(unchanged.academic_year_id).toBe(academicYearId);
  });

  it("should allow changing an empty class's academic year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_EmptyClass",
      gradeId: gradeOneId,
      academicYearId,
    });
    const otherYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Other Empty",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date("2026-01-01"),
      },
    });

    // Also drop status to INACTIVE - only one academic year can be ACTIVE at
    // a time (DB-enforced), and the class defaults to ClassStatus.ACTIVE,
    // which would otherwise conflict with the UPCOMING target year. Not
    // what this test is exercising - that's assertClassStatusMatchesAcademicYear.
    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}`,
      { academic_year_id: otherYear.id, status: ClassStatus.INACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.academic_year.id).toBe(otherYear.id);
  });

  it("should set and clear a class's capacity", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_Capacity_Update",
      gradeId: gradeOneId,
      academicYearId,
      capacity: 30,
    });

    const setResponse = await TestRequest.patch(
      `/api/admin/classes/${klass.id}`,
      { capacity: 40 },
      accessToken,
    );
    const setBody = await setResponse.json();
    expect(setResponse.status).toBe(200);
    expect(setBody.data.capacity).toBe(40);

    const clearResponse = await TestRequest.patch(
      `/api/admin/classes/${klass.id}`,
      { capacity: null },
      accessToken,
    );
    const clearBody = await clearResponse.json();
    expect(clearResponse.status).toBe(200);
    expect(clearBody.data.capacity).toBeNull();
  });

  it("should reject update (403) when DATABASE_ADMIN's unit doesn't match the class's unit", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const klass = await ClassTest.create({
      name: "TEST_Blocked",
      gradeId: gradeOneId, // Grade 1 -> Elementary, default test admin -> TEST_UNIT_SHIELD
      academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}`,
      { status: ClassStatus.INACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("unit scope");
  });

  it("should allow DATABASE_ADMIN with matching unit and write access to update a class", async () => {
    const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Elementary" },
    });
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      elementaryUnit.id,
    );
    const klass = await ClassTest.create({
      name: "TEST_DbAdminEditable",
      gradeId: gradeOneId, // Grade 1 -> Elementary, same unit as this admin
      academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}`,
      { status: ClassStatus.INACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(ClassStatus.INACTIVE);
  });

  it("should reject moving a class to a grade outside DATABASE_ADMIN's unit", async () => {
    const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Elementary" },
    });
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      elementaryUnit.id,
    );
    const klass = await ClassTest.create({
      name: "TEST_DbAdminNoMove",
      gradeId: gradeOneId, // Grade 1 -> Elementary
      academicYearId,
    });
    const juniorHighGrade = await GradeTest.getByName("Grade 7"); // -> Junior High

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}`,
      { grade_id: juniorHighGrade.id },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("unit scope");
  });

  it("should reject changing a class's grade when it would strand an active teacher assignment outside their unit", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_GradeChangeStrandsTeacher",
      gradeId: gradeOneId, // Grade 1 -> Elementary
      academicYearId,
    });
    const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Elementary" },
    });
    const teacher = await createTeachingEmployee(
      "test_grade_change_strands_teacher@millennia21.id",
      elementaryUnit.id,
    );
    await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );

    const juniorHighGrade = await GradeTest.getByName("Grade 7"); // -> Junior High
    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}`,
      { grade_id: juniorHighGrade.id },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("active teacher assignment");

    const reloaded = await prismaClient.class.findUniqueOrThrow({
      where: { id: klass.id },
    });
    expect(reloaded.grade_id).toBe(gradeOneId);
  });

  it("should allow changing a class's grade to another grade in the same unit, even with an active teacher assigned", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_GradeChangeSameUnit",
      gradeId: gradeOneId, // Grade 1 -> Elementary
      academicYearId,
    });
    const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Elementary" },
    });
    const teacher = await createTeachingEmployee(
      "test_grade_change_same_unit_teacher@millennia21.id",
      elementaryUnit.id,
    );
    await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}`,
      { grade_id: gradeTwoId }, // Grade 2 -> also Elementary
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.grade.id).toBe(gradeTwoId);
  });

  it("should allow changing a class's grade across units once the mismatched teacher assignment has ended", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_GradeChangeAfterEnd",
      gradeId: gradeOneId, // Grade 1 -> Elementary
      academicYearId,
    });
    const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Elementary" },
    });
    const teacher = await createTeachingEmployee(
      "test_grade_change_after_end_teacher@millennia21.id",
      elementaryUnit.id,
    );
    const assignResponse = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );
    const assignment = await assignResponse.json();
    await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${assignment.data.id}/end`,
      {},
      accessToken,
    );

    const juniorHighGrade = await GradeTest.getByName("Grade 7"); // -> Junior High
    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}`,
      { grade_id: juniorHighGrade.id },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.grade.id).toBe(juniorHighGrade.id);
  });

  it("should reject renaming to an already-used name within the same academic year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_TakenName",
      gradeId: gradeOneId,
      academicYearId,
    });
    const other = await ClassTest.create({
      name: "TEST_ToRename",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/classes/${other.id}`,
      { name: klass.name },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already exists");
  });

  it("should reject moving a class into an academic year that already has a class with the same name", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const otherYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Other",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date("2026-01-01"),
      },
    });
    // Same name as `movable`, but sitting in a different academic year — so
    // the duplicate only shows up once `movable` is moved into that year.
    await ClassTest.create({
      name: "TEST_SharedName",
      gradeId: gradeOneId,
      academicYearId: otherYear.id,
    });
    const movable = await ClassTest.create({
      name: "TEST_SharedName",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/classes/${movable.id}`,
      { academic_year_id: otherYear.id },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already exists");
  });

  it("should allow re-saving a class without changing its name (no-op rename)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_SameName",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}`,
      { name: klass.name, status: ClassStatus.INACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.name).toBe(klass.name);
  });

  it("should reject an invalid grade_id", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_BadGradeUpdate",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}`,
      { grade_id: "invalid-grade-id" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("grade");
  });

  it("should reject an invalid academic_year_id", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_BadYearUpdate",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}`,
      { academic_year_id: "invalid-year-id" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("academic year");
  });

  it("should reject if the class does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.patch(
      "/api/admin/classes/invalid-cuid-123",
      { status: ClassStatus.INACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("not found");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch("/api/admin/classes/whatever", {
      status: ClassStatus.INACTIVE,
    });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("GET /api/admin/classes/:id", () => {
  let gradeOneId: string;
  let academicYearId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await ClassTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();

    gradeOneId = (await GradeTest.getByName("Grade 1")).id;
    academicYearId = (await AcademicYearTest.create()).id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await ClassTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should be readable by SUPER_ADMIN, DATABASE_ADMIN, and VIEWER alike", async () => {
    const klass = await ClassTest.create({
      name: "TEST_Readable",
      gradeId: gradeOneId,
      academicYearId,
    });
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin();
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin();
    const { accessToken: viewerToken } = await AdminUserTest.createViewer();

    for (const token of [superAdminToken, dbAdminToken, viewerToken]) {
      const response = await TestRequest.get(
        `/api/admin/classes/${klass.id}`,
        token,
      );
      expect(response.status).toBe(200);
    }
  });

  it("should reject if the class does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/classes/invalid-cuid-123",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("not found");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get("/api/admin/classes/whatever");
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("GET /api/admin/classes", () => {
  let gradeOneId: string;
  let gradeTwoId: string;
  let academicYearId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await ClassTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();

    gradeOneId = (await GradeTest.getByName("Grade 1")).id;
    gradeTwoId = (await GradeTest.getByName("Grade 2")).id;
    academicYearId = (await AcademicYearTest.create()).id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await ClassTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should list and paginate classes", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await ClassTest.create({
      name: "TEST_A",
      gradeId: gradeOneId,
      academicYearId,
    });
    await ClassTest.create({
      name: "TEST_B",
      gradeId: gradeOneId,
      academicYearId,
    });
    await ClassTest.create({
      name: "TEST_C",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.get(
      "/api/admin/classes?size=2&page=1&search=TEST_",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(2);
    expect(body.paging.total_item).toBe(3);
    expect(body.paging.total_page).toBe(2);
  });

  it("should filter by grade_id", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await ClassTest.create({
      name: "TEST_G1",
      gradeId: gradeOneId,
      academicYearId,
    });
    await ClassTest.create({
      name: "TEST_G2",
      gradeId: gradeTwoId,
      academicYearId,
    });

    const response = await TestRequest.get(
      `/api/admin/classes?grade_id=${gradeOneId}&search=TEST_`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("TEST_G1");
  });

  it("should filter by academic_year_id", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const otherYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Other",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date("2026-01-01"),
      },
    });
    await ClassTest.create({
      name: "TEST_Y1",
      gradeId: gradeOneId,
      academicYearId,
    });
    await ClassTest.create({
      name: "TEST_Y2",
      gradeId: gradeOneId,
      academicYearId: otherYear.id,
    });

    const response = await TestRequest.get(
      `/api/admin/classes?academic_year_id=${academicYearId}&search=TEST_`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("TEST_Y1");
  });

  it("should filter by status", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await ClassTest.create({
      name: "TEST_Active",
      gradeId: gradeOneId,
      academicYearId,
      status: ClassStatus.ACTIVE,
    });
    await ClassTest.create({
      name: "TEST_Inactive",
      gradeId: gradeOneId,
      academicYearId,
      status: ClassStatus.INACTIVE,
    });

    const response = await TestRequest.get(
      "/api/admin/classes?status=INACTIVE&search=TEST_",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("TEST_Inactive");
  });

  it("should search by name", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await ClassTest.create({
      name: "TEST_Sombrero",
      gradeId: gradeOneId,
      academicYearId,
    });
    await ClassTest.create({
      name: "TEST_Fedora",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.get(
      "/api/admin/classes?search=sombrero",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("TEST_Sombrero");
  });

  it("should sort by name ascending", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await ClassTest.create({
      name: "TEST_Zebra",
      gradeId: gradeOneId,
      academicYearId,
    });
    await ClassTest.create({
      name: "TEST_Alpha",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.get(
      "/api/admin/classes?search=TEST_&sort_by=name&sort_order=asc",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.map((c: { name: string }) => c.name)).toEqual([
      "TEST_Alpha",
      "TEST_Zebra",
    ]);
  });

  it("should sort by grade_level", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await ClassTest.create({
      name: "TEST_HighGrade",
      gradeId: gradeTwoId,
      academicYearId,
    });
    await ClassTest.create({
      name: "TEST_LowGrade",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.get(
      "/api/admin/classes?search=TEST_&sort_by=grade_level&sort_order=asc",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.map((c: { name: string }) => c.name)).toEqual([
      "TEST_LowGrade",
      "TEST_HighGrade",
    ]);
  });

  it("should be readable by VIEWER", async () => {
    const { accessToken } = await AdminUserTest.createViewer();

    const response = await TestRequest.get("/api/admin/classes", accessToken);

    expect(response.status).toBe(200);
  });

  it("should be readable by DATABASE_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();

    const response = await TestRequest.get("/api/admin/classes", accessToken);

    expect(response.status).toBe(200);
  });

  it("should reject an invalid status filter value", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/classes?status=NOT_A_REAL_STATUS",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject an invalid sort_by field", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/classes?sort_by=not_a_real_field",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject a non-numeric page", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/classes?page=abc",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("page must be a valid number");
  });

  it("should reject a size greater than the maximum allowed (100)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/classes?size=101",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get("/api/admin/classes");
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  it("should reflect current open HOMEROOM assignments in homeroom_teachers", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const teacherA = await createTeachingEmployee(
      "test_list_homeroom_a@millennia21.id",
    );
    const teacherB = await createTeachingEmployee(
      "test_list_homeroom_b@millennia21.id",
    );
    const klass = await ClassTest.create({
      name: "TEST_ListHomeroom",
      gradeId: gradeOneId,
      academicYearId,
    });

    const emptyResponse = await TestRequest.get(
      `/api/admin/classes?search=TEST_ListHomeroom`,
      accessToken,
    );
    const emptyBody = await emptyResponse.json();
    expect(emptyBody.data[0].homeroom_teachers).toEqual([]);

    await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacherA.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );
    const oneResponse = await TestRequest.get(
      `/api/admin/classes?search=TEST_ListHomeroom`,
      accessToken,
    );
    const oneBody = await oneResponse.json();
    expect(oneBody.data[0].homeroom_teachers.length).toBe(1);
    expect(oneBody.data[0].homeroom_teachers[0].employee.id).toBe(teacherA.id);

    await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacherB.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );
    const twoResponse = await TestRequest.get(
      `/api/admin/classes?search=TEST_ListHomeroom`,
      accessToken,
    );
    const twoBody = await twoResponse.json();
    expect(twoBody.data[0].homeroom_teachers.length).toBe(2);
    const employeeIds = twoBody.data[0].homeroom_teachers.map(
      (t: { employee: { id: string } }) => t.employee.id,
    );
    expect(employeeIds).toContain(teacherA.id);
    expect(employeeIds).toContain(teacherB.id);
  });

  it("should reflect current open SUPPORTING_HOMEROOM assignments in supporting_homeroom_teachers, separate from homeroom_teachers", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const homeroomTeacher = await createTeachingEmployee(
      "test_list_supporting_homeroom_a@millennia21.id",
    );
    const supportingTeacher = await createTeachingEmployee(
      "test_list_supporting_homeroom_b@millennia21.id",
    );
    const klass = await ClassTest.create({
      name: "TEST_ListSupportingHomeroom",
      gradeId: gradeOneId,
      academicYearId,
    });

    await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: homeroomTeacher.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );
    await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      {
        employee_id: supportingTeacher.id,
        role: ClassTeacherRole.SUPPORTING_HOMEROOM,
      },
      accessToken,
    );

    const response = await TestRequest.get(
      `/api/admin/classes?search=TEST_ListSupportingHomeroom`,
      accessToken,
    );
    const body = await response.json();
    expect(body.data[0].homeroom_teachers.length).toBe(1);
    expect(body.data[0].homeroom_teachers[0].employee.id).toBe(
      homeroomTeacher.id,
    );
    expect(body.data[0].supporting_homeroom_teachers.length).toBe(1);
    expect(body.data[0].supporting_homeroom_teachers[0].employee.id).toBe(
      supportingTeacher.id,
    );
  });

  it("should reflect current open SUBJECT_TEACHER assignments in subject_teachers, including the subject", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const mathTeacher = await createSubjectTeacherEmployee(
      "test_list_subject_teacher_a@millennia21.id",
    );
    const artTeacher = await createSubjectTeacherEmployee(
      "test_list_subject_teacher_b@millennia21.id",
    );
    const klass = await ClassTest.create({
      name: "TEST_ListSubjectTeacher",
      gradeId: gradeOneId,
      academicYearId,
    });

    await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      {
        employee_id: mathTeacher.id,
        role: ClassTeacherRole.SUBJECT_TEACHER,
        subject: "Math",
      },
      accessToken,
    );
    await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      {
        employee_id: artTeacher.id,
        role: ClassTeacherRole.SUBJECT_TEACHER,
        subject: "Art",
      },
      accessToken,
    );

    const response = await TestRequest.get(
      `/api/admin/classes?search=TEST_ListSubjectTeacher`,
      accessToken,
    );
    const body = await response.json();
    expect(body.data[0].subject_teachers.length).toBe(2);
    const subjects = body.data[0].subject_teachers.map(
      (t: { subject: string }) => t.subject,
    );
    expect(subjects.sort()).toEqual(["Art", "Math"]);
  });
});

describe("DELETE /api/admin/classes/:id", () => {
  let gradeOneId: string;
  let academicYearId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await ClassTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();

    gradeOneId = (await GradeTest.getByName("Grade 1")).id;
    academicYearId = (await AcademicYearTest.create()).id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    // FK order: enrollment -> student/person -> class -> academic_year
    await prismaClient.studentClassEnrollment.deleteMany({
      where: { class_name_snapshot: { startsWith: "TEST_" } },
    });
    await prismaClient.student.deleteMany({
      where: { nis: { startsWith: "TEST_NIS_" } },
    });
    // employee: null - don't delete persons whose employee row wasn't
    // targeted above (e.g. real/manually-created employees) - would violate
    // employees_person_id_fkey.
    await prismaClient.person.deleteMany({
      where: { email: { contains: "@millennia21.id" }, employee: null },
    });
    // ClassTest.delete() first - class deletion cascades ClassTeacherAssignment,
    // so EmployeeTest.delete() doesn't hit the employee_id FK still in use.
    await ClassTest.delete();
    await EmployeeTest.delete();
    await AdminUserTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should delete a class not referenced by anything", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_Deletable",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.delete(
      `/api/admin/classes/${klass.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data).toBe(true);

    const stillThere = await prismaClient.class.findUnique({
      where: { id: klass.id },
    });
    expect(stillThere).toBeNull();

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: klass.id },
    });
    logger.debug(auditLog);

    expect(auditLog.action).toBe(AuditAction.DELETE_CLASS);
    expect(auditLog.admin_id).toBe(admin.id);
    const oldValues = auditLog.old_values as { name?: string };
    expect(oldValues?.name).toBe(klass.name);
  });

  it("should reject deletion (403 Forbidden) when requested by DATABASE_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const klass = await ClassTest.create({
      name: "TEST_Protected",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.delete(
      `/api/admin/classes/${klass.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });

  it("should reject if the class does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.delete(
      "/api/admin/classes/invalid-cuid-123",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("not found");
  });

  it("should reject deletion when a student is currently assigned to the class", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_HasStudent",
      gradeId: gradeOneId,
      academicYearId,
    });
    const person = await prismaClient.person.create({
      data: {
        full_name: "Test Student Current",
        nick_name: "Test",
        email: "test_student_current@millennia21.id",
        person_type: "STUDENT",
        gender: "MALE",
        religion: "ISLAM",
        birth_place: "Jakarta",
        birth_date: new Date("2015-01-01"),
      },
    });
    await prismaClient.student.create({
      data: {
        person_id: person.id,
        nis: "TEST_NIS_CURRENT_001",
        current_class_id: klass.id,
        current_grade_id: gradeOneId,
        join_grade_id: gradeOneId,
        join_academic_year_id: academicYearId,
      },
    });

    const response = await TestRequest.delete(
      `/api/admin/classes/${klass.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("still referenced by");
    expect(body.errors).toContain("student(s)");

    const stillThere = await prismaClient.class.findUnique({
      where: { id: klass.id },
    });
    expect(stillThere).not.toBeNull();
  });

  it("should reject deletion when a StudentClassEnrollment still references the class", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_HasEnrollment",
      gradeId: gradeOneId,
      academicYearId,
    });
    const person = await prismaClient.person.create({
      data: {
        full_name: "Test Student Enrolled",
        nick_name: "Test",
        email: "test_student_enrolled@millennia21.id",
        person_type: "STUDENT",
        gender: "MALE",
        religion: "ISLAM",
        birth_place: "Jakarta",
        birth_date: new Date("2015-01-01"),
      },
    });
    const student = await prismaClient.student.create({
      data: {
        person_id: person.id,
        nis: "TEST_NIS_ENROLLED_001",
        current_grade_id: gradeOneId,
        join_grade_id: gradeOneId,
        join_academic_year_id: academicYearId,
      },
    });
    await prismaClient.studentClassEnrollment.create({
      data: {
        student_id: student.id,
        academic_year_id: academicYearId,
        class_id: klass.id,
        grade_level: "1",
        class_name_snapshot: klass.name,
      },
    });

    const response = await TestRequest.delete(
      `/api/admin/classes/${klass.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("still referenced by");
    expect(body.errors).toContain("enrollment(s)");
  });

  it("should reject deletion when a teacher is still assigned to the class", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_HasTeacher",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createTeachingEmployee(
      "test_class_delete_has_teacher@millennia21.id",
    );
    await prismaClient.classTeacherAssignment.create({
      data: {
        class_id: klass.id,
        employee_id: teacher.id,
        role: ClassTeacherRole.HOMEROOM,
      },
    });

    const response = await TestRequest.delete(
      `/api/admin/classes/${klass.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("still referenced by");
    expect(body.errors).toContain("teacher assignment(s)");

    const stillThere = await prismaClient.class.findUnique({
      where: { id: klass.id },
    });
    expect(stillThere).not.toBeNull();
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.delete("/api/admin/classes/whatever");
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("GET /api/admin/classes/:id/teacher-assignments", () => {
  let gradeOneId: string;
  let academicYearId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await ClassTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();

    gradeOneId = (await GradeTest.getByName("Grade 1")).id;
    academicYearId = (await AcademicYearTest.create()).id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await ClassTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should return the full assignment history ordered most-recent-first", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const teacherA = await createTeachingEmployee(
      "test_teacher_history_endpoint_a@millennia21.id",
    );
    const teacherB = await createTeachingEmployee(
      "test_teacher_history_endpoint_b@millennia21.id",
    );
    const createResponse = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_HistoryEndpoint",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
      },
      accessToken,
    );
    const created = await createResponse.json();
    const firstAssignment = await TestRequest.post(
      `/api/admin/classes/${created.data.id}/teachers`,
      { employee_id: teacherA.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );
    const firstAssignmentBody = await firstAssignment.json();
    await TestRequest.patch(
      `/api/admin/classes/${created.data.id}/teachers/${firstAssignmentBody.data.id}/end`,
      {},
      accessToken,
    );
    await TestRequest.post(
      `/api/admin/classes/${created.data.id}/teachers`,
      { employee_id: teacherB.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );

    const response = await TestRequest.get(
      `/api/admin/classes/${created.data.id}/teacher-assignments`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(2);
    expect(body.data[0].employee.id).toBe(teacherB.id);
    expect(body.data[0].end_date).toBeNull();
    expect(body.data[1].employee.id).toBe(teacherA.id);
    expect(body.data[1].end_date).not.toBeNull();
    expect(body.data[1].employee.full_name).toBeDefined();
  });

  it("should return an empty array for a class that never had a homeroom teacher", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_NoHistoryClass",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.get(
      `/api/admin/classes/${klass.id}/teacher-assignments`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it("should be readable by SUPER_ADMIN, DATABASE_ADMIN, and VIEWER alike", async () => {
    const klass = await ClassTest.create({
      name: "TEST_HistoryReadable",
      gradeId: gradeOneId,
      academicYearId,
    });
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin();
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin();
    const { accessToken: viewerToken } = await AdminUserTest.createViewer();

    for (const token of [superAdminToken, dbAdminToken, viewerToken]) {
      const response = await TestRequest.get(
        `/api/admin/classes/${klass.id}/teacher-assignments`,
        token,
      );
      expect(response.status).toBe(200);
    }
  });

  it("should reject if the class does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/classes/invalid-cuid-123/teacher-assignments",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("not found");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get(
      "/api/admin/classes/whatever/teacher-assignments",
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("POST /api/admin/classes/:id/teachers", () => {
  let gradeOneId: string;
  let gradeTwoId: string;
  let academicYearId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await ClassTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();

    gradeOneId = (await GradeTest.getByName("Grade 1")).id;
    gradeTwoId = (await GradeTest.getByName("Grade 2")).id;
    academicYearId = (await AcademicYearTest.create()).id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await ClassTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should assign a SUBJECT_TEACHER as SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_AssignSubject",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_assign_subject_teacher@millennia21.id",
    );

    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      {
        employee_id: teacher.id,
        role: ClassTeacherRole.SUBJECT_TEACHER,
        subject: "Visual Arts",
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.employee.id).toBe(teacher.id);
    expect(body.data.role).toBe(ClassTeacherRole.SUBJECT_TEACHER);
    expect(body.data.subject).toBe("Visual Arts");
    expect(body.data.end_date).toBeNull();

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AuditAction.ASSIGN_CLASS_TEACHER, admin_id: admin.id },
    });
    expect(auditLog.entity_type).toBe("ClassTeacherAssignment");
  });

  it("should assign a SUPPORTING_HOMEROOM teacher without a subject", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_AssignSupporting",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createTeachingEmployee(
      "test_assign_supporting_teacher@millennia21.id",
    );

    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUPPORTING_HOMEROOM },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.role).toBe(ClassTeacherRole.SUPPORTING_HOMEROOM);
    expect(body.data.subject).toBeNull();
  });

  it("should reject when caller is not SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const klass = await ClassTest.create({
      name: "TEST_AssignForbidden",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createTeachingEmployee(
      "test_assign_forbidden@millennia21.id",
    );

    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      accessToken,
    );

    expect(response.status).toBe(403);
  });

  it("should allow DATABASE_ADMIN with matching unit to assign a teacher", async () => {
    const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Elementary" },
    });
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      elementaryUnit.id,
    );
    const klass = await ClassTest.create({
      name: "TEST_DbAdminAssign",
      gradeId: gradeOneId, // Grade 1 -> Elementary
      academicYearId,
    });
    const teacher = await createTeachingEmployee(
      "test_dbadmin_assign@millennia21.id",
      elementaryUnit.id,
    );

    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUPPORTING_HOMEROOM },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
  });

  it("should reject assigning when DATABASE_ADMIN's own unit doesn't match the class's unit, even if the teacher's does", async () => {
    const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Elementary" },
    });
    // Default test admin unit (TEST_UNIT_SHIELD) deliberately left unset
    // here - the admin's own unit is what's under test, not the teacher's.
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const klass = await ClassTest.create({
      name: "TEST_DbAdminAssignBlocked",
      gradeId: gradeOneId, // Grade 1 -> Elementary
      academicYearId,
    });
    const teacher = await createTeachingEmployee(
      "test_dbadmin_assign_blocked@millennia21.id",
      elementaryUnit.id,
    );

    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUPPORTING_HOMEROOM },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("unit scope");
  });

  it("should assign a HOMEROOM teacher", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_AssignHomeroom",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createTeachingEmployee(
      "test_assign_homeroom@millennia21.id",
    );

    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.employee.id).toBe(teacher.id);
    expect(body.data.role).toBe(ClassTeacherRole.HOMEROOM);
    expect(body.data.end_date).toBeNull();
  });

  it("should reject an invalid employee_id when assigning a HOMEROOM teacher", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_AssignHomeroomInvalidTeacher",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: "invalid-employee-id", role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Invalid teacher");
  });

  it("should reject assigning the same teacher as HOMEROOM to a second class in the same academic year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const teacher = await createTeachingEmployee(
      "test_homeroom_double_book@millennia21.id",
    );
    await ClassTest.createWithHomeroomTeacher({
      name: "TEST_HomeroomFirstClass",
      gradeId: gradeOneId,
      academicYearId,
      employeeId: teacher.id,
    });
    const secondClass = await ClassTest.create({
      name: "TEST_HomeroomSecondClass",
      gradeId: gradeTwoId,
      academicYearId,
    });

    const response = await TestRequest.post(
      `/api/admin/classes/${secondClass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain(
      "already holds an active HOMEROOM assignment",
    );
  });

  it("should reject assigning the same teacher as SUPPORTING_HOMEROOM to a second class in the same academic year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const teacher = await createTeachingEmployee(
      "test_supporting_double_book@millennia21.id",
    );
    const firstClass = await ClassTest.create({
      name: "TEST_SupportingFirstClass",
      gradeId: gradeOneId,
      academicYearId,
    });
    const secondClass = await ClassTest.create({
      name: "TEST_SupportingSecondClass",
      gradeId: gradeTwoId,
      academicYearId,
    });
    await TestRequest.post(
      `/api/admin/classes/${firstClass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUPPORTING_HOMEROOM },
      accessToken,
    );

    const response = await TestRequest.post(
      `/api/admin/classes/${secondClass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUPPORTING_HOMEROOM },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain(
      "already holds an active SUPPORTING_HOMEROOM assignment",
    );
  });

  it("should allow assigning the same teacher as HOMEROOM to classes in different academic years", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const teacher = await createTeachingEmployee(
      "test_homeroom_multi_year@millennia21.id",
    );
    await ClassTest.createWithHomeroomTeacher({
      name: "TEST_HomeroomYearOne",
      gradeId: gradeOneId,
      academicYearId,
      employeeId: teacher.id,
    });
    const otherYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Other",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date("2026-01-01"),
      },
    });
    const otherYearClass = await ClassTest.create({
      name: "TEST_HomeroomYearTwo",
      gradeId: gradeOneId,
      academicYearId: otherYear.id,
      status: ClassStatus.INACTIVE,
    });

    const response = await TestRequest.post(
      `/api/admin/classes/${otherYearClass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.employee.id).toBe(teacher.id);
  });

  it("should allow two different HOMEROOM teachers on the same class", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_TwoHomeroom",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacherA = await createTeachingEmployee(
      "test_homeroom_a@millennia21.id",
    );
    const teacherB = await createTeachingEmployee(
      "test_homeroom_b@millennia21.id",
    );

    const first = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacherA.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );
    const second = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacherB.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("should reject when the class does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const teacher = await createTeachingEmployee(
      "test_assign_no_class@millennia21.id",
    );

    const response = await TestRequest.post(
      "/api/admin/classes/invalid-cuid-123/teachers",
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Class not found");
  });

  it("should reject an employee whose job level is not a teaching role", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_AssignNonTeaching",
      gradeId: gradeOneId,
      academicYearId,
    });
    const staff = await createNonTeachingEmployee(
      "test_assign_nonteaching@millennia21.id",
    );

    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: staff.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Invalid teacher");
  });

  it("should reject a SUBJECT_TEACHER assignment for an employee whose job position is not a Subject Teacher position", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_AssignSubjectWrongPosition",
      gradeId: gradeOneId,
      academicYearId,
    });
    // Teaching-eligible (job level), but a generic position, not
    // "... Subject Teacher - ...".
    const teacher = await createTeachingEmployee(
      "test_assign_subject_wrong_position@millennia21.id",
    );

    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("not a subject-teaching position");
  });

  it("should allow a HOMEROOM assignment for an employee who holds the Homeroom Teacher position", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_AssignHomeroomRightPosition",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createTeachingEmployee(
      "test_assign_homeroom_right_position@millennia21.id",
    );

    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );

    expect(response.status).toBe(200);
  });

  it("should reject a HOMEROOM assignment for an employee whose job position is not Homeroom Teacher", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_AssignHomeroomWrongPosition",
      gradeId: gradeOneId,
      academicYearId,
    });
    // Teaching-eligible (job level) and a real subject-teaching position,
    // but not Homeroom Teacher specifically.
    const teacher = await createSubjectTeacherEmployee(
      "test_assign_homeroom_wrong_position@millennia21.id",
    );

    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain('must be "Homeroom Teacher"');
  });

  it("should reject a SUPPORTING_HOMEROOM assignment for an employee whose job position is not Homeroom Teacher", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_AssignSupportingWrongPosition",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_assign_supporting_wrong_position@millennia21.id",
    );

    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUPPORTING_HOMEROOM },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain('must be "Homeroom Teacher"');
  });

  it("should reject a duplicate active assignment with the same role and subject", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_AssignDuplicate",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_assign_duplicate@millennia21.id",
    );

    await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      {
        employee_id: teacher.id,
        role: ClassTeacherRole.SUBJECT_TEACHER,
        subject: "Math",
      },
      accessToken,
    );
    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      {
        employee_id: teacher.id,
        role: ClassTeacherRole.SUBJECT_TEACHER,
        subject: "Math",
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already has an active assignment");
  });

  it("should allow the same subject teacher to teach the same subject in a different class", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const classOne = await ClassTest.create({
      name: "TEST_MultiClassOne",
      gradeId: gradeOneId,
      academicYearId,
    });
    const classTwo = await ClassTest.create({
      name: "TEST_MultiClassTwo",
      gradeId: gradeTwoId,
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_assign_multi_class@millennia21.id",
    );

    const first = await TestRequest.post(
      `/api/admin/classes/${classOne.id}/teachers`,
      {
        employee_id: teacher.id,
        role: ClassTeacherRole.SUBJECT_TEACHER,
        subject: "Math",
      },
      accessToken,
    );
    const second = await TestRequest.post(
      `/api/admin/classes/${classTwo.id}/teachers`,
      {
        employee_id: teacher.id,
        role: ClassTeacherRole.SUBJECT_TEACHER,
        subject: "Math",
      },
      accessToken,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("should allow two different SUPPORTING_HOMEROOM teachers on the same class", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_TwoSupporting",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacherA = await createTeachingEmployee(
      "test_supporting_a@millennia21.id",
    );
    const teacherB = await createTeachingEmployee(
      "test_supporting_b@millennia21.id",
    );

    const first = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacherA.id, role: ClassTeacherRole.SUPPORTING_HOMEROOM },
      accessToken,
    );
    const second = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacherB.id, role: ClassTeacherRole.SUPPORTING_HOMEROOM },
      accessToken,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("should reject if no access token provided", async () => {
    const klass = await ClassTest.create({
      name: "TEST_AssignNoAuth",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: "whatever", role: ClassTeacherRole.SUBJECT_TEACHER },
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  it("should reject when the teacher's unit does not match the class's unit", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_AssignCrossUnit",
      gradeId: gradeOneId, // Grade 1 -> Elementary
      academicYearId,
    });
    const juniorHighUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Junior High" },
    });
    const teacher = await createTeachingEmployee(
      "test_cross_unit_teacher@millennia21.id",
      juniorHighUnit.id,
    );

    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("unit");
  });

  it("should reject when the class's grade has no unit configured", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const ungradedGrade = await prismaClient.grade.findUniqueOrThrow({
      where: { name: "Unknown (Legacy Import)" },
    });
    const klass = await ClassTest.create({
      name: "TEST_AssignNoGradeUnit",
      gradeId: ungradedGrade.id,
      academicYearId,
    });
    const teacher = await createTeachingEmployee(
      "test_no_grade_unit_teacher@millennia21.id",
    );

    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("no unit configured");
  });
});

describe("PATCH /api/admin/classes/:id/teachers/:assignmentId/end", () => {
  let gradeOneId: string;
  let academicYearId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await ClassTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();

    gradeOneId = (await GradeTest.getByName("Grade 1")).id;
    academicYearId = (await AcademicYearTest.create()).id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await ClassTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should end an active SUBJECT_TEACHER assignment as SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_EndSubject",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_end_subject_teacher@millennia21.id",
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      accessToken,
    );
    const createdBody = await created.json();

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}/end`,
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
        action: AuditAction.END_CLASS_TEACHER_ASSIGNMENT,
        admin_id: admin.id,
      },
    });
    expect(auditLog.entity_type).toBe("ClassTeacherAssignment");
  });

  it("should reject when caller is not SUPER_ADMIN", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_EndForbidden",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_end_forbidden@millennia21.id",
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      superAdmin.accessToken,
    );
    const createdBody = await created.json();

    const { accessToken: viewerToken } = await AdminUserTest.createViewer();
    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}/end`,
      {},
      viewerToken,
    );

    expect(response.status).toBe(403);
  });

  it("should allow DATABASE_ADMIN with matching unit to end an assignment", async () => {
    const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Elementary" },
    });
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_DbAdminEnd",
      gradeId: gradeOneId, // Grade 1 -> Elementary
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_dbadmin_end@millennia21.id",
      elementaryUnit.id,
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      superAdmin.accessToken,
    );
    const createdBody = await created.json();

    const { accessToken: dbAdminToken } = await AdminUserTest.createDatabaseAdmin(
      elementaryUnit.id,
    );
    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}/end`,
      {},
      dbAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.end_date).not.toBeNull();
  });

  it("should reject ending an assignment when DATABASE_ADMIN's unit doesn't match the class's unit", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_DbAdminEndBlocked",
      gradeId: gradeOneId, // Grade 1 -> Elementary
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_dbadmin_end_blocked@millennia21.id",
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      superAdmin.accessToken,
    );
    const createdBody = await created.json();

    // Default test admin unit (TEST_UNIT_SHIELD) doesn't match Elementary.
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin();
    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}/end`,
      {},
      dbAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("unit scope");
  });

  it("should end an active HOMEROOM assignment", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const teacher = await createTeachingEmployee(
      "test_end_homeroom@millennia21.id",
    );
    const klass = await ClassTest.create({
      name: "TEST_EndHomeroom",
      gradeId: gradeOneId,
      academicYearId,
    });
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );
    const createdBody = await created.json();

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}/end`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.end_date).not.toBeNull();
  });

  it("should reject when the assignment does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_EndMissing",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/invalid-cuid-123/end`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Teacher assignment not found");
  });

  it("should reject when the assignment belongs to a different class", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const classOne = await ClassTest.create({
      name: "TEST_EndWrongClassOne",
      gradeId: gradeOneId,
      academicYearId,
    });
    const classTwo = await ClassTest.create({
      name: "TEST_EndWrongClassTwo",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_end_wrong_class@millennia21.id",
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${classOne.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      accessToken,
    );
    const createdBody = await created.json();

    const response = await TestRequest.patch(
      `/api/admin/classes/${classTwo.id}/teachers/${createdBody.data.id}/end`,
      {},
      accessToken,
    );

    expect(response.status).toBe(404);
  });

  it("should reject ending an already-ended assignment", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_EndAlreadyEnded",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_end_already_ended@millennia21.id",
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      accessToken,
    );
    const createdBody = await created.json();

    await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}/end`,
      {},
      accessToken,
    );
    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}/end`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already ended");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch(
      "/api/admin/classes/whatever/teachers/whatever/end",
      {},
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("DELETE /api/admin/classes/:id/teachers/:assignmentId", () => {
  let gradeOneId: string;
  let academicYearId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await ClassTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();

    gradeOneId = (await GradeTest.getByName("Grade 1")).id;
    academicYearId = (await AcademicYearTest.create()).id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await ClassTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should soft-delete an active assignment as SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_RemoveActive",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_remove_active@millennia21.id",
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      accessToken,
    );
    const createdBody = await created.json();

    const response = await TestRequest.delete(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}`,
      accessToken,
    );

    expect(response.status).toBe(200);

    const assignment = await prismaClient.classTeacherAssignment.findUniqueOrThrow(
      { where: { id: createdBody.data.id } },
    );
    expect(assignment.deleted_at).not.toBeNull();

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: {
        action: AuditAction.DELETE_CLASS_TEACHER_ASSIGNMENT,
        admin_id: admin.id,
      },
    });
    expect(auditLog.entity_type).toBe("ClassTeacherAssignment");
  });

  it("should soft-delete an already-ended assignment", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_RemoveEnded",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_remove_ended@millennia21.id",
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      accessToken,
    );
    const createdBody = await created.json();

    await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}/end`,
      {},
      accessToken,
    );

    const response = await TestRequest.delete(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}`,
      accessToken,
    );

    expect(response.status).toBe(200);

    const assignment = await prismaClient.classTeacherAssignment.findUniqueOrThrow(
      { where: { id: createdBody.data.id } },
    );
    expect(assignment.deleted_at).not.toBeNull();
  });

  it("should disappear from class and employee teaching-assignment listings after removal", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_RemoveHidesFromListings",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_remove_hides@millennia21.id",
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      accessToken,
    );
    const createdBody = await created.json();

    await TestRequest.delete(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}`,
      accessToken,
    );

    const classListResponse = await TestRequest.get(
      `/api/admin/classes/${klass.id}/teacher-assignments`,
      accessToken,
    );
    const classListBody = await classListResponse.json();
    expect(
      classListBody.data.some(
        (assignment: { id: string }) => assignment.id === createdBody.data.id,
      ),
    ).toBe(false);

    const employeeListResponse = await TestRequest.get(
      `/api/admin/employees/${teacher.id}/teaching-assignments`,
      accessToken,
    );
    const employeeListBody = await employeeListResponse.json();
    expect(
      employeeListBody.data.some(
        (assignment: { id: string }) => assignment.id === createdBody.data.id,
      ),
    ).toBe(false);
  });

  it("should allow re-assigning the same role/employee after removal", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_RemoveThenReassign",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_remove_reassign@millennia21.id",
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      accessToken,
    );
    const createdBody = await created.json();

    await TestRequest.delete(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}`,
      accessToken,
    );

    const reassigned = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      accessToken,
    );
    const reassignedBody = await reassigned.json();

    expect(reassigned.status).toBe(200);
    expect(reassignedBody.data.id).not.toBe(createdBody.data.id);
  });

  it("should reject when caller is not SUPER_ADMIN", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_RemoveForbidden",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_remove_forbidden@millennia21.id",
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      superAdmin.accessToken,
    );
    const createdBody = await created.json();

    const { accessToken: viewerToken } = await AdminUserTest.createViewer();
    const response = await TestRequest.delete(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}`,
      viewerToken,
    );

    expect(response.status).toBe(403);
  });

  it("should allow DATABASE_ADMIN with matching unit to remove an assignment", async () => {
    const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Elementary" },
    });
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_DbAdminRemove",
      gradeId: gradeOneId, // Grade 1 -> Elementary
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_dbadmin_remove@millennia21.id",
      elementaryUnit.id,
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      superAdmin.accessToken,
    );
    const createdBody = await created.json();

    const { accessToken: dbAdminToken } = await AdminUserTest.createDatabaseAdmin(
      elementaryUnit.id,
    );
    const response = await TestRequest.delete(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}`,
      dbAdminToken,
    );

    expect(response.status).toBe(200);
  });

  it("should reject removing an assignment when DATABASE_ADMIN's unit doesn't match the class's unit", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_DbAdminRemoveBlocked",
      gradeId: gradeOneId, // Grade 1 -> Elementary
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_dbadmin_remove_blocked@millennia21.id",
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      superAdmin.accessToken,
    );
    const createdBody = await created.json();

    // Default test admin unit (TEST_UNIT_SHIELD) doesn't match Elementary.
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin();
    const response = await TestRequest.delete(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}`,
      dbAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("unit scope");
  });

  it("should reject when the assignment does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_RemoveMissing",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.delete(
      `/api/admin/classes/${klass.id}/teachers/invalid-cuid-123`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Teacher assignment not found");
  });

  it("should reject when the assignment belongs to a different class", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const classOne = await ClassTest.create({
      name: "TEST_RemoveWrongClassOne",
      gradeId: gradeOneId,
      academicYearId,
    });
    const classTwo = await ClassTest.create({
      name: "TEST_RemoveWrongClassTwo",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_remove_wrong_class@millennia21.id",
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${classOne.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      accessToken,
    );
    const createdBody = await created.json();

    const response = await TestRequest.delete(
      `/api/admin/classes/${classTwo.id}/teachers/${createdBody.data.id}`,
      accessToken,
    );

    expect(response.status).toBe(404);
  });

  it("should reject removing an already-removed assignment", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_RemoveAlreadyRemoved",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_remove_already_removed@millennia21.id",
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      accessToken,
    );
    const createdBody = await created.json();

    await TestRequest.delete(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}`,
      accessToken,
    );
    const response = await TestRequest.delete(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Teacher assignment not found");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.delete(
      "/api/admin/classes/whatever/teachers/whatever",
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("PATCH /api/admin/classes/:id/teachers/:assignmentId/reopen", () => {
  let gradeOneId: string;
  let academicYearId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await ClassTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();

    gradeOneId = (await GradeTest.getByName("Grade 1")).id;
    academicYearId = (await AcademicYearTest.create()).id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await ClassTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should reopen an ended assignment as SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_ReopenActive",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_reopen_active@millennia21.id",
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      accessToken,
    );
    const createdBody = await created.json();

    await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}/end`,
      {},
      accessToken,
    );

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}/reopen`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.end_date).toBeNull();

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: {
        action: AuditAction.REOPEN_CLASS_TEACHER_ASSIGNMENT,
        admin_id: admin.id,
      },
    });
    expect(auditLog.entity_type).toBe("ClassTeacherAssignment");
  });

  it("should reject reopening an assignment that hasn't ended", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_ReopenNotEnded",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_reopen_not_ended@millennia21.id",
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      accessToken,
    );
    const createdBody = await created.json();

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}/reopen`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("has not ended");
  });

  it("should reject reopening a HOMEROOM assignment when the employee already holds an active HOMEROOM assignment elsewhere this year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const teacher = await createTeachingEmployee(
      "test_reopen_homeroom_conflict@millennia21.id",
    );
    const classOne = await ClassTest.create({
      name: "TEST_ReopenConflictOne",
      gradeId: gradeOneId,
      academicYearId,
    });
    const classTwo = await ClassTest.create({
      name: "TEST_ReopenConflictTwo",
      gradeId: gradeOneId,
      academicYearId,
    });
    const created = await TestRequest.post(
      `/api/admin/classes/${classOne.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );
    const createdBody = await created.json();
    await TestRequest.patch(
      `/api/admin/classes/${classOne.id}/teachers/${createdBody.data.id}/end`,
      {},
      accessToken,
    );

    // Same employee re-assigned HOMEROOM elsewhere this academic year, now
    // active - reopening the first one would put them in two at once.
    await TestRequest.post(
      `/api/admin/classes/${classTwo.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );

    const response = await TestRequest.patch(
      `/api/admin/classes/${classOne.id}/teachers/${createdBody.data.id}/reopen`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already holds an active");
  });

  it("should reject reopening a removed assignment", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_ReopenRemoved",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_reopen_removed@millennia21.id",
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      accessToken,
    );
    const createdBody = await created.json();

    await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}/end`,
      {},
      accessToken,
    );
    await TestRequest.delete(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}`,
      accessToken,
    );

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}/reopen`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Teacher assignment not found");
  });

  it("should reject when caller is not SUPER_ADMIN", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_ReopenForbidden",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_reopen_forbidden@millennia21.id",
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      superAdmin.accessToken,
    );
    const createdBody = await created.json();
    await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}/end`,
      {},
      superAdmin.accessToken,
    );

    const { accessToken: viewerToken } = await AdminUserTest.createViewer();
    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}/reopen`,
      {},
      viewerToken,
    );

    expect(response.status).toBe(403);
  });

  it("should allow DATABASE_ADMIN with matching unit to reopen an assignment", async () => {
    const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Elementary" },
    });
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_DbAdminReopen",
      gradeId: gradeOneId, // Grade 1 -> Elementary
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_dbadmin_reopen@millennia21.id",
      elementaryUnit.id,
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      superAdmin.accessToken,
    );
    const createdBody = await created.json();
    await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}/end`,
      {},
      superAdmin.accessToken,
    );

    const { accessToken: dbAdminToken } = await AdminUserTest.createDatabaseAdmin(
      elementaryUnit.id,
    );
    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}/reopen`,
      {},
      dbAdminToken,
    );

    expect(response.status).toBe(200);
  });

  it("should reject reopening an assignment when DATABASE_ADMIN's unit doesn't match the class's unit", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_DbAdminReopenBlocked",
      gradeId: gradeOneId, // Grade 1 -> Elementary
      academicYearId,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_dbadmin_reopen_blocked@millennia21.id",
    );
    const created = await TestRequest.post(
      `/api/admin/classes/${klass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      superAdmin.accessToken,
    );
    const createdBody = await created.json();
    await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}/end`,
      {},
      superAdmin.accessToken,
    );

    // Default test admin unit (TEST_UNIT_SHIELD) doesn't match Elementary.
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin();
    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/${createdBody.data.id}/reopen`,
      {},
      dbAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("unit scope");
  });

  it("should reject when the assignment does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_ReopenMissing",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}/teachers/invalid-cuid-123/reopen`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Teacher assignment not found");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch(
      "/api/admin/classes/whatever/teachers/whatever/reopen",
      {},
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("Class enrollment history counts", () => {
  let gradeOneId: string;
  let academicYearId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EnrollmentTest.delete();
    await ClassTest.delete();
    await StudentTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();

    gradeOneId = (await GradeTest.getByName("Grade 1")).id;
    academicYearId = (await AcademicYearTest.create()).id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EnrollmentTest.delete();
    // ClassTest.delete() first - class deletion cascades ClassTeacherAssignment,
    // so EmployeeTest.delete() doesn't hit the employee_id FK still in use.
    await ClassTest.delete();
    await StudentTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should report transferred/withdrawn/completed counts separately from active_enrollment_count", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_HistoryCounts",
      gradeId: gradeOneId,
      academicYearId,
    });
    const otherClass = await ClassTest.create({
      name: "TEST_HistoryCountsOther",
      gradeId: gradeOneId,
      academicYearId,
    });

    const activeStudent = await StudentTest.create({
      email: "test_history_counts_active@millennia21.id",
      currentGradeId: gradeOneId,
      joinGradeId: gradeOneId,
      joinAcademicYearId: academicYearId,
    });
    const transferredStudent = await StudentTest.create({
      email: "test_history_counts_transferred@millennia21.id",
      currentGradeId: gradeOneId,
      joinGradeId: gradeOneId,
      joinAcademicYearId: academicYearId,
    });
    const withdrawnStudent = await StudentTest.create({
      email: "test_history_counts_withdrawn@millennia21.id",
      currentGradeId: gradeOneId,
      joinGradeId: gradeOneId,
      joinAcademicYearId: academicYearId,
    });
    const completedStudent = await StudentTest.create({
      email: "test_history_counts_completed@millennia21.id",
      currentGradeId: gradeOneId,
      joinGradeId: gradeOneId,
      joinAcademicYearId: academicYearId,
    });

    await EnrollmentTest.create({
      studentId: activeStudent.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "Grade 1",
      status: EnrollmentStatus.ACTIVE,
    });
    await EnrollmentTest.create({
      studentId: transferredStudent.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "Grade 1",
      status: EnrollmentStatus.TRANSFERRED,
    });
    await EnrollmentTest.create({
      studentId: withdrawnStudent.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "Grade 1",
      status: EnrollmentStatus.WITHDRAWN,
    });
    await EnrollmentTest.create({
      studentId: completedStudent.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "Grade 1",
      status: EnrollmentStatus.COMPLETED,
    });

    const response = await TestRequest.get(
      `/api/admin/classes/${klass.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.active_enrollment_count).toBe(1);
    expect(body.data.enrollment_history_counts).toEqual({
      transferred: 1,
      withdrawn: 1,
      completed: 1,
    });

    const searchResponse = await TestRequest.get(
      `/api/admin/classes?search=TEST_HistoryCounts`,
      accessToken,
    );
    const searchBody = await searchResponse.json();
    const found = searchBody.data.find(
      (item: { id: string }) => item.id === klass.id,
    );
    expect(found.enrollment_history_counts).toEqual({
      transferred: 1,
      withdrawn: 1,
      completed: 1,
    });

    const otherResponse = await TestRequest.get(
      `/api/admin/classes/${otherClass.id}`,
      accessToken,
    );
    const otherBody = await otherResponse.json();
    expect(otherBody.data.enrollment_history_counts).toEqual({
      transferred: 0,
      withdrawn: 0,
      completed: 0,
    });
  });

  it("should mark has_dependents true even for a soft-deleted enrollment the visible counts don't show", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_SoftDeletedBlocker",
      gradeId: gradeOneId,
      academicYearId,
    });
    const student = await StudentTest.create({
      email: "test_has_dependents_soft_deleted@millennia21.id",
      currentGradeId: gradeOneId,
      joinGradeId: gradeOneId,
      joinAcademicYearId: academicYearId,
    });
    await EnrollmentTest.create({
      studentId: student.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "Grade 1",
      status: EnrollmentStatus.WITHDRAWN,
      deletedAt: new Date(),
    });

    const response = await TestRequest.get(
      `/api/admin/classes/${klass.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    // Soft-deleted, so it's invisible in the display breakdown...
    expect(body.data.active_enrollment_count).toBe(0);
    expect(body.data.enrollment_history_counts).toEqual({
      transferred: 0,
      withdrawn: 0,
      completed: 0,
    });
    // ...but it still holds the class_id FK, so a real delete would still 400.
    expect(body.data.has_dependents).toBe(true);

    const deleteResponse = await TestRequest.delete(
      `/api/admin/classes/${klass.id}`,
      accessToken,
    );
    expect(deleteResponse.status).toBe(400);

    const searchResponse = await TestRequest.get(
      `/api/admin/classes?search=TEST_SoftDeletedBlocker`,
      accessToken,
    );
    const searchBody = await searchResponse.json();
    const found = searchBody.data.find(
      (item: { id: string }) => item.id === klass.id,
    );
    expect(found.has_dependents).toBe(true);
  });

  it("should mark has_dependents false for a class with no students or enrollments", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_NoDependents",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.get(
      `/api/admin/classes/${klass.id}`,
      accessToken,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.has_dependents).toBe(false);

    const searchResponse = await TestRequest.get(
      `/api/admin/classes?search=TEST_NoDependents`,
      accessToken,
    );
    const searchBody = await searchResponse.json();
    const found = searchBody.data.find(
      (item: { id: string }) => item.id === klass.id,
    );
    expect(found.has_dependents).toBe(false);
  });

  it("should mark has_dependents true for a class with an active teacher assignment but no students", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_TeacherOnlyBlocker",
      gradeId: gradeOneId,
      academicYearId,
    });
    const teacher = await createTeachingEmployee(
      "test_has_dependents_teacher_only@millennia21.id",
    );
    await prismaClient.classTeacherAssignment.create({
      data: {
        class_id: klass.id,
        employee_id: teacher.id,
        role: ClassTeacherRole.HOMEROOM,
      },
    });

    const response = await TestRequest.get(
      `/api/admin/classes/${klass.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.has_dependents).toBe(true);

    const deleteResponse = await TestRequest.delete(
      `/api/admin/classes/${klass.id}`,
      accessToken,
    );
    expect(deleteResponse.status).toBe(400);

    const searchResponse = await TestRequest.get(
      `/api/admin/classes?search=TEST_TeacherOnlyBlocker`,
      accessToken,
    );
    const searchBody = await searchResponse.json();
    const found = searchBody.data.find(
      (item: { id: string }) => item.id === klass.id,
    );
    expect(found.has_dependents).toBe(true);
  });
});

describe("PATCH /api/admin/classes/:id/teachers/bulk/move", () => {
  let gradeOneId: string;
  let academicYearId: string;
  let nextAcademicYearId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await ClassTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();

    gradeOneId = (await GradeTest.getByName("Grade 1")).id;
    academicYearId = (await AcademicYearTest.create()).id;
    const nextYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Other",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date("2026-01-01"),
      },
    });
    nextAcademicYearId = nextYear.id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await ClassTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should move a teacher assignment to a target class, ending the old one and creating a new one", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const sourceClass = await ClassTest.create({
      name: "TEST_BulkMoveSource",
      gradeId: gradeOneId,
      academicYearId,
    });
    const targetClass = await ClassTest.create({
      name: "TEST_BulkMoveTarget",
      gradeId: gradeOneId,
      academicYearId: nextAcademicYearId,
      status: ClassStatus.INACTIVE,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_bulk_move_subject@millennia21.id",
    );

    const created = await TestRequest.post(
      `/api/admin/classes/${sourceClass.id}/teachers`,
      {
        employee_id: teacher.id,
        role: ClassTeacherRole.SUBJECT_TEACHER,
        subject: "Math",
      },
      accessToken,
    );
    const createdBody = await created.json();

    const response = await TestRequest.patch(
      `/api/admin/classes/${sourceClass.id}/teachers/bulk/move`,
      {
        assignment_ids: [createdBody.data.id],
        target_class_id: targetClass.id,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.success_count).toBe(1);
    expect(body.data.failed_count).toBe(0);
    expect(body.data.items[0].data.role).toBe(ClassTeacherRole.SUBJECT_TEACHER);
    expect(body.data.items[0].data.subject).toBe("Math");

    const oldAssignment = await prismaClient.classTeacherAssignment.findUniqueOrThrow(
      { where: { id: createdBody.data.id } },
    );
    expect(oldAssignment.end_date).not.toBeNull();

    const newAssignment = await prismaClient.classTeacherAssignment.findFirstOrThrow(
      { where: { class_id: targetClass.id, employee_id: teacher.id } },
    );
    expect(newAssignment.role).toBe(ClassTeacherRole.SUBJECT_TEACHER);
    expect(newAssignment.subject).toBe("Math");
    expect(newAssignment.end_date).toBeNull();
  });

  it("should report a per-item failure without failing the whole batch", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const sourceClass = await ClassTest.create({
      name: "TEST_BulkMovePartial",
      gradeId: gradeOneId,
      academicYearId,
    });
    const targetClass = await ClassTest.create({
      name: "TEST_BulkMovePartialTarget",
      gradeId: gradeOneId,
      academicYearId: nextAcademicYearId,
      status: ClassStatus.INACTIVE,
    });
    const teacher = await createSubjectTeacherEmployee(
      "test_bulk_move_partial@millennia21.id",
    );

    const created = await TestRequest.post(
      `/api/admin/classes/${sourceClass.id}/teachers`,
      { employee_id: teacher.id, role: ClassTeacherRole.SUBJECT_TEACHER },
      accessToken,
    );
    const createdBody = await created.json();

    const response = await TestRequest.patch(
      `/api/admin/classes/${sourceClass.id}/teachers/bulk/move`,
      {
        assignment_ids: [createdBody.data.id, "nonexistent-assignment-id"],
        target_class_id: targetClass.id,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.success_count).toBe(1);
    expect(body.data.failed_count).toBe(1);
    const failedItem = body.data.items.find(
      (item: { status: string }) => item.status === "FAILED",
    );
    expect(failedItem.error).toContain("not found");
  });

  it("should reject (403) for VIEWER", async () => {
    const { accessToken } = await AdminUserTest.createViewer();
    const sourceClass = await ClassTest.create({
      name: "TEST_BulkMoveForbidden",
      gradeId: gradeOneId,
      academicYearId,
    });
    const targetClass = await ClassTest.create({
      name: "TEST_BulkMoveForbiddenTarget",
      gradeId: gradeOneId,
      academicYearId: nextAcademicYearId,
      status: ClassStatus.INACTIVE,
    });

    const response = await TestRequest.patch(
      `/api/admin/classes/${sourceClass.id}/teachers/bulk/move`,
      { assignment_ids: ["whatever"], target_class_id: targetClass.id },
      accessToken,
    );

    expect(response.status).toBe(403);
  });
});
