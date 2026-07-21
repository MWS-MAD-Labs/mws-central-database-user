import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  AcademicYearTest,
  AuditLogTest,
  MasterDataTest,
  StudentTest,
} from "./test-utils";
import { Gender, Religion, StudentStatus } from "../generated/prisma/client";
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
    await MasterDataTest.create();
    const academicYear = await AcademicYearTest.create();
    academicYearId = academicYear.id;
    const grade = await prismaClient.grade.create({
      data: { name: "TEST_STU_GRADE1", level: 9101 },
    });
    gradeId = grade.id;
    const higherGrade = await prismaClient.grade.create({
      data: { name: "TEST_STU_GRADE2", level: 9102 },
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
      nisn: "1234567890",
      status: StudentStatus.ACTIVE,
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
    expect(body.data.status).toBe("ACTIVE");

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: "CREATE_STUDENT", entity_id: body.data.id },
    });
    expect(auditLog.entity_type).toBe("Student");
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

  it("should successfully create a student when requested by DATABASE_ADMIN with can_write_data", async () => {
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
  });

  it("should reject creation (403) for DATABASE_ADMIN if can_write_data is false", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    await prismaClient.adminUser.updateMany({
      where: { role: "DATABASE_ADMIN" },
      data: { can_write_data: false },
    });

    const requestBody = {
      full_name: "Test Student Three",
      nick_name: "Stu Three",
      email: "test_stu_3@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2012-03-03").toISOString(),
      nis: "9000004",
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
    expect(body.errors).toContain("NISN already registered");
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
});

describe("GET /api/admin/students/:id", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
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

  it("should hide sensitive fields (gender, birth_date, current_class_id, etc.) for DATABASE_ADMIN and VIEWER", async () => {
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
      expect(body.data.identity.gender).toBeUndefined();
      expect(body.data.identity.birth_date).toBeUndefined();
      expect(body.data.academic.current_class_id).toBeUndefined();
      expect(body.data.academic.graduation_grade).toBeUndefined();
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
});

describe("GET /api/admin/students", () => {
  let academicYearId: string;
  let gradeAId: string;
  let gradeZId: string;
  let classId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
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
      currentGradeId: gradeAId,
      joinAcademicYearId: academicYearId,
    });
    await StudentTest.create({
      email: "test_stu_search2@millennia21.id",
      nis: "9000019",
      currentGradeId: gradeAId,
      joinAcademicYearId: academicYearId,
    });
    await StudentTest.create({
      email: "test_stu_search3@millennia21.id",
      nis: "9000020",
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
      currentGradeId: gradeAId,
      joinGradeId: gradeAId,
      joinAcademicYearId: academicYearId,
      currentClassId: classId,
      status: StudentStatus.ACTIVE,
    });
    await StudentTest.create({
      email: "test_stu_filterZ@millennia21.id",
      nis: "9000023",
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
      currentGradeId: gradeAId,
      currentClassId: classId,
      joinAcademicYearId: academicYearId,
    });
    await StudentTest.create({
      email: "test_stu_sortZ@millennia21.id",
      nis: "9000025",
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
});

describe("PATCH /api/admin/students/:id", () => {
  let academicYearId: string;
  let gradeId: string;
  let higherGradeId: string;

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
      data: { name: "TEST_STU_GRADE1", level: 9301 },
    });
    gradeId = grade.id;
    const higherGrade = await prismaClient.grade.create({
      data: { name: "TEST_STU_GRADE2", level: 9302 },
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

  it("should successfully update a student when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_upd1@millennia21.id",
      nis: "9000027",
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

  it("should successfully update a student when requested by DATABASE_ADMIN with can_write_data", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const student = await StudentTest.create({
      email: "test_stu_upd2@millennia21.id",
      nis: "9000028",
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

  it("should reject update (403 Forbidden) when requested by VIEWER", async () => {
    const { accessToken } = await AdminUserTest.createViewer();
    const student = await StudentTest.create({
      email: "test_stu_upd3@millennia21.id",
      nis: "9000029",
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

  it("should reject update (403) for DATABASE_ADMIN if can_write_data is false", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    await prismaClient.adminUser.updateMany({
      where: { role: "DATABASE_ADMIN" },
      data: { can_write_data: false },
    });
    const student = await StudentTest.create({
      email: "test_stu_upd4@millennia21.id",
      nis: "9000030",
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
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });
    const student = await StudentTest.create({
      email: "test_stu_upd_mine@millennia21.id",
      nis: "9000032",
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

  it("should reject duplicate NIS on update", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await StudentTest.create({
      email: "test_stu_upd_nistaken@millennia21.id",
      nis: "9000033",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });
    const student = await StudentTest.create({
      email: "test_stu_upd_nismine@millennia21.id",
      nis: "9000034",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      { nis: "9000033" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("NIS already registered");
  });

  it("should allow updating a student with its own unchanged email/nis (no false duplicate)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const student = await StudentTest.create({
      email: "test_stu_upd_self@millennia21.id",
      nis: "9000035",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
    });

    const response = await TestRequest.patch(
      `/api/admin/students/${student.student!.id}`,
      {
        email: "test_stu_upd_self@millennia21.id",
        nis: "9000035",
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
    const response = await TestRequest.patch(
      "/api/admin/students/whatever",
      { full_name: "No Token Update" },
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
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

  it("should reject delete (403 Forbidden) when requested by DATABASE_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const student = await StudentTest.create({
      email: "test_stu_del2@millennia21.id",
      nis: "9000040",
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
    expect(body.data.status).toBe("ACTIVE");

    const stillThere = await prismaClient.student.findUnique({
      where: { id: student.student!.id },
    });
    expect(stillThere?.deleted_at).toBeNull();
  });

  it("should reject restore (403 Forbidden) when requested by DATABASE_ADMIN", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin();
    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin();
    const student = await StudentTest.create({
      email: "test_stu_res2@millennia21.id",
      nis: "9000044",
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
