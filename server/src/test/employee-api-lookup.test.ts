import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  MasterDataTest,
  EmployeeTest,
  ApiClientTest,
} from "./test-utils";
import { EmployeeStatus } from "../generated/prisma/client";
import type {
  MasterUnit,
  MasterJobPosition,
  MasterJobLevel,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

const READ_SCOPE = "employees:read";

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("GET /api/internal/employees/lookup", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };

  beforeEach(async () => {
    await EmployeeTest.delete();
    await ApiClientTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await EmployeeTest.delete();
    await ApiClientTest.delete();
    await MasterDataTest.delete();
  });

  it("should return a minimal employee profile for a valid token with the right scope", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
    });
    const person = await EmployeeTest.create({
      email: "lookup_me@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.get(
      "/api/internal/employees/lookup?email=lookup_me@millennia21.id",
      undefined,
      authHeader(token),
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(person.employee!.id);
    expect(body.data.email).toBe("lookup_me@millennia21.id");
    expect(body.data.unit).toBe(masterData.unit.name);
    expect(body.data.job_position).toBe(masterData.position.name);
    expect(body.data.status).toBe(EmployeeStatus.ACTIVE);

    // Lean contract — no sensitive/admin-only fields leak through.
    expect(body.data.gender).toBeUndefined();
    expect(body.data.religion).toBeUndefined();
    expect(body.data.birth_date).toBeUndefined();
    expect(body.data.offboarding).toBeUndefined();
  });

  it("should record last_used_at on the calling client after a successful request", async () => {
    const { client, token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
    });
    await EmployeeTest.create({
      email: "track_usage@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    expect(client.last_used_at).toBeNull();

    await TestRequest.get(
      "/api/internal/employees/lookup?email=track_usage@millennia21.id",
      undefined,
      authHeader(token),
    );

    const updated = await prismaClient.apiClient.findUnique({
      where: { id: client.id },
    });
    expect(updated?.last_used_at).not.toBeNull();
  });

  it("should reject if no Authorization header is provided", async () => {
    const response = await TestRequest.get(
      "/api/internal/employees/lookup?email=anyone@millennia21.id",
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  it("should reject a malformed token (missing prefix/secret separator)", async () => {
    const response = await TestRequest.get(
      "/api/internal/employees/lookup?email=anyone@millennia21.id",
      undefined,
      authHeader("not-a-valid-token"),
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
  });

  it("should reject a token with the right prefix but wrong secret", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
    });
    const [prefix] = token.split(".");
    const tamperedToken = `${prefix}.${"0".repeat(64)}`;

    const response = await TestRequest.get(
      "/api/internal/employees/lookup?email=anyone@millennia21.id",
      undefined,
      authHeader(tamperedToken),
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
  });

  it("should reject a token belonging to a revoked (inactive) client", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
      isActive: false,
    });

    const response = await TestRequest.get(
      "/api/internal/employees/lookup?email=anyone@millennia21.id",
      undefined,
      authHeader(token),
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(401);
  });

  it("should reject a client that lacks the employees:read scope", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: ["some_other:scope"],
    });

    const response = await TestRequest.get(
      "/api/internal/employees/lookup?email=anyone@millennia21.id",
      undefined,
      authHeader(token),
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("employees:read");
  });

  it("should reject if the email query parameter is missing", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
    });

    const response = await TestRequest.get(
      "/api/internal/employees/lookup",
      undefined,
      authHeader(token),
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
  });

  it("should return 404 for an email that has no matching active employee", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
    });

    const response = await TestRequest.get(
      "/api/internal/employees/lookup?email=nobody_here@millennia21.id",
      undefined,
      authHeader(token),
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
  });

  it("should return 404 for an employee that is not ACTIVE", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
    });
    await EmployeeTest.create({
      email: "resigned_lookup@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      status: EmployeeStatus.RESIGNED,
    });

    const response = await TestRequest.get(
      "/api/internal/employees/lookup?email=resigned_lookup@millennia21.id",
      undefined,
      authHeader(token),
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
  });

  it("should also accept lookup by employee_id", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
    });
    const person = await EmployeeTest.create({
      email: "lookup_by_id@millennia21.id",
      employeeId: "99.99.LOOKUP",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.get(
      "/api/internal/employees/lookup?employee_id=99.99.LOOKUP",
      undefined,
      authHeader(token),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.id).toBe(person.employee!.id);
    expect(body.data.employee_id).toBe("99.99.LOOKUP");
  });

  it("should return 404 for an employee_id that has no matching active employee", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
    });

    const response = await TestRequest.get(
      "/api/internal/employees/lookup?employee_id=99.99.NOBODY",
      undefined,
      authHeader(token),
    );

    expect(response.status).toBe(404);
  });
});

