import { describe, afterEach, beforeEach, it, expect, spyOn } from "bun:test";
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
  type MasterBuilding,
  EmployeeStatus,
  MaritalStatus,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";
import { AuditService } from "../service/audit-service";
import { EmployeeService } from "../service/employee-service";

describe("POST /api/admin/employees", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
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
      building_id: masterData.building.id,
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

  it("should persist and return contract_end_date, independent of last_working_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const response = await TestRequest.post(
      "/api/admin/employees",
      {
        full_name: "Test Contract Employee",
        nick_name: "Contract Emp",
        email: "test_emp_contract@millennia21.id",
        gender: Gender.FEMALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("1995-01-01").toISOString(),
        employee_id: "99.99.097",
        marital_status: MaritalStatus.SINGLE,
        status: EmployeeStatus.ACTIVE,
        employment_type: EmploymentType.CONTRACT,
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        job_level_id: masterData.level.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-01-15").toISOString(),
        contract_end_date: new Date("2027-01-15").toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status_info.contract_end_date).toBe(
      new Date("2027-01-15").toISOString(),
    );
    // Still ACTIVE, not resigned - last_working_date must stay untouched.
    expect(body.data.offboarding.last_working_date).toBeNull();
  });

  it("should reject creation when job position and job level teaching flags don't match", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const teachingLevel = await prismaClient.masterJobLevel.create({
      data: { name: "TEST_LVL_TEACHING", is_teaching_role: true },
    });

    const response = await TestRequest.post(
      "/api/admin/employees",
      {
        full_name: "Mismatched Employee",
        nick_name: "Mismatch",
        email: "test_emp_mismatch@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("1995-01-01").toISOString(),
        employee_id: "99.99.098",
        marital_status: MaritalStatus.SINGLE,
        status: EmployeeStatus.ACTIVE,
        employment_type: EmploymentType.PERMANENT,
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id, // is_teaching_position: false
        job_level_id: teachingLevel.id, // is_teaching_role: true
        building_id: masterData.building.id,
        join_date: new Date("2026-07-01").toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("is not compatible with job level");
  });

  it("should reject creation when job level is SE Teacher but job position is not Special Education Teacher", async () => {
    const elementary = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Elementary" },
    });
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      elementary.id,
    );
    const seLevel = await prismaClient.masterJobLevel.findUniqueOrThrow({
      where: { name: "SE Teacher" },
    });
    const homeroomPosition = await prismaClient.masterJobPosition.findUniqueOrThrow(
      { where: { name: "Homeroom Teacher" } },
    );
    const building = await prismaClient.masterBuilding.findFirstOrThrow();

    const response = await TestRequest.post(
      "/api/admin/employees",
      {
        full_name: "SE Level Wrong Position",
        nick_name: "Wrong",
        email: "test_emp_se_wrong_position@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("1995-01-01").toISOString(),
        employee_id: "99.99.097",
        marital_status: MaritalStatus.SINGLE,
        status: EmployeeStatus.ACTIVE,
        employment_type: EmploymentType.PERMANENT,
        unit_id: elementary.id,
        job_position_id: homeroomPosition.id,
        job_level_id: seLevel.id,
        building_id: building.id,
        join_date: new Date("2026-07-01").toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("must be paired together");
  });

  it("should reject creation when job position is Special Education Teacher but job level is not SE Teacher", async () => {
    const elementary = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Elementary" },
    });
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      elementary.id,
    );
    const teacherLevel = await prismaClient.masterJobLevel.findUniqueOrThrow({
      where: { name: "Teacher" },
    });
    const sePosition = await prismaClient.masterJobPosition.findUniqueOrThrow({
      where: { name: "Special Education Teacher" },
    });
    const building = await prismaClient.masterBuilding.findFirstOrThrow();

    const response = await TestRequest.post(
      "/api/admin/employees",
      {
        full_name: "SE Position Wrong Level",
        nick_name: "Wrong",
        email: "test_emp_se_wrong_level@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("1995-01-01").toISOString(),
        employee_id: "99.99.096",
        marital_status: MaritalStatus.SINGLE,
        status: EmployeeStatus.ACTIVE,
        employment_type: EmploymentType.PERMANENT,
        unit_id: elementary.id,
        job_position_id: sePosition.id,
        job_level_id: teacherLevel.id,
        building_id: building.id,
        join_date: new Date("2026-07-01").toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("must be paired together");
  });

  it("should roll back employee creation entirely if the audit log write fails", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const auditSpy = spyOn(AuditService, "record").mockRejectedValue(
      new Error("Simulated audit failure"),
    );

    try {
      const response = await TestRequest.post(
        "/api/admin/employees",
        {
          full_name: "Rollback Test Employee",
          nick_name: "Rollback",
          email: "test_emp_audit_rollback@millennia21.id",
          gender: Gender.MALE,
          religion: Religion.ISLAM,
          birth_place: "Jakarta",
          birth_date: new Date("1995-01-01").toISOString(),
          employee_id: "99.99.097",
          marital_status: MaritalStatus.SINGLE,
          status: EmployeeStatus.ACTIVE,
          employment_type: EmploymentType.PERMANENT,
          unit_id: masterData.unit.id,
          job_position_id: masterData.position.id,
          job_level_id: masterData.level.id,
          building_id: masterData.building.id,
          join_date: new Date("2026-07-01").toISOString(),
        },
        accessToken,
      );

      expect(response.status).toBe(500);

      // The person/employee write happened in the same transaction as the
      // (mocked-to-fail) audit write - if the transaction didn't roll back,
      // this row would exist despite the request having failed.
      const person = await prismaClient.person.findUnique({
        where: { email: "test_emp_audit_rollback@millennia21.id" },
      });
      expect(person).toBeNull();
    } finally {
      auditSpy.mockRestore();
    }
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
      building_id: masterData.building.id,
      join_date: new Date("2026-01-01").toISOString(),
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
      building_id: masterData.building.id,
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
      building_id: masterData.building.id,
      join_date: new Date("2026-01-01").toISOString(),

      mobile_phone: "0812-3456-7890",
      residential_address: "Jl. Merdeka No. 1, Jakarta",
      nik: "1111 1111 1111 1111",
      npwp: "11.111.111.1-123.000",
      bank_account_number: "12 34 56 78 90",
      bpjs_number: "0001 2345 6789 0",
      bpjs_employment_number: "123 4567 8901",
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
    expect(getBody.data.identity.bpjs_employment_number).toBe("12345678901");
    expect(getBody.data.identity.marital_status).toBe(MaritalStatus.MARRIED);
  });

  it("should persist education fields on create", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Test Employee Education",
      nick_name: "Emp Edu",
      email: "test_emp_education@millennia21.id",
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
      building_id: masterData.building.id,
      join_date: new Date("2026-01-01").toISOString(),

      education_level: "S1",
      institution_name: "Universitas Indonesia",
      major: "Computer Science",
      graduation_year: 2015,
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);

    const getResponse = await TestRequest.get(
      `/api/admin/employees/${body.data.id}`,
      accessToken,
    );
    const getBody = await getResponse.json();
    logger.debug(getBody);

    expect(getResponse.status).toBe(200);
    expect(getBody.data.identity.education_level).toBe("S1");
    expect(getBody.data.identity.institution_name).toBe(
      "Universitas Indonesia",
    );
    expect(getBody.data.identity.major).toBe("Computer Science");
    expect(getBody.data.identity.graduation_year).toBe(2015);
  });

  it("should reject creation when graduation_year is in the future", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Test Employee Bad Grad Year",
      nick_name: "Emp Bad",
      email: "test_emp_bad_grad_year@millennia21.id",
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
      building_id: masterData.building.id,
      join_date: new Date("2026-01-01").toISOString(),

      graduation_year: new Date().getFullYear() + 1,
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("Graduation year cannot be in the future");
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
      building_id: masterData.building.id,
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
      building_id: masterData.building.id,
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
      building_id: masterData.building.id,
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
    expect(body.errors).toContain("starting with 08");
  });

  it("should reject a mobile_phone that's too long, saying so specifically", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Too Long Phone",
      nick_name: "TooLong",
      email: "test_emp_phone_too_long@millennia21.id",
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
      building_id: masterData.building.id,
      join_date: new Date("2026-01-01").toISOString(),
      // The exact input from a real bug report - a stray extra chunk of
      // digits pasted in by mistake.
      mobile_phone: "081232283827354645",
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("too long");
  });

  it("should reject a mobile_phone that's too short, saying so specifically", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Too Short Phone",
      nick_name: "TooShort",
      email: "test_emp_phone_too_short@millennia21.id",
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
      building_id: masterData.building.id,
      join_date: new Date("2026-01-01").toISOString(),
      mobile_phone: "0812345",
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("too short");
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
      building_id: masterData.building.id,
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
      building_id: masterData.building.id,
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

  it("should reject a bpjs_employment_number that isn't exactly 11 digits", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Bad BPJS Employment",
      nick_name: "BadBPJSEmployment",
      email: "test_emp_bad_bpjs_employment@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),
      employee_id: "99.99.508",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building_id: masterData.building.id,
      join_date: new Date("2026-01-01").toISOString(),
      bpjs_employment_number: "123",
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("11 digits");
  });

  it("should reject a kpj_number that isn't exactly 11 letters/digits", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Bad KPJ",
      nick_name: "BadKPJ",
      email: "test_emp_bad_kpj@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),
      employee_id: "99.99.509",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building_id: masterData.building.id,
      join_date: new Date("2026-01-01").toISOString(),
      kpj_number: "AB123",
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("11 letters/digits");
  });

  it("should create an employee with a kpj_number, normalized to uppercase", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Legacy KPJ Employee",
      nick_name: "LegacyKPJ",
      email: "test_emp_kpj_ok@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),
      employee_id: "99.99.510",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building_id: masterData.building.id,
      join_date: new Date("2026-01-01").toISOString(),
      kpj_number: "ab-1234 5678c",
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);

    const getResponse = await TestRequest.get(
      `/api/admin/employees/${body.data.id}`,
      accessToken,
    );
    const getBody = await getResponse.json();
    expect(getBody.data.identity.kpj_number).toBe("AB12345678C");
  });

  it("should reject a kpj_number already registered to another employee", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    await TestRequest.post(
      "/api/admin/employees",
      {
        full_name: "KPJ Owner",
        nick_name: "KPJOwner",
        email: "test_emp_kpj_owner@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("1995-01-01").toISOString(),
        employee_id: "99.99.511",
        marital_status: MaritalStatus.SINGLE,
        status: EmployeeStatus.ACTIVE,
        employment_type: EmploymentType.PERMANENT,
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        job_level_id: masterData.level.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-01-01").toISOString(),
        kpj_number: "AB12345678C",
      },
      accessToken,
    );

    const response = await TestRequest.post(
      "/api/admin/employees",
      {
        full_name: "KPJ Duplicate",
        nick_name: "KPJDup",
        email: "test_emp_kpj_dup@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("1995-01-01").toISOString(),
        employee_id: "99.99.512",
        marital_status: MaritalStatus.SINGLE,
        status: EmployeeStatus.ACTIVE,
        employment_type: EmploymentType.PERMANENT,
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        job_level_id: masterData.level.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-01-01").toISOString(),
        kpj_number: "ab12345678c",
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("KPJ number");
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
      building_id: masterData.building.id,
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

  it("should reject creation (403) when DATABASE_ADMIN without can_view_employee_pii tries to set NIK", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Test Employee PII",
      nick_name: "Emp PII",
      email: "test_emp_pii_blocked@millennia21.id",
      gender: Gender.FEMALE,
      religion: Religion.PROTESTANTISM,
      birth_place: "Bandung",
      birth_date: new Date("1996-02-02").toISOString(),
      employee_id: "99.99.003",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.CONTRACT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building_id: masterData.building.id,
      join_date: new Date("2026-08-01").toISOString(),
      nik: "1111111111111111",
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("employee PII");
  });

  it("should allow creation with NIK for DATABASE_ADMIN with can_view_employee_pii", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
      { canViewEmployeePii: true },
    );

    const requestBody = {
      full_name: "Test Employee PII Allowed",
      nick_name: "Emp PII Allowed",
      email: "test_emp_pii_allowed@millennia21.id",
      gender: Gender.FEMALE,
      religion: Religion.PROTESTANTISM,
      birth_place: "Bandung",
      birth_date: new Date("1996-02-02").toISOString(),
      employee_id: "99.99.004",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.CONTRACT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building_id: masterData.building.id,
      join_date: new Date("2026-08-01").toISOString(),
      nik: "2222222222222222",
    };

    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.identity.full_name).toBe("Test Employee PII Allowed");
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
      building_id: masterData.building.id,
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

    const auditEntry = await prismaClient.auditLog.findFirst({
      where: { action: AuditAction.UNAUTHORIZED_ACCESS },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.new_values).toMatchObject({
      reason: "blocked employee create",
    });
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
      building_id: masterData.building.id,
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
      building_id: masterData.building.id,
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
      building_id: masterData.building.id,
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
      building_id: masterData.building.id,
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

  it("should reject creation (400) if NIK already belongs to another active employee, naming them", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const basePayload = {
      full_name: "NIK Owner",
      nick_name: "Owner",
      email: "test_emp_nik_owner@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),
      employee_id: "99.99.610",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building_id: masterData.building.id,
      join_date: new Date().toISOString(),
      nik: "5555555555555555",
    };

    await TestRequest.post("/api/admin/employees", basePayload, accessToken);

    const response = await TestRequest.post(
      "/api/admin/employees",
      {
        ...basePayload,
        email: "test_emp_nik_dupe@millennia21.id",
        employee_id: "99.99.611",
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("NIK");
    expect(body.errors).toContain("NIK Owner");
    expect(body.errors).toContain("99.99.610");
  });

  it("should allow reusing a NIK/NPWP/bank/BPJS that belonged to a now-archived employee (cleared on delete)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const originalPayload = {
      full_name: "Soon Archived",
      nick_name: "Archived",
      email: "test_emp_archived_sensitive@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),
      employee_id: "99.99.612",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building_id: masterData.building.id,
      join_date: new Date().toISOString(),
      nik: "6666666666666666",
      npwp: "666666666666666",
      bank_account_number: "6666666666",
      bpjs_number: "6666666666666",
      bpjs_employment_number: "66666666666",
      // Both set directly here to lock in that each identifier clears
      // independently - the UI's checkbox only ever writes one at a time,
      // but the backend doesn't enforce that as a constraint.
      kpj_number: "AB66666666C",
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

    const archivedRow = await prismaClient.employee.findUniqueOrThrow({
      where: { id: createdEmployee.id },
    });
    expect(archivedRow.nik).toBeNull();
    expect(archivedRow.npwp).toBeNull();
    expect(archivedRow.bank_account_number).toBeNull();
    expect(archivedRow.bpjs_number).toBeNull();
    expect(archivedRow.bpjs_employment_number).toBeNull();
    expect(archivedRow.kpj_number).toBeNull();

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: {
        action: AuditAction.DELETE_EMPLOYEE,
        entity_id: createdEmployee.id,
      },
    });
    expect(auditLog.old_values).toMatchObject({
      nik: "6666666666666666",
      npwp: "666666666666666",
      bank_account_number: "6666666666",
      bpjs_number: "6666666666666",
      bpjs_employment_number: "66666666666",
      kpj_number: "AB66666666C",
    });

    const response = await TestRequest.post(
      "/api/admin/employees",
      {
        ...originalPayload,
        email: "test_emp_new_owner_sensitive@millennia21.id",
        employee_id: "99.99.613",
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
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
      building_id: masterData.building.id,
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
      building_id: masterData.building.id,
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
      building_id: masterData.building.id,
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
      building_id: masterData.building.id,
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
      building_id: masterData.building.id,
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

  it("should reject creation (400 Bad Request) if status is RESIGNED without last_working_date", async () => {
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
      building_id: masterData.building.id,
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
      "Last working date is required when status is RESIGNED",
    );
  });

  it("should successfully create an employee with status RESIGNED when last_working_date is provided", async () => {
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
      building_id: masterData.building.id,
      join_date: new Date("2020-01-01").toISOString(),
      last_working_date: new Date("2026-01-01").toISOString(),
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
    expect(body.data.offboarding.last_working_date).toBeDefined();
  });

  it("should immediately set status to RESIGNED on create when last_working_date is already in the past, even if ACTIVE was requested", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Backdated Last Working",
      nick_name: "Backdated",
      email: "test_emp_backdated_create@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),

      employee_id: "99.99.902",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building_id: masterData.building.id,
      join_date: new Date("2020-01-01").toISOString(),
      last_working_date: new Date("2020-06-01").toISOString(),
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
  });

  it("should reject creation when last_working_date is after the contract end date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Last Working After Contract End",
      nick_name: "LWAfterCE",
      email: "test_emp_lw_after_ce_create@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),

      employee_id: "99.99.903",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.RESIGNED,
      employment_type: EmploymentType.CONTRACT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building_id: masterData.building.id,
      join_date: new Date("2020-01-01").toISOString(),
      contract_end_date: new Date("2027-01-01").toISOString(),
      last_working_date: new Date("2027-06-01").toISOString(),
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
      "Last working date can't be after the contract end date",
    );
  });
});

