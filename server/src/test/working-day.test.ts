import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import { TestRequest, AdminUserTest, MasterDataTest, WorkingDayTest } from "./test-utils";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

describe("POST /api/admin/working-days", () => {
  beforeEach(async () => {
    await AdminUserTest.delete();
    await WorkingDayTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await WorkingDayTest.delete();
    await MasterDataTest.delete();
  });

  it("should designate a Saturday as a working day when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const saturday = WorkingDayTest.nextSaturdayOnOrAfter(2100);

    const response = await TestRequest.post(
      "/api/admin/working-days",
      { date: saturday.toISOString(), reason: "Makeup day" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.reason).toBe("Makeup day");
    expect(new Date(body.data.date).toISOString()).toBe(saturday.toISOString());
  });

  it("should reject a date that isn't a Saturday", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const saturday = WorkingDayTest.nextSaturdayOnOrAfter(2100);
    const sunday = new Date(saturday.getTime() + 24 * 60 * 60 * 1000);

    const response = await TestRequest.post(
      "/api/admin/working-days",
      { date: sunday.toISOString() },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("must fall on a Saturday");
  });

  it("should reject a duplicate override for the same Saturday", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const saturday = WorkingDayTest.nextSaturdayOnOrAfter(2100);

    await TestRequest.post(
      "/api/admin/working-days",
      { date: saturday.toISOString() },
      accessToken,
    );
    const response = await TestRequest.post(
      "/api/admin/working-days",
      { date: saturday.toISOString() },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already designated");
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const saturday = WorkingDayTest.nextSaturdayOnOrAfter(2100);

    const response = await TestRequest.post(
      "/api/admin/working-days",
      { date: saturday.toISOString() },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });

  it("should reject if no access token provided", async () => {
    const saturday = WorkingDayTest.nextSaturdayOnOrAfter(2100);

    const response = await TestRequest.post("/api/admin/working-days", {
      date: saturday.toISOString(),
    });
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });
});

describe("GET /api/admin/working-days", () => {
  beforeEach(async () => {
    await AdminUserTest.delete();
    await WorkingDayTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await WorkingDayTest.delete();
    await MasterDataTest.delete();
  });

  it("should list working days for SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const saturday = WorkingDayTest.nextSaturdayOnOrAfter(2100);
    await prismaClient.workingDayOverride.create({ data: { date: saturday } });

    const response = await TestRequest.get("/api/admin/working-days", accessToken);
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(new Date(body.data[0].date).toISOString()).toBe(saturday.toISOString());
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createViewer();

    const response = await TestRequest.get("/api/admin/working-days", accessToken);
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });
});

describe("DELETE /api/admin/working-days/:id", () => {
  beforeEach(async () => {
    await AdminUserTest.delete();
    await WorkingDayTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await WorkingDayTest.delete();
    await MasterDataTest.delete();
  });

  it("should remove a working day when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const saturday = WorkingDayTest.nextSaturdayOnOrAfter(2100);
    const created = await prismaClient.workingDayOverride.create({
      data: { date: saturday },
    });

    const response = await TestRequest.delete(
      `/api/admin/working-days/${created.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data).toBe(true);

    const stillThere = await prismaClient.workingDayOverride.findUnique({
      where: { id: created.id },
    });
    expect(stillThere).toBeNull();
  });

  it("should reject if the working day does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.delete(
      "/api/admin/working-days/invalid-cuid-123",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Working day not found");
  });

  it("should reject if requester is not SUPER_ADMIN", async () => {
    const { accessToken: dbAdminToken } = await AdminUserTest.createDatabaseAdmin();
    const saturday = WorkingDayTest.nextSaturdayOnOrAfter(2100);
    const created = await prismaClient.workingDayOverride.create({
      data: { date: saturday },
    });

    const response = await TestRequest.delete(
      `/api/admin/working-days/${created.id}`,
      dbAdminToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Only Super Admin");
  });
});
