import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  AcademicYearTest,
  ClassTest,
  GradeTest,
  EmployeeTest,
  MasterDataTest,
  AuditLogTest,
} from "./test-utils";
import {
  AcademicYearStatus,
  AuditAction,
  AuditSource,
  ClassStatus,
  EmployeeStatus,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

async function createTeachingEmployee(email: string): Promise<{ id: string }> {
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

  it("should create a class with a capacity and default to null when omitted", async () => {
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
    expect(withoutCapacityBody.data.capacity).toBeNull();
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

  it("should reject creation (403 Forbidden) when requested by DATABASE_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_Blocked",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
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
    expect(body.errors).toContain("Only Super Admin");
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
      data: { name: "Test Year Other", status: AcademicYearStatus.UPCOMING },
    });

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_Reused",
        grade_id: gradeOneId,
        academic_year_id: otherYear.id,
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

  it("should reject an invalid homeroom_teacher_id", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_BadTeacher",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
        homeroom_teacher_id: "invalid-employee-id",
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("homeroom teacher");
  });

  it("should accept a valid homeroom_teacher_id", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const masterData = await prismaClient.masterUnit.findFirstOrThrow({
      where: { name: { startsWith: "TEST_" } },
    });
    const position = await prismaClient.masterJobPosition.findFirstOrThrow({
      where: { name: { startsWith: "TEST_" } },
    });
    const teachingLevel = await prismaClient.masterJobLevel.create({
      data: { name: "TEST_LVL_TEACHER", is_teaching_role: true },
    });
    const teacherPerson = await EmployeeTest.create({
      email: "test_teacher_class@millennia21.id",
      unitId: masterData.id,
      jobPositionId: position.id,
      jobLevelId: teachingLevel.id,
    });

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_WithTeacher",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
        homeroom_teacher_id: teacherPerson.employee!.id,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.homeroom_teacher_id).toBe(teacherPerson.employee!.id);
  });

  it("should reject a homeroom_teacher_id belonging to an employee whose job level is not a teaching role", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const masterData = await prismaClient.masterUnit.findFirstOrThrow({
      where: { name: { startsWith: "TEST_" } },
    });
    const position = await prismaClient.masterJobPosition.findFirstOrThrow({
      where: { name: { startsWith: "TEST_" } },
    });
    // The default TEST_ fixture level has is_teaching_role: false.
    const nonTeachingLevel = await prismaClient.masterJobLevel.findFirstOrThrow(
      { where: { name: { startsWith: "TEST_" } } },
    );
    const officeStaff = await EmployeeTest.create({
      email: "test_office_staff_class@millennia21.id",
      unitId: masterData.id,
      jobPositionId: position.id,
      jobLevelId: nonTeachingLevel.id,
    });

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_NonTeachingStaff",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
        homeroom_teacher_id: officeStaff.employee!.id,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("homeroom teacher");
  });

  it("should reject a homeroom_teacher_id belonging to a non-ACTIVE (e.g. resigned) employee", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const masterData = await prismaClient.masterUnit.findFirstOrThrow({
      where: { name: { startsWith: "TEST_" } },
    });
    const position = await prismaClient.masterJobPosition.findFirstOrThrow({
      where: { name: { startsWith: "TEST_" } },
    });
    // Explicitly a teaching-eligible level, so this test isolates the
    // status check — the only reason it should fail is RESIGNED status,
    // not job level.
    const teachingLevel = await prismaClient.masterJobLevel.create({
      data: { name: "TEST_LVL_TEACHER_A", is_teaching_role: true },
    });
    const resignedTeacher = await EmployeeTest.create({
      email: "test_teacher_resigned@millennia21.id",
      unitId: masterData.id,
      jobPositionId: position.id,
      jobLevelId: teachingLevel.id,
      status: EmployeeStatus.RESIGNED,
    });

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_ResignedTeacher",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
        homeroom_teacher_id: resignedTeacher.employee!.id,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("homeroom teacher");
  });

  it("should reject a homeroom_teacher_id belonging to a soft-deleted employee", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const masterData = await prismaClient.masterUnit.findFirstOrThrow({
      where: { name: { startsWith: "TEST_" } },
    });
    const position = await prismaClient.masterJobPosition.findFirstOrThrow({
      where: { name: { startsWith: "TEST_" } },
    });
    // Explicitly a teaching-eligible level, so this test isolates the
    // soft-delete check — the only reason it should fail is deleted_at,
    // not job level.
    const teachingLevel = await prismaClient.masterJobLevel.create({
      data: { name: "TEST_LVL_TEACHER_B", is_teaching_role: true },
    });
    const deletedTeacher = await EmployeeTest.create({
      email: "test_teacher_deleted@millennia21.id",
      unitId: masterData.id,
      jobPositionId: position.id,
      jobLevelId: teachingLevel.id,
    });
    await prismaClient.employee.update({
      where: { id: deletedTeacher.employee!.id },
      data: { deleted_at: new Date(), status: EmployeeStatus.ARCHIVED },
    });

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_DeletedTeacher",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
        homeroom_teacher_id: deletedTeacher.employee!.id,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("homeroom teacher");
  });

  it("should reject assigning a teacher who is already homeroom teacher of another class in the same academic year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const teacher = await createTeachingEmployee(
      "test_teacher_double_book@millennia21.id",
    );
    await ClassTest.create({
      name: "TEST_FirstClass",
      gradeId: gradeOneId,
      academicYearId,
      homeroomTeacherId: teacher.id,
    });

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_SecondClass",
        grade_id: gradeTwoId,
        academic_year_id: academicYearId,
        homeroom_teacher_id: teacher.id,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already the homeroom teacher");
  });

  it("should allow assigning the same teacher to classes in different academic years", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const teacher = await createTeachingEmployee(
      "test_teacher_multi_year@millennia21.id",
    );
    await ClassTest.create({
      name: "TEST_YearOneClass",
      gradeId: gradeOneId,
      academicYearId,
      homeroomTeacherId: teacher.id,
    });
    const otherYear = await prismaClient.academicYear.create({
      data: { name: "Test Year Other", status: AcademicYearStatus.UPCOMING },
    });

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_YearTwoClass",
        grade_id: gradeOneId,
        academic_year_id: otherYear.id,
        homeroom_teacher_id: teacher.id,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.homeroom_teacher_id).toBe(teacher.id);
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

  it("should reject update (403 Forbidden) when requested by DATABASE_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const klass = await ClassTest.create({
      name: "TEST_Blocked",
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

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
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
      data: { name: "Test Year Other", status: AcademicYearStatus.UPCOMING },
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

  it("should reject an invalid homeroom_teacher_id", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_BadTeacherUpdate",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}`,
      { homeroom_teacher_id: "invalid-employee-id" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("homeroom teacher");
  });

  it("should allow clearing an assigned homeroom teacher", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const masterData = await prismaClient.masterUnit.findFirstOrThrow({
      where: { name: { startsWith: "TEST_" } },
    });
    const position = await prismaClient.masterJobPosition.findFirstOrThrow({
      where: { name: { startsWith: "TEST_" } },
    });
    const level = await prismaClient.masterJobLevel.findFirstOrThrow({
      where: { name: { startsWith: "TEST_" } },
    });
    const teacherPerson = await EmployeeTest.create({
      email: "test_teacher_clear@millennia21.id",
      unitId: masterData.id,
      jobPositionId: position.id,
      jobLevelId: level.id,
    });
    const klass = await ClassTest.create({
      name: "TEST_ClearTeacher",
      gradeId: gradeOneId,
      academicYearId,
      homeroomTeacherId: teacherPerson.employee!.id,
    });

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}`,
      { homeroom_teacher_id: null },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.homeroom_teacher_id).toBeNull();
  });

  it("should reject reassigning a class to a teacher who already homerooms another class in the same academic year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const teacher = await createTeachingEmployee(
      "test_teacher_double_book_update@millennia21.id",
    );
    await ClassTest.create({
      name: "TEST_AlreadyTaken",
      gradeId: gradeOneId,
      academicYearId,
      homeroomTeacherId: teacher.id,
    });
    const target = await ClassTest.create({
      name: "TEST_WantsSameTeacher",
      gradeId: gradeOneId,
      academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/classes/${target.id}`,
      { homeroom_teacher_id: teacher.id },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already the homeroom teacher");
  });

  it("should allow re-saving a class with the same homeroom_teacher_id it already has", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const teacher = await createTeachingEmployee(
      "test_teacher_resave@millennia21.id",
    );
    const klass = await ClassTest.create({
      name: "TEST_ResaveSameTeacher",
      gradeId: gradeOneId,
      academicYearId,
      homeroomTeacherId: teacher.id,
    });

    const response = await TestRequest.patch(
      `/api/admin/classes/${klass.id}`,
      { homeroom_teacher_id: teacher.id, status: ClassStatus.INACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.homeroom_teacher_id).toBe(teacher.id);
    expect(body.data.status).toBe(ClassStatus.INACTIVE);
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
      data: { name: "Test Year Other", status: AcademicYearStatus.UPCOMING },
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
});

