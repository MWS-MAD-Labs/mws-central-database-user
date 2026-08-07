import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import ExcelJS from "exceljs";
import {
  TestRequest,
  AdminUserTest,
  AuditLogTest,
  MasterDataTest,
  EmployeeTest,
} from "./test-utils";
import { AuditAction, ImportStatus } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { logger } from "../lib/logger";
import { web } from "../application/web";
import type { PreviewEmployeeImportResponse } from "../model/import-model";

let UNIT_NAME: string;
let POSITION_NAME: string;
let LEVEL_NAME: string;
let BUILDING_NAME: string;

const HEADERS = [
  "Employee ID",
  "Full Name",
  "Nick",
  "Email",
  "Gender",
  "Religion",
  "Birth Place",
  "Birth Date",
  "Unit",
  "Job Position",
  "Job Level",
  "Building",
  "Join Date",
  "Employment Type",
  "Marital Status",
  "Status",
];

function csvFile(
  headers: string[],
  rows: string[][],
  name = "TEST_IMPORT_employees.csv",
): File {
  const csv = [headers, ...rows]
    .map((row) => row.join(","))
    .join("\n");
  return new File([csv], name, { type: "text/csv" });
}

function row(employeeId: string, email: string, overrides: Partial<Record<string, string>> = {}): string[] {
  const base: Record<string, string> = {
    "Employee ID": employeeId,
    "Full Name": "Budi Guru",
    Nick: "Budi",
    Email: email,
    Gender: "MALE",
    Religion: "ISLAM",
    "Birth Place": "Jakarta",
    "Birth Date": "1985-01-01",
    Unit: UNIT_NAME,
    "Job Position": POSITION_NAME,
    "Job Level": LEVEL_NAME,
    Building: BUILDING_NAME,
    "Join Date": "2020-01-01",
    "Employment Type": "PERMANENT",
    "Marital Status": "MARRIED",
    Status: "",
    ...overrides,
  };
  return HEADERS.map((h) => base[h] ?? "");
}

