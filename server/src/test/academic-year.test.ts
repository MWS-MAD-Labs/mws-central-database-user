import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  AcademicYearTest,
  MasterDataTest,
} from "./test-utils";
import { AcademicYearStatus } from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

describe("POST /api/admin/academic-years", () => {
  beforeEach(async () => {
    await AdminUserTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should successfully create an academic year when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      {
        name: "Test Year 2027/2028",
        start_date: new Date("2027-07-01").toISOString(),
        end_date: new Date("2028-06-30").toISOString(),
        status: AcademicYearStatus.UPCOMING,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.name).toBe("Test Year 2027/2028");
    expect(body.data.status).toBe(AcademicYearStatus.UPCOMING);
    expect(body.data.start_date).toBeDefined();
    expect(body.data.end_date).toBeDefined();
  });

  it("should default to UPCOMING status and allow omitting dates", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      { name: "Test Year Minimal" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(AcademicYearStatus.UPCOMING);
    expect(body.data.start_date).toBeNull();
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
    await AcademicYearTest.create();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      { name: "Test Year 2026/2027" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already exists");
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
  beforeEach(async () => {
    await AdminUserTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

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
  });

  it("should reject update (403 Forbidden) when requested by DATABASE_ADMIN", async () => {
    const { accessToken: dbAdminToken } = await AdminUserTest.createDatabaseAdmin();
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
      data: { name: "Test Year Other", status: AcademicYearStatus.UPCOMING },
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
    await AdminUserTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should be readable by SUPER_ADMIN, DATABASE_ADMIN, and VIEWER alike", async () => {
    const year = await AcademicYearTest.create();
    const { accessToken: superAdminToken } = await AdminUserTest.createSuperAdmin();
    const { accessToken: dbAdminToken } = await AdminUserTest.createDatabaseAdmin();
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
    const response = await TestRequest.get("/api/admin/academic-years/whatever");
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("GET /api/admin/academic-years", () => {
  beforeEach(async () => {
    await AdminUserTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should list and paginate academic years", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await prismaClient.academicYear.createMany({
      data: [
        { name: "Test Year A", status: AcademicYearStatus.COMPLETED },
        { name: "Test Year B", status: AcademicYearStatus.ACTIVE },
        { name: "Test Year C", status: AcademicYearStatus.UPCOMING },
      ],
    });

    const response = await TestRequest.get(
      "/api/admin/academic-years?size=2&page=1",
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
        { name: "Test Year Active", status: AcademicYearStatus.ACTIVE },
        { name: "Test Year Upcoming", status: AcademicYearStatus.UPCOMING },
      ],
    });

    const response = await TestRequest.get(
      "/api/admin/academic-years?status=ACTIVE",
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
        { name: "Test Year Sombrero", status: AcademicYearStatus.ACTIVE },
        { name: "Test Year Fedora", status: AcademicYearStatus.UPCOMING },
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
    await AdminUserTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    // FK order: enrollment -> student/class -> person/grade/academic_year
    await prismaClient.studentClassEnrollment.deleteMany({
      where: { class_name_snapshot: { startsWith: "TEST_" } },
    });
    await prismaClient.student.deleteMany({
      where: { nis: { startsWith: "TEST_NIS_" } },
    });
    await prismaClient.person.deleteMany({
      where: { email: { contains: "@millennia21.id" } },
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
      data: { name: "TEST_Grade1", level: 1 },
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