describe("PATCH /api/admin/employees/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
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
      building_id: masterData.building.id,
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

    const northWing = await prismaClient.masterBuilding.create({
      data: { name: "TEST_BUILDING_NORTH_WING" },
    });

    const updatePayload = {
      full_name: "Updated Employee Name",
      building_id: northWing.id,
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
    expect(body.data.employment.building).toBe("TEST_BUILDING_NORTH_WING");
    expect(body.data.status_info.status).toBe("INACTIVE");

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: targetEmployee.id },
    });
    logger.debug(auditLog);

    expect(auditLog.action).toBe(AuditAction.UPDATE_EMPLOYEE);
    const oldValues = auditLog.old_values as { status?: string };
    const newValues = auditLog.new_values as {
      status?: string;
      building_id?: string;
    };
    expect(oldValues?.status).toBe(EmployeeStatus.ACTIVE);
    expect(newValues?.status).toBe(EmployeeStatus.INACTIVE);
    expect(newValues?.building_id).toBe(northWing.id);
  });

  it("should not write a new audit log entry when the update payload matches the existing values", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.302",
      "test_emp_update_noop@millennia21.id",
    );
    await AuditLogTest.delete(); // ignore the CREATE_EMPLOYEE entry from the dummy setup above

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { full_name: "Dummy Employee", status: EmployeeStatus.ACTIVE },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);

    const auditLogs = await prismaClient.auditLog.findMany({
      where: { entity_id: targetEmployee.id },
    });
    expect(auditLogs.length).toBe(0);
  });

  it("should update contract_end_date independently of last_working_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.303",
      "test_emp_update_contract@millennia21.id",
    );

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      {
        // createDummyEmployee defaults to PERMANENT, which can't carry a
        // contract_end_date - move it to CONTRACT in the same call.
        employment_type: EmploymentType.CONTRACT,
        contract_end_date: new Date("2027-07-01").toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status_info.contract_end_date).toBe(
      new Date("2027-07-01").toISOString(),
    );
    expect(body.data.offboarding.last_working_date).toBeNull();
  });

  it("should update education fields", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.305",
      "test_emp_update_education@millennia21.id",
    );

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      {
        education_level: "S2",
        institution_name: "Institut Teknologi Bandung",
        major: "Information Systems",
        graduation_year: 2020,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);

    const getResponse = await TestRequest.get(
      `/api/admin/employees/${targetEmployee.id}`,
      accessToken,
    );
    const getBody = await getResponse.json();

    expect(getBody.data.identity.education_level).toBe("S2");
    expect(getBody.data.identity.institution_name).toBe(
      "Institut Teknologi Bandung",
    );
    expect(getBody.data.identity.major).toBe("Information Systems");
    expect(getBody.data.identity.graduation_year).toBe(2020);
  });

  it("should reject update when the new job level's teaching flag doesn't match the employee's job position", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.302",
      "test_emp_update_mismatch@millennia21.id",
    );
    await AuditLogTest.delete();

    const teachingLevel = await prismaClient.masterJobLevel.create({
      data: { name: "TEST_LVL_TEACHING_UPDATE", is_teaching_role: true },
    });

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { job_level_id: teachingLevel.id },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("is not compatible with job level");
  });

  it("should allow changing NIK/NPWP within 1 day of creation", async () => {
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

  it("should reject (400) overwriting an already-set NIK after the 1-day grace period, even for SUPER_ADMIN, and audit-log the blocked attempt", async () => {
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
        created_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
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

  it("should allow overwriting NIK a few seconds shy of the 1-day boundary", async () => {
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
        created_at: new Date(Date.now() - 24 * 60 * 60 * 1000 + 5000),
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { nik: "2222222222222222" },
      accessToken,
    );
    expect(response.status).toBe(200);
  });

  it("should reject (400) overwriting NIK just past the 1-day boundary", async () => {
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
        created_at: new Date(Date.now() - 24 * 60 * 60 * 1000 - 1000),
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { nik: "2222222222222222" },
      accessToken,
    );
    expect(response.status).toBe(400);
  });

  it("should allow setting NIK for the first time even after the 1-day grace period (it was never overwriting anything)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.308",
      "test_emp_nik3@millennia21.id",
    );
    await AuditLogTest.delete();
    await prismaClient.employee.update({
      where: { id: targetEmployee.id },
      data: { created_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
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

  it("should allow changing BPJS number and bank account within 1 day of creation", async () => {
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

  it("should reject (400) overwriting an already-set BPJS number or bank account after the 1-day grace period, even for SUPER_ADMIN", async () => {
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
        created_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
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

  it("should allow setting BPJS number and bank account for the first time even after the 1-day grace period", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.309",
      "test_emp_bpjs3@millennia21.id",
    );
    await AuditLogTest.delete();
    await prismaClient.employee.update({
      where: { id: targetEmployee.id },
      data: { created_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
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

  it("should reject (400) overwriting an already-set BPJS Ketenagakerjaan number after the 1-day grace period, even for SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.312",
      "test_emp_bpjs_employment1@millennia21.id",
    );
    await AuditLogTest.delete();
    await prismaClient.employee.update({
      where: { id: targetEmployee.id },
      data: {
        bpjs_employment_number: "11111111111",
        created_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { bpjs_employment_number: "22222222222" },
      accessToken,
    );
    expect(response.status).toBe(400);
  });

  it("should allow setting BPJS Ketenagakerjaan number for the first time even after the 1-day grace period", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.313",
      "test_emp_bpjs_employment2@millennia21.id",
    );
    await AuditLogTest.delete();
    await prismaClient.employee.update({
      where: { id: targetEmployee.id },
      data: { created_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { bpjs_employment_number: "33333333333" },
      accessToken,
    );
    expect(response.status).toBe(200);

    const updated = await prismaClient.employee.findUniqueOrThrow({
      where: { id: targetEmployee.id },
    });
    expect(updated.bpjs_employment_number).toBe("33333333333");
  });

  it("should reject (400) overwriting an already-set kpj_number after the 1-day grace period, even for SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.314",
      "test_emp_kpj1@millennia21.id",
    );
    await AuditLogTest.delete();
    await prismaClient.employee.update({
      where: { id: targetEmployee.id },
      data: {
        kpj_number: "AB11111111C",
        created_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { kpj_number: "AB22222222C" },
      accessToken,
    );
    expect(response.status).toBe(400);
  });

  it("should allow setting kpj_number for the first time even after the 1-day grace period", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.315",
      "test_emp_kpj2@millennia21.id",
    );
    await AuditLogTest.delete();
    await prismaClient.employee.update({
      where: { id: targetEmployee.id },
      data: { created_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { kpj_number: "AB33333333C" },
      accessToken,
    );
    expect(response.status).toBe(200);

    const updated = await prismaClient.employee.findUniqueOrThrow({
      where: { id: targetEmployee.id },
    });
    expect(updated.kpj_number).toBe("AB33333333C");
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

  it("should reject update (403) when DATABASE_ADMIN without can_view_employee_pii tries to set NIK", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.306",
      "test_emp_update_pii_blocked@millennia21.id",
    );

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { nik: "3333333333333333" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("employee PII");
  });

  it("should allow update with NIK for DATABASE_ADMIN with can_view_employee_pii", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      undefined,
      { canViewEmployeePii: true },
    );
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.307",
      "test_emp_update_pii_allowed@millennia21.id",
    );

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { nik: "4444444444444444" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
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

  it("should reject update (400) if new NIK already belongs to another active employee, naming them", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const employeeA = await createDummyEmployee(
      accessToken,
      "99.99.620",
      "test_emp_nik_upd_a@millennia21.id",
    );
    await TestRequest.patch(
      `/api/admin/employees/${employeeA.id}`,
      { nik: "7777777777777777" },
      accessToken,
    );

    const employeeB = await createDummyEmployee(
      accessToken,
      "99.99.621",
      "test_emp_nik_upd_b@millennia21.id",
    );

    const response = await TestRequest.patch(
      `/api/admin/employees/${employeeB.id}`,
      { nik: "7777777777777777" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("NIK");
    expect(body.errors).toContain("Dummy Employee");
    expect(body.errors).toContain("99.99.620");
  });

  it("should not repopulate cleared sensitive fields when an archived employee is restored", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.622",
      "test_emp_restore_sensitive@millennia21.id",
    );
    await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { nik: "8888888888888888", bank_account_number: "8888888888" },
      accessToken,
    );

    await TestRequest.patch(
      `/api/admin/employees/delete/${targetEmployee.id}`,
      {},
      accessToken,
    );
    await TestRequest.patch(
      `/api/admin/employees/restore/${targetEmployee.id}`,
      {},
      accessToken,
    );

    const restored = await prismaClient.employee.findUniqueOrThrow({
      where: { id: targetEmployee.id },
    });
    expect(restored.deleted_at).toBeNull();
    expect(restored.nik).toBeNull();
    expect(restored.bank_account_number).toBeNull();
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

  it("should reject update (400 Bad Request) if status is changed to RESIGNED without last_working_date", async () => {
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
      "Last working date is required when status is RESIGNED",
    );
  });

  it("should successfully update status to RESIGNED when last_working_date is provided", async () => {
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
        last_working_date: new Date("2026-01-01").toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status_info.status).toBe(EmployeeStatus.RESIGNED);
    expect(body.data.offboarding.last_working_date).toBeDefined();
  });

  it("should immediately set status to RESIGNED on update when last_working_date is backdated to the past, without requesting a status change", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.607",
      "test_emp_backdated_update@millennia21.id",
    );

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      { last_working_date: new Date("2020-06-01").toISOString() },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status_info.status).toBe(EmployeeStatus.RESIGNED);
  });

  it("should reject update when last_working_date is after the contract end date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const targetEmployee = await createDummyEmployee(
      accessToken,
      "99.99.608",
      "test_emp_lw_after_ce_update@millennia21.id",
    );
    await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      {
        employment_type: EmploymentType.CONTRACT,
        contract_end_date: new Date("2027-01-01").toISOString(),
      },
      accessToken,
    );

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      {
        status: EmployeeStatus.RESIGNED,
        last_working_date: new Date("2027-06-01").toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain(
      "Last working date can't be after the contract end date",
    );
  });

  it("should allow updating other fields without resending last_working_date once the employee is already RESIGNED", async () => {
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
        last_working_date: new Date("2026-01-01").toISOString(),
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
    building: MasterBuilding;
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
      building_id: masterData.building.id,
      join_date: new Date("2026-07-01").toISOString(),
      mobile_phone: "081234567890",
      residential_address: "Jl. Merdeka No. 1, Jakarta",
      nik: "1111111111111111",
      npwp: "111111111123000",
      bank_account_number: "1234567890",
      bpjs_number: "0001234567890",
      bpjs_employment_number: "12345678901",
      kpj_number: "AB12345678C",
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
    expect(body.data.identity.bpjs_employment_number).toBe("12345678901");
    expect(body.data.identity.kpj_number).toBe("AB12345678C");

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
    expect(body.data.identity.bpjs_employment_number).toBeUndefined();
    expect(body.data.identity.kpj_number).toBeUndefined();

    // Non-sensitive contact fields are still visible
    expect(body.data.identity.mobile_phone).toBe("6281234567890");
    expect(body.data.identity.residential_address).toBe(
      "Jl. Merdeka No. 1, Jakarta",
    );
  });

  it("should return detailed response for DATABASE_ADMIN with can_view_employee_pii", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const dbAdmin = await AdminUserTest.createDatabaseAdmin(undefined, {
      canViewEmployeePii: true,
    });

    const targetEmployee = await createDummyEmployee(
      superAdmin.accessToken,
      "99.99.806",
      "test_emp_view_dbadmin_pii@millennia21.id",
    );

    const response = await TestRequest.get(
      `/api/admin/employees/${targetEmployee.id}`,
      dbAdmin.accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.identity.nik).toBe("1111111111111111");
    expect(body.data.identity.npwp).toBe("111111111123000");
    expect(body.data.identity.bank_account_number).toBe("1234567890");
    expect(body.data.identity.bpjs_number).toBe("0001234567890");
    expect(body.data.identity.bpjs_employment_number).toBe("12345678901");
    expect(body.data.identity.kpj_number).toBe("AB12345678C");
    expect(body.data.identity.marital_status).toBe(MaritalStatus.SINGLE);
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
    expect(body.data.identity.bpjs_employment_number).toBeUndefined();
    expect(body.data.identity.kpj_number).toBeUndefined();

    // Contact fields are read-only-scoped: hidden from Viewer too, unlike
    // Database Admin who may need them for day-to-day unit management
    expect(body.data.identity.mobile_phone).toBeUndefined();
    expect(body.data.identity.residential_address).toBeUndefined();
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

  it("should let a DATABASE_ADMIN with can_view_all_units view an employee from a different unit", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const dbAdmin = await AdminUserTest.createDatabaseAdmin(undefined, {
      canViewAllUnits: true,
    });

    const targetEmployee = await createDummyEmployee(
      superAdmin.accessToken,
      "99.99.805",
      "test_emp_allunits_get@millennia21.id",
      secondUnitId,
    );

    const response = await TestRequest.get(
      `/api/admin/employees/${targetEmployee.id}`,
      dbAdmin.accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.identity.email).toBe(
      "test_emp_allunits_get@millennia21.id",
    );
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
    building: MasterBuilding;
  };
  let secondUnitId: string;
  let secondBuildingId: string;

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

    await prismaClient.masterBuilding.deleteMany({
      where: { id: "building_2_test" },
    });
    const building2 = await prismaClient.masterBuilding.create({
      data: { id: "building_2_test", name: "TEST_BUILDING_SOUTH_WING" },
    });
    secondBuildingId = building2.id;
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await EmployeeTest.delete();

    await prismaClient.masterUnit.deleteMany({ where: { id: "unit_2_test" } });
    await prismaClient.masterBuilding.deleteMany({
      where: { id: "building_2_test" },
    });
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
      building_id: masterData.building.id,
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
      building_id: secondBuildingId,
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
        building_id: masterData.building.id,
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

  it("should bypass unit scoping for a DATABASE_ADMIN with can_view_all_units", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    await populateDummyEmployees(superAdmin.accessToken);
    const dbAdmin = await AdminUserTest.createDatabaseAdmin(masterData.unit.id, {
      canViewAllUnits: true,
    });

    const response = await TestRequest.get(
      "/api/admin/employees?page=1&size=10&search=99.99.",
      dbAdmin.accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(2);
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
      `/api/admin/employees?status=INACTIVE&building_id=${secondBuildingId}`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].status_info.status).toBe("INACTIVE");
    expect(body.data[0].employment.building).toBe("TEST_BUILDING_SOUTH_WING");
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

  it("should hide mobile_phone and residential_address from VIEWER in list results, but keep them for DATABASE_ADMIN", async () => {
    const superAdmin = await AdminUserTest.createSuperAdmin();
    const dbAdmin = await AdminUserTest.createDatabaseAdmin();
    const viewer = await AdminUserTest.createViewer();

    await TestRequest.post(
      "/api/admin/employees",
      {
        full_name: "Contact Field Test",
        nick_name: "Contact",
        email: "test_emp_contact_visibility@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("1995-01-01").toISOString(),
        employee_id: "99.99.900",
        marital_status: MaritalStatus.SINGLE,
        status: EmployeeStatus.ACTIVE,
        employment_type: EmploymentType.PERMANENT,
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        job_level_id: masterData.level.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-01-01").toISOString(),
        mobile_phone: "081234567890",
        residential_address: "Jl. Merdeka No. 1, Jakarta",
      },
      superAdmin.accessToken,
    );

    const dbAdminResponse = await TestRequest.get(
      "/api/admin/employees?search=Contact Field Test",
      dbAdmin.accessToken,
    );
    const dbAdminBody = await dbAdminResponse.json();
    expect(dbAdminBody.data[0].identity.mobile_phone).toBe("6281234567890");
    expect(dbAdminBody.data[0].identity.residential_address).toBe(
      "Jl. Merdeka No. 1, Jakarta",
    );

    const viewerResponse = await TestRequest.get(
      "/api/admin/employees?search=Contact Field Test",
      viewer.accessToken,
    );
    const viewerBody = await viewerResponse.json();
    expect(viewerBody.data[0].identity.mobile_phone).toBeUndefined();
    expect(viewerBody.data[0].identity.residential_address).toBeUndefined();
  });
});

describe("GET /api/admin/employees/count-total", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
  };
  let secondUnitId: string;
  let secondBuildingId: string;

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

    await prismaClient.masterBuilding.deleteMany({
      where: { id: "building_2_test" },
    });
    const building2 = await prismaClient.masterBuilding.create({
      data: { id: "building_2_test", name: "TEST_BUILDING_SOUTH_WING" },
    });
    secondBuildingId = building2.id;
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await EmployeeTest.delete();

    await prismaClient.masterUnit.deleteMany({ where: { id: "unit_2_test" } });
    await prismaClient.masterBuilding.deleteMany({
      where: { id: "building_2_test" },
    });
    await MasterDataTest.delete();
  });

  const populateDummyEmployees = async (accessToken: string) => {
    const payload1 = {
      full_name: "Count Total Alpha",
      nick_name: "Alpha",
      email: "test_emp_count_alpha@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1990-01-01").toISOString(),
      employee_id: "99.99.201",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building_id: masterData.building.id,
      join_date: new Date("2026-01-01").toISOString(),
    };

    const payload2 = {
      full_name: "Count Total Bravo",
      nick_name: "Bravo",
      email: "test_emp_count_bravo@millennia21.id",
      gender: Gender.FEMALE,
      religion: Religion.CATHOLICISM,
      birth_place: "Bandung",
      birth_date: new Date("1992-02-02").toISOString(),
      employee_id: "99.99.202",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.CONTRACT,
      unit_id: secondUnitId,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building_id: secondBuildingId,
      join_date: new Date("2026-02-01").toISOString(),
    };

    await TestRequest.post("/api/admin/employees", payload1, accessToken);
    await TestRequest.post("/api/admin/employees", payload2, accessToken);
  };

  it("should return the true org-wide total for SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await populateDummyEmployees(accessToken);

    const response = await TestRequest.get(
      "/api/admin/employees/count-total",
      accessToken,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.total).toBe(2);
  });

  it("should return the same unscoped total for a unit-scoped DATABASE_ADMIN, even though search() only shows their own unit", async () => {
    const { accessToken: superAdminToken } =
      await AdminUserTest.createSuperAdmin();
    await populateDummyEmployees(superAdminToken);

    const { accessToken: dbAdminToken } =
      await AdminUserTest.createDatabaseAdmin(masterData.unit.id);

    const scopedSearch = await TestRequest.get(
      "/api/admin/employees",
      dbAdminToken,
    );
    const scopedBody = await scopedSearch.json();
    expect(scopedBody.data.length).toBe(1);

    const totalResponse = await TestRequest.get(
      "/api/admin/employees/count-total",
      dbAdminToken,
    );
    const totalBody = await totalResponse.json();

    expect(totalResponse.status).toBe(200);
    expect(totalBody.data.total).toBe(2);
  });
});

