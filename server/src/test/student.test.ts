import { describe, afterEach, beforeEach, it, expect, spyOn } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  AcademicYearTest,
  AuditLogTest,
  MasterDataTest,
  GradeTest,
  StudentTest,
  ParentGuardianTest,
  ConsentTest,
  PCActivityTest,
  ClassTest,
  EnrollmentTest,
  EmployeeTest,
} from "./test-utils";
import {
  AcademicYearStatus,
  AuditAction,
  ConsentStatus,
  EnrollmentStatus,
  Gender,
  Religion,
  StudentStatus,
} from "../generated/prisma/client";
import { AuditService } from "../service/audit-service";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

describe("POST /api/admin/students", () => {
  let academicYearId: string;
  let gradeId: string;
  let higherGradeId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
    await AcademicYearTest.delete();
    const masterData = await MasterDataTest.create();
    const academicYear = await AcademicYearTest.create();
    academicYearId = academicYear.id;
    const grade = await prismaClient.grade.create({
      data: {
        name: "TEST_STU_GRADE1",
        level: 9101,
        unit_id: masterData.unit.id,
      },
    });
    gradeId = grade.id;
    const higherGrade = await prismaClient.grade.create({
      data: {
        name: "TEST_STU_GRADE2",
        level: 9102,
        unit_id: masterData.unit.id,
      },
    });
    higherGradeId = higherGrade.id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
    await AcademicYearTest.delete();
    await prismaClient.grade.deleteMany({
      where: { name: { startsWith: "TEST_STU_GRADE" } },
    });
  });

  it("should successfully create a student when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const requestBody = {
      full_name: "Test Student One",
      nick_name: "Stu One",
      email: "test_stu_1@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2012-01-01").toISOString(),

      nis: "9000001",
      entry_type: "PSB",
      nisn: "1234567890",
      current_grade_id: gradeId,
      join_academic_year_id: academicYearId,
      join_grade_id: gradeId,
    };

    const response = await TestRequest.post(
      "/api/admin/students",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.identity.full_name).toBe("Test Student One");
    expect(body.data.academic.nis).toBe("9000001");
    expect(body.data.academic.nisn).toBe("1234567890");
    expect(body.data.status).toBe("REGISTERED");

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: "CREATE_STUDENT", entity_id: body.data.id },
    });
    expect(auditLog.entity_type).toBe("Student");
  });

  it("should reject creating an ACTIVE student before class enrollment", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/students",
      {
        full_name: "Premature Active Student",
        nick_name: "Premature",
        email: "test_stu_premature_active@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("2012-01-01").toISOString(),
        nis: "9000099",
        entry_type: "PSB",
        status: StudentStatus.ACTIVE,
        current_grade_id: gradeId,
        join_academic_year_id: academicYearId,
        join_grade_id: gradeId,
      },
      accessToken,
    );

    expect(response.status).toBe(400);
  });

  it("should roll back student creation entirely if the audit log write fails", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const auditSpy = spyOn(AuditService, "record").mockRejectedValue(
      new Error("Simulated audit failure"),
    );

    try {
      const response = await TestRequest.post(
        "/api/admin/students",
        {
          full_name: "Rollback Test Student",
          nick_name: "Rollback",
          email: "test_stu_audit_rollback@millennia21.id",
          gender: Gender.MALE,
          religion: Religion.ISLAM,
          birth_place: "Jakarta",
          birth_date: new Date("2012-01-01").toISOString(),
          nis: "9000097",
          entry_type: "PSB",
          current_grade_id: gradeId,
          join_academic_year_id: academicYearId,
          join_grade_id: gradeId,
        },
        accessToken,
      );

      expect(response.status).toBe(500);

      // The person/student write happened in the same transaction as the
      // (mocked-to-fail) audit write - if the transaction didn't roll back,
      // this row would exist despite the request having failed.
      const person = await prismaClient.person.findUnique({
        where: { email: "test_stu_audit_rollback@millennia21.id" },
      });
      expect(person).toBeNull();
    } finally {
      auditSpy.mockRestore();
    }
  });

  it("should create and update pickup_drop_service, catering_service, and psb_guide", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const createResponse = await TestRequest.post(
      "/api/admin/students",
      {
        full_name: "Test Student Services",
        nick_name: "Stu Svc",
        email: "test_stu_services@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("2012-01-01").toISOString(),
        nis: "9000090",
        entry_type: "PSB",
        current_grade_id: gradeId,
        join_academic_year_id: academicYearId,
        join_grade_id: gradeId,
        pickup_drop_service: true,
        catering_service: true,
        psb_guide: true,
      },
      accessToken,
    );
    const created = await createResponse.json();
    expect(createResponse.status).toBe(200);

    const detailResponse = await TestRequest.get(
      `/api/admin/students/${created.data.id}`,
      accessToken,
    );
    const detail = await detailResponse.json();
    logger.debug(detail);

    expect(detail.data.academic.pickup_drop_service).toBe(true);
    expect(detail.data.academic.catering_service).toBe(true);
    expect(detail.data.academic.psb_guide).toBe(true);

    const updateResponse = await TestRequest.patch(
      `/api/admin/students/${created.data.id}`,
      { catering_service: false },
      accessToken,
    );
    expect(updateResponse.status).toBe(200);

    const updatedDetailResponse = await TestRequest.get(
      `/api/admin/students/${created.data.id}`,
      accessToken,
    );
    const updatedDetail = await updatedDetailResponse.json();

    expect(updatedDetail.data.academic.pickup_drop_service).toBe(true);
    expect(updatedDetail.data.academic.catering_service).toBe(false);
    expect(updatedDetail.data.academic.psb_guide).toBe(true);
  });

  it("should successfully create a student when requested by DATABASE_ADMIN with can_write_student_data", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();

    const requestBody = {
      full_name: "Test Student Two",
      nick_name: "Stu Two",
      email: "test_stu_2@millennia21.id",
      gender: Gender.FEMALE,
      religion: Religion.PROTESTANTISM,
      birth_place: "Bandung",
      birth_date: new Date("2012-02-02").toISOString(),

      nis: "9000002",
      entry_type: "PSB",
      join_academic_year_id: academicYearId,
      current_grade_id: gradeId,
      join_grade_id: gradeId,
    };

    const response = await TestRequest.post(
      "/api/admin/students",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.identity.full_name).toBe("Test Student Two");
  });

  it("should reject creation (403 Forbidden) when requested by VIEWER", async () => {
    const { accessToken } = await AdminUserTest.createViewer();

    const requestBody = {
      full_name: "Hacker Student",
      nick_name: "Hacker",
      email: "test_stu_hacker@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Unknown",
      birth_date: new Date().toISOString(),
      nis: "9000003",
      entry_type: "PSB",
      join_academic_year_id: academicYearId,
    };

    const response = await TestRequest.post(
      "/api/admin/students",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toBeDefined();

    const viewer = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_viewer@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: {
        action: AuditAction.UNAUTHORIZED_ACCESS,
        admin_id: viewer.id,
      },
    });
    expect(auditLog.new_values).toMatchObject({
      reason: "blocked student create",
    });
  });

  it("should reject creation (403) for DATABASE_ADMIN if can_write_student_data is false", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      undefined,
      { canWriteStudentData: false },
    );

    const requestBody = {
      full_name: "Test Student No Domain",
      nick_name: "Stu NoDomain",
      email: "test_stu_nodomain@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2012-03-03").toISOString(),
      nis: "9000006",
      entry_type: "PSB",
      join_academic_year_id: academicYearId,
    };

    const response = await TestRequest.post(
      "/api/admin/students",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain(
      "Forbidden: You don't have permission to write student data",
    );
  });

  it("should reject duplicate email", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await StudentTest.create({
      email: "test_stu_dup@millennia21.id",
      nis: "9000005",
    });

    const requestBody = {
      full_name: "Test Student Duplicate",
      nick_name: "Stu Dup",
      email: "test_stu_dup@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2012-04-04").toISOString(),
      nis: "9000006",
      entry_type: "PSB",
      join_academic_year_id: academicYearId,
      current_grade_id: gradeId,
      join_grade_id: gradeId,
    };

    const response = await TestRequest.post(
      "/api/admin/students",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Email already registered");
  });

  it("should reject duplicate NIS", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await StudentTest.create({
      email: "test_stu_nis1@millennia21.id",
      nis: "9000007",
    });

    const requestBody = {
      full_name: "Test Student NIS Dup",
      nick_name: "Stu NIS",
      email: "test_stu_nis2@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2012-05-05").toISOString(),
      nis: "9000007",
      entry_type: "PSB",
      join_academic_year_id: academicYearId,
      current_grade_id: gradeId,
      join_grade_id: gradeId,
    };

    const response = await TestRequest.post(
      "/api/admin/students",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("NIS already registered");
  });

  it("should reject duplicate NISN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await StudentTest.create({
      email: "test_stu_nisn1@millennia21.id",
      nis: "9000008",
      entry_type: "PSB",
      nisn: "9876543210",
    });

    const requestBody = {
      full_name: "Test Student NISN Dup",
      nick_name: "Stu NISN",
      email: "test_stu_nisn2@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2012-06-06").toISOString(),
      nis: "9000009",
      entry_type: "PSB",
      nisn: "9876543210",
      join_academic_year_id: academicYearId,
      current_grade_id: gradeId,
      join_grade_id: gradeId,
    };

    const response = await TestRequest.post(
      "/api/admin/students",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain(
      "NISN is already registered to another student",
    );
    expect(body.errors).toContain("Test Student");
    expect(body.errors).toContain("9000008");
  });

  it("should reject an invalid NISN format", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const requestBody = {
      full_name: "Test Student Bad NISN",
      nick_name: "Stu Bad",
      email: "test_stu_badnisn@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2012-07-07").toISOString(),
      nis: "9000010",
      entry_type: "PSB",
      nisn: "123",
      join_academic_year_id: academicYearId,
      current_grade_id: gradeId,
      join_grade_id: gradeId,
    };

    const response = await TestRequest.post(
      "/api/admin/students",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("NISN must be exactly 10 digits");
  });

  it("should accept a NIS that is exactly 7 digits", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const requestBody = {
      full_name: "Test Student NIS Valid",
      nick_name: "Stu NIS",
      email: "test_stu_nisvalid@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2012-07-08").toISOString(),
      nis: "9000100",
      entry_type: "PSB",
      join_academic_year_id: academicYearId,
      current_grade_id: gradeId,
      join_grade_id: gradeId,
    };

    const response = await TestRequest.post(
      "/api/admin/students",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.academic.nis).toBe("9000100");
  });

  it("should reject a NIS that is not exactly 7 digits or contains letters", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    for (const nis of ["900010", "90001000", "Z000010"]) {
      const requestBody = {
        full_name: "Test Student Bad NIS",
        nick_name: "Stu Bad",
        email: "test_stu_badnislen@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("2012-07-09").toISOString(),
        nis,
        join_academic_year_id: academicYearId,
        current_grade_id: gradeId,
        join_grade_id: gradeId,
      };

      const response = await TestRequest.post(
        "/api/admin/students",
        requestBody,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
      expect(body.errors).toContain("NIS must be exactly 7 digits");
    }
  });

  it("should create a student with only legacy_nis, leaving nis null", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const requestBody = {
      full_name: "Test Student Legacy NIS",
      nick_name: "Stu Legacy",
      email: "test_stu_legacynis@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2012-07-10").toISOString(),
      legacy_nis: "OLD-1234-XYZ",
      entry_type: "PSB",
      join_academic_year_id: academicYearId,
      current_grade_id: gradeId,
      join_grade_id: gradeId,
    };

    const response = await TestRequest.post(
      "/api/admin/students",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.academic.nis).toBeNull();
    expect(body.data.academic.legacy_nis).toBe("OLD-1234-XYZ");
  });

  it("should still auto-generate a nis when both nis and legacy_nis are omitted", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const requestBody = {
      full_name: "Test Student No Legacy",
      nick_name: "Stu NoLegacy",
      email: "test_stu_nolegacy@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2012-07-11").toISOString(),
      nis: "9000200",
      entry_type: "PSB",
      join_academic_year_id: academicYearId,
      current_grade_id: gradeId,
      join_grade_id: gradeId,
    };

    const response = await TestRequest.post(
      "/api/admin/students",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.academic.nis).toBe("9000200");
    expect(body.data.academic.legacy_nis).toBeNull();
  });

  it("should reject missing required fields", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/students",
      { full_name: "Incomplete Student" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject if join_academic_year_id is missing", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const requestBody = {
      full_name: "Test Student No Year",
      nick_name: "Stu NoYear",
      email: "test_stu_noyear@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2012-08-08").toISOString(),
      nis: "9000011",
      entry_type: "PSB",
    };

    const response = await TestRequest.post(
      "/api/admin/students",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject when current grade is lower than join grade", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const requestBody = {
      full_name: "Test Student Low Grade",
      nick_name: "Stu LowGrade",
      email: "test_stu_lowgrade@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2012-09-09").toISOString(),
      nis: "9000012",
      entry_type: "PSB",
      join_academic_year_id: academicYearId,
      join_grade_id: higherGradeId,
      current_grade_id: gradeId,
    };

    const response = await TestRequest.post(
      "/api/admin/students",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain(
      "Current grade cannot be lower than the grade the student joined at",
    );
  });

  it("should allow current grade higher than join grade (promoted/backfilled student)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const requestBody = {
      full_name: "Test Student Promoted",
      nick_name: "Stu Promoted",
      email: "test_stu_promoted@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2012-10-10").toISOString(),
      nis: "9000013",
      entry_type: "PSB",
      join_academic_year_id: academicYearId,
      join_grade_id: gradeId,
      current_grade_id: higherGradeId,
    };

    const response = await TestRequest.post(
      "/api/admin/students",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
  });

  it("should reject an invalid current_grade_id reference", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const requestBody = {
      full_name: "Test Student Bad Grade",
      nick_name: "Stu BadGrade",
      email: "test_stu_badgrade@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2012-11-11").toISOString(),
      nis: "9000014",
      entry_type: "PSB",
      join_academic_year_id: academicYearId,
      join_grade_id: gradeId,
      current_grade_id: "invalid-grade-id",
    };

    const response = await TestRequest.post(
      "/api/admin/students",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Invalid current grade");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.post("/api/admin/students", {
      full_name: "No Token Student",
    });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  it("should reject (403) a DATABASE_ADMIN creating a student outside their unit", async () => {
    const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Elementary" },
    });
    const { accessToken } =
      await AdminUserTest.createDatabaseAdmin(elementaryUnit.id);

    const requestBody = {
      full_name: "Test Student Cross Unit",
      nick_name: "Stu CrossUnit",
      email: "test_stu_crossunit@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2012-01-01").toISOString(),
      nis: "9000036",
      entry_type: "PSB",
      join_academic_year_id: academicYearId,
      // gradeId belongs to the default TEST_ unit, not "Elementary".
      current_grade_id: gradeId,
      join_grade_id: gradeId,
    };

    const response = await TestRequest.post(
      "/api/admin/students",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("unit scope");
  });
});

