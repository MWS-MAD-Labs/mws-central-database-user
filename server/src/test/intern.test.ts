import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  AuditLogTest,
  MasterDataTest,
  InternTest,
} from "./test-utils";
import {
  AuditAction,
  AuditSource,
  Gender,
  Religion,
  InternStatus,
  type MasterUnit,
  type MasterJobPosition,
  type MasterBuilding,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

describe("POST /api/admin/interns", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    building: MasterBuilding;
  };
  let secondUnitId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await InternTest.delete();

    await prismaClient.masterUnit.deleteMany({ where: { id: "unit_2_test" } });
    await MasterDataTest.delete();

    masterData = await MasterDataTest.create();

    const unit2 = await prismaClient.masterUnit.create({
      data: { id: "unit_2_test", name: "Second Unit" },
    });
    secondUnitId = unit2.id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await InternTest.delete();

    await prismaClient.masterUnit.deleteMany({ where: { id: "unit_2_test" } });
    await MasterDataTest.delete();
  });

  it("should successfully create an intern when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Test Intern One",
      nick_name: "Intern One",
      email: "test_intern_1@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2003-01-01").toISOString(),

      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      building_id: masterData.building.id,
      join_date: new Date("2026-07-01").toISOString(),
      end_date: new Date("2026-12-31").toISOString(),
    };

    const response = await TestRequest.post(
      "/api/admin/interns",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.identity.email).toBe("test_intern_1@millennia21.id");
    expect(body.data.employment.unit).toBe("TEST_UNIT_SHIELD");
    expect(body.data.employment.job_position).toBe("TEST_POS_TEACHER");
    expect(body.data.status).toBe(InternStatus.ACTIVE);

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: body.data.id },
    });

    expect(auditLog.action).toBe(AuditAction.CREATE_INTERN);
    expect(auditLog.source).toBe(AuditSource.UI);
    expect(auditLog.entity_type).toBe("Intern");
    expect(auditLog.admin_id).toBe(admin.id);
    expect(auditLog.old_values).toBeNull();
  });

  it("should reject (400) when end_date is not after join_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const response = await TestRequest.post(
      "/api/admin/interns",
      {
        full_name: "Test Intern Bad Dates",
        nick_name: "Bad Dates",
        email: "test_intern_2@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("2003-01-01").toISOString(),

        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-07-01").toISOString(),
        end_date: new Date("2026-01-01").toISOString(),
      },
      accessToken,
    );

    expect(response.status).toBe(400);
  });

  it("should reject (403) when requested by VIEWER", async () => {
    const { accessToken } = await AdminUserTest.createViewer(masterData.unit.id);

    const response = await TestRequest.post(
      "/api/admin/interns",
      {
        full_name: "Test Intern Viewer",
        nick_name: "Viewer",
        email: "test_intern_3@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("2003-01-01").toISOString(),

        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-07-01").toISOString(),
        end_date: new Date("2026-12-31").toISOString(),
      },
      accessToken,
    );

    expect(response.status).toBe(403);
  });

  it("should reject (403) when DATABASE_ADMIN creates outside their unit scope", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );

    const response = await TestRequest.post(
      "/api/admin/interns",
      {
        full_name: "Test Intern Other Unit",
        nick_name: "Other Unit",
        email: "test_intern_4@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("2003-01-01").toISOString(),

        unit_id: secondUnitId,
        job_position_id: masterData.position.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-07-01").toISOString(),
        end_date: new Date("2026-12-31").toISOString(),
      },
      accessToken,
    );

    expect(response.status).toBe(403);
  });
});

describe("PATCH /api/admin/interns/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await InternTest.delete();
    await MasterDataTest.delete();

    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await InternTest.delete();
    await MasterDataTest.delete();
  });

  it("should update status and notes", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const person = await InternTest.create({
      email: "test_intern_update@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });

    const response = await TestRequest.patch(
      `/api/admin/interns/${person.intern!.id}`,
      { status: InternStatus.COMPLETED, notes: "Finished the internship" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(InternStatus.COMPLETED);
    expect(body.data.notes).toBe("Finished the internship");
  });
});

describe("GET /api/admin/interns", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await InternTest.delete();
    await MasterDataTest.delete();

    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await InternTest.delete();
    await MasterDataTest.delete();
  });

  it("should list and get intern detail", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const person = await InternTest.create({
      email: "test_intern_get@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });

    const searchResponse = await TestRequest.get(
      "/api/admin/interns",
      accessToken,
    );
    const searchBody = await searchResponse.json();
    expect(searchResponse.status).toBe(200);
    expect(
      searchBody.data.some((item: { id: string }) => item.id === person.intern!.id),
    ).toBe(true);

    const getResponse = await TestRequest.get(
      `/api/admin/interns/${person.intern!.id}`,
      accessToken,
    );
    const getBody = await getResponse.json();
    expect(getResponse.status).toBe(200);
    expect(getBody.data.identity.email).toBe("test_intern_get@millennia21.id");
    expect(getBody.data.identity.gender).toBe(Gender.MALE);
  });
});

describe("DELETE/RESTORE /api/admin/interns", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await InternTest.delete();
    await MasterDataTest.delete();

    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await InternTest.delete();
    await MasterDataTest.delete();
  });

  it("should soft-delete then restore an intern, SUPER_ADMIN only", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const person = await InternTest.create({
      email: "test_intern_delete@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });

    const removeResponse = await TestRequest.patch(
      `/api/admin/interns/delete/${person.intern!.id}`,
      {},
      accessToken,
    );
    expect(removeResponse.status).toBe(200);

    const deleted = await prismaClient.intern.findUniqueOrThrow({
      where: { id: person.intern!.id },
    });
    expect(deleted.deleted_at).not.toBeNull();
    expect(deleted.status).toBe(InternStatus.TERMINATED);

    const restoreResponse = await TestRequest.patch(
      `/api/admin/interns/restore/${person.intern!.id}`,
      {},
      accessToken,
    );
    expect(restoreResponse.status).toBe(200);

    const restored = await prismaClient.intern.findUniqueOrThrow({
      where: { id: person.intern!.id },
    });
    expect(restored.deleted_at).toBeNull();
    expect(restored.status).toBe(InternStatus.ACTIVE);
  });

  it("should reject (403) delete when requested by DATABASE_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );
    const person = await InternTest.create({
      email: "test_intern_delete_forbidden@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });

    const response = await TestRequest.patch(
      `/api/admin/interns/delete/${person.intern!.id}`,
      {},
      accessToken,
    );

    expect(response.status).toBe(403);
  });
});
