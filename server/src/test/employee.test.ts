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
  EmployeeStatus,
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
    expect(body.data.email).toBe("test_emp_1@millennia21.id");
    expect(body.data.employee_id).toBe("99.99.001");
    expect(body.data.unit).toBe("TEST_UNIT_SHIELD");
    expect(body.data.job_position).toBe("TEST_POS_TEACHER");
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
    expect(body.data.full_name).toBe("Test Employee Two");
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

  it("should reject creation (403) for DATABASE_ADMIN if can_create_data is false", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );

    await prismaClient.adminUser.updateMany({
      where: { role: "DATABASE_ADMIN" },
      data: { can_create_data: false },
    });

    const requestBody = {
      full_name: "No Permission Emp",
      email: "test_emp_noperm@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date().toISOString(),
      employee_id: "99.99.003",
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
});

describe("PATCH /api/admin/employees/:id", () => {
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
    expect(body.data.full_name).toBe("Updated Employee Name");
    expect(body.data.building).toBe("North Wing");
    expect(body.data.status).toBe("INACTIVE");
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
      assigned_class: "Class 10A",
    };

    const response = await TestRequest.patch(
      `/api/admin/employees/${targetEmployee.id}`,
      updatePayload,
      accessToken,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.employment_type).toBe(EmploymentType.CONTRACT);
    expect(body.data.assigned_class).toBe("Class 10A");
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
    expect(body.data.full_name).toBe("Name Changed");
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
});
