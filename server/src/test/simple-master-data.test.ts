import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  EmployeeTest,
  MasterDataTest,
  AuditLogTest,
} from "./test-utils";
import { AuditAction, AuditSource } from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

// MasterUnit, MasterJobPosition, MasterJobLevel are all served by the same
// generic factory (simple-master-data-service.ts / -controller.ts), so
// their CRUD/RBAC/search behavior is identical by construction - this
// table-driven suite runs the same scenarios against all three real
// endpoints instead of hand-duplicating the same test file three times.
// Each entity's delete-guard setup differs (what references it), so those
// get their own dedicated describe blocks below instead of being looped.
//
// beforeEach calls MasterDataTest.create() (not just .delete()) because
// AdminUserTest.createSuperAdmin()/createDatabaseAdmin()/createViewer() all
// need *some* TEST_-prefixed MasterUnit to already exist to attach the
// admin account to. That fixture is named "TEST_UNIT_SHIELD" etc, so this
// file's own ad-hoc CRUD fixtures use a "TEST_CRUD_" prefix and search for
// "TEST_CRUD" (not bare "TEST_") to avoid counting the fixture as one of
// their own test rows.
type EndpointConfig = {
  label: string;
  basePath: string;
  create: (name: string) => Promise<{ id: string; name: string }>;
  findByName: (name: string) => Promise<{ id: string; name: string } | null>;
};

const ENDPOINTS: EndpointConfig[] = [
  {
    label: "unit",
    basePath: "/api/admin/units",
    create: (name) => prismaClient.masterUnit.create({ data: { name } }),
    findByName: (name) => prismaClient.masterUnit.findUnique({ where: { name } }),
  },
  {
    label: "job position",
    basePath: "/api/admin/job-positions",
    create: (name) => prismaClient.masterJobPosition.create({ data: { name } }),
    findByName: (name) =>
      prismaClient.masterJobPosition.findUnique({ where: { name } }),
  },
  {
    label: "job level",
    basePath: "/api/admin/job-levels",
    create: (name) => prismaClient.masterJobLevel.create({ data: { name } }),
    findByName: (name) =>
      prismaClient.masterJobLevel.findUnique({ where: { name } }),
  },
];

