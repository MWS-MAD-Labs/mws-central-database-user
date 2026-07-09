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
    expect(body.data.identity.email).toBe("test_emp_1@millennia21.id");
    expect(body.data.employment.employee_id).toBe("99.99.001");
    expect(body.data.employment.unit).toBe("TEST_UNIT_SHIELD");
    expect(body.data.employment.job_position).toBe("TEST_POS_TEACHER");
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
    expect(body.data.identity.full_name).toBe("Updated Employee Name");
    expect(body.data.employment.building).toBe("North Wing");
    expect(body.data.status_info.status).toBe("INACTIVE");
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
    expect(body.data.status_info.employment_type).toBe(EmploymentType.CONTRACT);
    expect(body.data.employment.assigned_class).toBe("Class 10A");
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

  it("should successfully return pageable data for SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await populateDummyEmployees(accessToken);

    const response = await TestRequest.get(
      "/api/admin/employees?page=1&size=10",
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
});

describe("PATCH /api/admin/employees/delete/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await EmployeeTest.delete();

    await prismaClient.masterUnit.deleteMany({ where: { id: "unit_2_test" } });
    await MasterDataTest.delete();

    masterData = await MasterDataTest.create();
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
    await AdminUserTest.delete();
    await EmployeeTest.delete();

    await prismaClient.masterUnit.deleteMany({ where: { id: "unit_2_test" } });
    await MasterDataTest.delete();

    masterData = await MasterDataTest.create();
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
