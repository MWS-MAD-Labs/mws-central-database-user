import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  AuditLogTest,
  MasterDataTest,
  EmployeeTest,
} from "./test-utils";
import {
  AuditAction,
  AuditSource,
  EmploymentType,
  Gender,
  Religion,
  type MasterUnit,
  type MasterJobPosition,
  type MasterJobLevel,
  EmployeeStatus,
  MaritalStatus,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

describe("POST /api/admin/employees", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };
  let secondUnitId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();

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
    await EmployeeTest.delete();

    await prismaClient.masterUnit.deleteMany({ where: { id: "unit_2_test" } });
    await MasterDataTest.delete();
  });

  it("should successfully create an employee when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Test Employee One",
      nick_name: "Emp One",
      email: "test_emp_1@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),

      employee_id: "99.99.001",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
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
    expect(body.data.identity.email).toBe("test_emp_1@millennia21.id");
    expect(body.data.employment.employee_id).toBe("99.99.001");
    expect(body.data.employment.unit).toBe("TEST_UNIT_SHIELD");
    expect(body.data.employment.job_position).toBe("TEST_POS_TEACHER");

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: body.data.id },
    });
    logger.debug(auditLog);

    expect(auditLog.action).toBe(AuditAction.CREATE_EMPLOYEE);
    expect(auditLog.source).toBe(AuditSource.UI);
    expect(auditLog.entity_type).toBe("Employee");
    expect(auditLog.admin_id).toBe(admin.id);
    expect(auditLog.old_values).toBeNull();
    expect((auditLog.new_values as { employee_id?: string })?.employee_id).toBe(
      "99.99.001",
    );
    expect(auditLog.ip_address).toBeDefined();
  });

  it("should persist last_working_date and notes when provided on create", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Test Employee Offboarding",
      nick_name: "Emp Off",
      email: "test_emp_offboarding@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),

      employee_id: "99.99.777",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.RESIGNED,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main Building",
      join_date: new Date("2026-01-01").toISOString(),
      resignation_date: new Date("2026-06-30").toISOString(),
      last_working_date: new Date("2026-06-30").toISOString(),
      notes: "Resigned to pursue further studies",
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.offboarding.last_working_date).toBe(
      new Date("2026-06-30").toISOString(),
    );
    expect(body.data.offboarding.notes).toBe(
      "Resigned to pursue further studies",
    );
  });

  it("should reject creation (400 Bad Request) if marital_status is missing", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const { marital_status, ...requestBody } = {
      full_name: "No Marital Status",
      nick_name: "NoMarital",
      email: "test_emp_no_marital@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),
      employee_id: "99.99.501",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main Building",
      join_date: new Date("2026-01-01").toISOString(),
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should normalize and persist mobile_phone, NIK, NPWP, bank account, and BPJS regardless of input punctuation", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Test Employee PII",
      nick_name: "Emp PII",
      email: "test_emp_pii@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),

      employee_id: "99.99.502",
      marital_status: MaritalStatus.MARRIED,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main Building",
      join_date: new Date("2026-01-01").toISOString(),

      mobile_phone: "0812-3456-7890",
      residential_address: "Jl. Merdeka No. 1, Jakarta",
      nik: "1111 1111 1111 1111",
      npwp: "11.111.111.1-123.000",
      bank_account_number: "12 34 56 78 90",
      bpjs_number: "0001 2345 6789 0",
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.identity.mobile_phone).toBe("6281234567890");
    expect(body.data.identity.residential_address).toBe(
      "Jl. Merdeka No. 1, Jakarta",
    );

    const getResponse = await TestRequest.get(
      `/api/admin/employees/${body.data.id}`,
      accessToken,
    );
    const getBody = await getResponse.json();
    logger.debug(getBody);

    expect(getResponse.status).toBe(200);
    expect(getBody.data.identity.nik).toBe("1111111111111111");
    expect(getBody.data.identity.npwp).toBe("111111111123000");
    expect(getBody.data.identity.bank_account_number).toBe("1234567890");
    expect(getBody.data.identity.bpjs_number).toBe("0001234567890");
    expect(getBody.data.identity.marital_status).toBe(MaritalStatus.MARRIED);
  });

  it("should reject an invalid NIK (not 16 digits after normalization)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Bad NIK",
      nick_name: "BadNIK",
      email: "test_emp_bad_nik@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),
      employee_id: "99.99.503",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main Building",
      join_date: new Date("2026-01-01").toISOString(),
      nik: "123.456",
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("16 digits");
  });

  it("should reject an invalid NPWP (not 15 digits after normalization)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Bad NPWP",
      nick_name: "BadNPWP",
      email: "test_emp_bad_npwp@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),
      employee_id: "99.99.507",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main Building",
      join_date: new Date("2026-01-01").toISOString(),
      npwp: "11.111.111.1-123",
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("15 digits");
  });

  it("should reject an invalid mobile_phone (not a valid Indonesian number)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Bad Phone",
      nick_name: "BadPhone",
      email: "test_emp_bad_phone@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),
      employee_id: "99.99.504",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main Building",
      join_date: new Date("2026-01-01").toISOString(),
      mobile_phone: "021-5551234",
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Indonesian number");
  });

  it("should reject a bank_account_number that isn't exactly 10 digits", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Bad Bank",
      nick_name: "BadBank",
      email: "test_emp_bad_bank@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),
      employee_id: "99.99.505",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main Building",
      join_date: new Date("2026-01-01").toISOString(),
      bank_account_number: "12345",
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("10 digits");
  });

  it("should reject a bpjs_number that isn't exactly 13 digits", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Bad BPJS",
      nick_name: "BadBPJS",
      email: "test_emp_bad_bpjs@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),
      employee_id: "99.99.506",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main Building",
      join_date: new Date("2026-01-01").toISOString(),
      bpjs_number: "123",
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("13 digits");
  });

  it("should successfully create an employee when requested by DATABASE_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Test Employee Two",
      nick_name: "Emp Two",
      email: "test_emp_2@millennia21.id",
      gender: Gender.FEMALE,
      religion: Religion.PROTESTANTISM,
      birth_place: "Bandung",
      birth_date: new Date("1996-02-02").toISOString(),

      employee_id: "99.99.002",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
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
    expect(body.data.identity.full_name).toBe("Test Employee Two");
  });

  it("should reject creation (403 Forbidden) when requested by VIEWER", async () => {
    const { accessToken } = await AdminUserTest.createViewer(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Hacker Employee",
      nick_name: "Hacker",
      email: "test_emp_hacker@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Unknown",
      birth_date: new Date().toISOString(),

      employee_id: "99.99.999",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
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
    expect(body.errors).toContain("Forbidden: Viewer cannot create data");
  });

  it("should reject creation (400 Bad Request) if required fields are missing", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

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
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Invalid Enum Emp",
      nick_name: "Invalid",
      email: "test_emp_invalid@millennia21.id",
      gender: "ALIEN",
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),

      employee_id: "99.99.400",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
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
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const validPayload = {
      full_name: "Test Employee Duplicate Email",
      nick_name: "Duplicate",
      email: "test_emp_duplicate@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),

      employee_id: "99.99.100",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
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
      marital_status: MaritalStatus.SINGLE,
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
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const validPayload = {
      full_name: "Test Employee Duplicate ID",
      nick_name: "Duplicate",
      email: "test_emp_original@millennia21.id",
      gender: Gender.FEMALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),

      employee_id: "99.99.200",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
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

  it("should reject creation (400 Bad Request) if the email belongs to a soft-deleted employee (duplicate check does not filter deleted_at)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const originalPayload = {
      full_name: "Test Employee To Be Deleted",
      nick_name: "Ghost",
      email: "test_emp_ghost@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),

      employee_id: "99.99.600",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main Building",
      join_date: new Date().toISOString(),
    };

    const createResponse = await TestRequest.post(
      "/api/admin/employees",
      originalPayload,
      accessToken,
    );
    const createdEmployee = (await createResponse.json()).data;

    await TestRequest.patch(
      `/api/admin/employees/delete/${createdEmployee.id}`,
      {},
      accessToken,
    );

    const newPayload = {
      ...originalPayload,
      employee_id: "99.99.601",
      marital_status: MaritalStatus.SINGLE,
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      newPayload,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Email already registered");
  });

  it("should reject creation (400 Bad Request) if unit_id does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Test Invalid Unit",
      nick_name: "Invalid",
      email: "test_emp_invalid_unit@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),

      employee_id: "99.99.300",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: "non_existent_unit_id",
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
    expect(body.errors).toContain("Invalid unit");
  });

  it("should reject creation (400 Bad Request) if job_position_id does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Test Invalid Job Position",
      nick_name: "Invalid",
      email: "test_emp_invalid_position@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),

      employee_id: "99.99.301",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: "non_existent_position_id",
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
    expect(body.errors).toContain("Invalid job position");
  });

  it("should reject creation (400 Bad Request) if job_level_id does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Test Invalid Job Level",
      nick_name: "Invalid",
      email: "test_emp_invalid_level@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),

      employee_id: "99.99.302",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: "non_existent_level_id",
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
    expect(body.errors).toContain("Invalid job level");
  });

  it("should reject creation (403) for DATABASE_ADMIN if trying to create in a different unit", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Cross Unit Emp",
      email: "test_emp_cross@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date().toISOString(),
      employee_id: "99.99.002",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: secondUnitId,
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

    expect(response.status).toBe(403);
    expect(body.errors).toContain(
      "Forbidden: You can only create employees within your unit scope",
    );
  });

  it("should reject creation (403) for DATABASE_ADMIN if can_write_data is false", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );

    await prismaClient.adminUser.updateMany({
      where: { role: "DATABASE_ADMIN" },
      data: { can_write_data: false },
    });

    const requestBody = {
      full_name: "No Permission Emp",
      email: "test_emp_noperm@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date().toISOString(),
      employee_id: "99.99.003",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main",
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
    expect(body.errors).toContain(
      "Forbidden: You don't have permission to create data",
    );
  });

  it("should reject creation (400 Bad Request) if status is RESIGNED without resignation_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Resigned No Date",
      nick_name: "Resigned",
      email: "test_emp_resigned_no_date@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),

      employee_id: "99.99.900",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.RESIGNED,
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
      "Resignation date is required when status is RESIGNED",
    );
  });

  it("should successfully create an employee with status RESIGNED when resignation_date is provided", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Resigned With Date",
      nick_name: "Resigned",
      email: "test_emp_resigned_with_date@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),

      employee_id: "99.99.901",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.RESIGNED,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main Building",
      join_date: new Date("2020-01-01").toISOString(),
      resignation_date: new Date("2026-01-01").toISOString(),
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status_info.status).toBe(EmployeeStatus.RESIGNED);
    expect(body.data.offboarding.resignation_date).toBeDefined();
  });
});