for (const endpoint of ENDPOINTS) {
  describe(`POST ${endpoint.basePath}`, () => {
    beforeEach(async () => {
      await AuditLogTest.delete();
      await AdminUserTest.delete();
      await MasterDataTest.delete();
      await MasterDataTest.create();
    });

    afterEach(async () => {
      await AuditLogTest.delete();
      await AdminUserTest.delete();
      await MasterDataTest.delete();
    });

    it(`should successfully create a ${endpoint.label} when requested by SUPER_ADMIN`, async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        endpoint.basePath,
        { name: "TEST_CRUD_New Value" },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.name).toBe("TEST_CRUD_New Value");

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { entity_id: body.data.id },
      });
      logger.debug(auditLog);

      expect(auditLog.action).toBe(AuditAction.CREATE_MASTER_DATA);
      expect(auditLog.source).toBe(AuditSource.UI);
      expect(auditLog.admin_id).toBe(admin.id);
      expect(auditLog.old_values).toBeNull();
    });

    it(`should reject creation (403 Forbidden) when requested by DATABASE_ADMIN`, async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();

      const response = await TestRequest.post(
        endpoint.basePath,
        { name: "TEST_CRUD_Blocked" },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(403);
      expect(body.errors).toContain("Only Super Admin");
    });

    it(`should reject creation (403 Forbidden) when requested by VIEWER`, async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.post(
        endpoint.basePath,
        { name: "TEST_CRUD_Blocked2" },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(403);
      expect(body.errors).toContain("Only Super Admin");
    });

    it(`should reject a duplicate name`, async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await endpoint.create("TEST_CRUD_Duplicate");

      const response = await TestRequest.post(
        endpoint.basePath,
        { name: "TEST_CRUD_Duplicate" },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
      expect(body.errors).toContain("already exists");
    });

    it(`should reject creation (400 Bad Request) if name is missing`, async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(endpoint.basePath, {}, accessToken);
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
      expect(body.errors).toBeDefined();
    });

    it(`should reject creation (400 Bad Request) if name exceeds 100 characters`, async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.post(
        endpoint.basePath,
        { name: `TEST_CRUD_${"X".repeat(100)}` },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
      expect(body.errors).toBeDefined();
    });

    it(`should reject if no access token provided`, async () => {
      const response = await TestRequest.post(endpoint.basePath, {
        name: "TEST_CRUD_NoAuth",
      });
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(401);
      expect(body.errors).toBeDefined();
    });
  });

  describe(`PATCH ${endpoint.basePath}/:id`, () => {
    beforeEach(async () => {
      await AuditLogTest.delete();
      await AdminUserTest.delete();
      await MasterDataTest.delete();
      await MasterDataTest.create();
    });

    afterEach(async () => {
      await AuditLogTest.delete();
      await AdminUserTest.delete();
      await MasterDataTest.delete();
    });

    it(`should successfully update a ${endpoint.label} when requested by SUPER_ADMIN`, async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const entity = await endpoint.create("TEST_CRUD_Original");

      const response = await TestRequest.patch(
        `${endpoint.basePath}/${entity.id}`,
        { name: "TEST_CRUD_Renamed" },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.name).toBe("TEST_CRUD_Renamed");

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { entity_id: entity.id },
      });
      logger.debug(auditLog);

      expect(auditLog.action).toBe(AuditAction.UPDATE_MASTER_DATA);
      expect(auditLog.admin_id).toBe(admin.id);
      const oldValues = auditLog.old_values as { name?: string };
      const newValues = auditLog.new_values as { name?: string };
      expect(oldValues?.name).toBe("TEST_CRUD_Original");
      expect(newValues?.name).toBe("TEST_CRUD_Renamed");
    });

    it(`should reject update (403 Forbidden) when requested by DATABASE_ADMIN`, async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const entity = await endpoint.create("TEST_CRUD_Protected");

      const response = await TestRequest.patch(
        `${endpoint.basePath}/${entity.id}`,
        { name: "TEST_CRUD_ShouldNotChange" },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(403);
      expect(body.errors).toContain("Only Super Admin");
    });

    it(`should reject renaming to an already-used name`, async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const taken = await endpoint.create("TEST_CRUD_Taken");
      const other = await endpoint.create("TEST_CRUD_ToRename");

      const response = await TestRequest.patch(
        `${endpoint.basePath}/${other.id}`,
        { name: taken.name },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
      expect(body.errors).toContain("already exists");
    });

    it(`should allow re-saving with the same name (no-op rename)`, async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const entity = await endpoint.create("TEST_CRUD_SameName");

      const response = await TestRequest.patch(
        `${endpoint.basePath}/${entity.id}`,
        { name: entity.name },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.name).toBe(entity.name);
    });

    it(`should reject if the ${endpoint.label} does not exist`, async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.patch(
        `${endpoint.basePath}/invalid-cuid-123`,
        { name: "TEST_CRUD_Whatever" },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(404);
      expect(body.errors).toContain("not found");
    });

    it(`should reject if no access token provided`, async () => {
      const response = await TestRequest.patch(`${endpoint.basePath}/whatever`, {
        name: "TEST_CRUD_Whatever",
      });
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(401);
      expect(body.errors).toBeDefined();
    });
  });

  describe(`GET ${endpoint.basePath}/:id`, () => {
    beforeEach(async () => {
      await AuditLogTest.delete();
      await AdminUserTest.delete();
      await MasterDataTest.delete();
      await MasterDataTest.create();
    });

    afterEach(async () => {
      await AuditLogTest.delete();
      await AdminUserTest.delete();
      await MasterDataTest.delete();
    });

    it(`should be readable by SUPER_ADMIN, DATABASE_ADMIN, and VIEWER alike`, async () => {
      const entity = await endpoint.create("TEST_CRUD_Readable");
      const { accessToken: superAdminToken } = await AdminUserTest.createSuperAdmin();
      const { accessToken: dbAdminToken } = await AdminUserTest.createDatabaseAdmin();
      const { accessToken: viewerToken } = await AdminUserTest.createViewer();

      for (const token of [superAdminToken, dbAdminToken, viewerToken]) {
        const response = await TestRequest.get(
          `${endpoint.basePath}/${entity.id}`,
          token,
        );
        expect(response.status).toBe(200);
      }
    });

    it(`should reject if the ${endpoint.label} does not exist`, async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.get(
        `${endpoint.basePath}/invalid-cuid-123`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(404);
      expect(body.errors).toContain("not found");
    });

    it(`should reject if no access token provided`, async () => {
      const response = await TestRequest.get(`${endpoint.basePath}/whatever`);
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(401);
      expect(body.errors).toBeDefined();
    });
  });

  describe(`GET ${endpoint.basePath}`, () => {
    beforeEach(async () => {
      await AuditLogTest.delete();
      await AdminUserTest.delete();
      await MasterDataTest.delete();
      await MasterDataTest.create();
    });

    afterEach(async () => {
      await AuditLogTest.delete();
      await AdminUserTest.delete();
      await MasterDataTest.delete();
    });

    it(`should list and paginate`, async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await endpoint.create("TEST_CRUD_A");
      await endpoint.create("TEST_CRUD_B");
      await endpoint.create("TEST_CRUD_C");

      const response = await TestRequest.get(
        `${endpoint.basePath}?size=2&page=1&search=TEST_CRUD`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(2);
      expect(body.paging.total_item).toBe(3);
      expect(body.paging.total_page).toBe(2);
    });

    it(`should search by name`, async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await endpoint.create("TEST_CRUD_Sombrero");
      await endpoint.create("TEST_CRUD_Fedora");

      const response = await TestRequest.get(
        `${endpoint.basePath}?search=sombrero`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].name).toBe("TEST_CRUD_Sombrero");
    });

    it(`should sort by name descending when requested`, async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await endpoint.create("TEST_CRUD_Alpha");
      await endpoint.create("TEST_CRUD_Zebra");

      const response = await TestRequest.get(
        `${endpoint.basePath}?search=TEST_CRUD&sort_by=name&sort_order=desc`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.map((e: { name: string }) => e.name)).toEqual([
        "TEST_CRUD_Zebra",
        "TEST_CRUD_Alpha",
      ]);
    });

    it(`should be readable by VIEWER`, async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.get(endpoint.basePath, accessToken);

      expect(response.status).toBe(200);
    });

    it(`should reject an invalid sort_by field`, async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.get(
        `${endpoint.basePath}?sort_by=not_a_real_field`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
      expect(body.errors).toBeDefined();
    });

    it(`should reject a non-numeric page`, async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.get(
        `${endpoint.basePath}?page=abc`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
      expect(body.errors).toContain("page must be a valid number");
    });

    it(`should reject a size greater than the maximum allowed (100)`, async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.get(
        `${endpoint.basePath}?size=101`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
      expect(body.errors).toBeDefined();
    });

    it(`should reject if no access token provided`, async () => {
      const response = await TestRequest.get(endpoint.basePath);
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(401);
      expect(body.errors).toBeDefined();
    });
  });

  describe(`DELETE ${endpoint.basePath}/:id`, () => {
    beforeEach(async () => {
      await AuditLogTest.delete();
      await AdminUserTest.delete();
      await MasterDataTest.delete();
      await MasterDataTest.create();
    });

    afterEach(async () => {
      await AuditLogTest.delete();
      await AdminUserTest.delete();
      await MasterDataTest.delete();
    });

    it(`should delete a ${endpoint.label} not referenced by anything`, async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const entity = await endpoint.create("TEST_CRUD_Deletable");

      const response = await TestRequest.delete(
        `${endpoint.basePath}/${entity.id}`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data).toBe(true);

      const stillThere = await endpoint.findByName(entity.name);
      expect(stillThere).toBeNull();

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { entity_id: entity.id },
      });
      logger.debug(auditLog);

      expect(auditLog.action).toBe(AuditAction.DELETE_MASTER_DATA);
      expect(auditLog.admin_id).toBe(admin.id);
    });

    it(`should reject deletion (403 Forbidden) when requested by DATABASE_ADMIN`, async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const entity = await endpoint.create("TEST_CRUD_Protected2");

      const response = await TestRequest.delete(
        `${endpoint.basePath}/${entity.id}`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(403);
      expect(body.errors).toContain("Only Super Admin");
    });

    it(`should reject if the ${endpoint.label} does not exist`, async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const response = await TestRequest.delete(
        `${endpoint.basePath}/invalid-cuid-123`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(404);
      expect(body.errors).toContain("not found");
    });

    it(`should reject if no access token provided`, async () => {
      const response = await TestRequest.delete(`${endpoint.basePath}/whatever`);
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(401);
      expect(body.errors).toBeDefined();
    });
  });
}