describe("GET /api/admin/students/:id", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EnrollmentTest.delete();
    await ClassTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EnrollmentTest.delete();
    await ClassTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
  });

  it("should be readable by SUPER_ADMIN, DATABASE_ADMIN, and VIEWER alike", async () => {
    const student = await StudentTest.create({
      email: "test_stu_readable@millennia21.id",
      nis: "9000015",
    });
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin();
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin();
    const { accessToken: viewerToken } = await AdminUserTest.createViewer();

    for (const token of [superAdminToken, dbAdminToken, viewerToken]) {
      const response = await TestRequest.get(
        `/api/admin/students/${student.student!.id}`,
        token,
      );
      expect(response.status).toBe(200);
    }
  });

  it("should return full detail (with sensitive fields) for SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_detail@millennia21.id",
      nis: "9000016",
      entry_type: "PSB",
      nisn: "1122334455",
    });

    const response = await TestRequest.get(
      `/api/admin/students/${student.student!.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.id).toBe(student.student!.id);
    expect(body.data.identity.full_name).toBe("Test Student");
    expect(body.data.identity.gender).toBe("MALE");
    expect(body.data.identity.birth_date).toBeDefined();
    expect(body.data.academic.current_class_id).toBeNull();
    expect(body.data.academic.graduation_grade).toBeNull();
    expect(body.data.academic.nis).toBe("9000016");
    expect(body.data.academic.nisn).toBe("1122334455");
  });

  it("should include current_class (name) alongside current_class_id when the student has an active class", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const gradeId = await StudentTest.resolveGradeId();
    const academicYearId = await StudentTest.resolveAcademicYearId();
    const klass = await ClassTest.create({
      name: "TEST_Class_Detail_CurrentClass",
      gradeId,
      academicYearId,
    });
    const student = await StudentTest.create({
      email: "test_stu_detail_class@millennia21.id",
      nis: "9000103",
      status: StudentStatus.ACTIVE,
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
      currentClassId: klass.id,
    });

    const response = await TestRequest.get(
      `/api/admin/students/${student.student!.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.academic.current_class_id).toBe(klass.id);
    expect(body.data.academic.current_class).toBe(klass.name);
  });

  it("should hide sensitive fields (birth_date, current_class_id, etc.) for DATABASE_ADMIN and VIEWER, but not gender/religion", async () => {
    const student = await StudentTest.create({
      email: "test_stu_limited@millennia21.id",
      nis: "9000017",
    });
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin();
    const { accessToken: viewerToken } = await AdminUserTest.createViewer();

    for (const token of [dbAdminToken, viewerToken]) {
      const response = await TestRequest.get(
        `/api/admin/students/${student.student!.id}`,
        token,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.identity.full_name).toBe("Test Student");
      expect(body.data.identity.gender).toBeDefined();
      expect(body.data.identity.religion).toBeDefined();
      expect(body.data.identity.birth_date).toBeUndefined();
      expect(body.data.identity.birth_place).toBeUndefined();
      expect(body.data.identity.photo_url).toBeUndefined();
      expect(body.data.academic.nis).toBe("9000017");
    }
  });

  it("should reject if the student does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/students/invalid-cuid-123",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toBeDefined();
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get("/api/admin/students/whatever");
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  it("should 404 for a DATABASE_ADMIN fetching a student outside their unit", async () => {
    const juniorHighGrade = await GradeTest.getByName("Grade 7");
    const student = await StudentTest.create({
      email: "test_stu_getunit_jh@millennia21.id",
      nis: "9000034",
      currentGradeId: juniorHighGrade.id,
    });

    const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Elementary" },
    });
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin(elementaryUnit.id);

    const response = await TestRequest.get(
      `/api/admin/students/${student.student!.id}`,
      dbAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toBe("Student not found");
  });

  it("should report has_class_history: false for a student with no enrollment records", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_no_history@millennia21.id",
      nis: "9000104",
    });

    const response = await TestRequest.get(
      `/api/admin/students/${student.student!.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.academic.has_class_history).toBe(false);
  });

  it("should report has_class_history: true once the student has an enrollment record", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const gradeId = await StudentTest.resolveGradeId();
    const academicYearId = await StudentTest.resolveAcademicYearId();
    const klass = await ClassTest.create({
      name: "TEST_Class_Detail_History",
      gradeId,
      academicYearId,
    });
    const student = await StudentTest.create({
      email: "test_stu_has_history@millennia21.id",
      nis: "9000105",
      status: StudentStatus.GRADUATED,
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });
    await EnrollmentTest.create({
      studentId: student.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "TEST_STU_GRADE1",
      classNameSnapshot: klass.name,
      startDate: new Date("2025-08-01"),
      endDate: new Date("2026-06-01"),
      status: EnrollmentStatus.COMPLETED,
    });

    const response = await TestRequest.get(
      `/api/admin/students/${student.student!.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.academic.has_class_history).toBe(true);
  });

  it("should let a DATABASE_ADMIN with can_view_all_units fetch a student outside their unit", async () => {
    const juniorHighGrade = await GradeTest.getByName("Grade 7");
    const student = await StudentTest.create({
      email: "test_stu_getunit_allunits@millennia21.id",
      nis: "9000036",
      currentGradeId: juniorHighGrade.id,
    });

    const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Elementary" },
    });
    const { accessToken: dbAdminToken } = await AdminUserTest.createDatabaseAdmin(
      elementaryUnit.id,
      { canViewAllUnits: true },
    );

    const response = await TestRequest.get(
      `/api/admin/students/${student.student!.id}`,
      dbAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.identity.email).toBe(
      "test_stu_getunit_allunits@millennia21.id",
    );
  });
});