describe("PATCH /api/admin/employees/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };
  let secondUnitId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();

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
    await EmployeeTest.delete();
    await prismaClient.masterUnit.deleteMany({ where: { id: "unit_2_test" } });
    await MasterDataTest.delete();
  });

  const createDummyEmployee = async (
    accessToken: string,
    empId: string,
    email: string,
    unitId: string = masterData.unit.id,
  ) => {
    const payload = {
      full_name: "Dummy Employee",
      nick_name: "Dummy",
      email: email,
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),
      employee_id: empId,
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: unitId,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main Building",
      join_date: new Date("2026-07-01").toISOString(),
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      payload,
      accessToken,
    );
    const body = await response.json();

    if (response.status !== 200) {
      console.error("[TEST FATAL ERROR] Failed to create dummy:", body);
    }

    return body.data;
  };

  it("should successfully update an employee (partial update) when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.301",
      "test_emp_update1@millennia21.id",
    );
    await AuditLogTest.delete(); // ignore the CREATE_EMPLOYEE entry from the dummy setup above

    const updatePayload = {
      full_name: "Updated Employee Name",
      building: "North Wing",
      status: EmployeeStatus.INACTIVE,
    };

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      updatePayload,
      accessToken,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.identity.full_name).toBe("Updated Employee Name");
    expect(body.data.employment.building).toBe("North Wing");
    expect(body.data.status_info.status).toBe("INACTIVE");

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: targetEmployee.id },
    });
    logger.debug(auditLog);

    expect(auditLog.action).toBe(AuditAction.UPDATE_EMPLOYEE);
    const oldValues = auditLog.old_values as { status?: string };
    const newValues = auditLog.new_values as {
      status?: string;
      building?: string;
    };
    expect(oldValues?.status).toBe(EmployeeStatus.ACTIVE);
    expect(newValues?.status).toBe(EmployeeStatus.INACTIVE);
    expect(newValues?.building).toBe("North Wing");
  });

  it("should allow changing NIK/NPWP within 1 hour of creation", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.304",
      "test_emp_nik1@millennia21.id",
    );
    await AuditLogTest.delete();

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { nik: "1111111111111111", npwp: "111111111111111" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);

    const updated = await prismaClient.employee.findUniqueOrThrow({
      where: { id: targetEmployee.id },
    });
    expect(updated.nik).toBe("1111111111111111");
    expect(updated.npwp).toBe("111111111111111");
  });

  it("should reject (400) overwriting an already-set NIK after the 1-hour grace period, even for SUPER_ADMIN, and audit-log the blocked attempt", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.305",
      "test_emp_nik2@millennia21.id",
    );
    await AuditLogTest.delete();
    await prismaClient.employee.update({
      where: { id: targetEmployee.id },
      data: {
        nik: "1111111111111111",
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { nik: "2222222222222222" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AuditAction.UNAUTHORIZED_ACCESS },
    });
    expect(auditLog.admin_id).toBe("test-super-admin-id");
  });

  it("should allow overwriting NIK a few seconds shy of the 1-hour boundary", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.310",
      "test_emp_nik_boundary1@millennia21.id",
    );
    // A few seconds under 1h, not exactly - exact-instant equality with
    // wall-clock time is inherently flaky given real request latency.
    await prismaClient.employee.update({
      where: { id: targetEmployee.id },
      data: {
        nik: "1111111111111111",
        created_at: new Date(Date.now() - 60 * 60 * 1000 + 5000),
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { nik: "2222222222222222" },
      accessToken,
    );
    expect(response.status).toBe(200);
  });

  it("should reject (400) overwriting NIK just past the 1-hour boundary", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.311",
      "test_emp_nik_boundary2@millennia21.id",
    );
    await prismaClient.employee.update({
      where: { id: targetEmployee.id },
      data: {
        nik: "1111111111111111",
        created_at: new Date(Date.now() - 60 * 60 * 1000 - 1000),
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { nik: "2222222222222222" },
      accessToken,
    );
    expect(response.status).toBe(400);
  });

  it("should allow setting NIK for the first time even after the 1-hour grace period (it was never overwriting anything)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.308",
      "test_emp_nik3@millennia21.id",
    );
    await AuditLogTest.delete();
    await prismaClient.employee.update({
      where: { id: targetEmployee.id },
      data: { created_at: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { nik: "3333333333333333" },
      accessToken,
    );
    expect(response.status).toBe(200);

    const updated = await prismaClient.employee.findUniqueOrThrow({
      where: { id: targetEmployee.id },
    });
    expect(updated.nik).toBe("3333333333333333");
  });

  it("should allow changing BPJS number and bank account within 1 hour of creation", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.306",
      "test_emp_bpjs1@millennia21.id",
    );
    await AuditLogTest.delete();

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { bpjs_number: "1111111111111", bank_account_number: "1111111111" },
      accessToken,
    );
    expect(response.status).toBe(200);

    const updated = await prismaClient.employee.findUniqueOrThrow({
      where: { id: targetEmployee.id },
    });
    expect(updated.bpjs_number).toBe("1111111111111");
    expect(updated.bank_account_number).toBe("1111111111");
  });

  it("should reject (400) overwriting an already-set BPJS number or bank account after the 1-hour grace period, even for SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.307",
      "test_emp_bpjs2@millennia21.id",
    );
    await AuditLogTest.delete();
    await prismaClient.employee.update({
      where: { id: targetEmployee.id },
      data: {
        bpjs_number: "1111111111111",
        bank_account_number: "1111111111",
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    });

    const bpjsResponse = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { bpjs_number: "2222222222222" },
      accessToken,
    );
    expect(bpjsResponse.status).toBe(400);

    const bankResponse = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { bank_account_number: "2222222222" },
      accessToken,
    );
    expect(bankResponse.status).toBe(400);
  });

  it("should allow setting BPJS number and bank account for the first time even after the 1-hour grace period", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.309",
      "test_emp_bpjs3@millennia21.id",
    );
    await AuditLogTest.delete();
    await prismaClient.employee.update({
      where: { id: targetEmployee.id },
      data: { created_at: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { bpjs_number: "3333333333333", bank_account_number: "3333333333" },
      accessToken,
    );
    expect(response.status).toBe(200);

    const updated = await prismaClient.employee.findUniqueOrThrow({
      where: { id: targetEmployee.id },
    });
    expect(updated.bpjs_number).toBe("3333333333333");
    expect(updated.bank_account_number).toBe("3333333333");
  });

  it("should update last_working_date and notes, and reflect the change in the audit log", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.303",
      "test_emp_update3@millennia21.id",
    );
    await AuditLogTest.delete();

    const updatePayload = {
      status: EmployeeStatus.RESIGNED,
      resignation_date: new Date("2026-06-30").toISOString(),
      last_working_date: new Date("2026-06-30").toISOString(),
      notes: "Handover completed",
    };

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      updatePayload,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.offboarding.last_working_date).toBe(
      new Date("2026-06-30").toISOString(),
    );
    expect(body.data.offboarding.notes).toBe("Handover completed");

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: targetEmployee.id },
    });
    const newValues = auditLog.new_values as {
      last_working_date?: string;
      notes?: string;
    };
    expect(newValues?.last_working_date).toBe(
      new Date("2026-06-30").toISOString(),
    );
    expect(newValues?.notes).toBe("Handover completed");
  });

  it("should successfully update an employee when requested by DATABASE_ADMIN in the same unit", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.302",
      "test_emp_update2@millennia21.id",
    );

    const updatePayload = {
      employment_type: EmploymentType.CONTRACT,
    };

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      updatePayload,
      accessToken,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status_info.employment_type).toBe(EmploymentType.CONTRACT);
  });

  it("should reject update (403) for DATABASE_ADMIN if can_write_data is false", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.305",
      "test_emp_update_noperm@millennia21.id",
    );

    await prismaClient.adminUser.updateMany({
      where: { role: "DATABASE_ADMIN" },
      data: { can_write_data: false },
    });

    const updatePayload = { full_name: "Should Not Update" };
    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      updatePayload,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain(
      "Forbidden: You don't have permission to update data",
    );
  });

  it("should reject update (403) for DATABASE_ADMIN if employee belongs to a different unit", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const empUnit2 = await createDummyEmployee(
      superAdmin.accessToken,
      "99.99.303",
      "test_emp_cross@millennia21.id",
      secondUnitId,
    );

    const dbAdmin = await AdminUserTest.createDatabaseAdmin();
    const updatePayload = { full_name: "Hacked Name" };
    const response = await TestRequest.patch(
      `/api/admin/employees/${empUnit2.id}`,
      updatePayload,
      dbAdmin.accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain(
      "Forbidden: This employee is outside your unit scope",
    );
  });

  it("should reject update (403) for DATABASE_ADMIN if trying to transfer employee to another unit", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.304",
      "test_emp_transfer@millennia21.id",
    );

    const updatePayload = { unit_id: secondUnitId };
    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      updatePayload,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain(
      "Forbidden: You cannot transfer an employee to a different unit",
    );
  });

  it("should successfully transfer an employee to another unit when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.305",
      "test_emp_sa_transfer@millennia21.id",
    );

    const updatePayload = { unit_id: secondUnitId };
    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      updatePayload,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data).toBeDefined();
  });

  it("should reject update (403 Forbidden) when requested by VIEWER", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      superAdmin.accessToken,
      "99.99.306",
      "test_emp_update3@millennia21.id",
    );

    const viewer = await AdminUserTest.createViewer();
    const updatePayload = { full_name: "Hacked Name" };

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      updatePayload,
      viewer.accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Forbidden: Viewer cannot update data");
  });

  it("should reject update (404 Not Found) if employee ID does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const updatePayload = { full_name: "Ghost Name" };

    const response = await TestRequest.patch(
      `/api/admin/employees/invalid-cuid-123`,
      updatePayload,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Employee not found");
  });

  it("should reject update (400 Bad Request) if new Email already belongs to another person", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    await createDummyEmployee(
      accessToken,
      "99.99.401",
      "test_emp_person_a@millennia21.id",
    );
    const employeeB = await createDummyEmployee(
      accessToken,
      "99.99.402",
      "test_emp_person_b@millennia21.id",
    );

    const updatePayload = {
      email: "test_emp_person_a@millennia21.id",
    };

    const response = await TestRequest.patch(
      `/api/admin/employees/${employeeB.id}`,
      updatePayload,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Email already registered to another person");
  });

  it("should allow update if the new Email is the same as the employee's current Email (Self-update)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.403",
      "test_emp_person_self@millennia21.id",
    );

    const updatePayload = {
      email: "test_emp_person_self@millennia21.id",
      full_name: "Name Changed",
    };

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      updatePayload,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.identity.full_name).toBe("Name Changed");
  });

  it("should reject update (400 Bad Request) if new Employee ID already belongs to another employee", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    await createDummyEmployee(
      accessToken,
      "99.99.501",
      "test_emp_id_a@millennia21.id",
    );

    const employeeB = await createDummyEmployee(
      accessToken,
      "99.99.502",
      "test_emp_id_b@millennia21.id",
    );

    const updatePayload = {
      employee_id: "99.99.501",
      marital_status: MaritalStatus.SINGLE,
    };

    const response = await TestRequest.patch(
      `/api/admin/employees/${employeeB.id}`,
      updatePayload,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Employee ID already registered");
  });

  it("should reject update (400 Bad Request) if unit_id does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.601",
      "test_emp_update_invalid_unit@millennia21.id",
    );

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { unit_id: "non_existent_unit_id" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Invalid unit");
  });

  it("should reject update (400 Bad Request) if job_position_id does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.602",
      "test_emp_update_invalid_position@millennia21.id",
    );

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { job_position_id: "non_existent_position_id" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Invalid job position");
  });

  it("should reject update (400 Bad Request) if job_level_id does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.603",
      "test_emp_update_invalid_level@millennia21.id",
    );

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { job_level_id: "non_existent_level_id" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Invalid job level");
  });

  it("should reject update (400 Bad Request) if status is changed to RESIGNED without resignation_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.604",
      "test_emp_update_resigned_no_date@millennia21.id",
    );

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { status: EmployeeStatus.RESIGNED },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain(
      "Resignation date is required when status is RESIGNED",
    );
  });

  it("should successfully update status to RESIGNED when resignation_date is provided", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.605",
      "test_emp_update_resigned_with_date@millennia21.id",
    );

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      {
        status: EmployeeStatus.RESIGNED,
        resignation_date: new Date("2026-01-01").toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status_info.status).toBe(EmployeeStatus.RESIGNED);
    expect(body.data.offboarding.resignation_date).toBeDefined();
  });

  it("should allow updating other fields without resending resignation_date once the employee is already RESIGNED", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.606",
      "test_emp_update_already_resigned@millennia21.id",
    );

    await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      {
        status: EmployeeStatus.RESIGNED,
        resignation_date: new Date("2026-01-01").toISOString(),
      },
      accessToken,
    );

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { full_name: "Updated After Resignation" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.identity.full_name).toBe("Updated After Resignation");
  });
});

