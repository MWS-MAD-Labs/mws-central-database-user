import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  AuditLogTest,
  MasterDataTest,
  StudentTest,
  ParentGuardianTest,
  HealthRecordTest,
  HealthNoteTest,
  ConsentTest,
  PCActivityTest,
} from "./test-utils";
import {
  AuditAction,
  ImportStatus,
  StudentStatus,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { logger } from "../lib/logger";
import { web } from "../application/web";

const GRADE_NAME = "TEST_IMPORT_GRADE";

const HEADERS = [
  "Full Name",
  "Nick Name",
  "Email",
  "Gender",
  "Religion",
  "Place, Date of birth",
  "NIS",
  "Current Grade",
  "Status",
  "Entry Type",
];

function escapeCsvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvFile(
  headers: string[],
  rows: string[][],
  name = "TEST_IMPORT_students.csv",
): File {
  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");
  return new File([csv], name, { type: "text/csv" });
}

async function ensureGradeAndYear() {
  const grade = await prismaClient.grade.upsert({
    where: { name: GRADE_NAME },
    create: { name: GRADE_NAME, level: -8888 },
    update: {},
  });
  await StudentTest.resolveAcademicYearId();
  return grade.id;
}

async function previewFile(
  accessToken: string,
  rows: string[][],
): Promise<any> {
  const file = csvFile(HEADERS, rows);
  const formData = new FormData();
  formData.append("file", file);
  const response = await TestRequest.postMultipart(
    "/api/admin/students/import/preview",
    formData,
    accessToken,
  );
  return response.json();
}

const FULL_HEADERS = [
  ...HEADERS,
  "Father",
  "Father's Phone",
  "Mother",
  "Mother's Phone",
  "Address",
  "Health Information",
  "Special Needs, Psychological / Physical",
  "Blood Type",
  "Media Consent Sign",
  "Media Consent YES",
  "Parent Consent Sign",
  "PC Monday",
  "PC Tuesday",
  "PC Wednesday",
  "PC Thursday",
];

async function previewFileFull(
  accessToken: string,
  rows: string[][],
): Promise<any> {
  const file = csvFile(FULL_HEADERS, rows);
  const formData = new FormData();
  formData.append("file", file);
  const response = await TestRequest.postMultipart(
    "/api/admin/students/import/preview",
    formData,
    accessToken,
  );
  return response.json();
}

async function cleanupImportTestData() {
  await prismaClient.importJob.deleteMany({
    where: { file_name: { startsWith: "TEST_IMPORT_" } },
  });
  await AuditLogTest.delete();
  await AdminUserTest.delete();
  // FK is ON DELETE RESTRICT on these - must run before StudentTest.delete().
  await ParentGuardianTest.delete();
  await HealthRecordTest.delete();
  await HealthNoteTest.delete();
  await ConsentTest.delete();
  await PCActivityTest.delete();
  await StudentTest.delete();
  await MasterDataTest.delete();
}

describe("Student import", () => {
  beforeEach(async () => {
    await cleanupImportTestData();
    await MasterDataTest.create();
    await ensureGradeAndYear();
  });

  afterEach(async () => {
    await cleanupImportTestData();
  });

  describe("POST /api/admin/students/import/preview", () => {
    it("rejects an unauthenticated request with 401", async () => {
      const formData = new FormData();
      formData.append("file", csvFile(HEADERS, []));
      const response = await web.request("/api/admin/students/import/preview", {
        method: "POST",
        headers: new Headers({ Origin: "http://localhost:5173" }),
        body: formData,
      });
      expect(response.status).toBe(401);
    });

    it("rejects a request without a file with 400", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const formData = new FormData();
      const response = await TestRequest.postMultipart(
        "/api/admin/students/import/preview",
        formData,
        accessToken,
      );
      expect(response.status).toBe(400);
    });

    it("rejects DATABASE_ADMIN with 403 - preview is SUPER_ADMIN-only too, since it echoes back raw sensitive data", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const formData = new FormData();
      formData.append("file", csvFile(HEADERS, []));
      const response = await TestRequest.postMultipart(
        "/api/admin/students/import/preview",
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
        "/api/admin/students/import/preview",
        formData,
        accessToken,
      );
      expect(response.status).toBe(403);
    });

    it("stages a new student as CREATE and warns about ACTIVE downgrade", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const body = await previewFile(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_budi@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601001",
          GRADE_NAME,
          "ACTIVE",
          "PSB",
        ],
      ]);
      logger.debug(body);

      expect(body.data.summary.total_rows).toBe(1);
      expect(body.data.summary.create_count).toBe(1);
      expect(body.data.rows[0].action).toBe("CREATE");
      expect(body.data.rows[0].errors).toEqual([]);
      expect(body.data.rows[0].warnings[0]).toContain("Status ACTIVE ignored");
      expect(body.data.rows[0].raw.birth_place).toBe("Jakarta");
      expect(body.data.rows[0].raw.birth_date).toBe("2010-05-01");

      const job = await prismaClient.importJob.findUnique({
        where: { id: body.data.job_id },
      });
      expect(job?.status).toBe(ImportStatus.PENDING);
    });

    it("accepts abbreviated gender values (M/F/L/P)", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const body = await previewFile(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_gender_m@millennia21.id",
          "M",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601010",
          GRADE_NAME,
          "",
          "PSB",
        ],
        [
          "Siti Aminah",
          "Siti",
          "test_imp_gender_p@millennia21.id",
          "p",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601011",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);
      logger.debug(body);

      expect(body.data.summary.error_rows).toBe(0);
      expect(
        body.data.rows.every((r: { action: string }) => r.action === "CREATE"),
      ).toBe(true);
    });

    it("flags a missing required field as an error", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const body = await previewFile(accessToken, [
        [
          "",
          "Budi",
          "test_imp_missing@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601002",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);

      expect(body.data.summary.error_rows).toBe(1);
      expect(
        body.data.rows[0].errors.some((e: string) => e.includes("Full Name")),
      ).toBe(true);
    });

    it("flags an unrecognized grade", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const body = await previewFile(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_badgrade@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601003",
          "NONEXISTENT_GRADE",
          "",
        ],
      ]);

      expect(
        body.data.rows[0].errors.some((e: string) =>
          e.includes("Grade not recognized"),
        ),
      ).toBe(true);
    });

    it("flags duplicate NIS within the file", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const row = (email: string) => [
        "Budi Santoso",
        "Budi",
        email,
        "MALE",
        "ISLAM",
        "Jakarta, 2010-05-01",
        "2601004",
        GRADE_NAME,
        "",
        "PSB",
      ];
      const body = await previewFile(accessToken, [
        row("test_imp_dup1@millennia21.id"),
        row("test_imp_dup2@millennia21.id"),
      ]);

      expect(
        body.data.rows[0].errors.some((e: string) =>
          e.includes("Duplicate NIS"),
        ),
      ).toBe(true);
      expect(
        body.data.rows[1].errors.some((e: string) =>
          e.includes("Duplicate NIS"),
        ),
      ).toBe(true);
    });

    it("matches an existing student by NIS as UPDATE", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await StudentTest.create({
        email: "test_imp_existing@millennia21.id",
        nis: "9100005",
      });

      const body = await previewFile(accessToken, [
        [
          "Budi Updated",
          "Budi",
          "test_imp_existing@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "9100005",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);

      expect(body.data.rows[0].action).toBe("UPDATE");
      expect(body.data.rows[0].matched_student_id).not.toBeNull();
    });
  });

  describe("POST /api/admin/students/import/:jobId/commit", () => {
    it("rejects VIEWER with 403", async () => {
      const superAdmin = await AdminUserTest.createSuperAdmin();
      const preview = await previewFile(superAdmin.accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_commit_viewer@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601006",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);

      const viewer = await AdminUserTest.createViewer();
      const response = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        viewer.accessToken,
      );
      expect(response.status).toBe(403);
    });

    it("rejects DATABASE_ADMIN with 403 even with can_write_data - commit is SUPER_ADMIN-only", async () => {
      const superAdmin = await AdminUserTest.createSuperAdmin();
      const preview = await previewFile(superAdmin.accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_commit_dbadmin@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601021",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);

      const dbAdmin = await AdminUserTest.createDatabaseAdmin();
      const response = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        dbAdmin.accessToken,
      );
      expect(response.status).toBe(403);

      // The job should still be untouched (PENDING) - a rejected commit
      // attempt must not leave it half-processed.
      const job = await prismaClient.importJob.findUnique({
        where: { id: preview.data.job_id },
      });
      expect(job?.status).toBe(ImportStatus.PENDING);
    });


    it("creates a new student, downgrading ACTIVE to REGISTERED", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const preview = await previewFile(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_commit_create@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601007",
          GRADE_NAME,
          "ACTIVE",
          "PSB",
        ],
      ]);

      const response = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.status).toBe(ImportStatus.COMPLETED);
      expect(body.data.summary.create_count).toBe(1);

      const created = await prismaClient.person.findFirst({
        where: { email: "test_imp_commit_create@millennia21.id" },
        include: { student: true },
      });
      expect(created?.student?.status).toBe(StudentStatus.REGISTERED);
      expect(created?.student?.nis).toBe("2601007");

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.IMPORT_DATA, admin_id: admin.id },
      });
      expect(auditLog.new_values).toMatchObject({
        entity: "Student",
        create_count: 1,
      });
    });

    it("updates an existing student matched by NIS", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const person = await StudentTest.create({
        email: "test_imp_commit_update@millennia21.id",
        nis: "9100008",
      });

      const preview = await previewFile(accessToken, [
        [
          "Budi Updated Name",
          "Budi",
          "test_imp_commit_update@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "9100008",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);
      expect(preview.data.rows[0].action).toBe("UPDATE");

      const response = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
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
        [
          "Budi Santoso",
          "Budi",
          "test_imp_commit_twice@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601009",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);

      await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      const secondResponse = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      expect(secondResponse.status).toBe(400);
    });
  });

  describe("GET /api/admin/students/import/fields", () => {
    it("rejects an unauthenticated request with 401", async () => {
      const response = await web.request("/api/admin/students/import/fields", {
        headers: new Headers({ Origin: "http://localhost:5173" }),
      });
      expect(response.status).toBe(401);
    });

    it("rejects DATABASE_ADMIN with 403", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const response = await TestRequest.get(
        "/api/admin/students/import/fields",
        accessToken,
      );
      expect(response.status).toBe(403);
    });

    it("returns the student import field definitions for SUPER_ADMIN", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const response = await TestRequest.get(
        "/api/admin/students/import/fields",
        accessToken,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(
        body.data.find((f: { key: string }) => f.key === "full_name"),
      ).toMatchObject({ label: "Full Name", required: true });
      expect(
        body.data.find((f: { key: string }) => f.key === "nis"),
      ).toMatchObject({ label: "NIS", required: false });
    });
  });

  describe("GET /api/admin/students/import/:jobId", () => {
    it("returns the job with its staged rows", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const preview = await previewFile(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_getjob@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601010",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);

      const response = await TestRequest.get(
        `/api/admin/students/import/${preview.data.job_id}`,
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
        "/api/admin/students/import/nonexistent-job-id",
        accessToken,
      );
      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/admin/students/import/:jobId/rollback", () => {
    it("rejects a non-SUPER_ADMIN with 403", async () => {
      const superAdmin = await AdminUserTest.createSuperAdmin();
      const preview = await previewFile(superAdmin.accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_rollback_dbadmin@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601011",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);
      await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        superAdmin.accessToken,
      );

      const dbAdmin = await AdminUserTest.createDatabaseAdmin();
      const response = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/rollback`,
        {},
        dbAdmin.accessToken,
      );
      expect(response.status).toBe(403);
    });

    it("rejects rolling back a job that was never committed", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const preview = await previewFile(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_rollback_pending@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601012",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);

      const response = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/rollback`,
        {},
        accessToken,
      );
      expect(response.status).toBe(400);
    });

    it("soft-deletes a student that was CREATEd by the import", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const preview = await previewFile(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_rollback_create@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601013",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);
      await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );

      const response = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/rollback`,
        {},
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.status).toBe(ImportStatus.ROLLED_BACK);
      expect(body.data.summary.reverted_count).toBe(1);

      const person = await prismaClient.person.findFirst({
        where: { email: "test_imp_rollback_create@millennia21.id" },
        include: { student: true },
      });
      expect(person?.student?.deleted_at).not.toBeNull();

      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.ROLLBACK_IMPORT, admin_id: admin.id },
      });
      expect(auditLog.new_values).toMatchObject({
        entity: "Student",
        reverted_count: 1,
      });
    });

    it("reverts a student that was UPDATEd by the import", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const person = await StudentTest.create({
        email: "test_imp_rollback_update@millennia21.id",
        nis: "9100014",
      });
      const originalName = person.full_name;

      const preview = await previewFile(accessToken, [
        [
          "Changed Name",
          "Budi",
          "test_imp_rollback_update@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "9100014",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);
      await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );

      const afterCommit = await prismaClient.person.findUnique({
        where: { id: person.id },
      });
      expect(afterCommit?.full_name).toBe("Changed Name");

      const response = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/rollback`,
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
        [
          "Budi Santoso",
          "Budi",
          "test_imp_rollback_twice@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601015",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);
      await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/rollback`,
        {},
        accessToken,
      );

      const secondResponse = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/rollback`,
        {},
        accessToken,
      );
      expect(secondResponse.status).toBe(400);
    });
  });

  describe("DELETE /api/admin/students/import/cleanup", () => {
    it("rejects a non-SUPER_ADMIN with 403", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin();
      const response = await TestRequest.delete(
        "/api/admin/students/import/cleanup",
        accessToken,
      );
      expect(response.status).toBe(403);
    });

    it("deletes only PENDING jobs older than the retention window", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();

      const oldPending = await previewFile(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_cleanup_old@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601016",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);
      const recentPending = await previewFile(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_cleanup_recent@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601017",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);
      const committed = await previewFile(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_cleanup_committed@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601018",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);
      await TestRequest.post(
        `/api/admin/students/import/${committed.data.job_id}/commit`,
        {},
        accessToken,
      );

      await prismaClient.importJob.update({
        where: { id: oldPending.data.job_id },
        data: { created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
      });

      const response = await TestRequest.delete(
        "/api/admin/students/import/cleanup?days=7",
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.deleted_count).toBe(1);

      expect(
        await prismaClient.importJob.findUnique({
          where: { id: oldPending.data.job_id },
        }),
      ).toBeNull();
      expect(
        await prismaClient.importJob.findUnique({
          where: { id: recentPending.data.job_id },
        }),
      ).not.toBeNull();
      expect(
        await prismaClient.importJob.findUnique({
          where: { id: committed.data.job_id },
        }),
      ).not.toBeNull();
    });
  });

  describe("relation data (parents/health/consents/pc activities)", () => {
    function fullRow(email: string, nis: string): string[] {
      return [
        "Budi Santoso",
        "Budi",
        email,
        "MALE",
        "ISLAM",
        "Jakarta, 2010-05-01",
        nis,
        GRADE_NAME,
        "",
        "PSB",
        "Budi Bapak",
        "081111111111",
        "Sri Ibu",
        "082222222222",
        "Jl. Mawar No. 1, Jakarta",
        "Asthma",
        "Needs wheelchair access",
        "O+",
        "Budi Bapak",
        "YES",
        "Sri Ibu",
        "Basketball",
        "",
        "Chess Club",
        "",
      ];
    }

    it("stages parents/health/consents/pc-activities for a new student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const body = await previewFileFull(accessToken, [
        fullRow("test_imp_rel_stage@millennia21.id", "2601019"),
      ]);
      logger.debug(body);

      const row = body.data.rows[0];
      expect(row.action).toBe("CREATE");
      expect(row.errors).toEqual([]);

      expect(row.parents).toHaveLength(2);
      expect(row.parents.find((p: any) => p.type === "FATHER")).toMatchObject(
        { full_name: "Budi Bapak", phone: "081111111111" },
      );
      expect(row.parents.find((p: any) => p.type === "MOTHER")).toMatchObject(
        { full_name: "Sri Ibu", phone: "082222222222" },
      );

      expect(row.health).toMatchObject({
        blood_type: "O+",
        needs_assistance: true,
      });

      expect(row.health_notes).toHaveLength(2);
      expect(
        row.health_notes.find((n: any) => n.category === "HEALTH_INFO"),
      ).toMatchObject({ description: "Asthma" });
      expect(
        row.health_notes.find((n: any) => n.category === "SPECIAL_NEEDS"),
      ).toMatchObject({ description: "Needs wheelchair access" });

      expect(row.consents).toHaveLength(2);
      expect(
        row.consents.find((c: any) => c.consent_type === "MEDIA_CONSENT"),
      ).toMatchObject({ signed_by: "Budi Bapak", status: "SIGNED" });
      expect(
        row.consents.find((c: any) => c.consent_type === "PARENT_CONSENT"),
      ).toMatchObject({ signed_by: "Sri Ibu", status: "SIGNED" });

      // Only Monday and Wednesday had an activity filled in.
      expect(row.pc_activities).toHaveLength(2);
      expect(row.pc_activities.map((a: any) => a.day).sort()).toEqual([
        "MONDAY",
        "WEDNESDAY",
      ]);
    });

    it("commits all relations and rollback removes them again", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const preview = await previewFileFull(accessToken, [
        fullRow("test_imp_rel_commit@millennia21.id", "2601020"),
      ]);

      const commitResponse = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      const commitBody = await commitResponse.json();
      logger.debug(commitBody);
      expect(commitResponse.status).toBe(200);
      expect(commitBody.data.status).toBe(ImportStatus.COMPLETED);

      const student = await prismaClient.person.findFirst({
        where: { email: "test_imp_rel_commit@millennia21.id" },
        include: { student: true },
      });
      const studentId = student!.student!.id;

      const parents = await prismaClient.parentGuardian.findMany({
        where: { student_id: studentId },
      });
      expect(parents).toHaveLength(2);

      const health = await prismaClient.healthRecord.findUnique({
        where: { student_id: studentId },
      });
      expect(health?.blood_type).toBe("O+");

      const notes = await prismaClient.healthNote.findMany({
        where: { student_id: studentId },
      });
      expect(notes).toHaveLength(2);

      const consents = await prismaClient.consentRecord.findMany({
        where: { student_id: studentId },
      });
      expect(consents).toHaveLength(2);

      const pcActivities = await prismaClient.passionConnectionActivity.findMany({
        where: { student_id: studentId },
      });
      expect(pcActivities).toHaveLength(2);

      // Now roll it all back.
      const rollbackResponse = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/rollback`,
        {},
        accessToken,
      );
      expect(rollbackResponse.status).toBe(200);

      const [
        parentsAfter,
        healthAfter,
        notesAfter,
        consentsAfter,
        pcActivitiesAfter,
        studentAfter,
      ] = await Promise.all([
        prismaClient.parentGuardian.findMany({
          where: { student_id: studentId, deleted_at: null },
        }),
        prismaClient.healthRecord.findUnique({
          where: { student_id: studentId },
        }),
        prismaClient.healthNote.findMany({
          where: { student_id: studentId, deleted_at: null },
        }),
        prismaClient.consentRecord.findMany({
          where: { student_id: studentId, deleted_at: null },
        }),
        prismaClient.passionConnectionActivity.findMany({
          where: { student_id: studentId, deleted_at: null },
        }),
        prismaClient.student.findUnique({ where: { id: studentId } }),
      ]);

      expect(parentsAfter).toHaveLength(0);
      expect(healthAfter?.deleted_at).not.toBeNull();
      expect(notesAfter).toHaveLength(0);
      expect(consentsAfter).toHaveLength(0);
      expect(pcActivitiesAfter).toHaveLength(0);
      expect(studentAfter?.deleted_at).not.toBeNull();
    });
  });
});
