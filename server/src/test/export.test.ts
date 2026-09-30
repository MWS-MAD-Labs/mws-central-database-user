import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  AuditLogTest,
  MasterDataTest,
  EmployeeTest,
  StudentTest,
  ClassTest,
  EnrollmentTest,
  InternTest,
} from "./test-utils";
import {
  AuditAction,
  EnrollmentStatus,
  StudentStatus,
  ClassTeacherRole,
} from "../generated/prisma/client";
import ExcelJS from "exceljs";
import { prismaClient } from "../lib/prisma";
import { logger } from "../lib/logger";

describe("GET /api/admin/students/export", () => {
  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EnrollmentTest.delete();
    // Class FKs to the grade/academic year that StudentTest.delete() itself
    // cleans up - must go before it, not after.
    await ClassTest.delete();
    await InternTest.delete();
    await EmployeeTest.delete();
    await StudentTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EnrollmentTest.delete();
    await ClassTest.delete();
    await InternTest.delete();
    await EmployeeTest.delete();
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
      "/api/admin/students/export?format=csv&export_mode=sensitive",
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

  it("includes Class Start Date for the student's current class enrollment", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const gradeId = await StudentTest.resolveGradeId();
    const academicYearId = await StudentTest.resolveAcademicYearId();
    const klass = await ClassTest.create({
      name: "TEST_Class_Export",
      gradeId,
      academicYearId,
    });
    const person = await StudentTest.create({
      email: "test_stu_export_class@millennia21.id",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
      currentClassId: klass.id,
    });
    await EnrollmentTest.create({
      studentId: person.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "TEST",
      classNameSnapshot: klass.name,
      startDate: new Date("2025-08-01"),
    });

    const response = await TestRequest.get(
      "/api/admin/students/export?format=csv&export_mode=sensitive",
      accessToken,
    );
    const csv = await response.text();
    const lines = csv.trim().split("\n");

    expect(lines[0]).toContain("Class Start Date");
    const dataLine = lines.find((line) =>
      line.includes("test_stu_export_class@millennia21.id"),
    );
    expect(dataLine).toContain("TEST_Class_Export");
    expect(dataLine).toContain("2025-08-01");
  });

  it("includes Class End Date and the last class for a WITHDRAWN student (current_class_id already null)", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const gradeId = await StudentTest.resolveGradeId();
    const academicYearId = await StudentTest.resolveAcademicYearId();
    const klass = await ClassTest.create({
      name: "TEST_Class_ExportWithdrawn",
      gradeId,
      academicYearId,
    });
    const person = await StudentTest.create({
      email: "test_stu_export_withdrawn@millennia21.id",
      currentGradeId: gradeId,
      joinAcademicYearId: academicYearId,
      status: StudentStatus.WITHDRAWN,
      // current_class_id intentionally left unset - mirrors what the
      // auto-close in StudentService.update() leaves behind.
    });
    await EnrollmentTest.create({
      studentId: person.student!.id,
      classId: klass.id,
      academicYearId,
      gradeLevel: "TEST",
      classNameSnapshot: klass.name,
      startDate: new Date("2025-08-01"),
      endDate: new Date("2026-03-15"),
      status: EnrollmentStatus.WITHDRAWN,
    });

    const response = await TestRequest.get(
      "/api/admin/students/export?format=csv&export_mode=sensitive",
      accessToken,
    );
    const csv = await response.text();
    const lines = csv.trim().split("\n");

    expect(lines[0]).toContain("Class End Date");
    const dataLine = lines.find((line) =>
      line.includes("test_stu_export_withdrawn@millennia21.id"),
    );
    expect(dataLine).toContain("TEST_Class_ExportWithdrawn");
    expect(dataLine).toContain("2025-08-01");
    expect(dataLine).toContain("2026-03-15");
  });

  it("should exclude sensitive columns for a DATABASE_ADMIN without can_view_sensitive_data", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      undefined,
      { canViewSensitiveData: false },
    );
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

  it("should include sensitive columns for a DATABASE_ADMIN with can_view_sensitive_data granted", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      undefined,
      { canViewSensitiveData: true },
    );
    await StudentTest.create({
      email: "test_stu_export_viewer_sensitive@millennia21.id",
    });

    const response = await TestRequest.get(
      "/api/admin/students/export?format=csv&export_mode=sensitive",
      accessToken,
    );
    const csv = await response.text();

    expect(csv.split("\n")[0]).toContain("Birth Date");
  });

  it("should reject (403) a VIEWER attempting to export students", async () => {
    const { accessToken } = await AdminUserTest.createViewer();

    const response = await TestRequest.get(
      "/api/admin/students/export?format=csv",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("write student data");
  });

  it("should reject (403) a DATABASE_ADMIN without can_write_student_data attempting to export students", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      undefined,
      { canWriteStudentData: false },
    );

    const response = await TestRequest.get(
      "/api/admin/students/export?format=csv",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("write student data");
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

  it("includes employee and intern teacher assignments in sensitive xlsx export", async () => {
    const [unit, position, level, building] = await Promise.all([
      prismaClient.masterUnit.findFirstOrThrow({ where: { name: { startsWith: "TEST_" } } }),
      prismaClient.masterJobPosition.findFirstOrThrow({ where: { name: { startsWith: "TEST_" } } }),
      prismaClient.masterJobLevel.findFirstOrThrow({ where: { name: { startsWith: "TEST_" } } }),
      prismaClient.masterBuilding.findFirstOrThrow({ where: { name: { startsWith: "TEST_" } } }),
    ]);
    const masterData = { unit, position, level, building };
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const academicYearId = await StudentTest.resolveAcademicYearId();
    const gradeId = await StudentTest.resolveGradeId();
    const klass = await ClassTest.create({
      name: "TEST_Export_Workforce_Assignments",
      gradeId,
      academicYearId,
    });
    const employee = await EmployeeTest.create({
      email: "test_export_workforce_employee@millennia21.id",
      employeeId: "99.99.EXPORT",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
    });
    const intern = await InternTest.create({
      email: "test_intern_export_workforce@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });
    await prismaClient.classTeacherAssignment.createMany({
      data: [
        {
          class_id: klass.id,
          employee_id: employee.employee!.id,
          role: ClassTeacherRole.SUBJECT_TEACHER,
          subject: "Math",
        },
        {
          class_id: klass.id,
          intern_id: intern.id,
          role: ClassTeacherRole.SUBJECT_TEACHER,
          subject: "Art",
        },
      ],
    });

    const response = await TestRequest.get(
      `/api/admin/students/export?format=xlsx&export_mode=sensitive&roster_academic_year_id=${academicYearId}`,
      accessToken,
    );
    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    const sheet = workbook.getWorksheet("TeacherAssignments");
    expect(sheet).toBeDefined();
    const rows = sheet!.getSheetValues().flat().filter(Boolean).map(String);
    expect(rows).toContain("EMPLOYEE");
    expect(rows).toContain("INTERN");
    expect(rows).toContain("99.99.EXPORT");
    expect(rows).toContain("test_intern_export_workforce@millennia21.id");
  });

  it("limits sensitive teacher assignments to DATABASE_ADMIN unit scope", async () => {
    const unit = await prismaClient.masterUnit.findFirstOrThrow({
      where: { name: { startsWith: "TEST_" } },
    });
    const otherUnit = await prismaClient.masterUnit.create({
      data: { name: `TEST_EXPORT_OTHER_UNIT_${Date.now()}` },
    });
    const academicYearId = await StudentTest.resolveAcademicYearId();
    const otherGrade = await prismaClient.grade.create({
      data: {
        name: `TEST_EXPORT_OTHER_GRADE_${Date.now()}`,
        level: 9500 + Math.floor(Math.random() * 100),
        unit_id: otherUnit.id,
      },
    });
    const otherClass = await ClassTest.create({
      name: `TEST_Export_Other_Unit_${Date.now()}`,
      gradeId: otherGrade.id,
      academicYearId,
    });
    const position = await prismaClient.masterJobPosition.findFirstOrThrow({
      where: { name: { startsWith: "TEST_" } },
    });
    const building = await prismaClient.masterBuilding.findFirstOrThrow({
      where: { name: { startsWith: "TEST_" } },
    });
    const intern = await InternTest.create({
      email: "test_intern_export_out_of_scope@millennia21.id",
      unitId: otherUnit.id,
      jobPositionId: position.id,
      buildingId: building.id,
    });
    await prismaClient.classTeacherAssignment.create({
      data: {
        class_id: otherClass.id,
        intern_id: intern.id,
        role: ClassTeacherRole.SUBJECT_TEACHER,
        subject: "Hidden Art",
      },
    });
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(unit.id, {
      canViewSensitiveData: true,
    });

    const response = await TestRequest.get(
      `/api/admin/students/export?format=xlsx&export_mode=sensitive&roster_academic_year_id=${academicYearId}`,
      accessToken,
    );
    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    const rows = workbook
      .getWorksheet("TeacherAssignments")!
      .getSheetValues()
      .flat()
      .filter(Boolean)
      .map(String);
    expect(rows).not.toContain("test_intern_export_out_of_scope@millennia21.id");
    expect(rows).not.toContain("Hidden Art");
  });

  it("should record an EXPORT_DATA audit log entry", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await StudentTest.create({ email: "test_stu_export_audit@millennia21.id" });

    await TestRequest.get("/api/admin/students/export?format=csv&export_mode=sensitive", accessToken);

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
      // Scope the export to employees created by this test.
      "/api/admin/employees/export?format=csv&search=test_emp_export&export_mode=sensitive",
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

  it("should include Contract End Date and Last Working Date columns", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    await prismaClient.employee.update({
      where: { employee_id: "99.99.301" },
      data: {
        employment_type: "CONTRACT",
        contract_end_date: new Date("2030-06-30T00:00:00.000Z"),
      },
    });

    const response = await TestRequest.get(
      "/api/admin/employees/export?format=csv&search=test_emp_export&export_mode=sensitive",
      accessToken,
    );
    expect(response.status).toBe(200);

    const csv = await response.text();
    const lines = csv.trim().split("\n");

    expect(lines[0]).toContain("Contract End Date");
    expect(lines[0]).toContain("Last Working Date");
    expect(csv).toContain("2030-06-30");
  });

  it("should include BPJS Ketenagakerjaan Number and KPJ Number columns with values", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    await prismaClient.employee.update({
      where: { employee_id: "99.99.301" },
      data: {
        bpjs_employment_number: "12345678901",
        kpj_number: "AB12345678C",
      },
    });

    const response = await TestRequest.get(
      "/api/admin/employees/export?format=csv&search=test_emp_export&export_mode=sensitive",
      accessToken,
    );
    expect(response.status).toBe(200);

    const csv = await response.text();
    const lines = csv.trim().split("\n");

    expect(lines[0]).toContain("BPJS Ketenagakerjaan Number");
    expect(lines[0]).toContain("KPJ Number");
    expect(csv).toContain("12345678901");
    expect(csv).toContain("AB12345678C");
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

  it("should let a DATABASE_ADMIN with can_write_employee_data export employees without sensitive columns", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();

    const response = await TestRequest.get(
      "/api/admin/employees/export?format=csv",
      accessToken,
    );
    expect(response.status).toBe(200);

    const csv = await response.text();
    expect(csv.split("\n")[0]).not.toContain("NIK");
  });

  it("should reject (403) a VIEWER attempting to export employees", async () => {
    const { accessToken } = await AdminUserTest.createViewer();

    const response = await TestRequest.get(
      "/api/admin/employees/export?format=csv",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("write employee data");
  });

  it("should reject (403) a DATABASE_ADMIN without can_write_employee_data attempting to export employees", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      undefined,
      { canWriteEmployeeData: false },
    );

    const response = await TestRequest.get(
      "/api/admin/employees/export?format=csv",
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(403);
    expect(body.errors).toContain("write employee data");
  });

  it("should record an EXPORT_DATA audit log entry", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    await TestRequest.get(
      // same scoping as above - keeps row_count deterministic regardless of
      // any other real employee data already sitting in the database.
      "/api/admin/employees/export?format=csv&search=test_emp_export&export_mode=sensitive",
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