describe("PATCH /api/admin/employees/delete/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
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
      building_id: masterData.building.id,
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
    building: MasterBuilding;
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
      building_id: masterData.building.id,
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

describe("PATCH /api/admin/employees/bulk/extend-contract", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  async function createEmployee(
    accessToken: string,
    employeeIdSuffix: string,
    email: string,
    overrides: Record<string, unknown> = {},
  ) {
    const response = await TestRequest.post(
      "/api/admin/employees",
      {
        full_name: "Test Employee Bulk Extend",
        nick_name: "Emp Bulk",
        email,
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("1995-01-01").toISOString(),
        employee_id: `99.99.${employeeIdSuffix}`,
        marital_status: MaritalStatus.SINGLE,
        status: EmployeeStatus.ACTIVE,
        employment_type: EmploymentType.CONTRACT,
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        job_level_id: masterData.level.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-01-01").toISOString(),
        ...overrides,
      },
      accessToken,
    );
    const body = await response.json();
    return body.data;
  }

  it("should extend each selected employee from its own current end date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const withEndDate = await createEmployee(
      accessToken,
      "601",
      "test_bulk_extend_with_end_date@millennia21.id",
      { contract_end_date: new Date("2026-12-01").toISOString() },
    );
    const withoutEndDate = await createEmployee(
      accessToken,
      "602",
      "test_bulk_extend_without_end_date@millennia21.id",
    );

    const response = await TestRequest.patch(
      "/api/admin/employees/bulk/extend-contract",
      { ids: [withEndDate.id, withoutEndDate.id], duration_months: 6 },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.success_count).toBe(2);
    expect(body.data.failed_count).toBe(0);

    const withEndDateResponse = await TestRequest.get(
      `/api/admin/employees/${withEndDate.id}`,
      accessToken,
    );
    const withEndDateBody = await withEndDateResponse.json();
    expect(withEndDateBody.data.status_info.contract_end_date).toBe(
      new Date("2027-06-01").toISOString(),
    );

    const withoutEndDateResponse = await TestRequest.get(
      `/api/admin/employees/${withoutEndDate.id}`,
      accessToken,
    );
    const withoutEndDateBody = await withoutEndDateResponse.json();
    expect(withoutEndDateBody.data.status_info.contract_end_date).not.toBeNull();
  });

  it("should extend from an explicit baseline_overrides date instead of now, for employees with no contract_end_date yet", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(
      accessToken,
      "607",
      "test_bulk_extend_baseline_override@millennia21.id",
    );

    const response = await TestRequest.patch(
      "/api/admin/employees/bulk/extend-contract",
      {
        ids: [employee.id],
        duration_months: 6,
        baseline_overrides: [
          { id: employee.id, baseline_date: new Date("2026-06-01").toISOString() },
        ],
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.success_count).toBe(1);

    const getResponse = await TestRequest.get(
      `/api/admin/employees/${employee.id}`,
      accessToken,
    );
    const getBody = await getResponse.json();
    expect(getBody.data.status_info.contract_end_date).toBe(
      new Date("2026-12-01").toISOString(),
    );
  });

  it("should skip PERMANENT employees as a failed item without blocking the rest", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const permanentEmployee = await createEmployee(
      accessToken,
      "603",
      "test_bulk_extend_permanent@millennia21.id",
      { employment_type: EmploymentType.PERMANENT },
    );
    const contractEmployee = await createEmployee(
      accessToken,
      "604",
      "test_bulk_extend_contract@millennia21.id",
    );

    const response = await TestRequest.patch(
      "/api/admin/employees/bulk/extend-contract",
      {
        ids: [permanentEmployee.id, contractEmployee.id],
        duration_months: 12,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.success_count).toBe(1);
    expect(body.data.failed_count).toBe(1);
    const failedItem = body.data.items.find(
      (item: { id: string }) => item.id === permanentEmployee.id,
    );
    expect(failedItem.status).toBe("FAILED");
    expect(failedItem.error).toContain("Permanent employees");
  });

  it("should reject when caller is VIEWER", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(
      accessToken,
      "605",
      "test_bulk_extend_viewer@millennia21.id",
    );

    const { accessToken: viewerToken } = await AdminUserTest.createViewer();
    const response = await TestRequest.patch(
      "/api/admin/employees/bulk/extend-contract",
      { ids: [employee.id], duration_months: 6 },
      viewerToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("Forbidden");
  });

  it("should reject when duration_months is missing", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(
      accessToken,
      "606",
      "test_bulk_extend_missing_duration@millennia21.id",
    );

    const response = await TestRequest.patch(
      "/api/admin/employees/bulk/extend-contract",
      { ids: [employee.id] },
      accessToken,
    );

    expect(response.status).toBe(400);
  });
});