// Each entity is referenced by a different set of tables, so the
// delete-guard itself is tested per-entity here instead of in the loop
// above.
describe("DELETE /api/admin/units - reference checks", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  it("should reject deletion when an Employee still references the unit", async () => {
    const masterData = await MasterDataTest.create();
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetUnit = await prismaClient.masterUnit.create({
      data: { name: "TEST_TargetUnit" },
    });
    await EmployeeTest.create({
      email: "test_emp_unit_ref@millennia21.id",
      unitId: targetUnit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.delete(
      `/api/admin/units/${targetUnit.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("still referenced by");
    expect(body.errors).toContain("employee(s)");
  });

  it("should reject deletion when an AdminUser still references the unit", async () => {
    await MasterDataTest.create();
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetUnit = await prismaClient.masterUnit.create({
      data: { name: "TEST_TargetUnit2" },
    });
    await AdminUserTest.createDatabaseAdmin(targetUnit.id);

    const response = await TestRequest.delete(
      `/api/admin/units/${targetUnit.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("still referenced by");
    expect(body.errors).toContain("admin user(s)");
  });
});

describe("DELETE /api/admin/job-positions - reference checks", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  it("should reject deletion when an Employee still references the job position", async () => {
    const masterData = await MasterDataTest.create();
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetPosition = await prismaClient.masterJobPosition.create({
      data: { name: "TEST_TargetPosition" },
    });
    await EmployeeTest.create({
      email: "test_emp_position_ref@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: targetPosition.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.delete(
      `/api/admin/job-positions/${targetPosition.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("still referenced by");
    expect(body.errors).toContain("employee(s)");
  });
});

describe("DELETE /api/admin/job-levels - reference checks", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  it("should reject deletion when an Employee still references the job level", async () => {
    const masterData = await MasterDataTest.create();
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetLevel = await prismaClient.masterJobLevel.create({
      data: { name: "TEST_TargetLevel" },
    });
    await EmployeeTest.create({
      email: "test_emp_level_ref@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: targetLevel.id,
    });

    const response = await TestRequest.delete(
      `/api/admin/job-levels/${targetLevel.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("still referenced by");
    expect(body.errors).toContain("employee(s)");
  });
});
