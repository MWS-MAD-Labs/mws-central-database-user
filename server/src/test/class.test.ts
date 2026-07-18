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
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

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

  it("should default to ACTIVE status when status is omitted", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/classes",
      { name: "TEST_Minimal", grade_id: gradeOneId, academic_year_id: academicYearId },
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
      { name: "TEST_Blocked", grade_id: gradeOneId, academic_year_id: academicYearId },
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
      { name: "TEST_Blocked2", grade_id: gradeOneId, academic_year_id: academicYearId },
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
      { name: "TEST_Duplicate", grade_id: gradeOneId, academic_year_id: academicYearId },
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
      { name: "TEST_Reused", grade_id: gradeOneId, academic_year_id: otherYear.id },
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
    const level = await prismaClient.masterJobLevel.findFirstOrThrow({
      where: { name: { startsWith: "TEST_" } },
    });
    const teacherPerson = await EmployeeTest.create({
      email: "test_teacher_class@millennia21.id",
      unitId: masterData.id,
      jobPositionId: position.id,
      jobLevelId: level.id,
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
    const { accessToken: superAdminToken } = await AdminUserTest.createSuperAdmin();
    const { accessToken: dbAdminToken } = await AdminUserTest.createDatabaseAdmin();
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
    await ClassTest.create({ name: "TEST_A", gradeId: gradeOneId, academicYearId });
    await ClassTest.create({ name: "TEST_B", gradeId: gradeOneId, academicYearId });
    await ClassTest.create({ name: "TEST_C", gradeId: gradeOneId, academicYearId });

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
    await ClassTest.create({ name: "TEST_G1", gradeId: gradeOneId, academicYearId });
    await ClassTest.create({ name: "TEST_G2", gradeId: gradeTwoId, academicYearId });

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
    await ClassTest.create({ name: "TEST_Y1", gradeId: gradeOneId, academicYearId });
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
    await ClassTest.create({ name: "TEST_Zebra", gradeId: gradeOneId, academicYearId });
    await ClassTest.create({ name: "TEST_Alpha", gradeId: gradeOneId, academicYearId });

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
    await ClassTest.create({ name: "TEST_HighGrade", gradeId: gradeTwoId, academicYearId });
    await ClassTest.create({ name: "TEST_LowGrade", gradeId: gradeOneId, academicYearId });

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
      data: { person_id: person.id, nis: "TEST_NIS_ENROLLED_001" },
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
