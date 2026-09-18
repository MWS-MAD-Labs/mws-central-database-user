import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  MasterDataTest,
  EmployeeTest,
  StudentTest,
  ApiClientTest,
} from "./test-utils";
import { EmployeeStatus, StudentStatus } from "../generated/prisma/client";
import type {
  MasterUnit,
  MasterJobPosition,
  MasterJobLevel,
  MasterBuilding,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

const BOTH_SCOPES = ["employees:read", "students:read"];

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// Combined lookup mws-hub uses at sign-in time to resolve an email without
// already knowing whether it belongs to an employee or a student - see
// resolveCentralIdentity() in mws-hub's central-client.ts. Re-verification
// (launch(), admin middleware) already knows the source and keeps using the
// dedicated /employees/lookup or /students/lookup id-based path instead.
describe("GET /api/internal/persons/lookup", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await StudentTest.delete();
    await EmployeeTest.delete();
    await ApiClientTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await StudentTest.delete();
    await EmployeeTest.delete();
    await ApiClientTest.delete();
    await MasterDataTest.delete();
  });

  it("should resolve an employee email in one call, tagged source: employee", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: BOTH_SCOPES,
    });
    const person = await EmployeeTest.create({
      email: "combined_employee@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
    });

    const response = await TestRequest.get(
      "/api/internal/persons/lookup?email=combined_employee@millennia21.id",
      undefined,
      authHeader(token),
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.source).toBe("employee");
    expect(body.data.id).toBe(person.employee!.id);
    expect(body.data.email).toBe("combined_employee@millennia21.id");
  });

  it("should resolve a student email in one call, tagged source: student", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: BOTH_SCOPES,
    });
    const person = await StudentTest.create({
      email: "combined_student@millennia21.id",
    });

    const response = await TestRequest.get(
      "/api/internal/persons/lookup?email=combined_student@millennia21.id",
      undefined,
      authHeader(token),
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.source).toBe("student");
    expect(body.data.id).toBe(person.student!.id);
    expect(body.data.email).toBe("combined_student@millennia21.id");
  });

  it("should return 404 for an email that matches neither an employee nor a student", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: BOTH_SCOPES,
    });

    const response = await TestRequest.get(
      "/api/internal/persons/lookup?email=combined_nobody@millennia21.id",
      undefined,
      authHeader(token),
    );

    expect(response.status).toBe(404);
  });

  it("should return 404 for an inactive employee, same as /employees/lookup", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: BOTH_SCOPES,
    });
    await EmployeeTest.create({
      email: "combined_resigned@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
      status: EmployeeStatus.RESIGNED,
    });

    const response = await TestRequest.get(
      "/api/internal/persons/lookup?email=combined_resigned@millennia21.id",
      undefined,
      authHeader(token),
    );

    expect(response.status).toBe(404);
  });

  it("should return 404 for a student whose status is neither REGISTERED nor ACTIVE", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: BOTH_SCOPES,
    });
    await StudentTest.create({
      email: "combined_graduated@millennia21.id",
      status: StudentStatus.GRADUATED,
    });

    const response = await TestRequest.get(
      "/api/internal/persons/lookup?email=combined_graduated@millennia21.id",
      undefined,
      authHeader(token),
    );

    expect(response.status).toBe(404);
  });

  it("should reject a client missing the students:read scope even though it has employees:read", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: ["employees:read"],
    });

    const response = await TestRequest.get(
      "/api/internal/persons/lookup?email=anyone@millennia21.id",
      undefined,
      authHeader(token),
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("students:read");
  });

  it("should reject a client missing the employees:read scope even though it has students:read", async () => {
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: ["students:read"],
    });

    const response = await TestRequest.get(
      "/api/internal/persons/lookup?email=anyone@millennia21.id",
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
      scopeNames: BOTH_SCOPES,
    });

    const response = await TestRequest.get(
      "/api/internal/persons/lookup",
      undefined,
      authHeader(token),
    );

    expect(response.status).toBe(400);
  });

  it("should audit-log a found lookup with source recorded", async () => {
    const { client, token } = await ApiClientTest.createWithToken({
      scopeNames: BOTH_SCOPES,
    });
    const person = await StudentTest.create({
      email: "combined_audit@millennia21.id",
    });

    const response = await TestRequest.get(
      "/api/internal/persons/lookup?email=combined_audit@millennia21.id",
      undefined,
      authHeader(token),
    );
    expect(response.status).toBe(200);

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { api_client_id: client.id },
      orderBy: { created_at: "desc" },
    });
    logger.debug(auditLog);

    expect(auditLog.entity_type).toBe("Person");
    expect(auditLog.entity_id).toBe(person.student!.id);
    const newValues = auditLog.new_values as { source?: string; found?: boolean };
    expect(newValues.source).toBe("student");
    expect(newValues.found).toBe(true);
  });
});
