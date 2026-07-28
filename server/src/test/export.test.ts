import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  AuditLogTest,
  MasterDataTest,
  EmployeeTest,
  StudentTest,
} from "./test-utils";
import { AuditAction, StudentStatus } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { logger } from "../lib/logger";

describe("GET /api/admin/students/export", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
  });

  it("should reject an unauthenticated request with 401", async () => {
    const response = await TestRequest.get(
      "/api/admin/students/export?format=csv",
    );
    expect(response.status).toBe(401);
  });

  it("should reject an unsupported format with 400", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      "/api/admin/students/export?format=pdf",
      accessToken,
    );
    expect(response.status).toBe(400);
  });

  it("should export students as CSV with sensitive columns for SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await StudentTest.create({ email: "test_stu_export1@millennia21.id" });
    await StudentTest.create({ email: "test_stu_export2@millennia21.id" });

    const response = await TestRequest.get(
      "/api/admin/students/export?format=csv",
      accessToken,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv");
    expect(response.headers.get("content-disposition")).toContain(
      "attachment; filename=",
    );

    const csv = await response.text();
    const lines = csv.trim().split("\n");
    logger.debug({ csv });

    expect(lines[0]).toContain("Birth Date");
    expect(lines[0]).toContain("Graduation Grade");
    expect(lines.length).toBe(3); // header + 2 students
    expect(csv).toContain("test_stu_export1@millennia21.id");
    expect(csv).toContain("test_stu_export2@millennia21.id");
  });

  it("should exclude sensitive columns for a VIEWER without can_view_sensitive_data", async () => {
    const { accessToken } = await AdminUserTest.createViewer();
    await StudentTest.create({
      email: "test_stu_export_viewer@millennia21.id",
    });

    const response = await TestRequest.get(
      "/api/admin/students/export?format=csv",
      accessToken,
    );
    expect(response.status).toBe(200);

    const csv = await response.text();
    const lines = csv.trim().split("\n");

    expect(lines[0]).not.toContain("Birth Date");
    expect(lines[0]).not.toContain("Birth Place");
    expect(lines[0]).not.toContain("Photo URL");

    expect(lines.length).toBe(2);
  });

  it("should include sensitive columns for a VIEWER with can_view_sensitive_data granted", async () => {
    const { accessToken } = await AdminUserTest.createViewer(undefined, {
      canViewSensitiveData: true,
    });
    await StudentTest.create({
      email: "test_stu_export_viewer_sensitive@millennia21.id",
    });

    const response = await TestRequest.get(
      "/api/admin/students/export?format=csv",
      accessToken,
    );
    const csv = await response.text();

    expect(csv.split("\n")[0]).toContain("Birth Date");
  });

  it("should filter by status", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await StudentTest.create({
      email: "test_stu_export_active@millennia21.id",
      status: StudentStatus.ACTIVE,
    });
    await StudentTest.create({
      email: "test_stu_export_graduated@millennia21.id",
      status: StudentStatus.GRADUATED,
    });

    const response = await TestRequest.get(
      "/api/admin/students/export?format=csv&status=GRADUATED",
      accessToken,
    );
    const csv = await response.text();
    const lines = csv.trim().split("\n");

    expect(lines.length).toBe(2); // header + 1 graduated student
    expect(csv).toContain("test_stu_export_graduated@millennia21.id");
    expect(csv).not.toContain("test_stu_export_active@millennia21.id");
  });

  it("should generate a valid xlsx buffer", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await StudentTest.create({ email: "test_stu_export_xlsx@millennia21.id" });

    const response = await TestRequest.get(
      "/api/admin/students/export?format=xlsx",
      accessToken,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    const bytes = new Uint8Array(await response.arrayBuffer());
    // xlsx is a zip archive - "PK" magic bytes.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("should record an EXPORT_DATA audit log entry", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await StudentTest.create({ email: "test_stu_export_audit@millennia21.id" });

    await TestRequest.get("/api/admin/students/export?format=csv", accessToken);

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AuditAction.EXPORT_DATA, admin_id: admin.id },
    });
    logger.debug(auditLog);

    expect(auditLog.entity_id).toBeNull();
    expect(auditLog.new_values).toMatchObject({
      entity: "Student",
      format: "csv",
      row_count: 1,
      included_sensitive_data: true,
    });
  });
});

describe("GET /api/admin/employees/export", () => {
  let secondUnitId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await prismaClient.masterUnit.deleteMany({
      where: { id: "unit_2_export_test" },
    });
    await MasterDataTest.delete();

    const masterData = await MasterDataTest.create();
    const unit2 = await prismaClient.masterUnit.create({
      data: { id: "unit_2_export_test", name: "Second Export Unit" },
    });
    secondUnitId = unit2.id;

    await EmployeeTest.create({
      email: "test_emp_export_unit1@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
      employeeId: "99.99.301",
    });
    await EmployeeTest.create({
      email: "test_emp_export_unit2@millennia21.id",
      unitId: secondUnitId,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
      employeeId: "99.99.302",
    });
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await prismaClient.masterUnit.deleteMany({
      where: { id: "unit_2_export_test" },
    });
    await MasterDataTest.delete();
  });

  it("should let SUPER_ADMIN export employees across all units with sensitive columns", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.get(
      // search scopes the export to just the 2 employees this test created -
      // without it, SUPER_ADMIN exports span every unit, so any other real
      // employee already in the database would inflate the row count.
      "/api/admin/employees/export?format=csv&search=test_emp_export",
      accessToken,
    );
    expect(response.status).toBe(200);

    const csv = await response.text();
    const lines = csv.trim().split("\n");

    expect(lines[0]).toContain("NIK");
    expect(lines[0]).toContain("Marital Status");
    expect(lines.length).toBe(3); // header + 2 employees, both units
    expect(csv).toContain("test_emp_export_unit1@millennia21.id");
    expect(csv).toContain("test_emp_export_unit2@millennia21.id");
  });

  it("should scope DATABASE_ADMIN export to their own unit and hide sensitive columns", async () => {
    const masterData = await prismaClient.masterUnit.findFirstOrThrow({
      where: { name: { startsWith: "TEST_" } },
    });
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.id,
    );

    const response = await TestRequest.get(
      "/api/admin/employees/export?format=csv",
      accessToken,
    );
    const csv = await response.text();
    const lines = csv.trim().split("\n");

    expect(lines[0]).not.toContain("NIK");
    expect(lines.length).toBe(2); // header + only own-unit employee
    expect(csv).toContain("test_emp_export_unit1@millennia21.id");
    expect(csv).not.toContain("test_emp_export_unit2@millennia21.id");
  });

  it("should let VIEWER export employees without sensitive columns", async () => {
    const { accessToken } = await AdminUserTest.createViewer();

    const response = await TestRequest.get(
      "/api/admin/employees/export?format=csv",
      accessToken,
    );
    expect(response.status).toBe(200);

    const csv = await response.text();
    expect(csv.split("\n")[0]).not.toContain("NIK");
  });

  it("should record an EXPORT_DATA audit log entry", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    await TestRequest.get(
      // same scoping as above - keeps row_count deterministic regardless of
      // any other real employee data already sitting in the database.
      "/api/admin/employees/export?format=csv&search=test_emp_export",
      accessToken,
    );

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AuditAction.EXPORT_DATA, admin_id: admin.id },
    });
    logger.debug(auditLog);

    expect(auditLog.new_values).toMatchObject({
      entity: "Employee",
      format: "csv",
      row_count: 2,
      included_sensitive_data: true,
    });
  });
});