describe("DELETE /api/admin/classes/:id", () => {
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
    // FK order: enrollment -> student/person -> class -> academic_year
    await prismaClient.studentClassEnrollment.deleteMany({
      where: { class_name_snapshot: { startsWith: "TEST_" } },
    });
    await prismaClient.student.deleteMany({
      where: { nis: { startsWith: "TEST_NIS_" } },
    });
    await prismaClient.person.deleteMany({
      where: { email: { contains: "@millennia21.id" } },
    });
    await ClassTest.delete();
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

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.delete("/api/admin/classes/whatever");
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("Class homeroom teacher assignment history", () => {
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
    // Deleting the Class rows cascade-deletes their
    // ClassHomeroomAssignment rows (onDelete: Cascade), so no separate
    // cleanup is needed for that table.
    await ClassTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should create an open assignment row when a class is created with a homeroom teacher", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const teacher = await createTeachingEmployee(
      "test_teacher_history_create@millennia21.id",
    );

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_HistoryCreate",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
        homeroom_teacher_id: teacher.id,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);
    expect(response.status).toBe(200);

    const assignments = await prismaClient.classHomeroomAssignment.findMany({
      where: { class_id: body.data.id },
    });
    expect(assignments.length).toBe(1);
    expect(assignments[0]?.employee_id).toBe(teacher.id);
    expect(assignments[0]?.end_date).toBeNull();
  });

  it("should not create any assignment row when a class is created without a homeroom teacher", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_HistoryNoTeacher",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);
    expect(response.status).toBe(200);

    const assignments = await prismaClient.classHomeroomAssignment.findMany({
      where: { class_id: body.data.id },
    });
    expect(assignments.length).toBe(0);
  });

  it("should close the old assignment and open a new one when the homeroom teacher changes", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const teacherA = await createTeachingEmployee(
      "test_teacher_history_a@millennia21.id",
    );
    const teacherB = await createTeachingEmployee(
      "test_teacher_history_b@millennia21.id",
    );
    const createResponse = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_HistorySwap",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
        homeroom_teacher_id: teacherA.id,
      },
      accessToken,
    );
    const created = await createResponse.json();

    const response = await TestRequest.patch(
      `/api/admin/classes/${created.data.id}`,
      { homeroom_teacher_id: teacherB.id },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);
    expect(response.status).toBe(200);

    const assignments = await prismaClient.classHomeroomAssignment.findMany({
      where: { class_id: created.data.id },
      orderBy: { start_date: "asc" },
    });
    expect(assignments.length).toBe(2);
    expect(assignments[0]?.employee_id).toBe(teacherA.id);
    expect(assignments[0]?.end_date).not.toBeNull();
    expect(assignments[1]?.employee_id).toBe(teacherB.id);
    expect(assignments[1]?.end_date).toBeNull();
  });

  it("should close the assignment without opening a new one when the homeroom teacher is cleared", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const teacher = await createTeachingEmployee(
      "test_teacher_history_clear@millennia21.id",
    );
    const createResponse = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_HistoryClear",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
        homeroom_teacher_id: teacher.id,
      },
      accessToken,
    );
    const created = await createResponse.json();

    const response = await TestRequest.patch(
      `/api/admin/classes/${created.data.id}`,
      { homeroom_teacher_id: null },
      accessToken,
    );
    logger.debug(await response.json());
    expect(response.status).toBe(200);

    const assignments = await prismaClient.classHomeroomAssignment.findMany({
      where: { class_id: created.data.id },
    });
    expect(assignments.length).toBe(1);
    expect(assignments[0]?.employee_id).toBe(teacher.id);
    expect(assignments[0]?.end_date).not.toBeNull();
  });

  it("should not touch assignment history when updating unrelated fields", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const teacher = await createTeachingEmployee(
      "test_teacher_history_untouched@millennia21.id",
    );
    const createResponse = await TestRequest.post(
      "/api/admin/classes",
      {
        name: "TEST_HistoryUntouched",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
        homeroom_teacher_id: teacher.id,
      },
      accessToken,
    );
    const created = await createResponse.json();

    const response = await TestRequest.patch(
      `/api/admin/classes/${created.data.id}`,
      { status: ClassStatus.INACTIVE },
      accessToken,
    );
    logger.debug(await response.json());
    expect(response.status).toBe(200);

    const assignments = await prismaClient.classHomeroomAssignment.findMany({
      where: { class_id: created.data.id },
    });
    expect(assignments.length).toBe(1);
    expect(assignments[0]?.employee_id).toBe(teacher.id);
    expect(assignments[0]?.end_date).toBeNull();
  });

  it("rejects a second class with the same (academic_year_id, homeroom_teacher_id) even when written directly through Prisma, bypassing the service-level check", async () => {
    const teacher = await createTeachingEmployee(
      "test_teacher_history_race@millennia21.id",
    );
    await prismaClient.class.create({
      data: {
        name: "TEST_RaceClassA",
        grade_id: gradeOneId,
        academic_year_id: academicYearId,
        homeroom_teacher_id: teacher.id,
      },
    });

    let threw = false;
    try {
      await prismaClient.class.create({
        data: {
          name: "TEST_RaceClassB",
          grade_id: gradeOneId,
          academic_year_id: academicYearId,
          homeroom_teacher_id: teacher.id,
        },
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    const conflictingCount = await prismaClient.class.count({
      where: {
        academic_year_id: academicYearId,
        homeroom_teacher_id: teacher.id,
      },
    });
    expect(conflictingCount).toBe(1);
  });
});

describe("GET /api/admin/classes/:id/homeroom-history", () => {
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
        homeroom_teacher_id: teacherA.id,
      },
      accessToken,
    );
    const created = await createResponse.json();
    await TestRequest.patch(
      `/api/admin/classes/${created.data.id}`,
      { homeroom_teacher_id: teacherB.id },
      accessToken,
    );

    const response = await TestRequest.get(
      `/api/admin/classes/${created.data.id}/homeroom-history`,
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
      `/api/admin/classes/${klass.id}/homeroom-history`,
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
        `/api/admin/classes/${klass.id}/homeroom-history`,
        token,
      );
      expect(response.status).toBe(200);
    }
  });

  it("should reject if the class does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/classes/invalid-cuid-123/homeroom-history",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("not found");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get(
      "/api/admin/classes/whatever/homeroom-history",
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});