describe("PATCH /api/admin/employees/bulk/update", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
  };
  let secondUnitId: string;
  let secondLevelId: string;
  let secondPositionId: string;
  let secondBuildingId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();

    await prismaClient.masterUnit.deleteMany({ where: { id: "bulk_update_unit_2" } });
    await prismaClient.masterJobLevel.deleteMany({ where: { id: "bulk_update_level_2" } });
    await prismaClient.masterJobPosition.deleteMany({ where: { id: "bulk_update_position_2" } });
    await prismaClient.masterBuilding.deleteMany({ where: { id: "bulk_update_building_2" } });
    await MasterDataTest.delete();

    masterData = await MasterDataTest.create();

    const unit2 = await prismaClient.masterUnit.create({
      data: { id: "bulk_update_unit_2", name: "Bulk Update Second Unit" },
    });
    secondUnitId = unit2.id;
    const level2 = await prismaClient.masterJobLevel.create({
      data: { id: "bulk_update_level_2", name: "Bulk Update Second Level" },
    });
    secondLevelId = level2.id;
    const position2 = await prismaClient.masterJobPosition.create({
      data: { id: "bulk_update_position_2", name: "Bulk Update Second Position" },
    });
    secondPositionId = position2.id;
    const building2 = await prismaClient.masterBuilding.create({
      data: { id: "bulk_update_building_2", name: "Bulk Update Second Building" },
    });
    secondBuildingId = building2.id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await prismaClient.masterUnit.deleteMany({ where: { id: "bulk_update_unit_2" } });
    await prismaClient.masterJobLevel.deleteMany({ where: { id: "bulk_update_level_2" } });
    await prismaClient.masterJobPosition.deleteMany({ where: { id: "bulk_update_position_2" } });
    await prismaClient.masterBuilding.deleteMany({ where: { id: "bulk_update_building_2" } });
    await MasterDataTest.delete();
  });

  async function createEmployee(
    accessToken: string,
    employeeIdSuffix: string,
    email: string,
    overrides: Record<string, unknown> = {},
  ) {
    const response = await TestRequest.post(
      "/api/admin/employees",
      {
        full_name: "Test Employee Bulk Update",
        nick_name: "Emp Bulk",
        email,
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("1995-01-01").toISOString(),
        employee_id: `99.99.${employeeIdSuffix}`,
        marital_status: MaritalStatus.SINGLE,
        status: EmployeeStatus.ACTIVE,
        employment_type: EmploymentType.PERMANENT,
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        job_level_id: masterData.level.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-01-01").toISOString(),
        ...overrides,
      },
      accessToken,
    );
    const body = await response.json();
    return body.data;
  }

  it("should bulk-update unit, job level, job position, and building together, backdating mutation history to effective_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(
      accessToken,
      "950",
      "test_bulk_update_categorical@millennia21.id",
    );

    const effectiveDate = new Date("2026-03-01").toISOString();
    const response = await TestRequest.patch(
      "/api/admin/employees/bulk/update",
      {
        ids: [employee.id],
        unit_id: secondUnitId,
        job_level_id: secondLevelId,
        job_position_id: secondPositionId,
        building_id: secondBuildingId,
        effective_date: effectiveDate,
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.success_count).toBe(1);
    expect(body.data.failed_count).toBe(0);

    const getResponse = await TestRequest.get(
      `/api/admin/employees/${employee.id}`,
      accessToken,
    );
    const getBody = await getResponse.json();
    expect(getBody.data.employment.unit).toBe("Bulk Update Second Unit");
    expect(getBody.data.employment.job_level).toBe("Bulk Update Second Level");
    expect(getBody.data.employment.job_position).toBe("Bulk Update Second Position");
    expect(getBody.data.employment.building).toBe("Bulk Update Second Building");

    const historyResponse = await TestRequest.get(
      `/api/admin/employees/${employee.id}/mutation-history`,
      accessToken,
    );
    const historyBody = await historyResponse.json();
    const unitEntry = historyBody.data.find(
      (entry: { field: string; end_date: string | null }) =>
        entry.field === "UNIT" && entry.end_date === null,
    );
    expect(unitEntry.start_date).toBe(effectiveDate);
  });

  it("should set a per-employee contract_end_date via contract_end_date_overrides when bulk-setting a non-PERMANENT employment type", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employeeA = await createEmployee(
      accessToken,
      "951",
      "test_bulk_update_contract_a@millennia21.id",
    );
    const employeeB = await createEmployee(
      accessToken,
      "952",
      "test_bulk_update_contract_b@millennia21.id",
    );

    const endDateA = new Date("2026-09-01").toISOString();
    const endDateB = new Date("2026-10-01").toISOString();
    const response = await TestRequest.patch(
      "/api/admin/employees/bulk/update",
      {
        ids: [employeeA.id, employeeB.id],
        employment_type: EmploymentType.CONTRACT,
        contract_end_date_overrides: [
          { id: employeeA.id, contract_end_date: endDateA },
          { id: employeeB.id, contract_end_date: endDateB },
        ],
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.success_count).toBe(2);

    const getA = await (
      await TestRequest.get(`/api/admin/employees/${employeeA.id}`, accessToken)
    ).json();
    expect(getA.data.status_info.employment_type).toBe(EmploymentType.CONTRACT);
    expect(getA.data.status_info.contract_end_date).toBe(endDateA);

    const getB = await (
      await TestRequest.get(`/api/admin/employees/${employeeB.id}`, accessToken)
    ).json();
    expect(getB.data.status_info.contract_end_date).toBe(endDateB);
  });

  it("should clear an existing contract_end_date when bulk-setting employment type to PERMANENT", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(
      accessToken,
      "953",
      "test_bulk_update_permanent_clear@millennia21.id",
      {
        employment_type: EmploymentType.CONTRACT,
        contract_end_date: new Date("2026-12-01").toISOString(),
      },
    );

    const response = await TestRequest.patch(
      "/api/admin/employees/bulk/update",
      { ids: [employee.id], employment_type: EmploymentType.PERMANENT },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.success_count).toBe(1);
    expect(body.data.failed_count).toBe(0);

    const getResponse = await TestRequest.get(
      `/api/admin/employees/${employee.id}`,
      accessToken,
    );
    const getBody = await getResponse.json();
    expect(getBody.data.status_info.employment_type).toBe(EmploymentType.PERMANENT);
    expect(getBody.data.status_info.contract_end_date).toBeNull();
  });

  it("should set status to RESIGNED with a per-employee last_working_date_overrides", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(
      accessToken,
      "954",
      "test_bulk_update_resign_override@millennia21.id",
    );

    const lastWorkingDate = new Date("2020-01-15").toISOString();
    const response = await TestRequest.patch(
      "/api/admin/employees/bulk/update",
      {
        ids: [employee.id],
        status: EmployeeStatus.RESIGNED,
        last_working_date_overrides: [
          { id: employee.id, last_working_date: lastWorkingDate },
        ],
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.success_count).toBe(1);

    const getResponse = await TestRequest.get(
      `/api/admin/employees/${employee.id}`,
      accessToken,
    );
    const getBody = await getResponse.json();
    expect(getBody.data.status_info.status).toBe(EmployeeStatus.RESIGNED);
    expect(getBody.data.offboarding.last_working_date).toBe(lastWorkingDate);
  });

  it("should fail employees left without a last_working_date when bulk-setting status to RESIGNED, without aborting the rest of the batch", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const withOverride = await createEmployee(
      accessToken,
      "955",
      "test_bulk_resign_with_ovr@millennia21.id",
    );
    const withoutOverride = await createEmployee(
      accessToken,
      "956",
      "test_bulk_resign_no_ovr@millennia21.id",
    );

    const response = await TestRequest.patch(
      "/api/admin/employees/bulk/update",
      {
        ids: [withOverride.id, withoutOverride.id],
        status: EmployeeStatus.RESIGNED,
        last_working_date_overrides: [
          {
            id: withOverride.id,
            last_working_date: new Date("2020-01-15").toISOString(),
          },
        ],
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.success_count).toBe(1);
    expect(body.data.failed_count).toBe(1);
    const failedItem = body.data.items.find(
      (item: { id: string }) => item.id === withoutOverride.id,
    );
    expect(failedItem.status).toBe("FAILED");
  });

  it("should reject (400) when no field to update is provided", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(
      accessToken,
      "957",
      "test_bulk_update_no_field@millennia21.id",
    );

    const response = await TestRequest.patch(
      "/api/admin/employees/bulk/update",
      { ids: [employee.id] },
      accessToken,
    );

    expect(response.status).toBe(400);
  });
});