describe("GET /api/admin/employees/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };
  let secondUnitId: string;

  beforeEach(async () => {
    await AdminUserTest.delete();
    await EmployeeTest.delete();

    await prismaClient.masterUnit.deleteMany({ where: { id: "unit_2_test" } });
    await MasterDataTest.delete();

    masterData = await MasterDataTest.create();

    const unit2 = await prismaClient.masterUnit.create({
      data: { id: "unit_2_test", name: "Second Unit" },
    });
    secondUnitId = unit2.id;
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await EmployeeTest.delete();

    await prismaClient.masterUnit.deleteMany({ where: { id: "unit_2_test" } });
    await MasterDataTest.delete();
  });

  const createDummyEmployee = async (
    accessToken: string,
    empId: string,
    email: string,
    unitId: string = masterData.unit.id,
  ): Promise<{ id: string }> => {
    const payload = {
      full_name: "Dummy Employee",
      nick_name: "Dummy",
      email: email,
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),
      employee_id: empId,
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: unitId,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main Building",
      join_date: new Date("2026-07-01").toISOString(),
      mobile_phone: "081234567890",
      residential_address: "Jl. Merdeka No. 1, Jakarta",
      nik: "1111111111111111",
      npwp: "111111111123000",
      bank_account_number: "1234567890",
      bpjs_number: "0001234567890",
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      payload,
      accessToken,
    );
    const body = await response.json();

    if (response.status !== 200) {
      console.error("[TEST FATAL ERROR] Failed to create dummy:", body);
    }

    return body.data as { id: string };
  };

  it("should return detailed response (including sensitive fields) for SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.800",
      "test_emp_view_sa@millennia21.id",
    );

    const response = await TestRequest.get(
      `/api/admin/employees/${targetEmployee.id}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.identity.full_name).toBe("Dummy Employee");
    expect(body.data.identity.religion).toBe("ISLAM");
    expect(body.data.identity.birth_place).toBe("Jakarta");
    expect(body.data.identity.birth_date).toBeDefined();

    // Sensitive PII — Super Admin only
    expect(body.data.identity.marital_status).toBe(MaritalStatus.SINGLE);
    expect(body.data.identity.nik).toBe("1111111111111111");
    expect(body.data.identity.npwp).toBe("111111111123000");
    expect(body.data.identity.bank_account_number).toBe("1234567890");
    expect(body.data.identity.bpjs_number).toBe("0001234567890");

    // Not sensitive — visible in the base response too, checked below
    expect(body.data.identity.mobile_phone).toBe("6281234567890");
    expect(body.data.identity.residential_address).toBe(
      "Jl. Merdeka No. 1, Jakarta",
    );
  });

  it("should return basic response (without sensitive fields) for DATABASE_ADMIN in the same unit", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const dbAdmin = await AdminUserTest.createDatabaseAdmin();

    const targetEmployee = await createDummyEmployee(
      superAdmin.accessToken,
      "99.99.801",
      "test_emp_view_dbadmin@millennia21.id",
    );

    const response = await TestRequest.get(
      `/api/admin/employees/${targetEmployee.id}`,
      dbAdmin.accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.identity.full_name).toBe("Dummy Employee");

    expect(body.data.identity.religion).toBeUndefined();
    expect(body.data.identity.birth_place).toBeUndefined();
    expect(body.data.identity.birth_date).toBeUndefined();

    // Sensitive PII stays hidden for DB Admin
    expect(body.data.identity.marital_status).toBeUndefined();
    expect(body.data.identity.nik).toBeUndefined();
    expect(body.data.identity.npwp).toBeUndefined();
    expect(body.data.identity.bank_account_number).toBeUndefined();
    expect(body.data.identity.bpjs_number).toBeUndefined();

    // Non-sensitive contact fields are still visible
    expect(body.data.identity.mobile_phone).toBe("6281234567890");
    expect(body.data.identity.residential_address).toBe(
      "Jl. Merdeka No. 1, Jakarta",
    );
  });

  it("should return basic response (without sensitive fields) for VIEWER in the same unit", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const viewer = await AdminUserTest.createViewer();

    const targetEmployee = await createDummyEmployee(
      superAdmin.accessToken,
      "99.99.802",
      "test_emp_view_viewer@millennia21.id",
    );

    const response = await TestRequest.get(
      `/api/admin/employees/${targetEmployee.id}`,
      viewer.accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.identity.full_name).toBe("Dummy Employee");

    expect(body.data.identity.religion).toBeUndefined();
    expect(body.data.identity.birth_place).toBeUndefined();
    expect(body.data.identity.birth_date).toBeUndefined();

    // Sensitive PII stays hidden for Viewer
    expect(body.data.identity.marital_status).toBeUndefined();
    expect(body.data.identity.nik).toBeUndefined();
    expect(body.data.identity.npwp).toBeUndefined();
    expect(body.data.identity.bank_account_number).toBeUndefined();
    expect(body.data.identity.bpjs_number).toBeUndefined();

    // Non-sensitive contact fields are still visible
    expect(body.data.identity.mobile_phone).toBe("6281234567890");
    expect(body.data.identity.residential_address).toBe(
      "Jl. Merdeka No. 1, Jakarta",
    );
  });

  it("should reject (404 Not Found) for DATABASE_ADMIN trying to view employee from a different unit", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const dbAdmin = await AdminUserTest.createDatabaseAdmin();

    const targetEmployee = await createDummyEmployee(
      superAdmin.accessToken,
      "99.99.803",
      "test_emp_cross_unit_get@millennia21.id",
      secondUnitId,
    );

    const response = await TestRequest.get(
      `/api/admin/employees/${targetEmployee.id}`,
      dbAdmin.accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Employee not found");
  });

  it("should reject (404 Not Found) for VIEWER trying to view employee from a different unit", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const viewer = await AdminUserTest.createViewer();

    const targetEmployee = await createDummyEmployee(
      superAdmin.accessToken,
      "99.99.804",
      "test_emp_cross_unit_viewer_get@millennia21.id",
      secondUnitId,
    );

    const response = await TestRequest.get(
      `/api/admin/employees/${targetEmployee.id}`,
      viewer.accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Employee not found");
  });

  it("should reject (404 Not Found) if employee ID does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/employees/invalid-cuid-123",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Employee not found");
  });
});

describe("GET /api/admin/employees", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };
  let secondUnitId: string;

  beforeEach(async () => {
    await AdminUserTest.delete();
    await EmployeeTest.delete();

    await prismaClient.masterUnit.deleteMany({ where: { id: "unit_2_test" } });
    await MasterDataTest.delete();

    masterData = await MasterDataTest.create();

    const unit2 = await prismaClient.masterUnit.create({
      data: { id: "unit_2_test", name: "Second Unit" },
    });
    secondUnitId = unit2.id;
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await EmployeeTest.delete();

    await prismaClient.masterUnit.deleteMany({ where: { id: "unit_2_test" } });
    await MasterDataTest.delete();
  });

  const populateDummyEmployees = async (accessToken: string) => {
    const payload1 = {
      full_name: "John Doe Sniper",
      nick_name: "John",
      email: "test_emp_john@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1990-01-01").toISOString(),
      employee_id: "99.99.101",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main Building",
      join_date: new Date("2026-01-01").toISOString(),
    };

    const payload2 = {
      full_name: "Jane Smith Medic",
      nick_name: "Jane",
      email: "test_emp_jane@millennia21.id",
      gender: Gender.FEMALE,
      religion: Religion.CATHOLICISM,
      birth_place: "Bandung",
      birth_date: new Date("1992-02-02").toISOString(),
      employee_id: "99.99.102",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.INACTIVE,
      employment_type: EmploymentType.CONTRACT,
      unit_id: secondUnitId,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "South Wing",
      join_date: new Date("2026-02-01").toISOString(),
    };

    await TestRequest.post("/api/admin/employees", payload1, accessToken);
    await TestRequest.post("/api/admin/employees", payload2, accessToken);
  };

  const populateManyDummyEmployees = async (accessToken: string) => {
    const names = [
      "Employee Alpha",
      "Employee Bravo",
      "Employee Charlie",
      "Employee Delta",
      "Employee Echo",
    ];

    for (let i = 0; i < names.length; i++) {
      const payload = {
        full_name: names[i],
        nick_name: names[i],
        email: `test_emp_page_${i}@millennia21.id`,
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("1995-01-01").toISOString(),
        employee_id: `99.99.7${i}0`,
        marital_status: MaritalStatus.SINGLE,
        status: EmployeeStatus.ACTIVE,
        employment_type: EmploymentType.PERMANENT,
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        job_level_id: masterData.level.id,
        building: "Main Building",
        join_date: new Date("2026-01-01").toISOString(),
      };
      await TestRequest.post("/api/admin/employees", payload, accessToken);
    }
  };

  it("should successfully return pageable data for SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await populateDummyEmployees(accessToken);

    const response = await TestRequest.get(
      "/api/admin/employees?page=1&size=10&search=99.99.",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(2);
    expect(body.paging.current_page).toBe(1);
    expect(body.paging.total_item).toBe(2);
  });

  it("should enforce UNIT SCOPE for DATABASE_ADMIN (Fraud Protection)", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    await populateDummyEmployees(superAdmin.accessToken);
    const dbAdmin = await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const response = await TestRequest.get(
      `/api/admin/employees?unit_id=${secondUnitId}`,
      dbAdmin.accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].identity.full_name).toContain("John");
  });

  it("should successfully filter by global search keyword (Name/Email/ID)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await populateDummyEmployees(accessToken);

    const response = await TestRequest.get(
      "/api/admin/employees?search=medic",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].identity.full_name).toContain("Jane Smith Medic");
  });

  it("should successfully filter by specific fields (status & building)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await populateDummyEmployees(accessToken);

    const response = await TestRequest.get(
      "/api/admin/employees?status=INACTIVE&building=South Wing",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].status_info.status).toBe("INACTIVE");
    expect(body.data[0].employment.building).toBe("South Wing");
  });

  it("should successfully filter by join_date range", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await populateDummyEmployees(accessToken);

    const start = new Date("2026-01-15").toISOString();
    const end = new Date("2026-12-31").toISOString();

    const response = await TestRequest.get(
      `/api/admin/employees?join_date_start=${start}&join_date_end=${end}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].identity.full_name).toContain("Jane");
  });

  it("should exclude soft-deleted employees by default", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await populateDummyEmployees(accessToken);

    const listResponse = await TestRequest.get(
      "/api/admin/employees?search=99.99.",
      accessToken,
    );
    const john = (await listResponse.json()).data.find(
      (e: { employment: { employee_id: string } }) =>
        e.employment.employee_id === "99.99.101",
    );
    await TestRequest.patch(
      `/api/admin/employees/delete/${john.id}`,
      {},
      accessToken,
    );

    const response = await TestRequest.get(
      "/api/admin/employees?search=99.99.",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].identity.full_name).toContain("Jane");
  });

  it("should return only soft-deleted employees when is_deleted=true (trash bin)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await populateDummyEmployees(accessToken);

    const listResponse = await TestRequest.get(
      "/api/admin/employees?search=99.99.",
      accessToken,
    );
    const john = (await listResponse.json()).data.find(
      (e: { employment: { employee_id: string } }) =>
        e.employment.employee_id === "99.99.101",
    );
    await TestRequest.patch(
      `/api/admin/employees/delete/${john.id}`,
      {},
      accessToken,
    );

    const response = await TestRequest.get(
      "/api/admin/employees?is_deleted=true&search=99.99.",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].identity.full_name).toContain("John");
  });

  it("should scope the trash bin (is_deleted=true) to the DATABASE_ADMIN's own unit", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    await populateDummyEmployees(superAdmin.accessToken);

    const listResponse = await TestRequest.get(
      "/api/admin/employees",
      superAdmin.accessToken,
    );
    const employees = (await listResponse.json()).data as Array<{
      id: string;
      employment: { employee_id: string };
    }>;
    // Only soft-delete the dummies this test created — the list above is
    // unscoped and can include unrelated employees (e.g. dev seed data),
    // deleting those would corrupt state for other tests/runs.
    const dummyEmployees = employees.filter((e) =>
      e.employment.employee_id.startsWith("99.99."),
    );
    for (const emp of dummyEmployees) {
      await TestRequest.patch(
        `/api/admin/employees/delete/${emp.id}`,
        {},
        superAdmin.accessToken,
      );
    }

    const dbAdmin = await AdminUserTest.createDatabaseAdmin(masterData.unit.id);
    const response = await TestRequest.get(
      "/api/admin/employees?is_deleted=true",
      dbAdmin.accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].identity.full_name).toContain("John");
  });

  it("should successfully sort by full_name instead of the default created_at", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await populateDummyEmployees(accessToken);

    const response = await TestRequest.get(
      "/api/admin/employees?sort_by=full_name&sort_order=asc&search=99.99.",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(2);
    expect(body.data[0].identity.full_name).toBe("Jane Smith Medic");
    expect(body.data[1].identity.full_name).toBe("John Doe Sniper");
  });

  it("should successfully sort by an employee-level field (employee_id desc)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await populateDummyEmployees(accessToken);

    const response = await TestRequest.get(
      "/api/admin/employees?sort_by=employee_id&sort_order=desc&search=99.99.",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(2);
    expect(body.data[0].employment.employee_id).toBe("99.99.102");
    expect(body.data[1].employment.employee_id).toBe("99.99.101");
  });

  it("should paginate correctly across multiple pages with a consistent sort_order", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await populateManyDummyEmployees(accessToken);

    const fetchPage = async (page: number) => {
      const response = await TestRequest.get(
        `/api/admin/employees?sort_by=full_name&sort_order=asc&page=${page}&size=2&search=99.99.`,
        accessToken,
      );
      return response.json();
    };

    const page1 = await fetchPage(1);
    const page2 = await fetchPage(2);
    const page3 = await fetchPage(3);
    logger.debug({ page1, page2, page3 });

    expect(page1.paging.total_item).toBe(5);
    expect(page1.paging.total_page).toBe(3);
    expect(page1.paging.current_page).toBe(1);
    expect(
      page1.data.map(
        (e: { identity: { full_name: string } }) => e.identity.full_name,
      ),
    ).toEqual(["Employee Alpha", "Employee Bravo"]);

    expect(page2.paging.current_page).toBe(2);
    expect(
      page2.data.map(
        (e: { identity: { full_name: string } }) => e.identity.full_name,
      ),
    ).toEqual(["Employee Charlie", "Employee Delta"]);

    expect(page3.paging.current_page).toBe(3);
    expect(page3.data.length).toBe(1);
    expect(page3.data[0].identity.full_name).toBe("Employee Echo");

    const allIds = [
      ...page1.data.map((e: { id: string }) => e.id),
      ...page2.data.map((e: { id: string }) => e.id),
      ...page3.data.map((e: { id: string }) => e.id),
    ];
    expect(new Set(allIds).size).toBe(5);
  });

  it("should reject search (400 Bad Request) if sort_by is not a whitelisted field", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/employees?sort_by=__proto__",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject search (400 Bad Request) if enum filter is invalid (Zod Protection)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/employees?status=UNKNOWN_STATUS",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject search (400 Bad Request) if pagination input is invalid", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/employees?page=-1&size=0",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toBeDefined();
  });

  it("should reject search (400 Bad Request) with a clear message if page/size are not numbers", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const pageResponse = await TestRequest.get(
      "/api/admin/employees?page=abc",
      accessToken,
    );
    const pageBody = await pageResponse.json();
    logger.debug(pageBody);

    expect(pageResponse.status).toBe(400);
    expect(pageBody.errors).toContain("page must be a valid number");

    const sizeResponse = await TestRequest.get(
      "/api/admin/employees?size=xyz",
      accessToken,
    );
    const sizeBody = await sizeResponse.json();
    logger.debug(sizeBody);

    expect(sizeResponse.status).toBe(400);
    expect(sizeBody.errors).toContain("size must be a valid number");
  });
});

