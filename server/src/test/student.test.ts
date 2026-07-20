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

      nis: "TEST_0001",
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
    expect(body.data.academic.nis).toBe("TEST_0001");
    expect(body.data.academic.nisn).toBe("1234567890");
    expect(body.data.status).toBe("ACTIVE");

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: "CREATE_STUDENT", entity_id: body.data.id },
    });
    expect(auditLog.entity_type).toBe("Student");
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

      nis: "TEST_0002",
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
      nis: "TEST_9999",
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
      nis: "TEST_0003",
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
      nis: "TEST_0004",
    });

    const requestBody = {
      full_name: "Test Student Duplicate",
      nick_name: "Stu Dup",
      email: "test_stu_dup@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2012-04-04").toISOString(),
      nis: "TEST_0005",
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
      nis: "TEST_0006",
    });

    const requestBody = {
      full_name: "Test Student NIS Dup",
      nick_name: "Stu NIS",
      email: "test_stu_nis2@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2012-05-05").toISOString(),
      nis: "TEST_0006",
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
      nis: "TEST_0007",
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
      nis: "TEST_0008",
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
      nis: "TEST_0009",
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
      nis: "TEST_0013",
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
      nis: "TEST_0014",
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
      nis: "TEST_0015",
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
      nis: "TEST_0016",
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
      nis: "TEST_0010",
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
      nis: "TEST_0011",
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
    expect(body.data.academic.nis).toBe("TEST_0011");
    expect(body.data.academic.nisn).toBe("1122334455");
  });

  it("should hide sensitive fields (gender, birth_date, current_class_id, etc.) for DATABASE_ADMIN and VIEWER", async () => {
    const student = await StudentTest.create({
      email: "test_stu_limited@millennia21.id",
      nis: "TEST_0012",
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
      expect(body.data.academic.nis).toBe("TEST_0012");
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