describe("Employee education fields seed Master Data > Institutions/Majors", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await prismaClient.masterInstitution.deleteMany({
      where: { name: { startsWith: "TEST_" } },
    });
    await prismaClient.masterMajor.deleteMany({
      where: { name: { startsWith: "TEST_" } },
    });
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await prismaClient.masterInstitution.deleteMany({
      where: { name: { startsWith: "TEST_" } },
    });
    await prismaClient.masterMajor.deleteMany({
      where: { name: { startsWith: "TEST_" } },
    });
    await MasterDataTest.delete();
  });

  it("should create a MasterInstitution/MasterMajor entry when a new employee is created with a new institution_name/major", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.post(
      "/api/admin/employees",
      {
        full_name: "Test Employee Education Seed",
        nick_name: "Emp Edu",
        email: "test_employee_education_seed@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("1995-01-01").toISOString(),
        employee_id: "99.99.960",
        marital_status: MaritalStatus.SINGLE,
        status: EmployeeStatus.ACTIVE,
        employment_type: EmploymentType.PERMANENT,
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        job_level_id: masterData.level.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-01-01").toISOString(),
        institution_name: "TEST_Universitas Baru",
        major: "TEST_Computer Science",
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);

    const institution = await prismaClient.masterInstitution.findUnique({
      where: { name: "TEST_Universitas Baru" },
    });
    expect(institution).not.toBeNull();

    const major = await prismaClient.masterMajor.findUnique({
      where: { name: "TEST_Computer Science" },
    });
    expect(major).not.toBeNull();
  });

  it("should not fail or duplicate when the same institution_name is reused by a second employee", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    await prismaClient.masterInstitution.create({
      data: { name: "TEST_Universitas Existing" },
    });

    const response = await TestRequest.post(
      "/api/admin/employees",
      {
        full_name: "Test Employee Education Reuse",
        nick_name: "Emp Edu",
        email: "test_employee_education_reuse@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("1995-01-01").toISOString(),
        employee_id: "99.99.961",
        marital_status: MaritalStatus.SINGLE,
        status: EmployeeStatus.ACTIVE,
        employment_type: EmploymentType.PERMANENT,
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        job_level_id: masterData.level.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-01-01").toISOString(),
        institution_name: "TEST_Universitas Existing",
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);

    const institutions = await prismaClient.masterInstitution.findMany({
      where: { name: "TEST_Universitas Existing" },
    });
    expect(institutions.length).toBe(1);
  });
});