describe("PATCH /api/admin/employees/delete/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();

    await prismaClient.masterUnit.deleteMany({ where: { id: "unit_2_test" } });
    await MasterDataTest.delete();

    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await prismaClient.masterUnit.deleteMany({ where: { id: "unit_2_test" } });
    await MasterDataTest.delete();
  });

  const createDummyEmployee = async (
    accessToken: string,
    empId: string,
    email: string,
  ): Promise<{ id: string }> => {
    const payload = {
      full_name: "Dummy Employee Delete",
      nick_name: "Dummy",
      email: email,
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),
      employee_id: empId,
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main Building",
      join_date: new Date("2026-07-01").toISOString(),
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      payload,
      accessToken,
    );
    const body = await response.json();
    return body.data as { id: string };
  };

  it("should successfully soft delete an employee when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.701",
      "test_emp_del1@millennia21.id",
    );
    await AuditLogTest.delete(); // ignore the CREATE_EMPLOYEE entry from the dummy setup above

    const response = await TestRequest.patch(
      `/api/admin/employees/delete/${targetEmployee.id}`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data).toBe(true);

    const checkDb = await prismaClient.employee.findUnique({
      where: { id: targetEmployee.id },
      select: { deleted_at: true, status: true },
    });
    expect(checkDb?.deleted_at).not.toBeNull();
    expect(checkDb?.status).toBe(EmployeeStatus.ARCHIVED);

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: targetEmployee.id },
    });
    logger.debug(auditLog);

    expect(auditLog.action).toBe(AuditAction.DELETE_EMPLOYEE);
    const oldValues = auditLog.old_values as { status?: string };
    const newValues = auditLog.new_values as {
      status?: string;
      deleted_at?: string;
    };
    expect(oldValues?.status).toBe(EmployeeStatus.ACTIVE);
    expect(newValues?.status).toBe(EmployeeStatus.ARCHIVED);
    expect(newValues?.deleted_at).toBeDefined();
  });

  it("should reject delete (400 Bad Request) if employee is already deleted (Double-delete protection)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.702",
      "test_emp_del2@millennia21.id",
    );

    await TestRequest.patch(
      `/api/admin/employees/delete/${targetEmployee.id}`,
      {},
      accessToken,
    );

    const response = await TestRequest.patch(
      `/api/admin/employees/delete/${targetEmployee.id}`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Employee is already deleted");
  });

  it("should reject delete (403 Forbidden) when requested by DATABASE_ADMIN", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      superAdmin.accessToken,
      "99.99.703",
      "test_emp_del3@millennia21.id",
    );

    const dbAdmin = await AdminUserTest.createDatabaseAdmin();

    const response = await TestRequest.patch(
      `/api/admin/employees/delete/${targetEmployee.id}`,
      {},
      dbAdmin.accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain(
      "Forbidden: Only Super Admin can delete employee data",
    );
  });

  it("should reject delete (403 Forbidden) when requested by VIEWER", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      superAdmin.accessToken,
      "99.99.704",
      "test_emp_del4@millennia21.id",
    );

    const viewer = await AdminUserTest.createViewer();

    const response = await TestRequest.patch(
      `/api/admin/employees/delete/${targetEmployee.id}`,
      {},
      viewer.accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain(
      "Forbidden: Only Super Admin can delete employee data",
    );
  });

  it("should reject delete (404 Not Found) if employee ID does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.patch(
      "/api/admin/employees/delete/invalid-cuid-123",
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Employee not found");
  });
});

