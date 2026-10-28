import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  AuditLogTest,
  InternTest,
  MasterDataTest,
} from "./test-utils";
import { ImportStatus, PersonType } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { web } from "../application/web";
import type {
  CommitInternImportResponse,
  PreviewInternImportResponse,
  RollbackInternImportResponse,
} from "../model/import-model";

let UNIT_NAME: string;
let POSITION_NAME: string;
let BUILDING_NAME: string;
let UNIT_ID: string;
let POSITION_ID: string;
let BUILDING_ID: string;

const HEADERS = [
  "Full Name",
  "Nick",
  "Email",
  "Gender",
  "Religion",
  "Birth Place",
  "Birth Date",
  "Unit",
  "Job Position",
  "Building",
  "Join Date",
  "End Date",
  "Status",
  "Notes",
  "Mobile Phone",
  "Education Level",
  "Institution Name",
  "Major",
  "Graduation Year",
];

function csvFile(headers: string[], rows: string[][], name = "TEST_IMPORT_interns.csv"): File {
  const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
  return new File([csv], name, { type: "text/csv" });
}

function row(email: string, overrides: Partial<Record<string, string>> = {}): string[] {
  const base: Record<string, string> = {
    "Full Name": "Sari Magang",
    Nick: "Sari",
    Email: email,
    Gender: "FEMALE",
    Religion: "ISLAM",
    "Birth Place": "Bandung",
    "Birth Date": "2004-05-05",
    Unit: UNIT_NAME,
    "Job Position": POSITION_NAME,
    Building: BUILDING_NAME,
    "Join Date": "2026-08-01",
    "End Date": "2027-02-01",
    ...overrides,
  };
  return HEADERS.map((h) => base[h] ?? "");
}

async function preview(accessToken: string, rows: string[][]) {
  const formData = new FormData();
  formData.append("file", csvFile(HEADERS, rows));
  const response = await TestRequest.postMultipart(
    "/api/admin/interns/import/preview",
    formData,
    accessToken,
  );
  return { status: response.status, body: (await response.json()) as { data: PreviewInternImportResponse } };
}

async function commit(accessToken: string, jobId: string) {
  const response = await TestRequest.post(
    `/api/admin/interns/import/${jobId}/commit`,
    {},
    accessToken,
  );
  return { status: response.status, body: (await response.json()) as { data: CommitInternImportResponse } };
}

async function cleanup() {
  await prismaClient.importJob.deleteMany({
    where: { file_name: { startsWith: "TEST_IMPORT_" } },
  });
  await prismaClient.person.deleteMany({
    where: { email: { contains: "test_intern_taken" } },
  });
  await InternTest.delete();
  await AuditLogTest.delete();
  await AdminUserTest.delete();
  await MasterDataTest.delete();
}