describe("GET /api/admin/students", () => {
  let academicYearId: string;
  let gradeAId: string;
  let gradeZId: string;
  let classId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await PCActivityTest.delete();
    await ConsentTest.delete();
    await ParentGuardianTest.delete();
    await StudentTest.delete();
    await prismaClient.class.deleteMany({
      where: { name: { startsWith: "TEST_STU_" } },
    });
    await prismaClient.grade.deleteMany({
      where: { name: { startsWith: "TEST_STU_GRADE" } },
    });
    await MasterDataTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.create();

    const academicYear = await AcademicYearTest.create();
    academicYearId = academicYear.id;

    const gradeA = await prismaClient.grade.create({
      data: { name: "TEST_STU_GRADE_A", level: 9201 },
    });
    gradeAId = gradeA.id;
    const gradeZ = await prismaClient.grade.create({
      data: { name: "TEST_STU_GRADE_Z", level: 9202 },
    });
    gradeZId = gradeZ.id;

    const klass = await prismaClient.class.create({
      data: {
        name: "TEST_STU_CLASS_A",
        grade_id: gradeAId,
        academic_year_id: academicYearId,
      },
    });
    classId = klass.id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await PCActivityTest.delete();
    await ConsentTest.delete();
    await ParentGuardianTest.delete();
    await StudentTest.delete();
    await prismaClient.class.deleteMany({
      where: { name: { startsWith: "TEST_STU_" } },
    });
    await prismaClient.grade.deleteMany({
      where: { name: { startsWith: "TEST_STU_GRADE" } },
    });
    await MasterDataTest.delete();
    await AcademicYearTest.delete();
  });

  it("should list and paginate", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await StudentTest.create({
      email: "test_stu_search1@millennia21.id",
      nis: "9000018",
      entry_type: "PSB",
      currentGradeId: gradeAId,
      joinAcademicYearId: academicYearId,
    });
    await StudentTest.create({
      email: "test_stu_search2@millennia21.id",
      nis: "9000019",
      entry_type: "PSB",
      currentGradeId: gradeAId,
      joinAcademicYearId: academicYearId,
    });
    await StudentTest.create({
      email: "test_stu_search3@millennia21.id",
      nis: "9000020",
      entry_type: "PSB",
      currentGradeId: gradeAId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.get(
      "/api/admin/students?size=2&page=1",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(2);
    expect(body.paging.total_item).toBe(3);
    expect(body.paging.total_page).toBe(2);
  });

  it("should search by full_name, nis, and nisn", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await StudentTest.create({
      email: "test_stu_findme@millennia21.id",
      nis: "9000021",
      entry_type: "PSB",
      nisn: "5551234567",
      currentGradeId: gradeAId,
      joinAcademicYearId: academicYearId,
    });

    const byNis = await TestRequest.get(
      "/api/admin/students?search=9000021",
      accessToken,
    );
    expect((await byNis.json()).data.length).toBe(1);

    const byNisn = await TestRequest.get(
      "/api/admin/students?search=5551234567",
      accessToken,
    );
    expect((await byNisn.json()).data.length).toBe(1);
  });

  it("should filter by status, current_grade_id, current_class_id, and join_academic_year_id", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await StudentTest.create({
      email: "test_stu_filterA@millennia21.id",
      nis: "9000022",
      entry_type: "PSB",
      currentGradeId: gradeAId,
      joinGradeId: gradeAId,
      joinAcademicYearId: academicYearId,
      currentClassId: classId,
      status: StudentStatus.ACTIVE,
    });
    await StudentTest.create({
      email: "test_stu_filterZ@millennia21.id",
      nis: "9000023",
      entry_type: "PSB",
      currentGradeId: gradeZId,
      joinGradeId: gradeZId,
      joinAcademicYearId: academicYearId,
      status: StudentStatus.INACTIVE,
    });

    const byGrade = await TestRequest.get(
      `/api/admin/students?current_grade_id=${gradeAId}`,
      accessToken,
    );
    const byGradeBody = await byGrade.json();
    expect(byGradeBody.data.length).toBe(1);
    expect(byGradeBody.data[0].academic.nis).toBe("9000022");

    const byClass = await TestRequest.get(
      `/api/admin/students?current_class_id=${classId}`,
      accessToken,
    );
    expect((await byClass.json()).data.length).toBe(1);

    const byStatus = await TestRequest.get(
      "/api/admin/students?status=INACTIVE",
      accessToken,
    );
    const byStatusBody = await byStatus.json();
    expect(byStatusBody.data.length).toBe(1);
    expect(byStatusBody.data[0].academic.nis).toBe("9000023");
  });

  it("should filter by pickup_drop_service, catering_service, and psb_guide", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    await TestRequest.post(
      "/api/admin/students",
      {
        full_name: "Test Student Service Yes",
        nick_name: "Stu Yes",
        email: "test_stu_svc_yes@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("2012-01-01").toISOString(),
        nis: "9000027",
        entry_type: "PSB",
        current_grade_id: gradeAId,
        join_academic_year_id: academicYearId,
        join_grade_id: gradeAId,
        pickup_drop_service: true,
        catering_service: true,
        psb_guide: false,
      },
      accessToken,
    );
    await TestRequest.post(
      "/api/admin/students",
      {
        full_name: "Test Student Service No",
        nick_name: "Stu No",
        email: "test_stu_svc_no@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("2012-01-01").toISOString(),
        nis: "9000028",
        entry_type: "PSB",
        current_grade_id: gradeAId,
        join_academic_year_id: academicYearId,
        join_grade_id: gradeAId,
        pickup_drop_service: false,
        catering_service: false,
        psb_guide: false,
      },
      accessToken,
    );

    const byPickupDrop = await TestRequest.get(
      "/api/admin/students?pickup_drop_service=true",
      accessToken,
    );
    const byPickupDropBody = await byPickupDrop.json();
    expect(byPickupDropBody.data.length).toBe(1);
    expect(byPickupDropBody.data[0].academic.nis).toBe("9000027");

    const byCateringFalse = await TestRequest.get(
      "/api/admin/students?catering_service=false",
      accessToken,
    );
    const byCateringFalseBody = await byCateringFalse.json();
    expect(byCateringFalseBody.data.length).toBe(1);
    expect(byCateringFalseBody.data[0].academic.nis).toBe("9000028");
  });

  it("should sort by full_name, nis, current grade name, current class name, and join year name", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await StudentTest.create({
      email: "test_stu_sortA@millennia21.id",
      nis: "9000024",
      entry_type: "PSB",
      currentGradeId: gradeAId,
      currentClassId: classId,
      joinAcademicYearId: academicYearId,
    });
    await StudentTest.create({
      email: "test_stu_sortZ@millennia21.id",
      nis: "9000025",
      entry_type: "PSB",
      currentGradeId: gradeZId,
      joinAcademicYearId: academicYearId,
    });

    const byGradeAsc = await TestRequest.get(
      "/api/admin/students?search=900002&sort_by=grade&sort_order=asc",
      accessToken,
    );
    const byGradeAscBody = await byGradeAsc.json();
    logger.debug(byGradeAscBody);
    expect(byGradeAsc.status).toBe(200);
    expect(
      byGradeAscBody.data.map(
        (s: { academic: { nis: string } }) => s.academic.nis,
      ),
    ).toEqual(["9000024", "9000025"]);

    const byClassSort = await TestRequest.get(
      "/api/admin/students?search=900002&sort_by=class&sort_order=asc",
      accessToken,
    );
    expect(byClassSort.status).toBe(200);

    const byJoinYear = await TestRequest.get(
      "/api/admin/students?search=900002&sort_by=join_year&sort_order=asc",
      accessToken,
    );
    expect(byJoinYear.status).toBe(200);
  });

  it("should exclude soft-deleted students by default and include them with is_deleted=true", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_softdel@millennia21.id",
      nis: "9000026",
      entry_type: "PSB",
      currentGradeId: gradeAId,
      joinAcademicYearId: academicYearId,
    });
    await prismaClient.student.update({
      where: { id: student.student!.id },
      data: { deleted_at: new Date() },
    });

    const defaultView = await TestRequest.get(
      "/api/admin/students?search=9000026",
      accessToken,
    );
    expect((await defaultView.json()).data.length).toBe(0);

    const deletedView = await TestRequest.get(
      "/api/admin/students?search=9000026&is_deleted=true",
      accessToken,
    );
    expect((await deletedView.json()).data.length).toBe(1);
  });

  it("should search by parent full_name, phone, and email", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_parentsearch@millennia21.id",
      nis: "9000027",
      entry_type: "PSB",
      currentGradeId: gradeAId,
      joinAcademicYearId: academicYearId,
    });
    await ParentGuardianTest.create({
      studentId: student.student!.id,
      fullName: "Budi Santoso",
      phone: "081234567890",
      email: "budi.parent@example.com",
    });

    const byName = await TestRequest.get(
      "/api/admin/students?search=Budi Santoso",
      accessToken,
    );
    expect((await byName.json()).data.length).toBe(1);

    const byPhone = await TestRequest.get(
      "/api/admin/students?search=081234567890",
      accessToken,
    );
    expect((await byPhone.json()).data.length).toBe(1);

    const byEmail = await TestRequest.get(
      "/api/admin/students?search=budi.parent@example.com",
      accessToken,
    );
    expect((await byEmail.json()).data.length).toBe(1);
  });

  it("should find a parent by phone regardless of 08xx/62xx/+62xx form, matching however it's actually stored", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_parentphoneform@millennia21.id",
      nis: "9000034",
      entry_type: "PSB",
      currentGradeId: gradeAId,
      joinAcademicYearId: academicYearId,
    });
    // Stored normalized (62-prefixed), same as what create/update via the
    // API always produces - unlike the raw fixture above.
    await ParentGuardianTest.create({
      studentId: student.student!.id,
      fullName: "Normalized Phone Parent",
      phone: "6281200000000",
    });
    // Unrelated student, no matching name/phone anywhere - if a non-phone
    // search term ever collapses to an empty `contains: ""`, this one
    // would wrongly show up too and the count assertions below would fail.
    await StudentTest.create({
      email: "test_stu_parentphoneform_unrelated@millennia21.id",
      nis: "9000035",
      entry_type: "PSB",
      currentGradeId: gradeAId,
      joinAcademicYearId: academicYearId,
    });

    for (const search of ["081200000000", "6281200000000", "+6281200000000"]) {
      const response = await TestRequest.get(
        `/api/admin/students?search=${encodeURIComponent(search)}`,
        accessToken,
      );
      expect((await response.json()).data.length).toBe(1);
    }

    // A non-phone search must not be turned into an empty `contains: ""`
    // by the phone normalizer - that would match every row.
    const byName = await TestRequest.get(
      "/api/admin/students?search=Normalized Phone Parent",
      accessToken,
    );
    expect((await byName.json()).data.length).toBe(1);
  });

  it("should filter by consent_status", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const signedStudent = await StudentTest.create({
      email: "test_stu_consentsigned@millennia21.id",
      nis: "9000028",
      entry_type: "PSB",
      currentGradeId: gradeAId,
      joinAcademicYearId: academicYearId,
    });
    await ConsentTest.create({
      studentId: signedStudent.student!.id,
      status: ConsentStatus.SIGNED,
    });
    const pendingStudent = await StudentTest.create({
      email: "test_stu_consentpending@millennia21.id",
      nis: "9000029",
      entry_type: "PSB",
      currentGradeId: gradeAId,
      joinAcademicYearId: academicYearId,
    });
    await ConsentTest.create({
      studentId: pendingStudent.student!.id,
      status: ConsentStatus.PENDING,
    });

    const response = await TestRequest.get(
      "/api/admin/students?consent_status=SIGNED",
      accessToken,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe(signedStudent.student!.id);
  });

  it("should filter by pc_activity_day", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const mondayStudent = await StudentTest.create({
      email: "test_stu_pcmonday@millennia21.id",
      nis: "9000030",
      entry_type: "PSB",
      currentGradeId: gradeAId,
      joinAcademicYearId: academicYearId,
    });
    await PCActivityTest.create({
      studentId: mondayStudent.student!.id,
      day: "MONDAY",
    });
    const tuesdayStudent = await StudentTest.create({
      email: "test_stu_pctuesday@millennia21.id",
      nis: "9000031",
      entry_type: "PSB",
      currentGradeId: gradeAId,
      joinAcademicYearId: academicYearId,
    });
    await PCActivityTest.create({
      studentId: tuesdayStudent.student!.id,
      day: "TUESDAY",
    });

    const response = await TestRequest.get(
      "/api/admin/students?pc_activity_day=MONDAY",
      accessToken,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe(mondayStudent.student!.id);
  });

  it("should filter by leave_year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const leaver = await StudentTest.create({
      email: "test_stu_leaveyear@millennia21.id",
      nis: "9000032",
      entry_type: "PSB",
      currentGradeId: gradeAId,
      joinAcademicYearId: academicYearId,
    });
    await prismaClient.student.update({
      where: { id: leaver.student!.id },
      data: { leave_year: "2025" },
    });
    await StudentTest.create({
      email: "test_stu_noleaveyear@millennia21.id",
      nis: "9000033",
      entry_type: "PSB",
      currentGradeId: gradeAId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.get(
      "/api/admin/students?leave_year=2025",
      accessToken,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe(leaver.student!.id);
  });

  it("should reject an invalid sort_by field", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/students?sort_by=not_a_real_field",
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
      "/api/admin/students?page=abc",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("page must be a valid number");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get("/api/admin/students");
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  it("should scope the student list to the DATABASE_ADMIN's own unit", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin();
    const elementaryGrade = await GradeTest.getByName("Grade 1");
    const juniorHighGrade = await GradeTest.getByName("Grade 7");

    await StudentTest.create({
      email: "test_stu_unit_elem@millennia21.id",
      nis: "9000031",
      currentGradeId: elementaryGrade.id,
      joinAcademicYearId: academicYearId,
    });
    await StudentTest.create({
      email: "test_stu_unit_jh@millennia21.id",
      nis: "9000032",
      currentGradeId: juniorHighGrade.id,
      joinAcademicYearId: academicYearId,
    });

    const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Elementary" },
    });
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin(elementaryUnit.id);

    const response = await TestRequest.get(
      "/api/admin/students",
      dbAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    const emails = (body.data as Array<{ identity: { email: string } }>).map(
      (s) => s.identity.email,
    );
    expect(emails).toContain("test_stu_unit_elem@millennia21.id");
    expect(emails).not.toContain("test_stu_unit_jh@millennia21.id");

    expect(superAdminToken).toBeDefined();
  });

  it("should return an empty list for a DATABASE_ADMIN whose unit isn't Kindergarten/Elementary/Junior High", async () => {
    const elementaryGrade = await GradeTest.getByName("Grade 1");
    await StudentTest.create({
      email: "test_stu_unit_nonacademic@millennia21.id",
      nis: "9000033",
      currentGradeId: elementaryGrade.id,
      joinAcademicYearId: academicYearId,
    });

    const nonAcademicUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "MAD Lab" },
    });
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin(nonAcademicUnit.id);

    const response = await TestRequest.get(
      "/api/admin/students",
      dbAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(0);
  });

  it("should bypass unit scoping for a DATABASE_ADMIN with can_view_all_units", async () => {
    const elementaryGrade = await GradeTest.getByName("Grade 1");
    const juniorHighGrade = await GradeTest.getByName("Grade 7");

    await StudentTest.create({
      email: "test_stu_allunits_elem@millennia21.id",
      nis: "9000034",
      currentGradeId: elementaryGrade.id,
      joinAcademicYearId: academicYearId,
    });
    await StudentTest.create({
      email: "test_stu_allunits_jh@millennia21.id",
      nis: "9000035",
      currentGradeId: juniorHighGrade.id,
      joinAcademicYearId: academicYearId,
    });

    const nonAcademicUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "CARE" },
    });
    const { accessToken: dbAdminToken } = await AdminUserTest.createDatabaseAdmin(
      nonAcademicUnit.id,
      { canViewAllUnits: true },
    );

    const response = await TestRequest.get(
      "/api/admin/students",
      dbAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    const emails = (body.data as Array<{ identity: { email: string } }>).map(
      (s) => s.identity.email,
    );
    expect(emails).toContain("test_stu_allunits_elem@millennia21.id");
    expect(emails).toContain("test_stu_allunits_jh@millennia21.id");
  });
});

