import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  MasterDataTest,
  EmployeeTest,
} from "./test-utils";
import {
  EmploymentType,
  Gender,
  Religion,
  type MasterUnit,
  type MasterJobPosition,
  type MasterJobLevel,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";

describe("POST /api/admin/employees", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };

  beforeEach(async () => {
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    await AdminUserTest.delete();

    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    await AdminUserTest.delete();
  });

  it("should successfully create an employee when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const requestBody = {
      full_name: "Test Employee One",
      nick_name: "Emp One",
      email: "test_emp_1@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),

      employee_id: "99.99.001",
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main Building",
      join_date: new Date("2026-07-01").toISOString(),
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.email).toBe("test_emp_1@millennia21.id");
    expect(body.data.employee_id).toBe("99.99.001");
    expect(body.data.unit).toBe("TEST_UNIT_SHIELD");
    expect(body.data.job_position).toBe("TEST_POS_TEACHER");
  });

  it("should successfully create an employee when requested by DATABASE_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();

    const requestBody = {
      full_name: "Test Employee Two",
      nick_name: "Emp Two",
      email: "test_emp_2@millennia21.id",
      gender: Gender.FEMALE,
      religion: Religion.PROTESTANTISM,
      birth_place: "Bandung",
      birth_date: new Date("1996-02-02").toISOString(),

      employee_id: "99.99.002",
      employment_type: EmploymentType.CONTRACT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "South Wing",
      join_date: new Date("2026-08-01").toISOString(),
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.full_name).toBe("Test Employee Two");
  });

  it("should reject creation (403 Forbidden) when requested by VIEWER", async () => {
    const { accessToken } = await AdminUserTest.createViewer();

    const requestBody = {
      full_name: "Hacker Employee",
      nick_name: "Hacker",
      email: "test_emp_hacker@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Unknown",
      birth_date: new Date().toISOString(),

      employee_id: "99.99.999",
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Secret",
      join_date: new Date().toISOString(),
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Insufficient permission");
  });

  it("should reject creation (400 Bad Request) if required fields are missing", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/employees",
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject creation (400 Bad Request) if Zod enum format is invalid", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const requestBody = {
      full_name: "Invalid Enum Emp",
      nick_name: "Invalid",
      email: "test_emp_invalid@millennia21.id",
      gender: "ALIEN",
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),

      employee_id: "99.99.400",
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main Building",
      join_date: new Date().toISOString(),
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain(
      "Gender is required and must be a valid format",
    );
  });

  it("should reject creation (400 Bad Request) if Email already exists", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const validPayload = {
      full_name: "Test Employee Duplicate Email",
      nick_name: "Duplicate",
      email: "test_emp_duplicate@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),

      employee_id: "99.99.100",
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main Building",
      join_date: new Date().toISOString(),
    };

    await TestRequest.post("/api/admin/employees", validPayload, accessToken);

    const duplicateEmailPayload = {
      ...validPayload,
      employee_id: "99.99.101",
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      duplicateEmailPayload,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Email already registered");
  });

  it("should reject creation (400 Bad Request) if Employee ID already exists", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const validPayload = {
      full_name: "Test Employee Duplicate ID",
      nick_name: "Duplicate",
      email: "test_emp_original@millennia21.id",
      gender: Gender.FEMALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),

      employee_id: "99.99.200",
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main Building",
      join_date: new Date().toISOString(),
    };

    await TestRequest.post("/api/admin/employees", validPayload, accessToken);

    const duplicateIdPayload = {
      ...validPayload,
      email: "test_emp_different@millennia21.id",
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      duplicateIdPayload,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Employee ID already registered");
  });
});
