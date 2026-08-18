import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  EmployeeTest,
  MasterDataTest,
  ClassTest,
  StudentTest,
  AuditLogTest,
} from "./test-utils";
import {
  AuditAction,
  EmployeeStatus,
  EmploymentType,
  Gender,
  MaritalStatus,
  Religion,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

describe("Employee Mutation History", () => {
  let employeeId: string;
  let masterData: Awaited<ReturnType<typeof MasterDataTest.create>>;
  let secondUnitId: string;
  // Reused across a test's body instead of calling AdminUserTest.
  // createSuperAdmin() again - it uses a fixed id ("test-super-admin-id")
  // with a plain create(), so a second call within the same test collides.
  let superAdminToken: string;

  async function cleanup() {
    await AuditLogTest.delete();
    await ClassTest.delete();
    await EmployeeTest.delete();
    await AdminUserTest.delete();
    await prismaClient.masterUnit.deleteMany({ where: { id: "emp_hist_unit_2" } });
    await MasterDataTest.delete();
  }

  beforeEach(async () => {
    await cleanup();
    masterData = await MasterDataTest.create();
    const unit2 = await prismaClient.masterUnit.create({
      data: { id: "emp_hist_unit_2", name: "Second Unit" },
    });
    secondUnitId = unit2.id;

    const requestBody = {
      full_name: "Test Employee History",
      nick_name: "Emp History",
      email: "test_emp_history@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("1995-01-01").toISOString(),
      employee_id: "99.99.500",
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      job_level_id: masterData.level.id,
      building_id: masterData.building.id,
      join_date: new Date("2026-01-01").toISOString(),
    };
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    superAdminToken = accessToken;
    const response = await TestRequest.post(
      "/api/admin/employees",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    employeeId = body.data.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should seed one baseline history row per tracked field on create", async () => {
    const rows = await prismaClient.employeeMutationHistory.findMany({
      where: { employee_id: employeeId },
    });

    expect(rows.length).toBe(6);
    const fields = rows.map((r) => r.field as string).sort();
    expect(fields).toEqual(
      [
        "BUILDING",
        "EMPLOYMENT_TYPE",
        "JOB_LEVEL",
        "JOB_POSITION",
        "STATUS",
        "UNIT",
      ].sort(),
    );
    for (const row of rows) {
      expect(row.end_date).toBeNull();
      expect(row.previous_history_id).toBeNull();
    }
  });

  it("should create a new history row and close the previous one when status changes", async () => {
    const accessToken = superAdminToken;

    const response = await TestRequest.patch(
      `/api/admin/employees/${employeeId}`,
      { status: EmployeeStatus.ON_LEAVE },
      accessToken,
    );
    expect(response.status).toBe(200);

    const statusRows = await prismaClient.employeeMutationHistory.findMany({
      where: { employee_id: employeeId, field: "STATUS" },
      orderBy: { created_at: "asc" },
    });

    expect(statusRows.length).toBe(2);
    expect(statusRows[0].status).toBe(EmployeeStatus.ACTIVE);
    expect(statusRows[0].end_date).not.toBeNull();
    expect(statusRows[1].status).toBe(EmployeeStatus.ON_LEAVE);
    expect(statusRows[1].end_date).toBeNull();
    expect(statusRows[1].previous_history_id).toBe(statusRows[0].id);

    // Unrelated fields shouldn't grow a second row.
    const unitRows = await prismaClient.employeeMutationHistory.findMany({
      where: { employee_id: employeeId, field: "UNIT" },
    });
    expect(unitRows.length).toBe(1);
  });

  it("should create two separate rows when two fields change in the same update() call", async () => {
    const accessToken = superAdminToken;

    const response = await TestRequest.patch(
      `/api/admin/employees/${employeeId}`,
      { unit_id: secondUnitId, status: EmployeeStatus.ON_LEAVE },
      accessToken,
    );
    expect(response.status).toBe(200);

    const unitRows = await prismaClient.employeeMutationHistory.findMany({
      where: { employee_id: employeeId, field: "UNIT" },
    });
    const statusRows = await prismaClient.employeeMutationHistory.findMany({
      where: { employee_id: employeeId, field: "STATUS" },
    });

    expect(unitRows.length).toBe(2);
    expect(statusRows.length).toBe(2);
  });

  describe("GET /api/admin/employees/:id/mutation-history", () => {
    it("should list history with can_rollback true only on the current, non-baseline row", async () => {
      const accessToken = superAdminToken;
      await TestRequest.patch(
        `/api/admin/employees/${employeeId}`,
        { status: EmployeeStatus.ON_LEAVE },
        accessToken,
      );

      const response = await TestRequest.get(
        `/api/admin/employees/${employeeId}/mutation-history`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      const statusEntries = body.data.filter(
        (e: { field: string }) => e.field === "STATUS",
      );
      expect(statusEntries.length).toBe(2);
      const current = statusEntries.find((e: { end_date: null }) => e.end_date === null);
      const closed = statusEntries.find((e: { end_date: null }) => e.end_date !== null);
      expect(current.can_rollback).toBe(true);
      expect(current.value).toBe("ON_LEAVE");
      expect(closed.can_rollback).toBe(false);

      const unitEntry = body.data.find(
        (e: { field: string }) => e.field === "UNIT",
      );
      expect(unitEntry.can_rollback).toBe(false); // baseline row, no previous
    });

    it("should reject (401) with no access token", async () => {
      const response = await TestRequest.get(
        `/api/admin/employees/${employeeId}/mutation-history`,
      );
      expect(response.status).toBe(401);
    });
  });

  describe("PATCH /api/admin/employees/:id/mutation-history/:historyId/rollback", () => {
    it("should restore the previous value on the live employee record and audit it", async () => {
      const accessToken = superAdminToken;
      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      await TestRequest.patch(
        `/api/admin/employees/${employeeId}`,
        { status: EmployeeStatus.ON_LEAVE },
        accessToken,
      );

      const currentRow = await prismaClient.employeeMutationHistory.findFirstOrThrow(
        {
          where: { employee_id: employeeId, field: "STATUS", end_date: null },
        },
      );

      const response = await TestRequest.patch(
        `/api/admin/employees/${employeeId}/mutation-history/${currentRow.id}/rollback`,
        {},
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data).toBe(true);

      const employee = await prismaClient.employee.findUniqueOrThrow({
        where: { id: employeeId },
      });
      expect(employee.status).toBe(EmployeeStatus.ACTIVE);

      const rolledBack = await prismaClient.employeeMutationHistory.findUnique({
        where: { id: currentRow.id },
      });
      expect(rolledBack?.deleted_at).not.toBeNull();

      const reactivated = await prismaClient.employeeMutationHistory.findFirst({
        where: { employee_id: employeeId, field: "STATUS", deleted_at: null },
      });
      expect(reactivated?.status).toBe(EmployeeStatus.ACTIVE);
      expect(reactivated?.end_date).toBeNull();

      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: {
          action: AuditAction.ROLLBACK_EMPLOYEE_MUTATION,
          admin_id: admin.id,
        },
      });
      expect(auditLog.entity_type).toBe("Employee");
      expect(auditLog.entity_id).toBe(employeeId);
    });

    it("should reject (400) rolling back a baseline row with no previous_history_id", async () => {
      const accessToken = superAdminToken;
      const baselineRow = await prismaClient.employeeMutationHistory.findFirstOrThrow(
        { where: { employee_id: employeeId, field: "UNIT" } },
      );

      const response = await TestRequest.patch(
        `/api/admin/employees/${employeeId}/mutation-history/${baselineRow.id}/rollback`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) rolling back an already-closed (non-current) row", async () => {
      const accessToken = superAdminToken;
      await TestRequest.patch(
        `/api/admin/employees/${employeeId}`,
        { status: EmployeeStatus.ON_LEAVE },
        accessToken,
      );
      const closedRow = await prismaClient.employeeMutationHistory.findFirstOrThrow(
        {
          where: {
            employee_id: employeeId,
            field: "STATUS",
            end_date: { not: null },
          },
        },
      );

      const response = await TestRequest.patch(
        `/api/admin/employees/${employeeId}/mutation-history/${closedRow.id}/rollback`,
        {},
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();
      const currentRow = await prismaClient.employeeMutationHistory.findFirstOrThrow(
        { where: { employee_id: employeeId, field: "STATUS" } },
      );

      const response = await TestRequest.patch(
        `/api/admin/employees/${employeeId}/mutation-history/${currentRow.id}/rollback`,
        {},
        accessToken,
      );

      expect(response.status).toBe(403);
    });
  });

  describe("GET /api/admin/employees/:id/teaching-assignments", () => {
    it("should return empty for an employee with no class assignments", async () => {
      const accessToken = superAdminToken;

      const response = await TestRequest.get(
        `/api/admin/employees/${employeeId}/teaching-assignments`,
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual([]);
    });

    it("should list a class the employee is assigned to teach", async () => {
      const accessToken = superAdminToken;
      const gradeId = await StudentTest.resolveGradeId();
      const academicYearId = await StudentTest.resolveAcademicYearId();
      const klass = await ClassTest.createWithHomeroomTeacher({
        name: "TEST_Class_EmpHistory",
        gradeId,
        academicYearId,
        employeeId,
      });

      const response = await TestRequest.get(
        `/api/admin/employees/${employeeId}/teaching-assignments`,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].class.id).toBe(klass.id);
      expect(body.data[0].role).toBe("HOMEROOM");
    });

    it("should reject (404) for a nonexistent employee", async () => {
      const accessToken = superAdminToken;

      const response = await TestRequest.get(
        "/api/admin/employees/nonexistent-id/teaching-assignments",
        accessToken,
      );

      expect(response.status).toBe(404);
    });
  });

  describe("EMPLOYMENT_TYPE mutation tracking", () => {
    it("should seed an EMPLOYMENT_TYPE baseline row on create", async () => {
      const row = await prismaClient.employeeMutationHistory.findFirstOrThrow(
        { where: { employee_id: employeeId, field: "EMPLOYMENT_TYPE" } },
      );
      expect(row.employment_type).toBe(EmploymentType.PERMANENT);
      expect(row.previous_history_id).toBeNull();
    });

    it("should create a new row and close the previous one when employment_type changes", async () => {
      const accessToken = superAdminToken;

      const response = await TestRequest.patch(
        `/api/admin/employees/${employeeId}`,
        { employment_type: EmploymentType.CONTRACT },
        accessToken,
      );
      expect(response.status).toBe(200);

      const rows = await prismaClient.employeeMutationHistory.findMany({
        where: { employee_id: employeeId, field: "EMPLOYMENT_TYPE" },
        orderBy: { created_at: "asc" },
      });
      expect(rows.length).toBe(2);
      expect(rows[0].employment_type).toBe(EmploymentType.PERMANENT);
      expect(rows[0].end_date).not.toBeNull();
      expect(rows[1].employment_type).toBe(EmploymentType.CONTRACT);
      expect(rows[1].end_date).toBeNull();
    });
  });

  describe("effective_date backdating", () => {
    it("should use the given effective_date as start_date/end_date instead of now", async () => {
      const accessToken = superAdminToken;
      const backdate = "2026-02-01T00:00:00.000Z";

      const response = await TestRequest.patch(
        `/api/admin/employees/${employeeId}`,
        { status: EmployeeStatus.ON_LEAVE, effective_date: backdate },
        accessToken,
      );
      expect(response.status).toBe(200);

      const rows = await prismaClient.employeeMutationHistory.findMany({
        where: { employee_id: employeeId, field: "STATUS" },
        orderBy: { created_at: "asc" },
      });
      expect(rows[0].end_date?.toISOString()).toBe(backdate);
      expect(rows[1].start_date.toISOString()).toBe(backdate);
    });

    it("should reject (400) an effective_date in the future", async () => {
      const accessToken = superAdminToken;

      const response = await TestRequest.patch(
        `/api/admin/employees/${employeeId}`,
        {
          status: EmployeeStatus.ON_LEAVE,
          effective_date: "2099-01-01T00:00:00.000Z",
        },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) an effective_date before the current record's start_date", async () => {
      const accessToken = superAdminToken;

      const response = await TestRequest.patch(
        `/api/admin/employees/${employeeId}`,
        {
          status: EmployeeStatus.ON_LEAVE,
          effective_date: "2025-01-01T00:00:00.000Z",
        },
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("PERMANENT employees cannot have a contract end date", () => {
    it("should reject (400) creating a PERMANENT employee with a contract_end_date", async () => {
      const accessToken = superAdminToken;

      const response = await TestRequest.post(
        "/api/admin/employees",
        {
          full_name: "Test Permanent Contract",
          nick_name: "Perm Contract",
          email: "test_emp_permanent_contract@millennia21.id",
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
          contract_end_date: new Date("2027-01-01").toISOString(),
        },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) switching an employee to PERMANENT while a contract_end_date is still set", async () => {
      const accessToken = superAdminToken;
      await TestRequest.patch(
        `/api/admin/employees/${employeeId}`,
        {
          employment_type: EmploymentType.CONTRACT,
          contract_end_date: new Date("2027-01-01").toISOString(),
        },
        accessToken,
      );

      const response = await TestRequest.patch(
        `/api/admin/employees/${employeeId}`,
        { employment_type: EmploymentType.PERMANENT },
        accessToken,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/employees/:id/extend-contract", () => {
    it("should extend the contract end date and audit it", async () => {
      const accessToken = superAdminToken;
      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      await TestRequest.patch(
        `/api/admin/employees/${employeeId}`,
        {
          employment_type: EmploymentType.CONTRACT,
          contract_end_date: new Date("2027-01-01").toISOString(),
        },
        accessToken,
      );

      const response = await TestRequest.patch(
        `/api/admin/employees/${employeeId}/extend-contract`,
        { contract_end_date: new Date("2027-06-01").toISOString() },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.status_info.contract_end_date).toBe(
        new Date("2027-06-01").toISOString(),
      );

      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: {
          action: AuditAction.EXTEND_EMPLOYEE_CONTRACT,
          admin_id: admin.id,
        },
      });
      expect(auditLog.entity_type).toBe("Employee");
      expect(auditLog.entity_id).toBe(employeeId);
    });

    it("should reject (400) extending a PERMANENT employee's contract", async () => {
      const accessToken = superAdminToken;

      const response = await TestRequest.patch(
        `/api/admin/employees/${employeeId}/extend-contract`,
        { contract_end_date: new Date("2027-06-01").toISOString() },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) extending a RESIGNED employee's contract", async () => {
      const accessToken = superAdminToken;
      await TestRequest.patch(
        `/api/admin/employees/${employeeId}`,
        {
          employment_type: EmploymentType.CONTRACT,
          contract_end_date: new Date("2027-01-01").toISOString(),
        },
        accessToken,
      );
      await TestRequest.patch(
        `/api/admin/employees/${employeeId}`,
        {
          status: EmployeeStatus.RESIGNED,
          last_working_date: new Date("2026-06-01").toISOString(),
        },
        accessToken,
      );

      const response = await TestRequest.patch(
        `/api/admin/employees/${employeeId}/extend-contract`,
        { contract_end_date: new Date("2027-06-01").toISOString() },
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(400);
      expect(body.errors).toContain("resigned");
    });

    it("should reject (400) a new end date that isn't after the current one", async () => {
      const accessToken = superAdminToken;
      await TestRequest.patch(
        `/api/admin/employees/${employeeId}`,
        {
          employment_type: EmploymentType.CONTRACT,
          contract_end_date: new Date("2027-01-01").toISOString(),
        },
        accessToken,
      );

      const response = await TestRequest.patch(
        `/api/admin/employees/${employeeId}/extend-contract`,
        { contract_end_date: new Date("2026-06-01").toISOString() },
        accessToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();

      const response = await TestRequest.patch(
        `/api/admin/employees/${employeeId}/extend-contract`,
        { contract_end_date: new Date("2027-06-01").toISOString() },
        accessToken,
      );

      expect(response.status).toBe(403);
    });
  });
});