describe("GET /api/admin/students/count-total", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await PCActivityTest.delete();
    await ConsentTest.delete();
    await ParentGuardianTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await PCActivityTest.delete();
    await ConsentTest.delete();
    await ParentGuardianTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
    await AcademicYearTest.delete();
  });

  it("should return the true org-wide total for SUPER_ADMIN", async () => {
    const elementaryGrade = await GradeTest.getByName("Grade 1");
    const juniorHighGrade = await GradeTest.getByName("Grade 7");

    await StudentTest.create({
      email: "test_stu_count1@millennia21.id",
      currentGradeId: elementaryGrade.id,
    });
    await StudentTest.create({
      email: "test_stu_count2@millennia21.id",
      currentGradeId: juniorHighGrade.id,
    });

    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const response = await TestRequest.get(
      "/api/admin/students/count-total",
      accessToken,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.total).toBe(2);
  });

  it("should return the same unscoped total for a unit-scoped DATABASE_ADMIN, even though search() only shows their own unit", async () => {
    const elementaryGrade = await GradeTest.getByName("Grade 1");
    const juniorHighGrade = await GradeTest.getByName("Grade 7");
    const juniorHighUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Junior High" },
    });

    await StudentTest.create({
      email: "test_stu_count3@millennia21.id",
      currentGradeId: elementaryGrade.id,
    });
    await StudentTest.create({
      email: "test_stu_count4@millennia21.id",
      currentGradeId: juniorHighGrade.id,
    });

    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin(juniorHighUnit.id);

    const scopedSearch = await TestRequest.get(
      "/api/admin/students",
      dbAdminToken,
    );
    const scopedBody = await scopedSearch.json();
    expect(scopedBody.data.length).toBe(1);

    const totalResponse = await TestRequest.get(
      "/api/admin/students/count-total",
      dbAdminToken,
    );
    const totalBody = await totalResponse.json();

    expect(totalResponse.status).toBe(200);
    expect(totalBody.data.total).toBe(2);
  });
});