describe("Intern import", () => {
  beforeEach(async () => {
    await cleanup();
    const masterData = await MasterDataTest.create();
    UNIT_NAME = masterData.unit.name;
    POSITION_NAME = masterData.position.name;
    BUILDING_NAME = masterData.building.name;
    UNIT_ID = masterData.unit.id;
    POSITION_ID = masterData.position.id;
    BUILDING_ID = masterData.building.id;
  });

  afterEach(cleanup);

  describe("who may import", () => {
    it("rejects an unauthenticated request with 401", async () => {
      const formData = new FormData();
      formData.append("file", csvFile(HEADERS, []));
      const response = await web.request("/api/admin/interns/import/preview", {
        method: "POST",
        headers: new Headers({ Origin: "http://localhost:5173" }),
        body: formData,
      });
      expect(response.status).toBe(401);
    });

    it("rejects a Database Admin and a Viewer with 403", async () => {
      for (const create of [AdminUserTest.createDatabaseAdmin, AdminUserTest.createViewer]) {
        const { accessToken } = await create.call(AdminUserTest);
        const formData = new FormData();
        formData.append("file", csvFile(HEADERS, []));
        const response = await TestRequest.postMultipart(
          "/api/admin/interns/import/preview",
          formData,
          accessToken,
        );
        expect(response.status).toBe(403);
        await AdminUserTest.delete();
      }
    });

    it("rejects a request without a file with 400", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const response = await TestRequest.postMultipart(
        "/api/admin/interns/import/preview",
        new FormData(),
        accessToken,
      );
      expect(response.status).toBe(400);
    });

    it("lists the import fields for a Super Admin only", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const ok = await TestRequest.get("/api/admin/interns/import/fields", accessToken);
      expect(ok.status).toBe(200);
      const fields = (await ok.json()).data as { key: string; required: boolean }[];
      expect(fields.find((f) => f.key === "end_date")?.required).toBe(true);
      expect(fields.some((f) => f.key === "employee_id")).toBe(false);

      const dba = await AdminUserTest.createDatabaseAdmin();
      const denied = await TestRequest.get("/api/admin/interns/import/fields", dba.accessToken);
      expect(denied.status).toBe(403);
    });
  });

  describe("preview", () => {
    it("stages a new intern as CREATE and stores an INTERN job", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const { body } = await preview(accessToken, [row("test_intern_imp_new@millennia21.id")]);

      expect(body.data.summary).toMatchObject({ total_rows: 1, create_count: 1, error_rows: 0 });
      expect(body.data.rows[0].action).toBe("CREATE");
      expect(body.data.rows[0].errors).toEqual([]);
      const job = await prismaClient.importJob.findUnique({ where: { id: body.data.job_id } });
      expect(job?.type).toBe("INTERN");
      expect(job?.status).toBe(ImportStatus.PENDING);
    });

    it("flags missing required fields, a wrong domain and a bad date order", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const { body } = await preview(accessToken, [
        row("test_intern_imp_noend@millennia21.id", { "End Date": "" }),
        row("test_intern_imp_domain@wrong.example", {}),
        row("test_intern_imp_order@millennia21.id", { "Join Date": "2026-09-01", "End Date": "2026-08-01" }),
      ]);

      expect(body.data.rows[0].errors.some((e) => e.includes("End Date is required"))).toBe(true);
      expect(body.data.rows[1].errors.some((e) => e.includes("allowed organization domain"))).toBe(true);
      expect(body.data.rows[2].errors.some((e) => e.includes("End date must be after join date"))).toBe(true);
    });

    it("flags unknown unit, position and building", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const { body } = await preview(accessToken, [
        row("test_intern_imp_unknown@millennia21.id", {
          Unit: "NO_UNIT",
          "Job Position": "NO_POSITION",
          Building: "NO_BUILDING",
        }),
      ]);
      const errors = body.data.rows[0].errors;
      expect(errors.some((e) => e.includes("Unit not recognized"))).toBe(true);
      expect(errors.some((e) => e.includes("Job position not recognized"))).toBe(true);
      expect(errors.some((e) => e.includes("Building not recognized"))).toBe(true);
    });

    it("flags a duplicate email inside the file", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const { body } = await preview(accessToken, [
        row("test_intern_imp_dup@millennia21.id"),
        row("TEST_INTERN_IMP_DUP@millennia21.id"),
      ]);
      expect(body.data.rows.every((r) => r.errors.some((e) => e.includes("Duplicate email")))).toBe(true);
    });

    it("refuses an email that belongs to another person", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await prismaClient.person.create({
        data: {
          full_name: "Someone Else",
          nick_name: "Else",
          email: "test_intern_taken@millennia21.id",
          person_type: PersonType.STUDENT,
          gender: "MALE",
          religion: "ISLAM",
          birth_place: "Jakarta",
          birth_date: new Date("2010-01-01"),
        },
      });
      const { body } = await preview(accessToken, [row("test_intern_taken@millennia21.id")]);
      expect(body.data.rows[0].errors.some((e) => e.includes("already registered to another person"))).toBe(true);
    });

    it("matches an existing intern by email as UPDATE and shows what changes", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await InternTest.create({
        email: "test_intern_imp_upd@millennia21.id",
        unitId: UNIT_ID,
        jobPositionId: POSITION_ID,
        buildingId: BUILDING_ID,
      });
      const { body } = await preview(accessToken, [
        row("test_intern_imp_upd@millennia21.id", { Notes: "Moved to the new project" }),
      ]);
      const staged = body.data.rows[0];
      expect(staged.action).toBe("UPDATE");
      expect(staged.matched_intern_id).not.toBeNull();
      expect(staged.warnings.some((w) => w.startsWith('Notes: ""'))).toBe(true);
    });

    it("skips a row that changes nothing", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const intern = await InternTest.create({
        email: "test_intern_imp_same@millennia21.id",
        unitId: UNIT_ID,
        jobPositionId: POSITION_ID,
        buildingId: BUILDING_ID,
      });
      const { body } = await preview(accessToken, [
        [
          intern.full_name,
          intern.nick_name,
          intern.email,
          "",
          "",
          "",
          "",
          UNIT_NAME,
          POSITION_NAME,
          BUILDING_NAME,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ],
      ]);
      expect(body.data.rows[0].action).toBeNull();
      expect(body.data.rows[0].warnings.some((w) => w.includes("No changes detected"))).toBe(true);
    });

    it("refuses an intern that was removed", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const intern = await InternTest.create({
        email: "test_intern_imp_removed@millennia21.id",
        unitId: UNIT_ID,
        jobPositionId: POSITION_ID,
        buildingId: BUILDING_ID,
      });
      await prismaClient.intern.update({ where: { id: intern.id }, data: { deleted_at: new Date() } });
      const { body } = await preview(accessToken, [row("test_intern_imp_removed@millennia21.id")]);
      expect(body.data.rows[0].action).toBeNull();
      expect(body.data.rows[0].errors.some((e) => e.includes("was removed"))).toBe(true);
    });
  });

  describe("commit and rollback", () => {
    it("creates an intern, completes the job, and can only be committed once", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const { body } = await preview(accessToken, [
        row("test_intern_imp_commit@millennia21.id", {
          Notes: "From the import",
          "Mobile Phone": "081234567890",
          "Education Level": "S1",
          "Institution Name": "Universitas Contoh",
          Major: "Informatika",
          "Graduation Year": "2026",
        }),
      ]);
      const first = await commit(accessToken, body.data.job_id);
      expect(first.status).toBe(200);
      expect(first.body.data.rows[0].errors).toEqual([]);
      expect(first.body.data.status).toBe(ImportStatus.COMPLETED);

      const created = await prismaClient.intern.findUniqueOrThrow({
        where: { email: "test_intern_imp_commit@millennia21.id" },
      });
      expect(created.status).toBe("ACTIVE");
      expect(created.unit_id).toBe(UNIT_ID);
      expect(created.end_date.toISOString().slice(0, 10)).toBe("2027-02-01");
      expect(created.notes).toBe("From the import");
      expect(created.education_level).toBe("S1");
      expect(created.graduation_year).toBe(2026);
      expect(first.body.data.rows[0].committed_intern_id).toBe(created.id);

      const second = await commit(accessToken, body.data.job_id);
      expect(second.status).toBe(400);
    });

    it("updates a matched intern and records the audit entries", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const intern = await InternTest.create({
        email: "test_intern_imp_change@millennia21.id",
        unitId: UNIT_ID,
        jobPositionId: POSITION_ID,
        buildingId: BUILDING_ID,
      });
      const { body } = await preview(accessToken, [
        row("test_intern_imp_change@millennia21.id", { Notes: "Changed by import" }),
      ]);
      const result = await commit(accessToken, body.data.job_id);
      expect(result.body.data.rows[0].errors).toEqual([]);
      const updated = await prismaClient.intern.findUniqueOrThrow({ where: { id: intern.id } });
      expect(updated.notes).toBe("Changed by import");

      const phases = await prismaClient.auditLog.findMany({
        where: { action: "IMPORT_DATA", entity_id: body.data.job_id },
      });
      expect(phases.length).toBe(2);
    });

    it("rolls back: removes what was created and restores what was changed", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const existing = await InternTest.create({
        email: "test_intern_imp_roll_old@millennia21.id",
        unitId: UNIT_ID,
        jobPositionId: POSITION_ID,
        buildingId: BUILDING_ID,
      });
      await prismaClient.intern.update({ where: { id: existing.id }, data: { notes: "Original note" } });
      const { body } = await preview(accessToken, [
        row("test_intern_imp_roll_new@millennia21.id"),
        row("test_intern_imp_roll_old@millennia21.id", { Notes: "Temporary note" }),
      ]);
      await commit(accessToken, body.data.job_id);

      const response = await TestRequest.post(
        `/api/admin/interns/import/${body.data.job_id}/rollback`,
        {},
        accessToken,
      );
      expect(response.status).toBe(200);
      const rolled = (await response.json()) as { data: RollbackInternImportResponse };
      expect(rolled.data.status).toBe(ImportStatus.ROLLED_BACK);
      expect(rolled.data.summary).toEqual({ reverted_count: 2, failed_count: 0 });

      const created = await prismaClient.intern.findUniqueOrThrow({
        where: { email: "test_intern_imp_roll_new@millennia21.id" },
      });
      expect(created.deleted_at).not.toBeNull();
      const restored = await prismaClient.intern.findUniqueOrThrow({ where: { id: existing.id } });
      expect(restored.notes).toBe("Original note");
    });

    it("does not touch rows that have errors", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const { body } = await preview(accessToken, [
        row("test_intern_imp_ok@millennia21.id"),
        row("test_intern_imp_bad@millennia21.id", { Unit: "NO_UNIT" }),
      ]);
      const result = await commit(accessToken, body.data.job_id);
      expect(result.body.data.status).toBe(ImportStatus.PARTIAL);
      expect(await prismaClient.intern.findUnique({ where: { email: "test_intern_imp_ok@millennia21.id" } })).not.toBeNull();
      expect(await prismaClient.intern.findUnique({ where: { email: "test_intern_imp_bad@millennia21.id" } })).toBeNull();
    });

    it("lets a Super Admin read the staged job and refuses others", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const { body } = await preview(accessToken, [row("test_intern_imp_job@millennia21.id")]);
      const ok = await TestRequest.get(`/api/admin/interns/import/${body.data.job_id}`, accessToken);
      expect(ok.status).toBe(200);
      expect((await ok.json()).data.rows.length).toBe(1);

      const dba = await AdminUserTest.createDatabaseAdmin();
      const denied = await TestRequest.get(`/api/admin/interns/import/${body.data.job_id}`, dba.accessToken);
      expect(denied.status).toBe(403);
    });
  });

  describe("export then import", () => {
    it("a sensitive export can be imported again without changes", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await InternTest.create({
        email: "test_intern_imp_round@millennia21.id",
        unitId: UNIT_ID,
        jobPositionId: POSITION_ID,
        buildingId: BUILDING_ID,
        mobilePhone: "081234567890",
      });
      const exportResponse = await TestRequest.get(
        "/api/admin/interns/export?format=csv&export_mode=sensitive&search=test_intern_imp_round",
        accessToken,
      );
      expect(exportResponse.status).toBe(200);
      const csv = await exportResponse.text();

      const formData = new FormData();
      formData.append("file", new File([csv], "TEST_IMPORT_round.csv", { type: "text/csv" }));
      const response = await TestRequest.postMultipart(
        "/api/admin/interns/import/preview",
        formData,
        accessToken,
      );
      const body = (await response.json()) as { data: PreviewInternImportResponse };
      expect(body.data.rows.length).toBe(1);
      expect(body.data.rows[0].errors).toEqual([]);
      expect(body.data.rows[0].warnings).toEqual(["No changes detected for this intern, already up to date."]);
      expect(body.data.rows[0].action).toBeNull();
      expect(body.data.unmapped_headers).toEqual(expect.arrayContaining(["ID", "Created At"]));
    });
  });
});
