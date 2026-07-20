import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  AcademicYearTest,
  AuditLogTest,
  MasterDataTest,
} from "./test-utils";
import {
  AcademicYearStatus,
  AuditAction,
  AuditSource,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

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
      "Test Year 2027/2028",
    );
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

  it("should reject creating a second ACTIVE academic year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await AcademicYearTest.create(); // status: ACTIVE

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      { name: "Test Year Also Active", status: AcademicYearStatus.ACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already active");

    const created = await prismaClient.academicYear.findUnique({
      where: { name: "Test Year Also Active" },
    });
    expect(created).toBeNull();
  });

  it("should successfully create a new ACTIVE academic year when none is currently active", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/academic-years",
      { name: "Test Year Freshly Active", status: AcademicYearStatus.ACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(AcademicYearStatus.ACTIVE);
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

  it("should reject activating a second academic year while one is already active", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await AcademicYearTest.create(); // status: ACTIVE
    const upcoming = await prismaClient.academicYear.create({
      data: { name: "Test Year Upcoming", status: AcademicYearStatus.UPCOMING },
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
    const year = await AcademicYearTest.create(); // status: ACTIVE

    const response = await TestRequest.patch(
      `/api/admin/academic-years/${year.id}`,
      { status: AcademicYearStatus.ACTIVE, end_date: new Date("2027-06-30").toISOString() },
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
      data: { name: "Test Year To Activate", status: AcademicYearStatus.UPCOMING },
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
        { name: "Test Year A", status: AcademicYearStatus.COMPLETED },
        { name: "Test Year B", status: AcademicYearStatus.ACTIVE },
        { name: "Test Year C", status: AcademicYearStatus.UPCOMING },
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
        { name: "Test Year Active", status: AcademicYearStatus.ACTIVE },
        { name: "Test Year Upcoming", status: AcademicYearStatus.UPCOMING },
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
        { name: "Test Year Zebra", status: AcademicYearStatus.UPCOMING },
        { name: "Test Year Alpha", status: AcademicYearStatus.UPCOMING },
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
      data: { name: "Test Year For Class", status: AcademicYearStatus.UPCOMING },
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
      data: { name: "Test Year Direct A", status: AcademicYearStatus.ACTIVE },
    });

    let threw = false;
    try {
      await prismaClient.academicYear.create({
        data: { name: "Test Year Direct B", status: AcademicYearStatus.ACTIVE },
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