describe("PATCH /api/admin/students/:id", () => {
  let academicYearId: string;
  let gradeId: string;
  let higherGradeId: string;
  let masterData: Awaited<ReturnType<typeof MasterDataTest.create>>;
  let secondUnitGradeId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EnrollmentTest.delete();
    await ClassTest.delete();
    await StudentTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    await AcademicYearTest.delete();
    await prismaClient.grade.deleteMany({
      where: { name: { startsWith: "TEST_STU_GRADE" } },
    });
    await prismaClient.masterUnit.deleteMany({
      where: { id: "student_update_second_unit_test" },
    });
    masterData = await MasterDataTest.create();

    const academicYear = await AcademicYearTest.create();
    academicYearId = academicYear.id;
    const grade = await prismaClient.grade.create({
      data: {
        name: "TEST_STU_GRADE1",
        level: 9301,
        unit_id: masterData.unit.id,
      },
    });
    gradeId = grade.id;
    const higherGrade = await prismaClient.grade.create({
      data: {
        name: "TEST_STU_GRADE2",
        level: 9302,
        unit_id: masterData.unit.id,
      },
    });
    higherGradeId = higherGrade.id;

    const secondUnit = await prismaClient.masterUnit.create({
      data: { id: "student_update_second_unit_test", name: "Second Unit" },
    });
    const secondUnitGrade = await prismaClient.grade.create({
      data: {
        name: "TEST_STU_GRADE_SECOND_UNIT",
        level: 9303,
        unit_id: secondUnit.id,
      },
    });
    secondUnitGradeId = secondUnitGrade.id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EnrollmentTest.delete();
    await ClassTest.delete();
    await StudentTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    await AcademicYearTest.delete();
    await prismaClient.grade.deleteMany({
      where: { name: { startsWith: "TEST_STU_GRADE" } },
    });
    await prismaClient.masterUnit.deleteMany({
      where: { id: "student_update_second_unit_test" },
    });
  });

  it("should successfully update a student when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_upd1@millennia21.id",
      nis: "9000027",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { full_name: "Updated Name", previous_school: "Old School" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.identity.full_name).toBe("Updated Name");
    expect(body.data.academic.previous_school).toBe("Old School");

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: "UPDATE_STUDENT", entity_id: student.student!.id },
    });
    expect(auditLog.old_values).toBeDefined();
    expect(auditLog.new_values).toBeDefined();
  });

  it("should successfully update a student when requested by DATABASE_ADMIN with can_write_student_data", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const student = await StudentTest.create({
      email: "test_stu_upd2@millennia21.id",
      nis: "9000028",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { status: "INACTIVE" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("INACTIVE");
  });

  it("should reject (400) changing current_grade for a graduated student whose completed enrollment says otherwise", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_grad_grade_lock@millennia21.id",
      nis: "9000090",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
      status: StudentStatus.REGISTERED,
    });
    const studentId = student.student!.id;
    const klass = await ClassTest.create({
      name: "TEST_STU_GRADE_LOCK_CLASS",
      gradeId,
      academicYearId,
    });

    const enrollResponse = await TestRequest.post(
      `/api/admin/students/${studentId}/enrollments`,
      { class_id: klass.id, academic_year_id: academicYearId },
      accessToken,
    );
    const enrollBody = await enrollResponse.json();

    const closeResponse = await TestRequest.patch(
      `/api/admin/students/${studentId}/enrollments/${enrollBody.data.id}/close`,
      {
        status: "COMPLETED",
        end_date: "2026-06-01T00:00:00.000Z",
        graduation_grade: "TEST_STU_GRADE1",
        leave_year: "2026",
      },
      accessToken,
    );
    const closeBody = await closeResponse.json();
    logger.debug(closeBody);
    expect(closeResponse.status).toBe(200);

    // No ACTIVE enrollment exists anymore at this point - this is exactly
    // the gap the old activeEnrollment-only check missed.
    const response = await TestRequest.patch(
      `/api/admin/students/${studentId}`,
      { current_grade_id: higherGradeId },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("enrollment record says");

    const unchanged = await prismaClient.student.findUniqueOrThrow({
      where: { id: studentId },
    });
    expect(unchanged.current_grade_id).toBe(gradeId);
  });

  it("should allow changing current_grade for a student with no enrollment history at all", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_no_history_grade@millennia21.id",
      nis: "9000091",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinGradeId: gradeId,
      joinAcademicYearId: academicYearId,
      status: StudentStatus.REGISTERED,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { current_grade_id: higherGradeId, join_grade_id: gradeId },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.academic.current_grade).toBe("TEST_STU_GRADE2");
  });

  it("should reject changing current_grade into a different unit while an active SE teacher assignment from the old unit exists", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_se_unit_blocked@millennia21.id",
      nis: "9000092",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinGradeId: gradeId,
      joinAcademicYearId: academicYearId,
      status: StudentStatus.REGISTERED,
    });
    const seTeacher = await EmployeeTest.create({
      email: "test_se_teacher_unit_blocked@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
    });
    await prismaClient.studentSupportAssignment.create({
      data: {
        student_id: student.student!.id,
        employee_id: seTeacher.employee!.id,
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { current_grade_id: secondUnitGradeId, join_grade_id: secondUnitGradeId },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("active Special Education Teacher assignment");

    const unchanged = await prismaClient.student.findUniqueOrThrow({
      where: { id: student.student!.id },
    });
    expect(unchanged.current_grade_id).toBe(gradeId);
  });

  it("should allow changing current_grade within the same unit as the active SE teacher assignment", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_se_same_unit@millennia21.id",
      nis: "9000093",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinGradeId: gradeId,
      joinAcademicYearId: academicYearId,
      status: StudentStatus.REGISTERED,
    });
    const seTeacher = await EmployeeTest.create({
      email: "test_se_teacher_same_unit@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
    });
    await prismaClient.studentSupportAssignment.create({
      data: {
        student_id: student.student!.id,
        employee_id: seTeacher.employee!.id,
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { current_grade_id: higherGradeId },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.academic.current_grade).toBe("TEST_STU_GRADE2");
  });

  it("should allow changing current_grade into a different unit once the SE teacher assignment has ended", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_se_unit_ended@millennia21.id",
      nis: "9000094",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinGradeId: gradeId,
      joinAcademicYearId: academicYearId,
      status: StudentStatus.REGISTERED,
    });
    const seTeacher = await EmployeeTest.create({
      email: "test_se_teacher_unit_ended@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
    });
    await prismaClient.studentSupportAssignment.create({
      data: {
        student_id: student.student!.id,
        employee_id: seTeacher.employee!.id,
        end_date: new Date(),
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { current_grade_id: secondUnitGradeId, join_grade_id: secondUnitGradeId },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
  });

  it("should re-open current_grade for editing once the only enrollment on file is rolled back", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_rollback_reopen@millennia21.id",
      nis: "9000106",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
      status: StudentStatus.REGISTERED,
    });
    const studentId = student.student!.id;
    const klass = await ClassTest.create({
      name: "TEST_STU_ROLLBACK_REOPEN_CLASS",
      gradeId,
      academicYearId,
    });

    const enrollResponse = await TestRequest.post(
      `/api/admin/students/${studentId}/enrollments`,
      { class_id: klass.id, academic_year_id: academicYearId },
      accessToken,
    );
    const enrollBody = await enrollResponse.json();
    const enrollmentId = enrollBody.data.id;

    const lockedCheckResponse = await TestRequest.get(
      `/api/admin/students/${studentId}`,
      accessToken,
    );
    const lockedCheckBody = await lockedCheckResponse.json();
    expect(lockedCheckBody.data.academic.has_active_enrollment_history).toBe(
      true,
    );

    const lockedUpdateResponse = await TestRequest.patch(
      `/api/admin/students/${studentId}`,
      { current_grade_id: higherGradeId },
      accessToken,
    );
    expect(lockedUpdateResponse.status).toBe(400);

    const rollbackResponse = await TestRequest.patch(
      `/api/admin/students/${studentId}/enrollments/delete/${enrollmentId}`,
      { student_id: studentId },
      accessToken,
    );
    const rollbackBody = await rollbackResponse.json();
    logger.debug(rollbackBody);
    expect(rollbackResponse.status).toBe(200);

    const reopenedCheckResponse = await TestRequest.get(
      `/api/admin/students/${studentId}`,
      accessToken,
    );
    const reopenedCheckBody = await reopenedCheckResponse.json();
    expect(
      reopenedCheckBody.data.academic.has_active_enrollment_history,
    ).toBe(false);
    // has_class_history stays true (rolled-back enrollments still count
    // toward "has this student ever had an enrollment record") - the point
    // of this test is that has_active_enrollment_history, not this one,
    // is what should gate the current_grade lock.
    expect(reopenedCheckBody.data.academic.has_class_history).toBe(true);

    const reopenedUpdateResponse = await TestRequest.patch(
      `/api/admin/students/${studentId}`,
      { current_grade_id: higherGradeId },
      accessToken,
    );
    const reopenedUpdateBody = await reopenedUpdateResponse.json();
    logger.debug(reopenedUpdateBody);
    expect(reopenedUpdateResponse.status).toBe(200);
    expect(reopenedUpdateBody.data.academic.current_grade).toBe(
      "TEST_STU_GRADE2",
    );
  });

  it("should update entry_type when the student has no nis yet (legacy-only)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const createResponse = await TestRequest.post(
      "/api/admin/students",
      {
        full_name: "Test Student Legacy Entry Type",
        nick_name: "Stu Legacy",
        email: "test_stu_entrytype_legacy@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("2012-07-12").toISOString(),
        legacy_nis: "OLD-ENTRYTYPE-001",
        entry_type: "PSB",
        join_academic_year_id: academicYearId,
        current_grade_id: gradeId,
        join_grade_id: gradeId,
      },
      accessToken,
    );
    const createdBody = await createResponse.json();
    const studentId = createdBody.data.id;

    const response = await TestRequest.patch(
      `/api/admin/students/${studentId}`,
      { entry_type: "TRANSFER" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);

    const updatedStudent = await prismaClient.student.findUniqueOrThrow({
      where: { id: studentId },
    });
    expect(updatedStudent.entry_type).toBe("TRANSFER");
    expect(updatedStudent.nis).toBeNull();
  });

  it("should reject (400) changing entry_type once a nis has already been assigned", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_entrytype_locked@millennia21.id",
      nis: "9000029",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { entry_type: "TRANSFER" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);

    const unchangedStudent = await prismaClient.student.findUniqueOrThrow({
      where: { id: student.student!.id },
    });
    expect(unchangedStudent.entry_type).toBe("PSB");
  });

  it("should allow re-submitting the same entry_type after a nis has been assigned", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_entrytype_noop@millennia21.id",
      nis: "9000030",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { entry_type: "PSB", previous_school: "Old School" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.academic.previous_school).toBe("Old School");
  });

  it("should reject (400) a SUPER_ADMIN overwriting an already-set NISN after the 1-day grace period", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_nis5@millennia21.id",
      nis: "9000038",
      entry_type: "PSB",
      nisn: "1111111111",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });
    await prismaClient.student.update({
      where: { id: student.student!.id },
      data: { created_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { nisn: "1234567890" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
  });

  it("should allow setting NISN for the first time even after the 1-day grace period (it was never overwriting anything)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_nis6@millennia21.id",
      nis: "9000039",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });
    await prismaClient.student.update({
      where: { id: student.student!.id },
      data: { created_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { nisn: "1234567890" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.academic.nisn).toBe("1234567890");
  });

  it("should still reject a first-time NISN set that duplicates another student's NISN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await StudentTest.create({
      email: "test_stu_nis7a@millennia21.id",
      nis: "9000040",
      entry_type: "PSB",
      nisn: "5555555555",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });
    const student = await StudentTest.create({
      email: "test_stu_nis7b@millennia21.id",
      nis: "9000041",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { nisn: "5555555555" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("NISN");
  });

  it("should reject update (403 Forbidden) when requested by VIEWER", async () => {
    const { accessToken } = await AdminUserTest.createViewer();
    const student = await StudentTest.create({
      email: "test_stu_upd3@millennia21.id",
      nis: "9000029",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { full_name: "Hacker Update" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toBeDefined();
  });

  it("should reject update (403) for DATABASE_ADMIN if can_write_student_data is false", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      undefined,
      { canWriteStudentData: false },
    );
    const student = await StudentTest.create({
      email: "test_stu_upd4@millennia21.id",
      nis: "9000030",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { full_name: "No Permission Update" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toBeDefined();
  });

  it("should reject duplicate email on update", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await StudentTest.create({
      email: "test_stu_upd_taken@millennia21.id",
      nis: "9000031",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });
    const student = await StudentTest.create({
      email: "test_stu_upd_mine@millennia21.id",
      nis: "9000032",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { email: "test_stu_upd_taken@millennia21.id" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Email already registered to another person");
  });

  it("should allow updating a student with its own unchanged email/nis (no false duplicate)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_upd_self@millennia21.id",
      nis: "9000035",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      {
        email: "test_stu_upd_self@millennia21.id",
        nis: "9000035",
        entry_type: "PSB",
        previous_school: "Same Person Update",
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.academic.previous_school).toBe("Same Person Update");
  });

  it("should reject when updated current grade is lower than join grade", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_upd_lowgrade@millennia21.id",
      nis: "9000036",
      entry_type: "PSB",
      currentGradeId: higherGradeId,
      joinGradeId: higherGradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { current_grade_id: gradeId },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain(
      "Current grade cannot be lower than the grade the student joined at",
    );
  });

  it("should allow promoting current grade above join grade", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_upd_promote@millennia21.id",
      nis: "9000037",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { current_grade_id: higherGradeId },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.academic.current_grade).toBe("TEST_STU_GRADE2");
  });

  it("should allow setting graduation_grade, leave_year, and sn on update", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_upd_graduate@millennia21.id",
      nis: "9000038",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      {
        status: "GRADUATED",
        graduation_grade: "TEST_STU_GRADE2",
        leave_year: "2026",
        sn: "SN-12345",
      },
      accessToken,
    );

    expect(response.status).toBe(200);

    const superAdminResponse = await TestRequest.get(
      `/api/admin/students/${student.student!.id}`,
      accessToken,
    );
    const body = await superAdminResponse.json();
    expect(body.data.academic.graduation_grade).toBe("TEST_STU_GRADE2");
    expect(body.data.academic.leave_year).toBe("2026");
    expect(body.data.academic.sn).toBe("SN-12345");
  });

  it("should clear graduation_grade and leave_year when a graduated student is moved off GRADUATED", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_upd_ungraduate@millennia21.id",
      nis: "9000039",
      entry_type: "PSB",
      status: StudentStatus.GRADUATED,
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });
    await prismaClient.student.update({
      where: { id: student.student!.id },
      data: { graduation_grade: "TEST_STU_GRADE2", leave_year: "2026" },
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { status: "REGISTERED" },
      accessToken,
    );
    expect(response.status).toBe(200);

    const getResponse = await TestRequest.get(
      `/api/admin/students/${student.student!.id}`,
      accessToken,
    );
    const body = await getResponse.json();
    expect(body.data.academic.graduation_grade).toBeNull();
    expect(body.data.academic.leave_year).toBeNull();
  });

  it("should reject graduating a student without leave_year and graduation_grade", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_upd_incomplete_graduate@millennia21.id",
      nis: "9000098",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { status: StudentStatus.GRADUATED },
      accessToken,
    );

    expect(response.status).toBe(400);
  });

  it("should auto-close the active enrollment and clear current_class_id when status changes to WITHDRAWN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_Class_AutoClose",
      gradeId,
      academicYearId,
    });
    const student = await StudentTest.create({
      email: "test_stu_upd_withdraw@millennia21.id",
      nis: "9000099",
      entry_type: "PSB",
      status: StudentStatus.ACTIVE,
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
      currentClassId: klass.id,
    });
    const enrollment = await EnrollmentTest.create({
      studentId: student.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "TEST_STU_GRADE1",
      classNameSnapshot: klass.name,
      startDate: new Date("2025-08-01"),
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { status: StudentStatus.WITHDRAWN },
      accessToken,
    );
    expect(response.status).toBe(200);

    const updatedEnrollment =
      await prismaClient.studentClassEnrollment.findUnique({
        where: { id: enrollment.id },
      });
    expect(updatedEnrollment?.enrollment_status).toBe(
      EnrollmentStatus.WITHDRAWN,
    );
    expect(updatedEnrollment?.end_date).not.toBeNull();

    const updatedStudent = await prismaClient.student.findUnique({
      where: { id: student.student!.id },
    });
    expect(updatedStudent?.current_class_id).toBeNull();

    const auditEntry = await prismaClient.auditLog.findFirst({
      where: {
        action: AuditAction.WITHDRAW_STUDENT_ENROLLMENT,
        entity_id: enrollment.id,
      },
    });
    expect(auditEntry).not.toBeNull();
  });

  it("should map GRADUATED status to a COMPLETED enrollment on auto-close", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_Class_AutoCloseGrad",
      gradeId,
      academicYearId,
    });
    const student = await StudentTest.create({
      email: "test_stu_upd_graduate_close@millennia21.id",
      nis: "9000100",
      entry_type: "PSB",
      status: StudentStatus.ACTIVE,
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
      currentClassId: klass.id,
    });
    const enrollment = await EnrollmentTest.create({
      studentId: student.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "TEST_STU_GRADE1",
      classNameSnapshot: klass.name,
      startDate: new Date("2025-08-01"),
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      {
        status: StudentStatus.GRADUATED,
        graduation_grade: "TEST_STU_GRADE2",
        leave_year: "2026",
      },
      accessToken,
    );
    expect(response.status).toBe(200);

    const updatedEnrollment =
      await prismaClient.studentClassEnrollment.findUnique({
        where: { id: enrollment.id },
      });
    expect(updatedEnrollment?.enrollment_status).toBe(
      EnrollmentStatus.COMPLETED,
    );
    expect(updatedEnrollment?.end_date).not.toBeNull();
  });

  it("should derive graduation_grade/leave_year from the real active enrollment, ignoring mismatched typed values", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await prismaClient.academicYear.findUniqueOrThrow({
      where: { id: academicYearId },
    });
    const klass = await ClassTest.create({
      name: "TEST_Class_DeriveGrad",
      gradeId,
      academicYearId,
    });
    const student = await StudentTest.create({
      email: "test_stu_upd_derive_grad@millennia21.id",
      nis: "9000109",
      entry_type: "PSB",
      status: StudentStatus.ACTIVE,
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
      currentClassId: klass.id,
    });
    await EnrollmentTest.create({
      studentId: student.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "TEST_STU_GRADE1",
      classNameSnapshot: klass.name,
      startDate: new Date("2025-08-01"),
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      {
        // Deliberately wrong/mismatched values - should be ignored in favor
        // of what the real enrollment actually says.
        status: StudentStatus.GRADUATED,
        graduation_grade: "Some Made Up Grade",
        leave_year: "1999",
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);
    expect(response.status).toBe(200);

    const updatedStudent = await prismaClient.student.findUniqueOrThrow({
      where: { id: student.student!.id },
    });
    expect(updatedStudent.graduation_grade).toBe("TEST_STU_GRADE1");
    expect(updatedStudent.leave_year).toBe(year.name);
  });

  it("should reject (400) graduating with a leave_year before the student's join academic year, when there's no active enrollment to derive from", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_upd_grad_year_before_join@millennia21.id",
      nis: "9000110",
      entry_type: "PSB",
      status: StudentStatus.REGISTERED,
      currentGradeId: gradeId,
      joinGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      {
        status: StudentStatus.GRADUATED,
        graduation_grade: "TEST_STU_GRADE1",
        leave_year: "1999",
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("can't be before");
  });

  it("should soft-delete the graduated enrollment for the active year when the student is moved off GRADUATED, unblocking a fresh enrollment for that year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_Class_UngraduateFreesYear",
      gradeId,
      academicYearId,
    });
    const student = await StudentTest.create({
      email: "test_stu_upd_ungraduate_free@millennia21.id",
      nis: "9000102",
      entry_type: "PSB",
      status: StudentStatus.ACTIVE,
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
      currentClassId: klass.id,
    });
    const enrollment = await EnrollmentTest.create({
      studentId: student.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "TEST_STU_GRADE1",
      classNameSnapshot: klass.name,
      startDate: new Date("2025-08-01"),
    });

    const graduateResponse = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      {
        status: StudentStatus.GRADUATED,
        graduation_grade: "TEST_STU_GRADE1",
        leave_year: "2026",
      },
      accessToken,
    );
    expect(graduateResponse.status).toBe(200);

    const ungraduateResponse = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { status: StudentStatus.REGISTERED },
      accessToken,
    );
    expect(ungraduateResponse.status).toBe(200);

    const orphanedEnrollment =
      await prismaClient.studentClassEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      });
    expect(orphanedEnrollment.deleted_at).not.toBeNull();
    expect(orphanedEnrollment.enrollment_status).toBe(
      EnrollmentStatus.COMPLETED,
    );

    // Same student, same class, same academic year - would have hit the
    // (student_id, academic_year_id) unique index if the orphaned row were
    // still counted.
    const freshEnrollResponse = await TestRequest.post(
      `/api/admin/students/${student.student!.id}/enrollments`,
      { class_id: klass.id, academic_year_id: academicYearId },
      accessToken,
    );
    expect(freshEnrollResponse.status).toBe(200);
  });

  it("should soft-delete the TRANSFERRED enrollment for the active year when the student is moved off that status, unblocking a fresh enrollment for that year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_Class_UnTransferFreesYear",
      gradeId,
      academicYearId,
    });
    const student = await StudentTest.create({
      email: "test_stu_upd_untransfer_free@millennia21.id",
      nis: "9000104",
      entry_type: "PSB",
      status: StudentStatus.TRANSFERRED,
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });
    const enrollment = await EnrollmentTest.create({
      studentId: student.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "TEST_STU_GRADE1",
      classNameSnapshot: klass.name,
      status: EnrollmentStatus.TRANSFERRED,
      startDate: new Date("2025-08-01"),
      endDate: new Date("2025-09-01"),
    });

    const revertResponse = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { status: StudentStatus.REGISTERED },
      accessToken,
    );
    expect(revertResponse.status).toBe(200);

    const orphanedEnrollment =
      await prismaClient.studentClassEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      });
    expect(orphanedEnrollment.deleted_at).not.toBeNull();
    expect(orphanedEnrollment.enrollment_status).toBe(
      EnrollmentStatus.TRANSFERRED,
    );

    // Same student, same class, same academic year - would have hit the
    // (student_id, academic_year_id) unique index if the orphaned row were
    // still counted.
    const freshEnrollResponse = await TestRequest.post(
      `/api/admin/students/${student.student!.id}/enrollments`,
      { class_id: klass.id, academic_year_id: academicYearId },
      accessToken,
    );
    expect(freshEnrollResponse.status).toBe(200);
  });

  it("should soft-delete the WITHDRAWN enrollment for the active year when the student is moved off that status, unblocking a fresh enrollment for that year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_Class_UnWithdrawFreesYear",
      gradeId,
      academicYearId,
    });
    const student = await StudentTest.create({
      email: "test_stu_upd_unwithdraw_free@millennia21.id",
      nis: "9000105",
      entry_type: "PSB",
      status: StudentStatus.WITHDRAWN,
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });
    const enrollment = await EnrollmentTest.create({
      studentId: student.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "TEST_STU_GRADE1",
      classNameSnapshot: klass.name,
      status: EnrollmentStatus.WITHDRAWN,
      startDate: new Date("2025-08-01"),
      endDate: new Date("2025-09-01"),
    });

    const revertResponse = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { status: StudentStatus.REGISTERED },
      accessToken,
    );
    expect(revertResponse.status).toBe(200);

    const orphanedEnrollment =
      await prismaClient.studentClassEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      });
    expect(orphanedEnrollment.deleted_at).not.toBeNull();
    expect(orphanedEnrollment.enrollment_status).toBe(
      EnrollmentStatus.WITHDRAWN,
    );

    // Same student, same class, same academic year - would have hit the
    // (student_id, academic_year_id) unique index if the orphaned row were
    // still counted.
    const freshEnrollResponse = await TestRequest.post(
      `/api/admin/students/${student.student!.id}/enrollments`,
      { class_id: klass.id, academic_year_id: academicYearId },
      accessToken,
    );
    expect(freshEnrollResponse.status).toBe(200);
  });

  it("should reject (400) moving a Transferred student directly to Inactive - Inactive only reaches from Active", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_upd_untransfer_inactive@millennia21.id",
      nis: "9000107",
      entry_type: "PSB",
      status: StudentStatus.TRANSFERRED,
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { status: StudentStatus.INACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("only be set from Active");
  });

  it("should update the same enrollment row in place when swapping directly between two terminal statuses, not delete it", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_Class_TerminalSwap",
      gradeId,
      academicYearId,
    });
    const student = await StudentTest.create({
      email: "test_stu_upd_terminal_swap@millennia21.id",
      nis: "9000106",
      entry_type: "PSB",
      status: StudentStatus.TRANSFERRED,
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });
    const enrollment = await EnrollmentTest.create({
      studentId: student.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "TEST_STU_GRADE1",
      classNameSnapshot: klass.name,
      status: EnrollmentStatus.TRANSFERRED,
      startDate: new Date("2025-08-01"),
      endDate: new Date("2025-09-01"),
    });

    const correctResponse = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { status: StudentStatus.WITHDRAWN },
      accessToken,
    );
    expect(correctResponse.status).toBe(200);

    const corrected =
      await prismaClient.studentClassEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      });
    // Same row, not soft-deleted - just corrected to the new terminal status.
    expect(corrected.deleted_at).toBeNull();
    expect(corrected.enrollment_status).toBe(EnrollmentStatus.WITHDRAWN);

    // The row still occupies the (student_id, academic_year_id) slot - this
    // is a real corrected outcome, not something to free up like reverting
    // to REGISTERED would be.
    const freshEnrollResponse = await TestRequest.post(
      `/api/admin/students/${student.student!.id}/enrollments`,
      { class_id: klass.id, academic_year_id: academicYearId },
      accessToken,
    );
    expect(freshEnrollResponse.status).toBe(400);
  });

  it("should correct the closing enrollment even when it's in a past academic year, not the currently active one", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const pastYear = await prismaClient.academicYear.create({
      data: {
        name: "Test Year Past Closing",
        status: AcademicYearStatus.COMPLETED,
        start_date: new Date("2020-07-01"),
        end_date: new Date("2021-06-30"),
      },
    });
    const klass = await ClassTest.create({
      name: "TEST_Class_TerminalSwapPastYear",
      gradeId,
      academicYearId: pastYear.id,
    });
    const student = await StudentTest.create({
      email: "test_stu_upd_terminal_swap_past_year@millennia21.id",
      nis: "9000108",
      entry_type: "PSB",
      status: StudentStatus.TRANSFERRED,
      currentGradeId: gradeId,
      joinAcademicYearId: pastYear.id,
    });
    const enrollment = await EnrollmentTest.create({
      studentId: student.student!.id,
      classId: klass.id,
      academicYearId: pastYear.id,
      gradeLevel: "TEST_STU_GRADE1",
      classNameSnapshot: klass.name,
      status: EnrollmentStatus.TRANSFERRED,
      startDate: new Date("2020-08-01"),
      endDate: new Date("2020-09-01"),
    });

    const correctResponse = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      {
        status: StudentStatus.GRADUATED,
        graduation_grade: "TEST_STU_GRADE1",
        leave_year: "2021",
      },
      accessToken,
    );
    expect(correctResponse.status).toBe(200);

    const corrected =
      await prismaClient.studentClassEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      });
    expect(corrected.deleted_at).toBeNull();
    expect(corrected.enrollment_status).toBe(EnrollmentStatus.COMPLETED);
  });

  it("should reject (400) setting status to REGISTERED while the student has an active class enrollment", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_Class_RegisteredBlocked",
      gradeId,
      academicYearId,
    });
    const student = await StudentTest.create({
      email: "test_stu_upd_registered_blocked@millennia21.id",
      nis: "9000103",
      entry_type: "PSB",
      status: StudentStatus.ACTIVE,
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
      currentClassId: klass.id,
    });
    await EnrollmentTest.create({
      studentId: student.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "TEST_STU_GRADE1",
      classNameSnapshot: klass.name,
      startDate: new Date("2025-08-01"),
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { status: StudentStatus.REGISTERED },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("active class enrollment");

    const unchanged = await prismaClient.student.findUniqueOrThrow({
      where: { id: student.student!.id },
    });
    expect(unchanged.status).toBe(StudentStatus.ACTIVE);
    expect(unchanged.current_class_id).toBe(klass.id);
  });

  it("should allow setting status to REGISTERED once the enrollment is removed", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_Class_RegisteredAfterRemove",
      gradeId,
      academicYearId,
    });
    const student = await StudentTest.create({
      email: "test_stu_upd_registered_after_remove@millennia21.id",
      nis: "9000104",
      entry_type: "PSB",
      status: StudentStatus.ACTIVE,
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
      currentClassId: klass.id,
    });
    const enrollment = await EnrollmentTest.create({
      studentId: student.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "TEST_STU_GRADE1",
      classNameSnapshot: klass.name,
      startDate: new Date("2025-08-01"),
    });

    await TestRequest.patch(
      `/api/admin/students/${student.student!.id}/enrollments/delete/${enrollment.id}`,
      {},
      accessToken,
    );

    // remove() already put the student back to REGISTERED as a side effect,
    // but the explicit status update should also be allowed now that
    // there's no active enrollment left in the way.
    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { status: StudentStatus.REGISTERED },
      accessToken,
    );

    expect(response.status).toBe(200);
  });

  it("should not touch enrollments when status is unrelated (e.g. plain field edit)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const klass = await ClassTest.create({
      name: "TEST_Class_NoAutoClose",
      gradeId,
      academicYearId,
    });
    const student = await StudentTest.create({
      email: "test_stu_upd_no_close@millennia21.id",
      nis: "9000101",
      entry_type: "PSB",
      status: StudentStatus.ACTIVE,
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
      currentClassId: klass.id,
    });
    const enrollment = await EnrollmentTest.create({
      studentId: student.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "TEST_STU_GRADE1",
      classNameSnapshot: klass.name,
      startDate: new Date("2025-08-01"),
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { previous_school: "Some Other School" },
      accessToken,
    );
    expect(response.status).toBe(200);

    const updatedEnrollment =
      await prismaClient.studentClassEnrollment.findUnique({
        where: { id: enrollment.id },
      });
    expect(updatedEnrollment?.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
    expect(updatedEnrollment?.end_date).toBeNull();
  });

  it("should reject if the student does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.patch(
      "/api/admin/students/invalid-cuid-123",
      { full_name: "Ghost Student" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toBeDefined();
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch("/api/admin/students/whatever", {
      full_name: "No Token Update",
    });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  it("should reject (403) a DATABASE_ADMIN updating a student outside their unit", async () => {
    const juniorHighGrade = await GradeTest.getByName("Grade 7");
    const student = await StudentTest.create({
      email: "test_stu_updateunit_jh@millennia21.id",
      nis: "9000035",
      currentGradeId: juniorHighGrade.id,
      joinAcademicYearId: academicYearId,
    });

    const elementaryUnit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Elementary" },
    });
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin(elementaryUnit.id);

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { full_name: "Should Not Update" },
      dbAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("outside your unit scope");
  });
});