async function xlsxFile(
  sheets: Array<{ name: string; headers: string[]; rows: string[][] }>,
  name = "TEST_IMPORT_employees.xlsx",
): Promise<File> {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    worksheet.addRow(sheet.headers);
    for (const row of sheet.rows) worksheet.addRow(row);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new File([buffer], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function previewFile(
  accessToken: string,
  rows: string[][],
): Promise<{ data: PreviewEmployeeImportResponse }> {
  const file = csvFile(HEADERS, rows);
  const formData = new FormData();
  formData.append("file", file);
  const response = await TestRequest.postMultipart(
    "/api/admin/employees/import/preview",
    formData,
    accessToken,
  );
  return response.json();
}

async function previewUpload(
  accessToken: string,
  file: File,
  sheetSelector: { sheet_index?: string; sheet_name?: string } = {},
): Promise<Response> {
  const formData = new FormData();
  formData.append("file", file);
  if (sheetSelector.sheet_index !== undefined) {
    formData.append("sheet_index", sheetSelector.sheet_index);
  }
  if (sheetSelector.sheet_name !== undefined) {
    formData.append("sheet_name", sheetSelector.sheet_name);
  }
  return TestRequest.postMultipart(
    "/api/admin/employees/import/preview",
    formData,
    accessToken,
  );
}

async function cleanupImportTestData() {
  await prismaClient.importJob.deleteMany({
    where: { file_name: { startsWith: "TEST_IMPORT_" } },
  });
  await AuditLogTest.delete();
  await AdminUserTest.delete();
  await EmployeeTest.delete();
  await MasterDataTest.delete();
}

describe("Employee import", () => {
  beforeEach(async () => {
    await cleanupImportTestData();
    const masterData = await MasterDataTest.create();
    UNIT_NAME = masterData.unit.name;
    POSITION_NAME = masterData.position.name;
    LEVEL_NAME = masterData.level.name;
    BUILDING_NAME = masterData.building.name;
  });

  afterEach(async () => {
    await cleanupImportTestData();
  });

  describe("POST /api/admin/employees/import/preview", () => {
    it("rejects an unauthenticated request with 401", async () => {
      const formData = new FormData();
      formData.append("file", csvFile(HEADERS, []));
      const response = await web.request(
        "/api/admin/employees/import/preview",
        {
          method: "POST",
          headers: new Headers({ Origin: "http://localhost:5173" }),
          body: formData,
        },
      );
      expect(response.status).toBe(401);
    });

    it("rejects DATABASE_ADMIN with 403", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const formData = new FormData();
      formData.append("file", csvFile(HEADERS, []));
      const response = await TestRequest.postMultipart(
        "/api/admin/employees/import/preview",
        formData,
        accessToken,
      );
      expect(response.status).toBe(403);
    });

    it("rejects VIEWER with 403", async () => {
      const { accessToken } = await AdminUserTest.createViewer();
      const formData = new FormData();
      formData.append("file", csvFile(HEADERS, []));
      const response = await TestRequest.postMultipart(
        "/api/admin/employees/import/preview",
        formData,
        accessToken,
      );
      expect(response.status).toBe(403);
    });

    it("rejects a request without a file with 400", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const formData = new FormData();
      const response = await TestRequest.postMultipart(
        "/api/admin/employees/import/preview",
        formData,
        accessToken,
      );
      expect(response.status).toBe(400);
    });

    it("stages a new employee as CREATE", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const body = await previewFile(accessToken, [
        row("99.99.001", "test_imp_emp_budi@millennia21.id"),
      ]);
      logger.debug(body);

      expect(body.data.summary.total_rows).toBe(1);
      expect(body.data.summary.create_count).toBe(1);
      expect(body.data.rows[0].action).toBe("CREATE");
      expect(body.data.rows[0].errors).toEqual([]);

      const job = await prismaClient.importJob.findUnique({
        where: { id: body.data.job_id },
      });
      expect(job?.status).toBe(ImportStatus.PENDING);
      expect(job?.type).toBe("EMPLOYEE");
    });

    it("flags a missing required field as an error", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const body = await previewFile(accessToken, [
        row("99.99.002", "test_imp_emp_missing@millennia21.id", {
          "Marital Status": "",
        }),
      ]);

      expect(body.data.summary.error_rows).toBe(1);
      expect(
        body.data.rows[0].errors.some((e: string) =>
          e.includes("Marital Status"),
        ),
      ).toBe(true);
    });

    it("flags an email that doesn't use the allowed organization domain, at preview time", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const body = await previewFile(accessToken, [
        row("99.99.004", "test_imp_emp_baddomain@millennia.21.id"),
      ]);

      expect(
        body.data.rows[0].errors.some((e: string) =>
          e.includes("allowed organization domain"),
        ),
      ).toBe(true);
    });

    it("flags an unrecognized unit", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const body = await previewFile(accessToken, [
        row("99.99.003", "test_imp_emp_badunit@millennia21.id", {
          Unit: "NONEXISTENT_UNIT",
        }),
      ]);

      expect(
        body.data.rows[0].errors.some((e: string) =>
          e.includes("Unit not recognized"),
        ),
      ).toBe(true);
    });

    it("flags duplicate Employee ID within the file", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const body = await previewFile(accessToken, [
        row("99.99.004", "test_imp_emp_dup1@millennia21.id"),
        row("99.99.004", "test_imp_emp_dup2@millennia21.id"),
      ]);

      expect(
        body.data.rows[0].errors.some((e: string) =>
          e.includes("Duplicate Employee ID"),
        ),
      ).toBe(true);
      expect(
        body.data.rows[1].errors.some((e: string) =>
          e.includes("Duplicate Employee ID"),
        ),
      ).toBe(true);
    });

    it("matches an existing employee by Employee ID as UPDATE", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const masterData = await prismaClient.masterUnit.findFirstOrThrow({
        where: { name: UNIT_NAME },
      });
      await EmployeeTest.create({
        email: "test_imp_emp_existing@millennia21.id",
        unitId: masterData.id,
        jobPositionId: (
          await prismaClient.masterJobPosition.findFirstOrThrow({
            where: { name: POSITION_NAME },
          })
        ).id,
        jobLevelId: (
          await prismaClient.masterJobLevel.findFirstOrThrow({
            where: { name: LEVEL_NAME },
          })
        ).id,
        buildingId: (
          await prismaClient.masterBuilding.findFirstOrThrow({
            where: { name: BUILDING_NAME },
          })
        ).id,
        employeeId: "99.99.005",
      });

      const body = await previewFile(accessToken, [
        row("99.99.005", "test_imp_emp_existing@millennia21.id", {
          "Full Name": "Budi Updated",
        }),
      ]);

      expect(body.data.rows[0].action).toBe("UPDATE");
      expect(body.data.rows[0].matched_employee_id).not.toBeNull();
    });

    it("accepts abbreviated gender values (M/F/L/P)", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const body = await previewFile(accessToken, [
        row("99.99.006", "test_imp_gender_m@millennia21.id", { Gender: "M" }),
        row("99.99.007", "test_imp_gender_f@millennia21.id", { Gender: "F" }),
        row("99.99.008", "test_imp_gender_l@millennia21.id", { Gender: "l" }),
        row("99.99.009", "test_imp_gender_p@millennia21.id", { Gender: "p" }),
      ]);
      logger.debug(body);

      expect(body.data.summary.error_rows).toBe(0);
      expect(body.data.rows.every((r) => r.action === "CREATE")).toBe(true);
    });
  });

  describe("POST /api/admin/employees/import/:jobId/commit", () => {
    it("rejects VIEWER with 403", async () => {
      const superAdmin = await AdminUserTest.createSuperAdmin();
      const preview = await previewFile(superAdmin.accessToken, [
        row("99.99.006", "test_imp_emp_commit_viewer@millennia21.id"),
      ]);

      const viewer = await AdminUserTest.createViewer();
      const response = await TestRequest.post(
        `/api/admin/employees/import/${preview.data.job_id}/commit`,
        {},
        viewer.accessToken,
      );
      expect(response.status).toBe(403);
    });

    it("rejects DATABASE_ADMIN with 403 - commit is SUPER_ADMIN-only", async () => {
      const superAdmin = await AdminUserTest.createSuperAdmin();
      const preview = await previewFile(superAdmin.accessToken, [
        row("99.99.007", "test_imp_emp_commit_dbadmin@millennia21.id"),
      ]);

      const dbAdmin = await AdminUserTest.createDatabaseAdmin();
      const response = await TestRequest.post(
        `/api/admin/employees/import/${preview.data.job_id}/commit`,
        {},
        dbAdmin.accessToken,
      );
      expect(response.status).toBe(403);
    });

    it("creates a new employee", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const preview = await previewFile(accessToken, [
        row("99.99.008", "test_imp_emp_commit_create@millennia21.id"),
      ]);

      const response = await TestRequest.post(
        `/api/admin/employees/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.status).toBe(ImportStatus.COMPLETED);
      expect(body.data.summary.create_count).toBe(1);

      const created = await prismaClient.person.findFirst({
        where: { email: "test_imp_emp_commit_create@millennia21.id" },
        include: { employee: true },
      });
      expect(created?.employee?.employee_id).toBe("99.99.008");
      expect(created?.employee?.marital_status).toBe("MARRIED");

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.IMPORT_DATA, admin_id: admin.id },
      });
      expect(auditLog.new_values).toMatchObject({
        entity: "Employee",
        create_count: 1,
      });
    });

    it("persists abbreviated gender values as MALE/FEMALE in the database", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const preview = await previewFile(accessToken, [
        row("99.99.010", "test_imp_gender_commit_m@millennia21.id", {
          Gender: "M",
        }),
        row("99.99.011", "test_imp_gender_commit_f@millennia21.id", {
          Gender: "F",
        }),
      ]);

      const response = await TestRequest.post(
        `/api/admin/employees/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      expect(response.status).toBe(200);

      const male = await prismaClient.person.findFirstOrThrow({
        where: { email: "test_imp_gender_commit_m@millennia21.id" },
      });
      const female = await prismaClient.person.findFirstOrThrow({
        where: { email: "test_imp_gender_commit_f@millennia21.id" },
      });
      expect(male.gender).toBe("MALE");
      expect(female.gender).toBe("FEMALE");
    });

    it("updates an existing employee matched by Employee ID", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const unit = await prismaClient.masterUnit.findFirstOrThrow({
        where: { name: UNIT_NAME },
      });
      const position = await prismaClient.masterJobPosition.findFirstOrThrow({
        where: { name: POSITION_NAME },
      });
      const level = await prismaClient.masterJobLevel.findFirstOrThrow({
        where: { name: LEVEL_NAME },
      });
      const building = await prismaClient.masterBuilding.findFirstOrThrow({
        where: { name: BUILDING_NAME },
      });
      const person = await EmployeeTest.create({
        email: "test_imp_emp_commit_update@millennia21.id",
        unitId: unit.id,
        jobPositionId: position.id,
        jobLevelId: level.id,
        buildingId: building.id,
        employeeId: "99.99.009",
      });

      const preview = await previewFile(accessToken, [
        row("99.99.009", "test_imp_emp_commit_update@millennia21.id", {
          "Full Name": "Budi Updated Name",
        }),
      ]);
      expect(preview.data.rows[0].action).toBe("UPDATE");

      const response = await TestRequest.post(
        `/api/admin/employees/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.data.summary.update_count).toBe(1);

      const updated = await prismaClient.person.findUnique({
        where: { id: person.id },
      });
      expect(updated?.full_name).toBe("Budi Updated Name");
    });

    it("rejects committing the same job twice", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const preview = await previewFile(accessToken, [
        row("99.99.010", "test_imp_emp_commit_twice@millennia21.id"),
      ]);

      await TestRequest.post(
        `/api/admin/employees/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      const secondResponse = await TestRequest.post(
        `/api/admin/employees/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      expect(secondResponse.status).toBe(400);
    });
  });

  describe("POST /api/admin/employees/import/:jobId/rollback", () => {
    it("rejects a non-SUPER_ADMIN with 403", async () => {
      const superAdmin = await AdminUserTest.createSuperAdmin();
      const preview = await previewFile(superAdmin.accessToken, [
        row("99.99.011", "test_imp_emp_rollback_dbadmin@millennia21.id"),
      ]);
      await TestRequest.post(
        `/api/admin/employees/import/${preview.data.job_id}/commit`,
        {},
        superAdmin.accessToken,
      );

      const dbAdmin = await AdminUserTest.createDatabaseAdmin();
      const response = await TestRequest.post(
        `/api/admin/employees/import/${preview.data.job_id}/rollback`,
        {},
        dbAdmin.accessToken,
      );
      expect(response.status).toBe(403);
    });

    it("rejects rolling back a job that was never committed", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const preview = await previewFile(accessToken, [
        row("99.99.012", "test_imp_emp_rollback_pending@millennia21.id"),
      ]);

      const response = await TestRequest.post(
        `/api/admin/employees/import/${preview.data.job_id}/rollback`,
        {},
        accessToken,
      );
      expect(response.status).toBe(400);
    });

    it("soft-deletes an employee that was CREATEd by the import", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const preview = await previewFile(accessToken, [
        row("99.99.013", "test_imp_emp_rollback_create@millennia21.id"),
      ]);
      await TestRequest.post(
        `/api/admin/employees/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );

      const response = await TestRequest.post(
        `/api/admin/employees/import/${preview.data.job_id}/rollback`,
        {},
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.status).toBe(ImportStatus.ROLLED_BACK);
      expect(body.data.summary.reverted_count).toBe(1);

      const person = await prismaClient.person.findFirst({
        where: { email: "test_imp_emp_rollback_create@millennia21.id" },
        include: { employee: true },
      });
      expect(person?.employee?.deleted_at).not.toBeNull();

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.ROLLBACK_IMPORT, admin_id: admin.id },
      });
      expect(auditLog.new_values).toMatchObject({
        entity: "Employee",
        reverted_count: 1,
      });
    });

    it("reverts an employee that was UPDATEd by the import", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const unit = await prismaClient.masterUnit.findFirstOrThrow({
        where: { name: UNIT_NAME },
      });
      const position = await prismaClient.masterJobPosition.findFirstOrThrow({
        where: { name: POSITION_NAME },
      });
      const level = await prismaClient.masterJobLevel.findFirstOrThrow({
        where: { name: LEVEL_NAME },
      });
      const building = await prismaClient.masterBuilding.findFirstOrThrow({
        where: { name: BUILDING_NAME },
      });
      const person = await EmployeeTest.create({
        email: "test_imp_emp_rollback_update@millennia21.id",
        unitId: unit.id,
        jobPositionId: position.id,
        jobLevelId: level.id,
        buildingId: building.id,
        employeeId: "99.99.014",
      });
      const originalName = person.full_name;

      const preview = await previewFile(accessToken, [
        row("99.99.014", "test_imp_emp_rollback_update@millennia21.id", {
          "Full Name": "Changed Name",
        }),
      ]);
      await TestRequest.post(
        `/api/admin/employees/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );

      const afterCommit = await prismaClient.person.findUnique({
        where: { id: person.id },
      });
      expect(afterCommit?.full_name).toBe("Changed Name");

      const response = await TestRequest.post(
        `/api/admin/employees/import/${preview.data.job_id}/rollback`,
        {},
        accessToken,
      );
      expect(response.status).toBe(200);

      const afterRollback = await prismaClient.person.findUnique({
        where: { id: person.id },
      });
      expect(afterRollback?.full_name).toBe(originalName);
    });

    it("rejects rolling back an already rolled-back job", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const preview = await previewFile(accessToken, [
        row("99.99.015", "test_imp_emp_rollback_twice@millennia21.id"),
      ]);
      await TestRequest.post(
        `/api/admin/employees/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      await TestRequest.post(
        `/api/admin/employees/import/${preview.data.job_id}/rollback`,
        {},
        accessToken,
      );

      const secondResponse = await TestRequest.post(
        `/api/admin/employees/import/${preview.data.job_id}/rollback`,
        {},
        accessToken,
      );
      expect(secondResponse.status).toBe(400);
    });
  });

  describe("GET /api/admin/employees/import/fields", () => {
    it("rejects an unauthenticated request with 401", async () => {
      const response = await web.request(
        "/api/admin/employees/import/fields",
        { headers: new Headers({ Origin: "http://localhost:5173" }) },
      );
      expect(response.status).toBe(401);
    });

    it("rejects DATABASE_ADMIN with 403", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const response = await TestRequest.get(
        "/api/admin/employees/import/fields",
        accessToken,
      );
      expect(response.status).toBe(403);
    });

    it("returns the employee import field definitions for SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const response = await TestRequest.get(
        "/api/admin/employees/import/fields",
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(
        body.data.find((f: { key: string }) => f.key === "full_name"),
      ).toMatchObject({ label: "Full Name", required: true });
      expect(
        body.data.find((f: { key: string }) => f.key === "employment_type"),
      ).toMatchObject({ label: "Employment Type", required: true });
    });
  });

  describe("GET /api/admin/employees/import/:jobId", () => {
    it("returns the job with its staged rows", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const preview = await previewFile(accessToken, [
        row("99.99.016", "test_imp_emp_getjob@millennia21.id"),
      ]);

      const response = await TestRequest.get(
        `/api/admin/employees/import/${preview.data.job_id}`,
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.rows.length).toBe(1);
      expect(body.data.status).toBe(ImportStatus.PENDING);
    });

    it("returns 404 for an unknown job", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const response = await TestRequest.get(
        "/api/admin/employees/import/nonexistent-job-id",
        accessToken,
      );
      expect(response.status).toBe(404);
    });

    it("returns 404 for a student import job fetched via the employee endpoint", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const formData = new FormData();
      formData.append(
        "file",
        new File(["Full Name\nX"], "TEST_IMPORT_students.csv", {
          type: "text/csv",
        }),
      );
      const studentPreview = await TestRequest.postMultipart(
        "/api/admin/students/import/preview",
        formData,
        accessToken,
      );
      const studentBody = await studentPreview.json();

      const response = await TestRequest.get(
        `/api/admin/employees/import/${studentBody.data.job_id}`,
        accessToken,
      );
      expect(response.status).toBe(404);

      await prismaClient.importJob.deleteMany({
        where: { id: studentBody.data.job_id },
      });
    });
  });

  describe("multi-sheet workbook selection", () => {
    async function multiSheetFile(): Promise<File> {
      return xlsxFile([
        { name: "Complete Data", headers: HEADERS, rows: [row("90.01.001", "test_imp_sheet0@millennia21.id")] },
        { name: "Freelance", headers: HEADERS, rows: [row("90.01.002", "test_imp_sheet1@millennia21.id")] },
      ]);
    }

    it("defaults to the first sheet and reports the others as skipped", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const response = await previewUpload(accessToken, await multiSheetFile());
      const body: { data: PreviewEmployeeImportResponse } =
        await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.sheet_name).toBe("Complete Data");
      expect(body.data.other_sheets).toEqual(["Freelance"]);
      expect(body.data.rows[0]!.raw.email).toBe(
        "test_imp_sheet0@millennia21.id",
      );
    });

    it("imports a specific sheet by sheet_index", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const response = await previewUpload(accessToken, await multiSheetFile(), {
        sheet_index: "1",
      });
      const body: { data: PreviewEmployeeImportResponse } =
        await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.sheet_name).toBe("Freelance");
      expect(body.data.other_sheets).toEqual(["Complete Data"]);
      expect(body.data.rows[0]!.raw.email).toBe(
        "test_imp_sheet1@millennia21.id",
      );
    });

    it("imports a specific sheet by sheet_name", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const response = await previewUpload(accessToken, await multiSheetFile(), {
        sheet_name: "Freelance",
      });
      const body: { data: PreviewEmployeeImportResponse } =
        await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.sheet_name).toBe("Freelance");
      expect(body.data.rows[0]!.raw.email).toBe(
        "test_imp_sheet1@millennia21.id",
      );
    });

    it("rejects an unknown sheet_name with 400", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const response = await previewUpload(accessToken, await multiSheetFile(), {
        sheet_name: "Ex-Employee",
      });
      expect(response.status).toBe(400);
    });

    it("rejects a negative sheet_index with 400", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const response = await previewUpload(accessToken, await multiSheetFile(), {
        sheet_index: "-1",
      });
      expect(response.status).toBe(400);
    });
  });
});