describe("EmployeeService.autoResignPastDueEmployees", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  async function createEmployee(
    employeeIdSuffix: string,
    email: string,
    overrides: Record<string, unknown> = {},
  ) {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const response = await TestRequest.post(
      "/api/admin/employees",
      {
        full_name: "Test Employee Sweep",
        nick_name: "Emp Sweep",
        email,
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("1995-01-01").toISOString(),
        employee_id: `99.99.${employeeIdSuffix}`,
        marital_status: MaritalStatus.SINGLE,
        status: EmployeeStatus.ACTIVE,
        employment_type: EmploymentType.PERMANENT,
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        job_level_id: masterData.level.id,
        building_id: masterData.building.id,
        join_date: new Date("2020-01-01").toISOString(),
        ...overrides,
      },
      accessToken,
    );
    const body = await response.json();
    return body.data;
  }

  it("should flip ACTIVE employees whose last_working_date has passed to RESIGNED, with a SYSTEM audit entry", async () => {
    const employee = await createEmployee(
      "910",
      "test_sweep_due@millennia21.id",
    );
    // Backdate directly via prisma, bypassing the service layer - create()
    // already auto-resigns a backdated date at write time (tested
    // separately), this simulates the date passing on its own afterward
    // with nobody touching the record.
    await prismaClient.employee.update({
      where: { id: employee.id },
      data: { last_working_date: new Date("2020-06-01") },
    });

    const count = await EmployeeService.autoResignPastDueEmployees();

    expect(count).toBeGreaterThanOrEqual(1);

    const updated = await prismaClient.employee.findUniqueOrThrow({
      where: { id: employee.id },
    });
    expect(updated.status).toBe(EmployeeStatus.RESIGNED);

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: {
        entity_id: employee.id,
        action: AuditAction.AUTO_RESIGN_EMPLOYEE,
      },
    });
    expect(auditLog.source).toBe(AuditSource.SYSTEM);
    expect(auditLog.admin_id).toBeNull();
  });

  it("should not touch employees whose last_working_date is in the future", async () => {
    const employee = await createEmployee(
      "911",
      "test_sweep_not_due@millennia21.id",
    );
    await prismaClient.employee.update({
      where: { id: employee.id },
      data: { last_working_date: new Date("2099-01-01") },
    });

    await EmployeeService.autoResignPastDueEmployees();

    const updated = await prismaClient.employee.findUniqueOrThrow({
      where: { id: employee.id },
    });
    expect(updated.status).toBe(EmployeeStatus.ACTIVE);
  });

  it("should not touch ARCHIVED employees even if last_working_date has passed", async () => {
    const employee = await createEmployee(
      "912",
      "test_sweep_archived@millennia21.id",
    );
    await prismaClient.employee.update({
      where: { id: employee.id },
      data: {
        last_working_date: new Date("2020-06-01"),
        status: EmployeeStatus.ARCHIVED,
      },
    });

    await EmployeeService.autoResignPastDueEmployees();

    const updated = await prismaClient.employee.findUniqueOrThrow({
      where: { id: employee.id },
    });
    expect(updated.status).toBe(EmployeeStatus.ARCHIVED);
  });

  it("should not touch employees who are already RESIGNED", async () => {
    const employee = await createEmployee(
      "913",
      "test_sweep_already_resigned@millennia21.id",
    );
    const lastWorkingDate = new Date("2020-06-01");
    await prismaClient.employee.update({
      where: { id: employee.id },
      data: { last_working_date: lastWorkingDate, status: EmployeeStatus.RESIGNED },
    });
    await AuditLogTest.delete();

    await EmployeeService.autoResignPastDueEmployees();

    const auditLog = await prismaClient.auditLog.findFirst({
      where: {
        entity_id: employee.id,
        action: AuditAction.AUTO_RESIGN_EMPLOYEE,
      },
    });
    expect(auditLog).toBeNull();
  });
});

