import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  GradeTest,
  AcademicYearTest,
  AuditLogTest,
  MasterDataTest,
} from "./test-utils";
import { AuditAction, AuditSource } from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

describe("POST /api/admin/grades", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await GradeTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await GradeTest.delete();
    await MasterDataTest.delete();
  });

  it("should successfully create a grade when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/grades",
      { name: "TEST_Grade New", level: 10 },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.name).toBe("TEST_Grade New");
    expect(body.data.level).toBe(10);

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: body.data.id },
    });
    logger.debug(auditLog);

    expect(auditLog.action).toBe(AuditAction.CREATE_MASTER_DATA);
    expect(auditLog.source).toBe(AuditSource.UI);
    expect(auditLog.entity_type).toBe("Grade");
    expect(auditLog.admin_id).toBe(admin.id);
    expect(auditLog.old_values).toBeNull();
  });

  it("should reject creation (403 Forbidden) when requested by DATABASE_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();

    const response = await TestRequest.post(
      "/api/admin/grades",
      { name: "TEST_Blocked", level: 11 },
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
      "/api/admin/grades",
      { name: "TEST_Blocked2", level: 12 },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });

  it("should reject a duplicate name", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await prismaClient.grade.create({
      data: { name: "TEST_Duplicate", level: 13 },
    });

    const response = await TestRequest.post(
      "/api/admin/grades",
      { name: "TEST_Duplicate", level: 14 },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("name already exists");
  });

  it("should reject a duplicate level", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await prismaClient.grade.create({
      data: { name: "TEST_LevelTaken", level: 15 },
    });

    const response = await TestRequest.post(
      "/api/admin/grades",
      { name: "TEST_DifferentName", level: 15 },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("level already exists");
  });

  it("should reject creation (400 Bad Request) if name is missing", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/grades",
      { level: 16 },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject creation (400 Bad Request) if level is missing", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/grades",
      { name: "TEST_NoLevel" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject creation (400 Bad Request) if level is not a whole number", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/grades",
      { name: "TEST_FloatLevel", level: 17.5 },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.post("/api/admin/grades", {
      name: "TEST_NoAuth",
      level: 18,
    });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("PATCH /api/admin/grades/:id", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await GradeTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await GradeTest.delete();
    await MasterDataTest.delete();
  });

  it("should successfully update a grade when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const grade = await prismaClient.grade.create({
      data: { name: "TEST_Original", level: 19 },
    });

    const response = await TestRequest.patch(
      `/api/admin/grades/${grade.id}`,
      { name: "TEST_Renamed" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.name).toBe("TEST_Renamed");
    expect(body.data.level).toBe(19);

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: grade.id },
    });
    logger.debug(auditLog);

    expect(auditLog.action).toBe(AuditAction.UPDATE_MASTER_DATA);
    expect(auditLog.admin_id).toBe(admin.id);
  });

  it("should reject update (403 Forbidden) when requested by DATABASE_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const grade = await prismaClient.grade.create({
      data: { name: "TEST_Protected", level: 20 },
    });

    const response = await TestRequest.patch(
      `/api/admin/grades/${grade.id}`,
      { name: "TEST_ShouldNotChange" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });

  it("should reject renaming to an already-used name", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const taken = await prismaClient.grade.create({
      data: { name: "TEST_Taken", level: 21 },
    });
    const other = await prismaClient.grade.create({
      data: { name: "TEST_ToRename", level: 22 },
    });

    const response = await TestRequest.patch(
      `/api/admin/grades/${other.id}`,
      { name: taken.name },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("name already exists");
  });

  it("should reject changing to an already-used level", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const taken = await prismaClient.grade.create({
      data: { name: "TEST_LevelTakenA", level: 23 },
    });
    const other = await prismaClient.grade.create({
      data: { name: "TEST_LevelTakenB", level: 24 },
    });

    const response = await TestRequest.patch(
      `/api/admin/grades/${other.id}`,
      { level: taken.level },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("level already exists");
  });

  it("should allow re-saving with the same name and level (no-op)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const grade = await prismaClient.grade.create({
      data: { name: "TEST_SameName", level: 25 },
    });

    const response = await TestRequest.patch(
      `/api/admin/grades/${grade.id}`,
      { name: grade.name, level: grade.level },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.name).toBe(grade.name);
    expect(body.data.level).toBe(grade.level);
  });

  it("should reject if the grade does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.patch(
      "/api/admin/grades/invalid-cuid-123",
      { name: "TEST_Whatever" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("not found");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.patch("/api/admin/grades/whatever", {
      name: "TEST_Whatever",
    });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("GET /api/admin/grades/:id", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await GradeTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await GradeTest.delete();
    await MasterDataTest.delete();
  });

  it("should be readable by SUPER_ADMIN, DATABASE_ADMIN, and VIEWER alike", async () => {
    const grade = await prismaClient.grade.create({
      data: { name: "TEST_Readable", level: 26 },
    });
    const { accessToken: superAdminToken } = await AdminUserTest.createSuperAdmin();
    const { accessToken: dbAdminToken } = await AdminUserTest.createDatabaseAdmin();
    const { accessToken: viewerToken } = await AdminUserTest.createViewer();

    for (const token of [superAdminToken, dbAdminToken, viewerToken]) {
      const response = await TestRequest.get(
        `/api/admin/grades/${grade.id}`,
        token,
      );
      expect(response.status).toBe(200);
    }
  });

  it("should be able to read one of the permanently seeded grades", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const seeded = await prismaClient.grade.findUniqueOrThrow({
      where: { name: "Grade 1" },
    });

    const response = await TestRequest.get(
      `/api/admin/grades/${seeded.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.name).toBe("Grade 1");
    expect(body.data.level).toBe(1);
  });

  it("should reject if the grade does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/grades/invalid-cuid-123",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("not found");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get("/api/admin/grades/whatever");
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("GET /api/admin/grades", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await GradeTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await GradeTest.delete();
    await MasterDataTest.delete();
  });

  it("should list and paginate, scoped by search so the 12 seeded grades don't interfere", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await prismaClient.grade.create({ data: { name: "TEST_A", level: 27 } });
    await prismaClient.grade.create({ data: { name: "TEST_B", level: 28 } });
    await prismaClient.grade.create({ data: { name: "TEST_C", level: 29 } });

    const response = await TestRequest.get(
      "/api/admin/grades?size=2&page=1&search=TEST_",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(2);
    expect(body.paging.total_item).toBe(3);
    expect(body.paging.total_page).toBe(2);
  });

  it("should sort by level ascending by default", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await prismaClient.grade.create({ data: { name: "TEST_High", level: 31 } });
    await prismaClient.grade.create({ data: { name: "TEST_Low", level: 30 } });

    const response = await TestRequest.get(
      "/api/admin/grades?search=TEST_",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.map((g: { name: string }) => g.name)).toEqual([
      "TEST_Low",
      "TEST_High",
    ]);
  });

  it("should be readable by VIEWER and include the real seeded grades", async () => {
    const { accessToken } = await AdminUserTest.createViewer();

    const response = await TestRequest.get(
      "/api/admin/grades?size=100",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(
      body.data.some((g: { name: string }) => g.name === "Grade 1"),
    ).toBe(true);
  });

  it("should reject an invalid sort_by field", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/grades?sort_by=not_a_real_field",
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
      "/api/admin/grades?page=abc",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("page must be a valid number");
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get("/api/admin/grades");
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("DELETE /api/admin/grades/:id", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await GradeTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    // FK order: class -> grade/academic_year
    await prismaClient.class.deleteMany({
      where: { name: { startsWith: "TEST_" } },
    });
    await AdminUserTest.delete();
    await GradeTest.delete();
    await AcademicYearTest.delete();
    await MasterDataTest.delete();
  });

  it("should delete a grade not referenced by anything", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const grade = await prismaClient.grade.create({
      data: { name: "TEST_Deletable", level: 32 },
    });

    const response = await TestRequest.delete(
      `/api/admin/grades/${grade.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data).toBe(true);

    const stillThere = await prismaClient.grade.findUnique({
      where: { id: grade.id },
    });
    expect(stillThere).toBeNull();

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: grade.id },
    });
    logger.debug(auditLog);

    expect(auditLog.action).toBe(AuditAction.DELETE_MASTER_DATA);
    expect(auditLog.admin_id).toBe(admin.id);
  });

  it("should reject deletion (403 Forbidden) when requested by DATABASE_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const grade = await prismaClient.grade.create({
      data: { name: "TEST_Protected2", level: 33 },
    });

    const response = await TestRequest.delete(
      `/api/admin/grades/${grade.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });

  it("should reject if the grade does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.delete(
      "/api/admin/grades/invalid-cuid-123",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("not found");
  });

  it("should reject deletion when a Class still references the grade", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const grade = await prismaClient.grade.create({
      data: { name: "TEST_HasClass", level: 34 },
    });
    const year = await AcademicYearTest.create();
    await prismaClient.class.create({
      data: {
        name: "TEST_ClassUsingGrade",
        grade_id: grade.id,
        academic_year_id: year.id,
      },
    });

    const response = await TestRequest.delete(
      `/api/admin/grades/${grade.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("still referenced by");
    expect(body.errors).toContain("class(es)");

    const stillThere = await prismaClient.grade.findUnique({
      where: { id: grade.id },
    });
    expect(stillThere).not.toBeNull();
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.delete("/api/admin/grades/whatever");
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});
