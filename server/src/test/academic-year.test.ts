import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  AcademicYearTest,
  AuditLogTest,
  MasterDataTest,
  ClassTest,
  GradeTest,
  StudentTest,
  EnrollmentTest,
  EmployeeTest,
} from "./test-utils";
import {
  AcademicYearStatus,
  AuditAction,
  AuditSource,
  ClassStatus,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

// Names are relative to "today" rather than hardcoded, so the suite doesn't
// start failing on its own once real time drifts past a hardcoded year.
const CURRENT_YEAR = new Date().getFullYear();
const PREVIOUS_VALID_YEAR_NAME = `${CURRENT_YEAR - 1}/${CURRENT_YEAR}`;
const VALID_YEAR_NAME = `${CURRENT_YEAR}/${CURRENT_YEAR + 1}`;
const OTHER_VALID_YEAR_NAME = `${CURRENT_YEAR + 1}/${CURRENT_YEAR + 2}`;
const TOO_FAR_YEAR_NAME = `${CURRENT_YEAR + 10}/${CURRENT_YEAR + 11}`;

describe("POST /api/admin/academic-years", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should successfully create an academic year when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      {
        name: VALID_YEAR_NAME,
        start_date: new Date(`${CURRENT_YEAR}-07-01`).toISOString(),
        end_date: new Date(`${CURRENT_YEAR + 1}-06-30`).toISOString(),
        status: AcademicYearStatus.UPCOMING,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.name).toBe(VALID_YEAR_NAME);
    expect(body.data.status).toBe(AcademicYearStatus.UPCOMING);
    expect(body.data.start_date).toBeDefined();
    expect(body.data.end_date).toBeDefined();

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: body.data.id },
    });
    logger.debug(auditLog);

    expect(auditLog.action).toBe(AuditAction.CREATE_ACADEMIC_YEAR);
    expect(auditLog.source).toBe(AuditSource.UI);
    expect(auditLog.entity_type).toBe("AcademicYear");
    expect(auditLog.admin_id).toBe(admin.id);
    expect(auditLog.old_values).toBeNull();
    expect((auditLog.new_values as { name?: string })?.name).toBe(
      VALID_YEAR_NAME,
    );
  });

  it("should reject creation without a start_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      { name: VALID_YEAR_NAME },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should default to UPCOMING status and allow omitting end_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      {
        name: VALID_YEAR_NAME,
        start_date: new Date(`${CURRENT_YEAR}-07-01`).toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(AcademicYearStatus.UPCOMING);
    expect(body.data.start_date).toBeDefined();
    expect(body.data.end_date).toBeNull();
  });

  it("should reject creation (403 Forbidden) when requested by DATABASE_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      { name: "Test Year Blocked" },
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
      "/api/admin/academic-years",
      { name: "Test Year Blocked 2" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });

  it("should reject a duplicate name", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await AcademicYearTest.create(); // name: PREVIOUS_VALID_YEAR_NAME

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      {
        name: PREVIOUS_VALID_YEAR_NAME,
        start_date: new Date(`${CURRENT_YEAR - 1}-07-01`).toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already exists");
  });

  it("should reject creating a second ACTIVE academic year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await AcademicYearTest.create(); // status: ACTIVE

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      {
        name: OTHER_VALID_YEAR_NAME,
        status: AcademicYearStatus.ACTIVE,
        start_date: new Date(`${CURRENT_YEAR + 1}-07-01`).toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already active");

    const created = await prismaClient.academicYear.findUnique({
      where: { name: OTHER_VALID_YEAR_NAME },
    });
    expect(created).toBeNull();
  });

  it("should successfully create a new ACTIVE academic year when none is currently active", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      {
        name: VALID_YEAR_NAME,
        status: AcademicYearStatus.ACTIVE,
        start_date: new Date(`${CURRENT_YEAR}-07-01`).toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(AcademicYearStatus.ACTIVE);
  });

  it("should reject a name that isn't in YYYY/YYYY format", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      { name: "2026-2027" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("YYYY/YYYY");
  });

  it("should reject a name where the second year isn't exactly one more than the first", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      { name: `${CURRENT_YEAR}/${CURRENT_YEAR + 2}` },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("one year after");
  });

  it("should reject activating an academic year whose name is too far from the current year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      {
        name: TOO_FAR_YEAR_NAME,
        status: AcademicYearStatus.ACTIVE,
        start_date: new Date(`${CURRENT_YEAR + 10}-07-01`).toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain(
      "doesn't look like the current academic year",
    );

    const created = await prismaClient.academicYear.findUnique({
      where: { name: TOO_FAR_YEAR_NAME },
    });
    expect(created).toBeNull();
  });

  it("should allow creating a far-future academic year as UPCOMING (the year check only applies to ACTIVE)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      {
        name: TOO_FAR_YEAR_NAME,
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date(`${CURRENT_YEAR + 10}-07-01`).toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(AcademicYearStatus.UPCOMING);
  });

  it("should reject a start_date whose year doesn't match the name's first year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      {
        name: VALID_YEAR_NAME,
        start_date: new Date(`${CURRENT_YEAR - 1}-07-01`).toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("start_date must fall within");
  });

  it("should reject an end_date whose year doesn't match the name's second year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      {
        name: VALID_YEAR_NAME,
        start_date: new Date(`${CURRENT_YEAR}-07-01`).toISOString(),
        end_date: new Date(`${CURRENT_YEAR + 5}-06-30`).toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("end_date must fall within");
  });

  it("should accept start_date/end_date years that match the name exactly", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      {
        name: VALID_YEAR_NAME,
        start_date: new Date(`${CURRENT_YEAR}-07-01`).toISOString(),
        end_date: new Date(`${CURRENT_YEAR + 1}-06-30`).toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
  });

  it("should reject a start_date that overlaps with the previous academic year's end_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await prismaClient.academicYear.create({
      data: {
        name: PREVIOUS_VALID_YEAR_NAME,
        start_date: new Date(`${CURRENT_YEAR - 1}-07-01`),
        end_date: new Date(`${CURRENT_YEAR}-06-30`),
      },
    });

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      {
        name: VALID_YEAR_NAME,
        start_date: new Date(`${CURRENT_YEAR}-06-01`).toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("overlaps with academic year");
  });

  it("should reject an end_date that overlaps with the next academic year's start_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await prismaClient.academicYear.create({
      data: {
        name: OTHER_VALID_YEAR_NAME,
        start_date: new Date(`${CURRENT_YEAR + 1}-07-01`),
      },
    });

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      {
        name: VALID_YEAR_NAME,
        start_date: new Date(`${CURRENT_YEAR}-07-01`).toISOString(),
        end_date: new Date(`${CURRENT_YEAR + 1}-08-01`).toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("overlaps with academic year");
  });

  it("should allow adjacent academic years with a clean date boundary", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await prismaClient.academicYear.create({
      data: {
        name: PREVIOUS_VALID_YEAR_NAME,
        start_date: new Date(`${CURRENT_YEAR - 1}-07-01`),
        end_date: new Date(`${CURRENT_YEAR}-06-30`),
      },
    });

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      {
        name: VALID_YEAR_NAME,
        start_date: new Date(`${CURRENT_YEAR}-07-01`).toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
  });

  it("should reject a PATCH end_date that overlaps with the next academic year's start_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await prismaClient.academicYear.create({
      data: {
        name: VALID_YEAR_NAME,
        start_date: new Date(`${CURRENT_YEAR}-07-01`),
      },
    });
    await prismaClient.academicYear.create({
      data: {
        name: OTHER_VALID_YEAR_NAME,
        start_date: new Date(`${CURRENT_YEAR + 1}-07-01`),
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${year.id}`,
      { end_date: new Date(`${CURRENT_YEAR + 1}-08-01`).toISOString() },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("overlaps with academic year");
  });

  it("should reject creation (400 Bad Request) if name is missing", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject creation (400 Bad Request) if start_date is not before end_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      {
        name: "Test Year Bad Range",
        start_date: new Date("2027-06-30").toISOString(),
        end_date: new Date("2027-01-01").toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("start_date must be before end_date");
  });

  it("should reject creation (400 Bad Request) if start_date is not a valid ISO-8601 datetime", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      { name: "Test Year Bad Date Format", start_date: "not-a-date" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject creation (400 Bad Request) if name exceeds 50 characters", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      { name: `Test Year ${"X".repeat(50)}` },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.post("/api/admin/academic-years", {
      name: "Test Year No Auth",
    });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("PATCH /api/admin/academic-years/:id", () => {
  let masterData: Awaited<ReturnType<typeof MasterDataTest.create>>;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    // Order matters - EnrollmentTest/StudentTest before ClassTest/GradeTest
    // before AcademicYearTest, same as enrollment.test.ts's cleanup(): a
    // student/enrollment still pointing at a class/grade/year blocks that
    // row's own delete, and a class/grade still pointing at a year makes
    // AcademicYearTest.delete()'s own "nothing attached" filter skip it,
    // permanently squatting on that year's unique name for every later test.
    await EnrollmentTest.delete();
    await StudentTest.delete();
    await ClassTest.delete();
    await EmployeeTest.delete();
    await GradeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EnrollmentTest.delete();
    await StudentTest.delete();
    await ClassTest.delete();
    await EmployeeTest.delete();
    await GradeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  // Raw insert, bypassing ClassService's assign-time business rules (real
  // job position, capacity, etc.) - this describe block only needs a valid
  // open (end_date: null) ClassTeacherAssignment row to exercise the
  // cascade, not a realistic one.
  async function createActiveTeacherAssignmentInClass(classId: string) {
    const employee = await EmployeeTest.create({
      email: `test_teacher_unresolved_${Date.now()}@millennia21.id`,
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
    });
    return prismaClient.classTeacherAssignment.create({
      data: { class_id: classId, employee_id: employee.employee!.id },
    });
  }

  it("should successfully update an academic year when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await AcademicYearTest.create();

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${year.id}`,
      { status: AcademicYearStatus.COMPLETED },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(AcademicYearStatus.COMPLETED);

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: year.id },
    });
    logger.debug(auditLog);

    expect(auditLog.action).toBe(AuditAction.UPDATE_ACADEMIC_YEAR);
    expect(auditLog.entity_type).toBe("AcademicYear");
    expect(auditLog.admin_id).toBe(admin.id);
    const oldValues = auditLog.old_values as { status?: string };
    const newValues = auditLog.new_values as { status?: string };
    expect(oldValues?.status).toBe(AcademicYearStatus.ACTIVE);
    expect(newValues?.status).toBe(AcademicYearStatus.COMPLETED);
  });

  it("should deactivate the year's ACTIVE classes when it stops being ACTIVE", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await AcademicYearTest.create(); // status: ACTIVE
    const grade = await GradeTest.getByName("Grade 1");
    const activeClass = await ClassTest.create({
      name: "TEST_WasActive",
      gradeId: grade.id,
      academicYearId: year.id,
      status: ClassStatus.ACTIVE,
    });
    const alreadyInactiveClass = await ClassTest.create({
      name: "TEST_AlreadyInactive",
      gradeId: grade.id,
      academicYearId: year.id,
      status: ClassStatus.INACTIVE,
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${year.id}`,
      { status: AcademicYearStatus.COMPLETED },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);
    expect(response.status).toBe(200);

    const [reloadedActive, reloadedAlreadyInactive] = await Promise.all([
      prismaClient.class.findUniqueOrThrow({ where: { id: activeClass.id } }),
      prismaClient.class.findUniqueOrThrow({
        where: { id: alreadyInactiveClass.id },
      }),
    ]);
    expect(reloadedActive.status).toBe(ClassStatus.INACTIVE);
    expect(reloadedAlreadyInactive.status).toBe(ClassStatus.INACTIVE);

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: year.id, action: AuditAction.UPDATE_ACADEMIC_YEAR },
    });
    expect(
      (auditLog.new_values as { cascaded_classes_deactivated?: number })
        ?.cascaded_classes_deactivated,
    ).toBe(1);
  });

  it("should reject (400) moving an ACTIVE year to COMPLETED with teachers still actively assigned", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await AcademicYearTest.create(); // status: ACTIVE
    const grade = await GradeTest.getByName("Grade 1");
    const klass = await ClassTest.create({
      name: "TEST_ClassWithTeacher",
      gradeId: grade.id,
      academicYearId: year.id,
      status: ClassStatus.ACTIVE,
    });
    await createActiveTeacherAssignmentInClass(klass.id);

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${year.id}`,
      { status: AcademicYearStatus.COMPLETED },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("active assignment");

    const stillActive = await prismaClient.academicYear.findUniqueOrThrow({
      where: { id: year.id },
    });
    expect(stillActive.status).toBe(AcademicYearStatus.ACTIVE);

    const stillOpen = await prismaClient.class.findUniqueOrThrow({
      where: { id: klass.id },
    });
    expect(stillOpen.status).toBe(ClassStatus.ACTIVE);
  });

  it("should end open teacher assignments (with their own audit record) when confirmed, alongside deactivating the class", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await AcademicYearTest.create(); // status: ACTIVE
    const grade = await GradeTest.getByName("Grade 1");
    const klass = await ClassTest.create({
      name: "TEST_ClassWithTeacherConfirmed",
      gradeId: grade.id,
      academicYearId: year.id,
      status: ClassStatus.ACTIVE,
    });
    const assignment = await createActiveTeacherAssignmentInClass(klass.id);

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${year.id}`,
      {
        status: AcademicYearStatus.COMPLETED,
        confirm_unresolved_enrollments: true,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);
    expect(response.status).toBe(200);

    const reloadedClass = await prismaClient.class.findUniqueOrThrow({
      where: { id: klass.id },
    });
    expect(reloadedClass.status).toBe(ClassStatus.INACTIVE);

    const reloadedAssignment =
      await prismaClient.classTeacherAssignment.findUniqueOrThrow({
        where: { id: assignment.id },
      });
    expect(reloadedAssignment.end_date).not.toBeNull();

    const yearAuditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: year.id, action: AuditAction.UPDATE_ACADEMIC_YEAR },
    });
    expect(
      (yearAuditLog.new_values as {
        cascaded_teacher_assignments_ended?: number;
      })?.cascaded_teacher_assignments_ended,
    ).toBe(1);

    const assignmentAuditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: {
        entity_id: assignment.id,
        action: AuditAction.END_CLASS_TEACHER_ASSIGNMENT,
      },
    });
    expect(assignmentAuditLog.entity_type).toBe("ClassTeacherAssignment");
    expect(
      (assignmentAuditLog.new_values as { end_date?: string })?.end_date,
    ).not.toBeNull();
  });

  it("should allow moving an ACTIVE year to COMPLETED without confirmation when nothing is actively assigned or enrolled", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await AcademicYearTest.create(); // status: ACTIVE
    const grade = await GradeTest.getByName("Grade 1");
    const klass = await ClassTest.create({
      name: "TEST_ClassAlreadyEndedTeacher",
      gradeId: grade.id,
      academicYearId: year.id,
      status: ClassStatus.ACTIVE,
    });
    const assignment = await createActiveTeacherAssignmentInClass(klass.id);
    // Already ended before the update - shouldn't count against the gate.
    await prismaClient.classTeacherAssignment.update({
      where: { id: assignment.id },
      data: { end_date: new Date() },
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${year.id}`,
      { status: AcademicYearStatus.COMPLETED },
      accessToken,
    );

    expect(response.status).toBe(200);
  });

  async function createActiveEnrollmentInYear(academicYearId: string) {
    const grade = await prismaClient.grade.create({
      data: { name: `TEST_GradeUnresolved_${Date.now()}`, level: 9404 },
    });
    const klass = await ClassTest.create({
      name: `TEST_ClassUnresolved_${Date.now()}`,
      gradeId: grade.id,
      academicYearId,
      status: ClassStatus.ACTIVE,
    });
    const person = await prismaClient.person.create({
      data: {
        full_name: "Test Student Unresolved",
        nick_name: "Test",
        email: `test_student_unresolved_${Date.now()}@millennia21.id`,
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
        nis: `TEST_NIS_UNRES_${Date.now()}`,
        current_grade_id: grade.id,
        join_grade_id: grade.id,
        join_academic_year_id: academicYearId,
        current_class_id: klass.id,
        status: "ACTIVE",
      },
    });
    await prismaClient.studentClassEnrollment.create({
      data: {
        student_id: student.id,
        academic_year_id: academicYearId,
        class_id: klass.id,
        grade_level: grade.name,
        class_name_snapshot: klass.name,
        enrollment_status: "ACTIVE",
      },
    });
  }

  it("should reject (400) moving an ACTIVE year to COMPLETED with students still actively enrolled", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await AcademicYearTest.create(); // status: ACTIVE
    await createActiveEnrollmentInYear(year.id);

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${year.id}`,
      { status: AcademicYearStatus.COMPLETED },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("active enrollment");

    const stillActive = await prismaClient.academicYear.findUniqueOrThrow({
      where: { id: year.id },
    });
    expect(stillActive.status).toBe(AcademicYearStatus.ACTIVE);
  });

  it("should reject (400) moving an ACTIVE year to UPCOMING with students still actively enrolled", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await AcademicYearTest.create(); // status: ACTIVE
    await createActiveEnrollmentInYear(year.id);

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${year.id}`,
      { status: AcademicYearStatus.UPCOMING },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("active enrollment");
  });

  it("should allow moving an ACTIVE year to COMPLETED with active enrollments when confirmed", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await AcademicYearTest.create(); // status: ACTIVE
    await createActiveEnrollmentInYear(year.id);

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${year.id}`,
      {
        status: AcademicYearStatus.COMPLETED,
        confirm_unresolved_enrollments: true,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(AcademicYearStatus.COMPLETED);
  });

  it("should allow moving an ACTIVE year to COMPLETED without confirmation when nothing is actively enrolled", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await AcademicYearTest.create(); // status: ACTIVE

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${year.id}`,
      { status: AcademicYearStatus.COMPLETED },
      accessToken,
    );

    expect(response.status).toBe(200);
  });

  it("should deactivate stray ACTIVE classes even when the year skips straight from UPCOMING to COMPLETED", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const grade = await GradeTest.getByName("Grade 1");
    const upcomingYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Upcoming",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date(`${CURRENT_YEAR}-07-01`),
      },
    });
    // Shouldn't exist under normal use (the class-status guard blocks this),
    // but simulate stray/legacy data written outside the service layer.
    const strayActiveClass = await ClassTest.create({
      name: "TEST_StrayActive",
      gradeId: grade.id,
      academicYearId: upcomingYear.id,
      status: ClassStatus.ACTIVE,
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${upcomingYear.id}`,
      { status: AcademicYearStatus.COMPLETED },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);
    expect(response.status).toBe(200);

    const reloaded = await prismaClient.class.findUniqueOrThrow({
      where: { id: strayActiveClass.id },
    });
    expect(reloaded.status).toBe(ClassStatus.INACTIVE);
  });

  it("should deactivate the year's UPCOMING classes when it becomes COMPLETED", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const grade = await GradeTest.getByName("Grade 1");
    const upcomingYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Upcoming To Completed",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date(`${CURRENT_YEAR}-07-01`),
      },
    });
    const preppedClass = await ClassTest.create({
      name: "TEST_PreppedNeverStarted",
      gradeId: grade.id,
      academicYearId: upcomingYear.id,
      status: ClassStatus.UPCOMING,
    });

    // Year skips straight to COMPLETED without ever going ACTIVE - the
    // UPCOMING class is now stale and gets swept to INACTIVE.
    const completedResponse = await TestRequest.patch(
      `/api/admin/academic-years/${upcomingYear.id}`,
      { status: AcademicYearStatus.COMPLETED },
      accessToken,
    );
    expect(completedResponse.status).toBe(200);
    const afterCompleted = await prismaClient.class.findUniqueOrThrow({
      where: { id: preppedClass.id },
    });
    expect(afterCompleted.status).toBe(ClassStatus.INACTIVE);
  });

  it("should not reactivate classes when a year becomes ACTIVE again", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const grade = await GradeTest.getByName("Grade 1");
    const upcomingYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Upcoming",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date(`${CURRENT_YEAR}-07-01`),
      },
    });
    const inactiveClass = await ClassTest.create({
      name: "TEST_StaysInactive",
      gradeId: grade.id,
      academicYearId: upcomingYear.id,
      status: ClassStatus.INACTIVE,
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${upcomingYear.id}`,
      { status: AcademicYearStatus.ACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);
    expect(response.status).toBe(200);

    const reloaded = await prismaClient.class.findUniqueOrThrow({
      where: { id: inactiveClass.id },
    });
    expect(reloaded.status).toBe(ClassStatus.INACTIVE);
  });

  it("should bulk-activate a year's INACTIVE classes when activate_classes is true", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const grade = await GradeTest.getByName("Grade 1");
    const upcomingYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Upcoming",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date(`${CURRENT_YEAR}-07-01`),
      },
    });
    const inactiveClass = await ClassTest.create({
      name: "TEST_ToActivate",
      gradeId: grade.id,
      academicYearId: upcomingYear.id,
      status: ClassStatus.INACTIVE,
    });
    const alreadyActiveClass = await ClassTest.create({
      name: "TEST_AlreadyActive",
      gradeId: grade.id,
      academicYearId: upcomingYear.id,
      status: ClassStatus.ACTIVE,
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${upcomingYear.id}`,
      { status: AcademicYearStatus.ACTIVE, activate_classes: true },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);
    expect(response.status).toBe(200);

    const [reloadedInactive, reloadedActive] = await Promise.all([
      prismaClient.class.findUniqueOrThrow({ where: { id: inactiveClass.id } }),
      prismaClient.class.findUniqueOrThrow({
        where: { id: alreadyActiveClass.id },
      }),
    ]);
    expect(reloadedInactive.status).toBe(ClassStatus.ACTIVE);
    expect(reloadedActive.status).toBe(ClassStatus.ACTIVE);

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: {
        entity_id: upcomingYear.id,
        action: AuditAction.UPDATE_ACADEMIC_YEAR,
      },
    });
    expect(
      (auditLog.new_values as { cascaded_classes_activated?: number })
        ?.cascaded_classes_activated,
    ).toBe(1);
  });

  it("should bulk-activate a year's UPCOMING classes too when activate_classes is true", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const grade = await GradeTest.getByName("Grade 1");
    const upcomingYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Upcoming Prepped",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date(`${CURRENT_YEAR}-07-01`),
      },
    });
    const preppedClass = await ClassTest.create({
      name: "TEST_PreppedAheadOfTime",
      gradeId: grade.id,
      academicYearId: upcomingYear.id,
      status: ClassStatus.UPCOMING,
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${upcomingYear.id}`,
      { status: AcademicYearStatus.ACTIVE, activate_classes: true },
      accessToken,
    );
    expect(response.status).toBe(200);

    const reloaded = await prismaClient.class.findUniqueOrThrow({
      where: { id: preppedClass.id },
    });
    expect(reloaded.status).toBe(ClassStatus.ACTIVE);
  });

  it("should ignore activate_classes when the year isn't being set to ACTIVE", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const grade = await GradeTest.getByName("Grade 1");
    const upcomingYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Upcoming",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date(`${CURRENT_YEAR}-07-01`),
      },
    });
    const inactiveClass = await ClassTest.create({
      name: "TEST_StaysInactiveToo",
      gradeId: grade.id,
      academicYearId: upcomingYear.id,
      status: ClassStatus.INACTIVE,
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${upcomingYear.id}`,
      { activate_classes: true },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);
    expect(response.status).toBe(200);

    const reloaded = await prismaClient.class.findUniqueOrThrow({
      where: { id: inactiveClass.id },
    });
    expect(reloaded.status).toBe(ClassStatus.INACTIVE);
  });

  it("should reject update (403 Forbidden) when requested by DATABASE_ADMIN", async () => {
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin();
    const year = await AcademicYearTest.create();

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${year.id}`,
      { status: AcademicYearStatus.ACTIVE },
      dbAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });

  it("should reject renaming to an already-used name", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await AcademicYearTest.create();
    const otherYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Other",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date(`${CURRENT_YEAR}-07-01`),
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${otherYear.id}`,
      { name: year.name },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already exists");
  });

  it("should reject activating a second academic year while one is already active", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await AcademicYearTest.create(); // status: ACTIVE
    const upcoming = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Upcoming",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date(`${CURRENT_YEAR}-07-01`),
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${upcoming.id}`,
      { status: AcademicYearStatus.ACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already active");

    const stillUpcoming = await prismaClient.academicYear.findUnique({
      where: { id: upcoming.id },
    });
    expect(stillUpcoming?.status).toBe(AcademicYearStatus.UPCOMING);
  });

  it("should allow re-saving an already-active academic year without a false self-conflict", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    // name: PREVIOUS_VALID_YEAR_NAME (${CURRENT_YEAR - 1}/${CURRENT_YEAR}),
    // status: ACTIVE - end_date's year must match the name's second year.
    const year = await AcademicYearTest.create();

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${year.id}`,
      {
        status: AcademicYearStatus.ACTIVE,
        end_date: new Date(`${CURRENT_YEAR}-06-30`).toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(AcademicYearStatus.ACTIVE);
  });

  it("should successfully activate an UPCOMING academic year when none else is active", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const upcoming = await prismaClient.academicYear.create({
      data: {
        name: "Test Year To Activate",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date(`${CURRENT_YEAR}-07-01`),
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${upcoming.id}`,
      { status: AcademicYearStatus.ACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(AcademicYearStatus.ACTIVE);
  });

  it("should reject activating an UPCOMING academic year whose name is too far from the current year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const upcoming = await prismaClient.academicYear.create({
      data: {
        name: TOO_FAR_YEAR_NAME,
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date(`${CURRENT_YEAR + 10}-07-01`),
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${upcoming.id}`,
      { status: AcademicYearStatus.ACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain(
      "doesn't look like the current academic year",
    );

    const stillUpcoming = await prismaClient.academicYear.findUnique({
      where: { id: upcoming.id },
    });
    expect(stillUpcoming?.status).toBe(AcademicYearStatus.UPCOMING);
  });

  it("should reject (400) activating an UPCOMING academic year more than 30 days before its start_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const farStartDate = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);
    const upcoming = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Activate Too Early",
        status: AcademicYearStatus.UPCOMING,
        start_date: farStartDate,
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${upcoming.id}`,
      { status: AcademicYearStatus.ACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Too early to activate");

    const stillUpcoming = await prismaClient.academicYear.findUnique({
      where: { id: upcoming.id },
    });
    expect(stillUpcoming?.status).toBe(AcademicYearStatus.UPCOMING);
  });

  it("should allow activating an UPCOMING academic year within 30 days of its start_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const soonStartDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const upcoming = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Activate Soon",
        status: AcademicYearStatus.UPCOMING,
        start_date: soonStartDate,
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${upcoming.id}`,
      { status: AcademicYearStatus.ACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(AcademicYearStatus.ACTIVE);
  });

  it("should allow activating an UPCOMING academic year whose start_date has already passed", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const pastStartDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const upcoming = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Activate Already Started",
        status: AcademicYearStatus.UPCOMING,
        start_date: pastStartDate,
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${upcoming.id}`,
      { status: AcademicYearStatus.ACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
  });

  it("should reject (400) marking an ACTIVE academic year Completed more than 30 days before its end_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const farEndDate = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);
    const active = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Complete Too Early",
        status: AcademicYearStatus.ACTIVE,
        start_date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        end_date: farEndDate,
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${active.id}`,
      { status: AcademicYearStatus.COMPLETED },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Too early to mark");

    const stillActive = await prismaClient.academicYear.findUnique({
      where: { id: active.id },
    });
    expect(stillActive?.status).toBe(AcademicYearStatus.ACTIVE);
  });

  it("should allow marking an ACTIVE academic year Completed within 30 days of its end_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const soonEndDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const active = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Complete Soon",
        status: AcademicYearStatus.ACTIVE,
        start_date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        end_date: soonEndDate,
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${active.id}`,
      { status: AcademicYearStatus.COMPLETED },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(AcademicYearStatus.COMPLETED);
  });

  it("should allow marking an ACTIVE academic year Completed after its end_date has passed", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const pastEndDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const active = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Complete Already Over",
        status: AcademicYearStatus.ACTIVE,
        start_date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        end_date: pastEndDate,
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${active.id}`,
      { status: AcademicYearStatus.COMPLETED },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
  });

  it("should allow marking an ACTIVE academic year Completed when it has no end_date set", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const active = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Complete No End Date",
        status: AcademicYearStatus.ACTIVE,
        start_date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${active.id}`,
      { status: AcademicYearStatus.COMPLETED },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
  });

  it("should reject (400) moving an ACTIVE academic year to Upcoming more than 30 days before its end_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const farEndDate = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);
    const active = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Upcoming Too Early",
        status: AcademicYearStatus.ACTIVE,
        start_date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        end_date: farEndDate,
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${active.id}`,
      { status: AcademicYearStatus.UPCOMING },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Too early to move");

    const stillActive = await prismaClient.academicYear.findUnique({
      where: { id: active.id },
    });
    expect(stillActive?.status).toBe(AcademicYearStatus.ACTIVE);
  });

  it("should allow moving an ACTIVE academic year to Upcoming within 30 days of its end_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const soonEndDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const active = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Upcoming Soon",
        status: AcademicYearStatus.ACTIVE,
        start_date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        end_date: soonEndDate,
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${active.id}`,
      { status: AcademicYearStatus.UPCOMING },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(AcademicYearStatus.UPCOMING);
  });

  it("should allow moving an ACTIVE academic year to Upcoming when it has no end_date set", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const active = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Upcoming No End Date",
        status: AcademicYearStatus.ACTIVE,
        start_date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${active.id}`,
      { status: AcademicYearStatus.UPCOMING },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
  });

  it("should allow updating other fields without changing the name (no-op rename)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await AcademicYearTest.create();

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${year.id}`,
      { name: year.name, status: AcademicYearStatus.COMPLETED },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.name).toBe(year.name);
    expect(body.data.status).toBe(AcademicYearStatus.COMPLETED);
  });

  it("should reject if the resulting date range is invalid", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Range",
        start_date: new Date("2027-01-01"),
        end_date: new Date("2027-12-31"),
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${year.id}`,
      { end_date: new Date("2026-01-01").toISOString() },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("start_date must be before end_date");
  });

  it("should reject a PATCH that sets an end_date whose year doesn't match the name's second year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await prismaClient.academicYear.create({
      data: {
        name: VALID_YEAR_NAME,
        start_date: new Date(`${CURRENT_YEAR}-07-01`),
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${year.id}`,
      { end_date: new Date(`${CURRENT_YEAR + 5}-06-30`).toISOString() },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("end_date must fall within");
  });

  it("should reject if the academic year does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.patch(
      "/api/admin/academic-years/invalid-cuid-123",
      { status: AcademicYearStatus.ACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("not found");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch(
      "/api/admin/academic-years/whatever",
      { status: AcademicYearStatus.ACTIVE },
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("GET /api/admin/academic-years/:id", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should be readable by SUPER_ADMIN, DATABASE_ADMIN, and VIEWER alike", async () => {
    const year = await AcademicYearTest.create();
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin();
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin();
    const { accessToken: viewerToken } = await AdminUserTest.createViewer();

    for (const token of [superAdminToken, dbAdminToken, viewerToken]) {
      const response = await TestRequest.get(
        `/api/admin/academic-years/${year.id}`,
        token,
      );
      expect(response.status).toBe(200);
    }
  });

  it("should reject if the academic year does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/academic-years/invalid-cuid-123",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("not found");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get(
      "/api/admin/academic-years/whatever",
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("GET /api/admin/academic-years/:id/unresolved-enrollments", () => {
  let masterData: Awaited<ReturnType<typeof MasterDataTest.create>>;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EnrollmentTest.delete();
    await StudentTest.delete();
    await ClassTest.delete();
    await EmployeeTest.delete();
    await GradeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EnrollmentTest.delete();
    await StudentTest.delete();
    await ClassTest.delete();
    await EmployeeTest.delete();
    await GradeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should count active enrollments and distinct classes for the year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await AcademicYearTest.create();
    const grade = await prismaClient.grade.create({
      data: { name: "TEST_GradeUnresolvedGet", level: 9405 },
    });
    const klass = await ClassTest.create({
      name: "TEST_ClassUnresolvedGet",
      gradeId: grade.id,
      academicYearId: year.id,
      status: ClassStatus.ACTIVE,
    });

    for (const suffix of ["a", "b"]) {
      const person = await prismaClient.person.create({
        data: {
          full_name: `Test Student Unresolved Get ${suffix}`,
          nick_name: "Test",
          email: `test_student_unresolved_get_${suffix}@millennia21.id`,
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
          nis: `TEST_NIS_UNRES_GET_${suffix}`,
          current_grade_id: grade.id,
          join_grade_id: grade.id,
          join_academic_year_id: year.id,
          current_class_id: klass.id,
          status: "ACTIVE",
        },
      });
      await prismaClient.studentClassEnrollment.create({
        data: {
          student_id: student.id,
          academic_year_id: year.id,
          class_id: klass.id,
          grade_level: grade.name,
          class_name_snapshot: klass.name,
          enrollment_status: "ACTIVE",
        },
      });
    }

    const response = await TestRequest.get(
      `/api/admin/academic-years/${year.id}/unresolved-enrollments`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.active_enrollment_count).toBe(2);
    expect(body.data.class_count).toBe(1);
    expect(body.data.classes.length).toBe(1);
    expect(body.data.classes[0].class_id).toBe(klass.id);
    expect(body.data.classes[0].class_name).toBe("TEST_ClassUnresolvedGet");
    expect(body.data.classes[0].grade_name).toBe("TEST_GradeUnresolvedGet");
    expect(body.data.classes[0].active_student_count).toBe(2);
    expect(body.data.active_teacher_assignment_count).toBe(0);
    expect(body.data.classes[0].active_teacher_assignment_count).toBe(0);
  });

  it("should count active teacher assignments too, including a class with a teacher but no students", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await AcademicYearTest.create();
    const grade = await prismaClient.grade.create({
      data: { name: "TEST_GradeUnresolvedTeacher", level: 9406 },
    });
    const klass = await ClassTest.create({
      name: "TEST_ClassUnresolvedTeacher",
      gradeId: grade.id,
      academicYearId: year.id,
      status: ClassStatus.ACTIVE,
    });
    const employee = await EmployeeTest.create({
      email: "test_teacher_unresolved_get@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
    });
    await prismaClient.classTeacherAssignment.create({
      data: { class_id: klass.id, employee_id: employee.employee!.id },
    });

    const response = await TestRequest.get(
      `/api/admin/academic-years/${year.id}/unresolved-enrollments`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.active_enrollment_count).toBe(0);
    expect(body.data.active_teacher_assignment_count).toBe(1);
    expect(body.data.class_count).toBe(1);
    expect(body.data.classes[0].class_id).toBe(klass.id);
    expect(body.data.classes[0].active_student_count).toBe(0);
    expect(body.data.classes[0].active_teacher_assignment_count).toBe(1);
  });

  it("should reject if the academic year does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/academic-years/invalid-cuid-123/unresolved-enrollments",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("not found");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get(
      "/api/admin/academic-years/whatever/unresolved-enrollments",
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("GET /api/admin/academic-years", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should list and paginate academic years", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await prismaClient.academicYear.createMany({
      data: [
        {
          name: "Test Year A",
          status: AcademicYearStatus.COMPLETED,
          start_date: new Date("2026-01-01"),
        },
        {
          name: "Test Year B",
          status: AcademicYearStatus.ACTIVE,
          start_date: new Date("2026-02-01"),
        },
        {
          name: "Test Year C",
          status: AcademicYearStatus.UPCOMING,
          start_date: new Date("2026-03-01"),
        },
      ],
    });

    const response = await TestRequest.get(
      "/api/admin/academic-years?size=2&page=1&search=Test Year",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(2);
    expect(body.paging.total_item).toBe(3);
    expect(body.paging.total_page).toBe(2);
  });

  it("should filter by status", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await prismaClient.academicYear.createMany({
      data: [
        {
          name: "Test Year Active",
          status: AcademicYearStatus.ACTIVE,
          start_date: new Date("2026-01-01"),
        },
        {
          name: "Test Year Upcoming",
          status: AcademicYearStatus.UPCOMING,
          start_date: new Date("2026-02-01"),
        },
      ],
    });

    const response = await TestRequest.get(
      "/api/admin/academic-years?status=ACTIVE&search=Test Year",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Test Year Active");
  });

  it("should search by name", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await prismaClient.academicYear.createMany({
      data: [
        {
          name: "Test Year Sombrero",
          status: AcademicYearStatus.ACTIVE,
          start_date: new Date("2026-01-01"),
        },
        {
          name: "Test Year Fedora",
          status: AcademicYearStatus.UPCOMING,
          start_date: new Date("2026-02-01"),
        },
      ],
    });

    const response = await TestRequest.get(
      "/api/admin/academic-years?search=sombrero",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Test Year Sombrero");
  });

  it("should be readable by VIEWER", async () => {
    const { accessToken } = await AdminUserTest.createViewer();

    const response = await TestRequest.get(
      "/api/admin/academic-years",
      accessToken,
    );

    expect(response.status).toBe(200);
  });

  it("should be readable by DATABASE_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();

    const response = await TestRequest.get(
      "/api/admin/academic-years",
      accessToken,
    );

    expect(response.status).toBe(200);
  });

  it("should sort by name ascending when requested", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await prismaClient.academicYear.createMany({
      data: [
        {
          name: "Test Year Zebra",
          status: AcademicYearStatus.UPCOMING,
          start_date: new Date("2026-01-01"),
        },
        {
          name: "Test Year Alpha",
          status: AcademicYearStatus.UPCOMING,
          start_date: new Date("2026-02-01"),
        },
      ],
    });

    const response = await TestRequest.get(
      "/api/admin/academic-years?search=Test Year&sort_by=name&sort_order=asc",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.map((y: { name: string }) => y.name)).toEqual([
      "Test Year Alpha",
      "Test Year Zebra",
    ]);
  });

  it("should default to sorting by start_date descending when sort params are omitted", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await prismaClient.academicYear.createMany({
      data: [
        {
          name: "Test Year Early",
          status: AcademicYearStatus.UPCOMING,
          start_date: new Date("2025-07-01"),
        },
        {
          name: "Test Year Late",
          status: AcademicYearStatus.UPCOMING,
          start_date: new Date("2027-07-01"),
        },
      ],
    });

    const response = await TestRequest.get(
      "/api/admin/academic-years?search=Test Year",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.map((y: { name: string }) => y.name)).toEqual([
      "Test Year Late",
      "Test Year Early",
    ]);
  });

  it("should reject an invalid status filter value", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/academic-years?status=NOT_A_REAL_STATUS",
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
      "/api/admin/academic-years?sort_by=not_a_real_field",
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
      "/api/admin/academic-years?page=abc",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("page must be a valid number");
  });

  it("should reject a page number below 1", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/academic-years?page=0",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject a size greater than the maximum allowed (100)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/academic-years?size=101",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get("/api/admin/academic-years");
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("DELETE /api/admin/academic-years/:id", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    // FK order: enrollment -> student/class -> person/grade/academic_year
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
    await prismaClient.class.deleteMany({
      where: { name: { startsWith: "TEST_" } },
    });
    await prismaClient.grade.deleteMany({
      where: { name: { startsWith: "TEST_" } },
    });
    await AdminUserTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should delete an academic year not referenced by anything", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await AcademicYearTest.create();

    const response = await TestRequest.delete(
      `/api/admin/academic-years/${year.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data).toBe(true);

    const stillThere = await prismaClient.academicYear.findUnique({
      where: { id: year.id },
    });
    expect(stillThere).toBeNull();

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: year.id },
    });
    logger.debug(auditLog);

    expect(auditLog.action).toBe(AuditAction.DELETE_ACADEMIC_YEAR);
    expect(auditLog.entity_type).toBe("AcademicYear");
    expect(auditLog.admin_id).toBe(admin.id);
    const oldValues = auditLog.old_values as { name?: string };
    expect(oldValues?.name).toBe(year.name);
  });

  it("should reject deletion (403 Forbidden) when requested by DATABASE_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const year = await AcademicYearTest.create();

    const response = await TestRequest.delete(
      `/api/admin/academic-years/${year.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });

  it("should reject if the academic year does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.delete(
      "/api/admin/academic-years/invalid-cuid-123",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Academic year not found");
  });

  it("should reject deletion when a Class still references the academic year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await AcademicYearTest.create();
    const grade = await prismaClient.grade.create({
      data: { name: "TEST_Grade1", level: 9001 },
    });
    await prismaClient.class.create({
      data: {
        name: "TEST_Class1",
        grade_id: grade.id,
        academic_year_id: year.id,
      },
    });

    const response = await TestRequest.delete(
      `/api/admin/academic-years/${year.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("still referenced by");
    expect(body.errors).toContain("class(es)");

    const stillThere = await prismaClient.academicYear.findUnique({
      where: { id: year.id },
    });
    expect(stillThere).not.toBeNull();
  });

  it("should reject deletion when a student joined in that academic year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await AcademicYearTest.create();
    const grade = await prismaClient.grade.create({
      data: { name: "TEST_GradeJoin", level: 9003 },
    });
    const person = await prismaClient.person.create({
      data: {
        full_name: "Test Student Join",
        nick_name: "Test",
        email: "test_student_join@millennia21.id",
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
        nis: "TEST_NIS_001",
        join_academic_year_id: year.id,
        current_grade_id: grade.id,
        join_grade_id: grade.id,
      },
    });

    const response = await TestRequest.delete(
      `/api/admin/academic-years/${year.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("still referenced by");
    expect(body.errors).toContain("joined in this year");
  });

  it("should reject deletion when a StudentClassEnrollment still references the academic year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await AcademicYearTest.create();
    // The enrolled class lives in a *different* academic year on purpose —
    // Class and StudentClassEnrollment each carry their own academic_year_id
    // (the schema doesn't force them to match), so this isolates the
    // enrollmentCount branch of the delete-guard from the classCount one
    // already covered above.
    const otherYearForClass = await prismaClient.academicYear.create({
      data: {
        name: "Test Year For Class",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date(`${CURRENT_YEAR}-07-01`),
      },
    });
    const grade = await prismaClient.grade.create({
      data: { name: "TEST_GradeEnroll", level: 9002 },
    });
    const klass = await prismaClient.class.create({
      data: {
        name: "TEST_ClassEnroll",
        grade_id: grade.id,
        academic_year_id: otherYearForClass.id,
      },
    });
    const person = await prismaClient.person.create({
      data: {
        full_name: "Test Student Enroll",
        nick_name: "Test",
        email: "test_student_enroll@millennia21.id",
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
        nis: "TEST_NIS_ENROLL_001",
        current_grade_id: grade.id,
        join_grade_id: grade.id,
        join_academic_year_id: otherYearForClass.id,
      },
    });
    await prismaClient.studentClassEnrollment.create({
      data: {
        student_id: student.id,
        academic_year_id: year.id,
        class_id: klass.id,
        grade_level: "2",
        class_name_snapshot: klass.name,
      },
    });

    const response = await TestRequest.delete(
      `/api/admin/academic-years/${year.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("still referenced by");
    expect(body.errors).toContain("enrollment(s)");

    const stillThere = await prismaClient.academicYear.findUnique({
      where: { id: year.id },
    });
    expect(stillThere).not.toBeNull();
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.delete(
      "/api/admin/academic-years/whatever",
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("Database constraint: single active academic year", () => {
  beforeEach(async () => {
    await AcademicYearTest.delete();
  });

  afterEach(async () => {
    await AcademicYearTest.delete();
  });

  it("rejects a second ACTIVE row even when written directly through Prisma, bypassing the service-level check", async () => {
    await prismaClient.academicYear.create({
      data: {
        name: "Test Year Direct A",
        status: AcademicYearStatus.ACTIVE,
        start_date: new Date(`${CURRENT_YEAR}-07-01`),
      },
    });

    let threw = false;
    try {
      await prismaClient.academicYear.create({
        data: {
          name: "Test Year Direct B",
          status: AcademicYearStatus.ACTIVE,
          start_date: new Date(`${CURRENT_YEAR}-07-01`),
        },
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    const activeCount = await prismaClient.academicYear.count({
      where: {
        status: AcademicYearStatus.ACTIVE,
        name: { startsWith: "Test Year Direct" },
      },
    });
    expect(activeCount).toBe(1);
  });
});