describe("GET /api/internal/employees (list)", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };

  beforeEach(async () => {
    await EmployeeTest.delete();
    await ApiClientTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await EmployeeTest.delete();
    await ApiClientTest.delete();
    await MasterDataTest.delete();
  });

  it("should return a paginated, lean list of employees with the success envelope", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
    });
    await EmployeeTest.create({
      email: "list_one@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });
    await EmployeeTest.create({
      email: "list_two@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.get(
      `/api/internal/employees?unit_id=${masterData.unit.id}`,
      undefined,
      authHeader(token),
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(2);
    expect(body.paging.total_item).toBe(2);
    expect(body.data[0].gender).toBeUndefined();
  });

  it("should default to ACTIVE employees only when no status filter is given", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
    });
    await EmployeeTest.create({
      email: "default_active@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      status: EmployeeStatus.ACTIVE,
    });
    await EmployeeTest.create({
      email: "default_resigned@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      status: EmployeeStatus.RESIGNED,
    });

    const response = await TestRequest.get(
      `/api/internal/employees?unit_id=${masterData.unit.id}`,
      undefined,
      authHeader(token),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].email).toBe("default_active@millennia21.id");
  });

  it("should return non-ACTIVE employees when status is explicitly requested", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
    });
    await EmployeeTest.create({
      email: "explicit_resigned@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      status: EmployeeStatus.RESIGNED,
    });

    const response = await TestRequest.get(
      `/api/internal/employees?unit_id=${masterData.unit.id}&status=RESIGNED`,
      undefined,
      authHeader(token),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].email).toBe("explicit_resigned@millennia21.id");
  });

  it("should filter by status", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
    });
    await EmployeeTest.create({
      email: "list_active@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      status: EmployeeStatus.ACTIVE,
    });
    await EmployeeTest.create({
      email: "list_resigned@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      status: EmployeeStatus.RESIGNED,
    });

    const response = await TestRequest.get(
      `/api/internal/employees?unit_id=${masterData.unit.id}&status=ACTIVE`,
      undefined,
      authHeader(token),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].email).toBe("list_active@millennia21.id");
  });

  it("should filter by unit_id", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
    });
    const otherUnit = await prismaClient.masterUnit.create({
      data: { name: "TEST_UNIT_OTHER" },
    });
    await EmployeeTest.create({
      email: "unit_a@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });
    await EmployeeTest.create({
      email: "unit_b@millennia21.id",
      unitId: otherUnit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.get(
      `/api/internal/employees?unit_id=${masterData.unit.id}`,
      undefined,
      authHeader(token),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].email).toBe("unit_a@millennia21.id");
  });

  it("should filter by job_position_id", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
    });
    const otherPosition = await prismaClient.masterJobPosition.create({
      data: { name: "TEST_POS_OTHER" },
    });
    await EmployeeTest.create({
      email: "pos_a@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
    });
    await EmployeeTest.create({
      email: "pos_b@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: otherPosition.id,
      jobLevelId: masterData.level.id,
    });

    const response = await TestRequest.get(
      `/api/internal/employees?unit_id=${masterData.unit.id}&job_position_id=${masterData.position.id}`,
      undefined,
      authHeader(token),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].email).toBe("pos_a@millennia21.id");
  });

  it("should reject a page size above the cap", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
    });

    const response = await TestRequest.get(
      "/api/internal/employees?size=500",
      undefined,
      authHeader(token),
    );

    expect(response.status).toBe(400);
  });

  it("should reject a client that lacks the employees:read scope", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: ["some_other:scope"],
    });

    const response = await TestRequest.get(
      "/api/internal/employees",
      undefined,
      authHeader(token),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.errors).toContain("employees:read");
  });

  it("should reject if no Authorization header is provided", async () => {
    const response = await TestRequest.get("/api/internal/employees");
    expect(response.status).toBe(401);
  });
});