describe("PATCH /api/admin/students/delete/:id", () => {
  let academicYearId: string;
  let gradeId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
    await AcademicYearTest.delete();
    await prismaClient.grade.deleteMany({
      where: { name: { startsWith: "TEST_STU_GRADE" } },
    });
    await MasterDataTest.create();

    const academicYear = await AcademicYearTest.create();
    academicYearId = academicYear.id;
    const grade = await prismaClient.grade.create({
      data: { name: "TEST_STU_GRADE1", level: 9401 },
    });
    gradeId = grade.id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
    await AcademicYearTest.delete();
    await prismaClient.grade.deleteMany({
      where: { name: { startsWith: "TEST_STU_GRADE" } },
    });
  });

  it("should soft-delete a student when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_del1@millennia21.id",
      nis: "9000039",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/delete/${student.student!.id}`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data).toBe(true);

    const stillThere = await prismaClient.student.findUnique({
      where: { id: student.student!.id },
    });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.deleted_at).not.toBeNull();
    expect(stillThere?.status).toBe("ARCHIVED");
  });

  it("should clear NISN on delete (freeing it for reuse) and preserve the old value in the audit log", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_del_nisn@millennia21.id",
      nis: "9000046",
      nisn: "9111111110",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    await TestRequest.patch(
      `/api/admin/students/delete/${student.student!.id}`,
      {},
      accessToken,
    );

    const archived = await prismaClient.student.findUniqueOrThrow({
      where: { id: student.student!.id },
    });
    expect(archived.nisn).toBeNull();

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: {
        action: AuditAction.DELETE_STUDENT,
        entity_id: student.student!.id,
      },
    });
    expect(auditLog.old_values).toMatchObject({ nisn: "9111111110" });

    const newStudentPayload = {
      full_name: "New NISN Owner",
      nick_name: "New Owner",
      email: "test_stu_new_nisn_owner@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2012-06-06").toISOString(),
      nis: "9000047",
      entry_type: "PSB",
      nisn: "9111111110",
      join_academic_year_id: academicYearId,
      current_grade_id: gradeId,
      join_grade_id: gradeId,
    };

    const response = await TestRequest.post(
      "/api/admin/students",
      newStudentPayload,
      accessToken,
    );

    expect(response.status).toBe(200);
  });

  it("should reject delete (403 Forbidden) when requested by DATABASE_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const student = await StudentTest.create({
      email: "test_stu_del2@millennia21.id",
      nis: "9000040",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/delete/${student.student!.id}`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toBeDefined();
  });

  it("should reject delete (403 Forbidden) when requested by VIEWER", async () => {
    const { accessToken } = await AdminUserTest.createViewer();
    const student = await StudentTest.create({
      email: "test_stu_del3@millennia21.id",
      nis: "9000041",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/delete/${student.student!.id}`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toBeDefined();
  });

  it("should reject deleting an already-deleted student", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_del4@millennia21.id",
      nis: "9000042",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    await TestRequest.patch(
      `/api/admin/students/delete/${student.student!.id}`,
      {},
      accessToken,
    );

    const response = await TestRequest.patch(
      `/api/admin/students/delete/${student.student!.id}`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Student is already deleted");
  });

  it("should reject if the student does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.patch(
      "/api/admin/students/delete/invalid-cuid-123",
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toBeDefined();
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch(
      "/api/admin/students/delete/whatever",
      {},
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("PATCH /api/admin/students/restore/:id", () => {
  let academicYearId: string;
  let gradeId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
    await AcademicYearTest.delete();
    await prismaClient.grade.deleteMany({
      where: { name: { startsWith: "TEST_STU_GRADE" } },
    });
    await MasterDataTest.create();

    const academicYear = await AcademicYearTest.create();
    academicYearId = academicYear.id;
    const grade = await prismaClient.grade.create({
      data: { name: "TEST_STU_GRADE1", level: 9501 },
    });
    gradeId = grade.id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
    await AcademicYearTest.delete();
    await prismaClient.grade.deleteMany({
      where: { name: { startsWith: "TEST_STU_GRADE" } },
    });
  });

  it("should restore a soft-deleted student when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_res1@millennia21.id",
      nis: "9000043",
      entry_type: "PSB",
      status: StudentStatus.GRADUATED,
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    await TestRequest.patch(
      `/api/admin/students/delete/${student.student!.id}`,
      {},
      accessToken,
    );

    const response = await TestRequest.patch(
      `/api/admin/students/restore/${student.student!.id}`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("GRADUATED");

    const stillThere = await prismaClient.student.findUnique({
      where: { id: student.student!.id },
    });
    expect(stillThere?.deleted_at).toBeNull();
  });

  it("should not repopulate a cleared NISN when a soft-deleted student is restored", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_res_nisn@millennia21.id",
      nis: "9000048",
      nisn: "9222222220",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    await TestRequest.patch(
      `/api/admin/students/delete/${student.student!.id}`,
      {},
      accessToken,
    );
    await TestRequest.patch(
      `/api/admin/students/restore/${student.student!.id}`,
      {},
      accessToken,
    );

    const restored = await prismaClient.student.findUniqueOrThrow({
      where: { id: student.student!.id },
    });
    expect(restored.deleted_at).toBeNull();
    expect(restored.nisn).toBeNull();
  });

  it("should reject restore (403 Forbidden) when requested by DATABASE_ADMIN", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin();
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin();
    const student = await StudentTest.create({
      email: "test_stu_res2@millennia21.id",
      nis: "9000044",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    await TestRequest.patch(
      `/api/admin/students/delete/${student.student!.id}`,
      {},
      superAdminToken,
    );

    const response = await TestRequest.patch(
      `/api/admin/students/restore/${student.student!.id}`,
      {},
      dbAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toBeDefined();
  });

  it("should reject restoring a student that is not in the trash bin", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_res3@millennia21.id",
      nis: "9000045",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/restore/${student.student!.id}`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("not in the trash bin");
  });

  it("should reject if the student does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.patch(
      "/api/admin/students/restore/invalid-cuid-123",
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toBeDefined();
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch(
      "/api/admin/students/restore/whatever",
      {},
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("PATCH /api/admin/students/:id/reissue-nis", () => {
  let academicYearId: string;
  let gradeId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
    await AcademicYearTest.delete();
    await prismaClient.grade.deleteMany({
      where: { name: { startsWith: "TEST_STU_GRADE" } },
    });
    await MasterDataTest.create();

    const academicYear = await AcademicYearTest.create();
    academicYearId = academicYear.id;
    // Grade 1 real level so generateNis() can derive a valid unit code -
    // unlike the other describe blocks' custom out-of-range test grades.
    const grade = await prismaClient.grade.findUniqueOrThrow({
      where: { name: "Grade 1" },
    });
    gradeId = grade.id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
    await AcademicYearTest.delete();
    await prismaClient.grade.deleteMany({
      where: { name: { startsWith: "TEST_STU_GRADE" } },
    });
  });

  async function createLegacyOnlyStudent(accessToken: string, email: string) {
    const response = await TestRequest.post(
      "/api/admin/students",
      {
        full_name: "Test Student Reissue",
        nick_name: "Stu Reissue",
        email,
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("2012-07-12").toISOString(),
        legacy_nis: "OLD-REISSUE-001",
        entry_type: "PSB",
        join_academic_year_id: academicYearId,
        current_grade_id: gradeId,
        join_grade_id: gradeId,
      },
      accessToken,
    );
    const body = await response.json();
    return body.data.id;
  }

  it("should reissue a nis for a legacy-only student as SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const studentId = await createLegacyOnlyStudent(
      accessToken,
      "test_stu_reissue1@millennia21.id",
    );

    const response = await TestRequest.patch(
      `/api/admin/students/${studentId}/reissue-nis`,
      { entry_type: "TRANSFER" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.academic.nis).not.toBeNull();
    expect(body.data.academic.nis).toMatch(/^\d{7}$/);
    expect(body.data.academic.legacy_nis).toBe("OLD-REISSUE-001");

    const updatedStudent = await prismaClient.student.findUniqueOrThrow({
      where: { id: studentId },
    });
    expect(updatedStudent.entry_type).toBe("TRANSFER");

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AuditAction.REISSUE_STUDENT_NIS, admin_id: admin.id },
    });
    expect(auditLog.entity_type).toBe("Student");
  });

  it("should reject when caller is not SUPER_ADMIN", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const studentId = await createLegacyOnlyStudent(
      superAdmin.accessToken,
      "test_stu_reissue_forbidden@millennia21.id",
    );

    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin();
    const response = await TestRequest.patch(
      `/api/admin/students/${studentId}/reissue-nis`,
      {},
      dbAdminToken,
    );

    expect(response.status).toBe(403);
  });

  it("should reject a student that already has a nis", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_reissue_already@millennia21.id",
      nis: "9000099",
      entry_type: "PSB",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}/reissue-nis`,
      { entry_type: "PSB" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already has a NIS");
  });

  it("should reject when entry_type is missing from the request", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const studentId = await createLegacyOnlyStudent(
      accessToken,
      "test_stu_reissue_no_entry_type@millennia21.id",
    );

    const response = await TestRequest.patch(
      `/api/admin/students/${studentId}/reissue-nis`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
  });

  it("should reject when the student does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.patch(
      "/api/admin/students/invalid-cuid-123/reissue-nis",
      { entry_type: "PSB" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("not found");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch(
      "/api/admin/students/whatever/reissue-nis",
      {},
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("PATCH /api/admin/students/:id/deactivate and /:id/reactivate", () => {
  let academicYearId: string;
  let gradeId: string;

  async function cleanup() {
    await AuditLogTest.delete();
    await EnrollmentTest.delete();
    await ClassTest.delete();
    await AdminUserTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
    await AcademicYearTest.delete();
    await prismaClient.grade.deleteMany({
      where: { name: { startsWith: "TEST_STU_GRADE" } },
    });
  }

  beforeEach(async () => {
    await cleanup();
    const masterData = await MasterDataTest.create();
    const academicYear = await AcademicYearTest.create();
    academicYearId = academicYear.id;
    const grade = await prismaClient.grade.create({
      data: {
        name: "TEST_STU_GRADE1",
        level: 9401,
        unit_id: masterData.unit.id,
      },
    });
    gradeId = grade.id;
  });

  afterEach(cleanup);

  async function createActiveStudent(email: string, nis: string) {
    const klass = await ClassTest.create({
      name: `TEST_Class_${nis}`,
      gradeId,
      academicYearId,
    });
    const student = await StudentTest.create({
      email,
      nis,
      entry_type: "PSB",
      status: StudentStatus.ACTIVE,
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
      currentClassId: klass.id,
    });
    const enrollment = await EnrollmentTest.create({
      studentId: student.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "TEST_STU_GRADE1",
      classNameSnapshot: klass.name,
      startDate: new Date("2025-08-01"),
    });
    return { studentId: student.student!.id, klass, enrollment };
  }

  it("should deactivate an ACTIVE student, leaving their enrollment untouched", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const { studentId, enrollment } = await createActiveStudent(
      "test_stu_deactivate@millennia21.id",
      "9100001",
    );

    const response = await TestRequest.patch(
      `/api/admin/students/${studentId}/deactivate`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("INACTIVE");

    const student = await prismaClient.student.findUniqueOrThrow({
      where: { id: studentId },
    });
    expect(student.current_class_id).not.toBeNull();

    const unchangedEnrollment =
      await prismaClient.studentClassEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      });
    expect(unchangedEnrollment.enrollment_status).toBe(EnrollmentStatus.ACTIVE);

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AuditAction.DEACTIVATE_STUDENT, admin_id: admin.id },
    });
    expect(auditLog.entity_id).toBe(studentId);
  });

  it("should reject (400) deactivating a student who isn't currently Active", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_deactivate_notactive@millennia21.id",
      nis: "9100002",
      entry_type: "PSB",
      status: StudentStatus.REGISTERED,
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}/deactivate`,
      {},
      accessToken,
    );
    expect(response.status).toBe(400);
  });

  it("should reject (403) VIEWER deactivating a student", async () => {
    const { accessToken } = await AdminUserTest.createViewer();
    const { studentId } = await createActiveStudent(
      "test_stu_deactivate_viewer@millennia21.id",
      "9100003",
    );

    const response = await TestRequest.patch(
      `/api/admin/students/${studentId}/deactivate`,
      {},
      accessToken,
    );
    expect(response.status).toBe(403);
  });

  it("should reactivate an INACTIVE student back to Active", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const { studentId } = await createActiveStudent(
      "test_stu_reactivate@millennia21.id",
      "9100004",
    );
    await TestRequest.patch(
      `/api/admin/students/${studentId}/deactivate`,
      {},
      accessToken,
    );

    const response = await TestRequest.patch(
      `/api/admin/students/${studentId}/reactivate`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("ACTIVE");

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AuditAction.REACTIVATE_STUDENT, admin_id: admin.id },
    });
    expect(auditLog.entity_id).toBe(studentId);
  });

  it("should reject (400) reactivating a student who isn't currently Inactive", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const { studentId } = await createActiveStudent(
      "test_stu_reactivate_notinactive@millennia21.id",
      "9100005",
    );

    const response = await TestRequest.patch(
      `/api/admin/students/${studentId}/reactivate`,
      {},
      accessToken,
    );
    expect(response.status).toBe(400);
  });

  it("should reject (400) setting Inactive via the generic update endpoint when not currently Active", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_update_inactive_notactive@millennia21.id",
      nis: "9100006",
      entry_type: "PSB",
      status: StudentStatus.REGISTERED,
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { status: StudentStatus.INACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("only be set from Active");
  });

  it("should reject (400) moving an Inactive student to anything other than Active via the generic update endpoint", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const { studentId } = await createActiveStudent(
      "test_stu_update_inactive_wrong_target@millennia21.id",
      "9100007",
    );
    await TestRequest.patch(
      `/api/admin/students/${studentId}/deactivate`,
      {},
      accessToken,
    );

    const response = await TestRequest.patch(
      `/api/admin/students/${studentId}`,
      { status: StudentStatus.TRANSFERRED },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("can only be moved back to Active");
  });

  it("should allow moving an Inactive student back to Active via the generic update endpoint too", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const { studentId } = await createActiveStudent(
      "test_stu_update_inactive_to_active@millennia21.id",
      "9100008",
    );
    await TestRequest.patch(
      `/api/admin/students/${studentId}/deactivate`,
      {},
      accessToken,
    );

    const response = await TestRequest.patch(
      `/api/admin/students/${studentId}`,
      { status: StudentStatus.ACTIVE },
      accessToken,
    );
    expect(response.status).toBe(200);
  });

  it("should bulk-deactivate students, reporting per-item success/failure", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const first = await createActiveStudent(
      "test_stu_bulk_deactivate_1@millennia21.id",
      "9100009",
    );
    const second = await createActiveStudent(
      "test_stu_bulk_deactivate_2@millennia21.id",
      "9100010",
    );

    const response = await TestRequest.patch(
      "/api/admin/students/bulk/deactivate",
      { ids: [first.studentId, second.studentId, "nonexistent-id"] },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.success_count).toBe(2);
    expect(body.data.failed_count).toBe(1);
  });

  it("should bulk-reactivate students", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const first = await createActiveStudent(
      "test_stu_bulk_reactivate_1@millennia21.id",
      "9100011",
    );
    await TestRequest.patch(
      `/api/admin/students/${first.studentId}/deactivate`,
      {},
      accessToken,
    );

    const response = await TestRequest.patch(
      "/api/admin/students/bulk/reactivate",
      { ids: [first.studentId] },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.success_count).toBe(1);
  });
});