describe("GET /api/admin/employees/education-suggestions", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  it("should return distinct, deduplicated institution names and majors", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const baseBody = {
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building_id: masterData.building.id,
      join_date: new Date("2020-01-01").toISOString(),
    };

    await TestRequest.post(
      "/api/admin/employees",
      {
        ...baseBody,
        full_name: "Suggestion One",
        nick_name: "S1",
        email: "test_edu_suggest_1@millennia21.id",
        employee_id: "99.99.930",
        institution_name: "Universitas Indonesia",
        major: "Computer Science",
      },
      accessToken,
    );
    await TestRequest.post(
      "/api/admin/employees",
      {
        ...baseBody,
        full_name: "Suggestion Two",
        nick_name: "S2",
        email: "test_edu_suggest_2@millennia21.id",
        employee_id: "99.99.931",
        // Same institution, different major - institution should dedupe.
        institution_name: "Universitas Indonesia",
        major: "Information Systems",
      },
      accessToken,
    );

    const response = await TestRequest.get(
      "/api/admin/employees/education-suggestions",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.institution_names).toEqual(["Universitas Indonesia"]);
    expect(body.data.majors.sort()).toEqual(
      ["Computer Science", "Information Systems"].sort(),
    );
  });

  it("should reject if no access token provided", async () => {
    const response = await TestRequest.get(
      "/api/admin/employees/education-suggestions",
    );

    expect(response.status).toBe(401);
  });
});