describe("PATCH /api/admin/employees/restore/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();

    await prismaClient.masterUnit.deleteMany({ where: { id: "unit_2_test" } });
    await MasterDataTest.delete();

    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await prismaClient.masterUnit.deleteMany({ where: { id: "unit_2_test" } });
    await MasterDataTest.delete();
  });

  const createDummyEmployee = async (
    accessToken: string,
    empId: string,
    email: string,
  ): Promise<{ id: string }> => {
    const payload = {
      full_name: "Dummy Employee Restore",
      nick_name: "Dummy",
      email: email,
      gender: Gender.FEMALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),
      employee_id: empId,
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building: "Main Building",
      join_date: new Date("2026-07-01").toISOString(),
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      payload,
      accessToken,
    );
    const body = await response.json();
    return body.data as { id: string };
  };

  it("should successfully restore a deleted employee when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.801",
      "test_emp_rest1@millennia21.id",
    );

    await TestRequest.patch(
      `/api/admin/employees/delete/${targetEmployee.id}`,
      {},
      accessToken,
    );
    await AuditLogTest.delete(); // ignore the CREATE_EMPLOYEE/DELETE_EMPLOYEE entries from setup above

    const response = await TestRequest.patch(
      `/api/admin/employees/restore/${targetEmployee.id}`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status_info.status).toBe(EmployeeStatus.ACTIVE);

    const checkDb = await prismaClient.employee.findUnique({
      where: { id: targetEmployee.id },
      select: { deleted_at: true },
    });
    expect(checkDb?.deleted_at).toBeNull();

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: targetEmployee.id },
    });
    logger.debug(auditLog);
    expect(auditLog.action).toBe(AuditAction.UPDATE_EMPLOYEE);
    const oldValues = auditLog.old_values as { status?: string };
    const newValues = auditLog.new_values as {
      status?: string;
      deleted_at?: string | null;
    };
    expect(oldValues?.status).toBe(EmployeeStatus.ARCHIVED);
    expect(newValues?.status).toBe(EmployeeStatus.ACTIVE);
    expect(newValues?.deleted_at).toBeNull();
  });

  it("should reject restore (400 Bad Request) if employee is not deleted (Active)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.802",
      "test_emp_rest2@millennia21.id",
    );

    const response = await TestRequest.patch(
      `/api/admin/employees/restore/${targetEmployee.id}`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Employee is not in the trash bin");
  });

  it("should reject restore (403 Forbidden) when requested by DATABASE_ADMIN", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      superAdmin.accessToken,
      "99.99.803",
      "test_emp_rest3@millennia21.id",
    );

    await TestRequest.patch(
      `/api/admin/employees/delete/${targetEmployee.id}`,
      {},
      superAdmin.accessToken,
    );

    const dbAdmin = await AdminUserTest.createDatabaseAdmin();
    const response = await TestRequest.patch(
      `/api/admin/employees/restore/${targetEmployee.id}`,
      {},
      dbAdmin.accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain(
      "Forbidden: Only Super Admin can restore employee data",
    );
  });

  it("should reject restore (403 Forbidden) when requested by VIEWER", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      superAdmin.accessToken,
      "99.99.804",
      "test_emp_rest4@millennia21.id",
    );

    await TestRequest.patch(
      `/api/admin/employees/delete/${targetEmployee.id}`,
      {},
      superAdmin.accessToken,
    );

    const viewer = await AdminUserTest.createViewer();
    const response = await TestRequest.patch(
      `/api/admin/employees/restore/${targetEmployee.id}`,
      {},
      viewer.accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain(
      "Forbidden: Only Super Admin can restore employee data",
    );
  });

  it("should reject restore (404 Not Found) if employee ID does not exist", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.patch(
      "/api/admin/employees/restore/invalid-cuid-123",
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(404);
    expect(body.errors).toContain("Employee not found");
  });
});
