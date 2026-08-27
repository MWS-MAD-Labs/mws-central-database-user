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
  VaccineRecordTest,
  ClassTest,
  EnrollmentTest,
} from "./test-utils";
import {
  AcademicYearStatus,
  AuditAction,
  EnrollmentStatus,
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

const HIGHER_GRADE_NAME = "TEST_IMPORT_GRADE_HIGHER";

// One level ahead of GRADE_NAME - used to exercise the Current Grade vs
// Join Grade consistency check (current must be the same as or ahead of
// join, never behind).
async function ensureHigherGrade() {
  const grade = await prismaClient.grade.upsert({
    where: { name: HIGHER_GRADE_NAME },
    create: { name: HIGHER_GRADE_NAME, level: -8887 },
    update: {},
  });
  return grade.id;
}

const HEADERS_WITH_JOIN_GRADE = [...HEADERS, "Join Grade"];

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

async function previewFileWithJoinGrade(
  accessToken: string,
  rows: string[][],
): Promise<any> {
  const file = csvFile(HEADERS_WITH_JOIN_GRADE, rows);
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
  "Vaccine Type",
  "Vaccine Received",
  "Vaccine Date",
  "Current Class",
  "Class Start Date",
  "Class End Date",
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

async function previewFileRelationAttach(
  accessToken: string,
  rows: string[][],
): Promise<any> {
  const file = csvFile(FULL_HEADERS, rows);
  const formData = new FormData();
  formData.append("file", file);
  formData.append("import_mode", "RELATION_ATTACH");
  const response = await TestRequest.postMultipart(
    "/api/admin/students/import/preview",
    formData,
    accessToken,
  );
  return response.json();
}

// Same 31 columns as fullRow() (see FULL_HEADERS) but blank except whichever
// relation fields a given relation-attach test cares about.
function relationRow(fields: {
  nis?: string;
  email?: string;
  healthInfo?: string;
}): string[] {
  const row = new Array(FULL_HEADERS.length).fill("");
  row[6] = fields.nis ?? ""; // NIS
  row[2] = fields.email ?? ""; // Email
  row[15] = fields.healthInfo ?? ""; // Health Information
  return row;
}

// Same header/row shape export-service.ts actually produces for each
// relation sheet (HEALTH_NOTE_COLUMNS etc.) - what a user re-uploads after
// downloading one of these sheets, as opposed to relationRow()'s
// compose-a-new-sheet shape above.
async function previewFileWithHeaders(
  accessToken: string,
  headers: string[],
  rows: string[][],
): Promise<any> {
  const file = csvFile(headers, rows);
  const formData = new FormData();
  formData.append("file", file);
  formData.append("import_mode", "RELATION_ATTACH");
  const response = await TestRequest.postMultipart(
    "/api/admin/students/import/preview",
    formData,
    accessToken,
  );
  return response.json();
}

const HEALTH_NOTE_EXPORT_HEADERS = [
  "Student NIS",
  "Student Name",
  "Category",
  "Description",
  "Status",
  "Noted Date",
  "Resolved Date",
];

const VACCINE_RECORD_EXPORT_HEADERS = [
  "Student NIS",
  "Student Name",
  "Vaccine Type",
  "Received",
  "Date",
];

const PARENT_GUARDIAN_EXPORT_HEADERS = [
  "Student NIS",
  "Student Name",
  "Type",
  "Parent/Guardian Name",
  "Phone",
  "Email",
  "Address",
  "Is Primary",
];

const CONSENT_EXPORT_HEADERS = [
  "Student NIS",
  "Student Name",
  "Consent Type",
  "Status",
  "Consent Date",
  "Signed By",
  "Validity Period",
];

const PC_ACTIVITY_EXPORT_HEADERS = [
  "Student NIS",
  "Student Name",
  "Day",
  "Activity",
  "Academic Year ID",
];

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
  await VaccineRecordTest.delete();
  await EnrollmentTest.delete();
  // Class FKs to the grade/academic year that StudentTest.delete() itself
  // cleans up - must go before it, not after.
  await ClassTest.delete();
  await StudentTest.delete();
  await MasterDataTest.delete();
  await prismaClient.academicYear.deleteMany({
    where: { name: "TEST_IMPORT_LATER_YEAR" },
  });
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

    it("falls back to Graduation Grade when Current Grade is blank for a GRADUATED row", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const headers = [...HEADERS, "Graduation Grade"];
      const file = csvFile(headers, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_graduated_grade@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601005",
          "",
          "GRADUATED",
          "PSB",
          GRADE_NAME,
        ],
      ]);
      const formData = new FormData();
      formData.append("file", file);
      const response = await TestRequest.postMultipart(
        "/api/admin/students/import/preview",
        formData,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(body.data.rows[0].errors).toEqual([]);
      expect(body.data.rows[0].raw.current_grade).toBe(GRADE_NAME);
      expect(body.data.rows[0].action).toBe("CREATE");
    });

    it("still requires Current Grade when status is not GRADUATED, even with a Graduation Grade set", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const headers = [...HEADERS, "Graduation Grade"];
      const file = csvFile(headers, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_active_no_grade@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601006",
          "",
          "ACTIVE",
          "PSB",
          GRADE_NAME,
        ],
      ]);
      const formData = new FormData();
      formData.append("file", file);
      const response = await TestRequest.postMultipart(
        "/api/admin/students/import/preview",
        formData,
        accessToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(
        body.data.rows[0].errors.some((e: string) =>
          e.includes("Current Grade is required"),
        ),
      ).toBe(true);
    });

    it("falls back to a sentinel grade for a GRADUATED row with no Current Grade or Graduation Grade at all", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      // NIS column is deliberately non-empty - the sentinel grade's level
      // also runs through the raw-NIS-prefix check every CREATE row with a
      // sheet NIS goes through, not just fresh auto-generation, so a level
      // outside deriveUnitCode()'s known ranges would crash preview here.
      const body = await previewFile(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_graduated_unknown_grade@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601007",
          "",
          "GRADUATED",
          "PSB",
        ],
      ]);
      logger.debug(body);

      expect(body.data.rows[0].errors).toEqual([]);
      expect(body.data.rows[0].raw.current_grade).toBe(
        "Unknown (Legacy Import)",
      );
      expect(body.data.rows[0].action).toBe("CREATE");

      const grade = await prismaClient.grade.findUnique({
        where: { name: "Unknown (Legacy Import)" },
      });
      expect(grade).not.toBeNull();
      expect(grade?.level).toBe(0);
    });

    it("warns (but doesn't error) when a terminal-status row has no Current Class", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const body = await previewFile(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_grad_no_class@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601008",
          GRADE_NAME,
          "GRADUATED",
          "PSB",
        ],
      ]);
      logger.debug(body);

      expect(body.data.rows[0].errors).toEqual([]);
      expect(
        body.data.rows[0].warnings.some((w: string) =>
          w.includes("no class history recorded"),
        ),
      ).toBe(true);
    });

    it("defaults missing Religion/Birth Place/Birth Date to placeholders instead of erroring", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const body = await previewFile(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_missing_identity_fields@millennia21.id",
          "MALE",
          "",
          "",
          "",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);
      logger.debug(body);

      expect(body.data.rows[0].errors).toEqual([]);
      expect(body.data.rows[0].raw.religion).toBe("OTHER");
      expect(body.data.rows[0].raw.birth_place).toBe("Unknown");
      expect(body.data.rows[0].raw.birth_date).toBe("1900-01-01");

      const commitResponse = await TestRequest.post(
        `/api/admin/students/import/${body.data.job_id}/commit`,
        {},
        accessToken,
      );
      const commitBody = await commitResponse.json();
      logger.debug(commitBody);

      const created = await prismaClient.person.findFirst({
        where: { email: "test_imp_missing_identity_fields@millennia21.id" },
      });
      // A genuinely blank cell has no original text to capture - unlike
      // a real "Other" answer (e.g. Sikhism, see the test below), so
      // religion_other stays null here.
      expect(created?.religion_other).toBeNull();
    });

    it("takes the first religion when a cell lists more than one, instead of erroring", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const body = await previewFile(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_multi_religion@millennia21.id",
          "MALE",
          "Christianity - Prosestant, Islam",
          "Jakarta, 2010-05-01",
          "2601008",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);
      logger.debug(body);

      expect(body.data.rows[0].errors).toEqual([]);
      expect(body.data.rows[0].raw.religion).toBe("Christianity - Prosestant");
    });

    it("maps Sikhism to OTHER instead of erroring", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const body = await previewFile(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_sikhism@millennia21.id",
          "MALE",
          "Sikhism",
          "Jakarta, 2010-05-01",
          "2601009",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);
      logger.debug(body);

      expect(body.data.rows[0].errors).toEqual([]);
      // Preview shows the raw sheet value as-is - normalizeReligion() only
      // runs at commit time when building the actual create/update request.
      expect(body.data.rows[0].raw.religion).toBe("Sikhism");

      const commitResponse = await TestRequest.post(
        `/api/admin/students/import/${body.data.job_id}/commit`,
        {},
        accessToken,
      );
      const commitBody = await commitResponse.json();
      logger.debug(commitBody);

      const created = await prismaClient.person.findFirst({
        where: { email: "test_imp_sikhism@millennia21.id" },
      });
      expect(created?.religion).toBe("OTHER");
      // The original sheet text is captured, not just OTHER - a real,
      // specific answer, distinct from a blank cell that also lands on
      // OTHER with nothing more to say.
      expect(created?.religion_other).toBe("Sikhism");
    });

    it("prefers an explicit Religion (Other) column over the auto-captured Religion text", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const headers = [...HEADERS, "Religion (Other)"];
      const file = csvFile(headers, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_religion_other_col@millennia21.id",
          "MALE",
          "Other",
          "Jakarta, 2010-05-01",
          "2601010",
          GRADE_NAME,
          "",
          "PSB",
          "Agnostic",
        ],
      ]);
      const formData = new FormData();
      formData.append("file", file);
      const previewResponse = await TestRequest.postMultipart(
        "/api/admin/students/import/preview",
        formData,
        accessToken,
      );
      const body = await previewResponse.json();
      logger.debug(body);

      expect(body.data.rows[0].errors).toEqual([]);

      const commitResponse = await TestRequest.post(
        `/api/admin/students/import/${body.data.job_id}/commit`,
        {},
        accessToken,
      );
      const commitBody = await commitResponse.json();
      logger.debug(commitBody);

      const created = await prismaClient.person.findFirst({
        where: { email: "test_imp_religion_other_col@millennia21.id" },
      });
      expect(created?.religion).toBe("OTHER");
      // A literal "Other" in the Religion column alone would normally
      // capture nothing - the explicit column is what supplies the detail
      // here, for an answer with no built-in alias (unlike Sikhism above).
      expect(created?.religion_other).toBe("Agnostic");
    });

    it("does not flag a comma-separated academic title in Father as multiple values", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const row = [
        "Budi Santoso",
        "Budi",
        "test_imp_father_title@millennia21.id",
        "MALE",
        "ISLAM",
        "Jakarta, 2010-05-01",
        "2601010",
        GRADE_NAME,
        "",
        "PSB",
        "Mohamad Zaki Zulqornain, ST.MM",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ];
      const body = await previewFileFull(accessToken, [row]);
      logger.debug(body);

      expect(body.data.rows[0].errors).toEqual([]);
      expect(body.data.rows[0].raw.father_name).toBe(
        "Mohamad Zaki Zulqornain, ST.MM",
      );
    });

    it("does not flag two phone numbers in Mother's Phone as multiple values", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const row = [
        "Budi Santoso",
        "Budi",
        "test_imp_mother_phone@millennia21.id",
        "MALE",
        "ISLAM",
        "Jakarta, 2010-05-01",
        "2601011",
        GRADE_NAME,
        "",
        "PSB",
        "",
        "",
        "Sri Ibu",
        "085881275432, 081384430818",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ];
      const body = await previewFileFull(accessToken, [row]);
      logger.debug(body);

      expect(body.data.rows[0].errors).toEqual([]);
      expect(body.data.rows[0].raw.mother_phone).toBe(
        "085881275432, 081384430818",
      );
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

    it("matches an existing student by email as UPDATE when the row's NIS is blank", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await StudentTest.create({
        email: "test_imp_existing_blank_nis@millennia21.id",
        nis: "9100006",
      });

      const body = await previewFile(accessToken, [
        [
          "Budi Updated",
          "Budi",
          "test_imp_existing_blank_nis@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);

      expect(body.data.rows[0].errors).toEqual([]);
      expect(body.data.rows[0].action).toBe("UPDATE");
      expect(body.data.rows[0].matched_student_id).not.toBeNull();
    });

    it("flags an email that doesn't use the allowed organization domain, at preview time", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const body = await previewFile(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_bad_domain@millennia.21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601012",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);

      expect(
        body.data.rows[0].errors.some((e: string) =>
          e.includes("allowed organization domain"),
        ),
      ).toBe(true);
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

    it("rejects DATABASE_ADMIN with 403 even with full write access - commit is SUPER_ADMIN-only", async () => {
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
      // Conforming NIS also gets preserved in legacy_nis - uniform audit
      // trail across every import regardless of whether it needed reissue.
      expect(created?.student?.legacy_nis).toBe("2601007");

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

    it("creates a new student with a non-conforming legacy NIS, leaving nis null", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const preview = await previewFile(accessToken, [
        [
          "Legacy Santoso",
          "Legacy",
          "test_imp_commit_legacynis@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "9911001-OLD",
          GRADE_NAME,
          "",
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
      expect(body.data.summary.create_count).toBe(1);

      const created = await prismaClient.person.findFirst({
        where: { email: "test_imp_commit_legacynis@millennia21.id" },
        include: { student: true },
      });

      expect(created?.student?.nis).toBeNull();
      expect(created?.student?.legacy_nis).toBe("9911001-OLD"); // <--- UBAH JUGA EKSPEKTASINYA DI SINI
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

  describe("relation data (parents/health/consents/pc activities/vaccine records/enrollment)", () => {
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
        "MEASLES",
        "TRUE",
        "2024-01-15",
        "",
        "",
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
      expect(row.parents.find((p: any) => p.type === "FATHER")).toMatchObject({
        full_name: "Budi Bapak",
        phone: "081111111111",
      });
      expect(row.parents.find((p: any) => p.type === "MOTHER")).toMatchObject({
        full_name: "Sri Ibu",
        phone: "082222222222",
      });

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

      expect(row.vaccine_records).toHaveLength(1);
      expect(row.vaccine_records[0]).toMatchObject({
        vaccine_type: "MEASLES",
        received: true,
      });
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

      const pcActivities =
        await prismaClient.passionConnectionActivity.findMany({
          where: { student_id: studentId },
        });
      expect(pcActivities).toHaveLength(2);

      const vaccineRecords = await prismaClient.vaccineRecord.findMany({
        where: { student_id: studentId },
      });
      expect(vaccineRecords).toHaveLength(1);
      expect(vaccineRecords[0]?.vaccine_type).toBe("MEASLES");
      expect(vaccineRecords[0]?.received).toBe(true);

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
        vaccineRecordsAfter,
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
        prismaClient.vaccineRecord.findMany({
          where: { student_id: studentId, deleted_at: null },
        }),
        prismaClient.student.findUnique({ where: { id: studentId } }),
      ]);

      expect(parentsAfter).toHaveLength(0);
      expect(healthAfter?.deleted_at).not.toBeNull();
      expect(notesAfter).toHaveLength(0);
      expect(consentsAfter).toHaveLength(0);
      expect(pcActivitiesAfter).toHaveLength(0);
      expect(vaccineRecordsAfter).toHaveLength(0);
      expect(studentAfter?.deleted_at).not.toBeNull();
    });

    it("reports a row error when vaccine type is not a valid enum value", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const row = fullRow("test_imp_vaccine_invalid@millennia21.id", "2601021");
      // Vaccine Type is the 6th-from-last column in fullRow() (Current Class + Class Start/End Date trail it).
      row[row.length - 6] = "NOT_A_REAL_VACCINE";

      const body = await previewFileFull(accessToken, [row]);
      logger.debug(body);

      const previewRow = body.data.rows[0];
      expect(previewRow.vaccine_records).toHaveLength(1);
      expect(previewRow.vaccine_records[0].vaccine_type).toBe(
        "NOT_A_REAL_VACCINE",
      );

      const commitResponse = await TestRequest.post(
        `/api/admin/students/import/${body.data.job_id}/commit`,
        {},
        accessToken,
      );
      const commitBody = await commitResponse.json();
      logger.debug(commitBody);

      const committedRow = commitBody.data.rows[0];
      expect(committedRow.vaccine_records[0].errors.length).toBeGreaterThan(0);
      // The rest of the row still commits - only the bad vaccine row fails.
      expect(committedRow.parents).toHaveLength(2);
    });

    it("stages and commits a Current Class enrollment, and rollback removes it", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const gradeId = await ensureGradeAndYear();
      const academicYearId = await StudentTest.resolveAcademicYearId();
      const klass = await ClassTest.create({
        name: "TEST_Class_Sombrero",
        gradeId,
        academicYearId,
      });

      const row = fullRow(
        "test_imp_enrollment_commit@millennia21.id",
        "2601022",
      );
      row[row.length - 3] = klass.name;
      row[row.length - 2] = "2025-08-01";

      const preview = await previewFileFull(accessToken, [row]);
      const previewRow = preview.data.rows[0];
      expect(previewRow.warnings).toEqual([]);
      expect(previewRow.enrollment).toMatchObject({
        class_name: klass.name,
        start_date: "2025-08-01",
      });

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
        where: { email: "test_imp_enrollment_commit@millennia21.id" },
        include: { student: true },
      });
      const studentId = student!.student!.id;

      const enrollment = await prismaClient.studentClassEnrollment.findFirst({
        where: { student_id: studentId, deleted_at: null },
      });
      expect(enrollment?.class_id).toBe(klass.id);
      expect(enrollment?.start_date?.toISOString().slice(0, 10)).toBe(
        "2025-08-01",
      );

      const studentRow = await prismaClient.student.findUnique({
        where: { id: studentId },
      });
      expect(studentRow?.current_class_id).toBe(klass.id);
      expect(studentRow?.status).toBe(StudentStatus.ACTIVE);

      const rollbackResponse = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/rollback`,
        {},
        accessToken,
      );
      expect(rollbackResponse.status).toBe(200);

      const enrollmentAfter =
        await prismaClient.studentClassEnrollment.findFirst({
          where: { student_id: studentId },
        });
      expect(enrollmentAfter?.deleted_at).not.toBeNull();
    });

    it("warns at preview and reports a row error at commit when Current Class is not recognized, without blocking student creation", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const row = fullRow(
        "test_imp_enrollment_invalid@millennia21.id",
        "2601023",
      );
      row[row.length - 3] = "TEST_NOT_A_REAL_CLASS";

      const preview = await previewFileFull(accessToken, [row]);
      const previewRow = preview.data.rows[0];
      expect(previewRow.errors).toEqual([]);
      expect(
        previewRow.warnings.some((w: string) =>
          w.includes("Class not recognized"),
        ),
      ).toBe(true);

      const commitResponse = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      const commitBody = await commitResponse.json();
      logger.debug(commitBody);

      const committedRow = commitBody.data.rows[0];
      expect(committedRow.enrollment.errors.length).toBeGreaterThan(0);
      // The student itself still commits - only the enrollment fails.
      expect(committedRow.committed_student_id).toBeTruthy();
      expect(committedRow.parents).toHaveLength(2);
    });

    it("swaps the ACTIVE-status warning wording when a valid Current Class is also given", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const gradeId = await ensureGradeAndYear();
      const academicYearId = await StudentTest.resolveAcademicYearId();
      const klass = await ClassTest.create({
        name: "TEST_Class_Fedora",
        gradeId,
        academicYearId,
      });

      const row = fullRow(
        "test_imp_enrollment_active_status@millennia21.id",
        "2601024",
      );
      row[8] = "ACTIVE"; // Status column (see HEADERS).
      row[row.length - 3] = klass.name;

      const preview = await previewFileFull(accessToken, [row]);
      const previewRow = preview.data.rows[0];
      expect(
        previewRow.warnings.some((w: string) =>
          w.includes("activated automatically once the Current Class"),
        ),
      ).toBe(true);
      expect(
        previewRow.warnings.some((w: string) =>
          w.includes("Activate after assigning a class."),
        ),
      ).toBe(false);
    });

    it("closes the enrollment immediately when re-importing an already-WITHDRAWN student with Class Start/End Date", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const gradeId = await ensureGradeAndYear();
      const academicYearId = await StudentTest.resolveAcademicYearId();
      const klass = await ClassTest.create({
        name: "TEST_Class_Withdrawn",
        gradeId,
        academicYearId,
      });

      const row = fullRow(
        "test_imp_enrollment_withdrawn@millennia21.id",
        "2601025",
      );
      row[8] = "WITHDRAWN"; // Status column (see HEADERS).
      row[row.length - 3] = klass.name;
      row[row.length - 2] = "2025-08-01";
      row[row.length - 1] = "2026-03-15";

      const preview = await previewFileFull(accessToken, [row]);
      const commitResponse = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      const commitBody = await commitResponse.json();
      logger.debug(commitBody);
      expect(commitResponse.status).toBe(200);

      const committedRow = commitBody.data.rows[0];
      expect(committedRow.errors).toEqual([]);
      expect(committedRow.enrollment.committed_id).toBeTruthy();

      const student = await prismaClient.person.findFirst({
        where: { email: "test_imp_enrollment_withdrawn@millennia21.id" },
        include: { student: true },
      });
      const studentId = student!.student!.id;

      const studentRow = await prismaClient.student.findUnique({
        where: { id: studentId },
      });
      expect(studentRow?.status).toBe(StudentStatus.WITHDRAWN);
      expect(studentRow?.current_class_id).toBeNull();

      const enrollment = await prismaClient.studentClassEnrollment.findFirst({
        where: { student_id: studentId },
      });
      expect(enrollment?.enrollment_status).toBe(EnrollmentStatus.WITHDRAWN);
      expect(enrollment?.end_date?.toISOString().slice(0, 10)).toBe(
        "2026-03-15",
      );

      const auditEntry = await prismaClient.auditLog.findFirst({
        where: {
          action: AuditAction.WITHDRAW_STUDENT_ENROLLMENT,
          entity_id: enrollment!.id,
        },
      });
      expect(auditEntry).not.toBeNull();
    });
  });

  describe("relation-attach import mode", () => {
    it("preview: rejects a row with neither NIS nor Email", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const body = await previewFileRelationAttach(accessToken, [
        relationRow({ healthInfo: "Asthma" }),
      ]);

      const row = body.data.rows[0];
      expect(row.action).toBeNull();
      expect(
        row.errors.some((e: string) =>
          e.includes("Either NIS or Email is required"),
        ),
      ).toBe(true);
    });

    it("preview: errors a row whose NIS matches no existing student, instead of treating it as a new student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const body = await previewFileRelationAttach(accessToken, [
        relationRow({ nis: "9199999", healthInfo: "Asthma" }),
      ]);

      const row = body.data.rows[0];
      expect(row.action).toBeNull();
      expect(row.matched_student_id).toBeNull();
      expect(
        row.errors.some((e: string) =>
          e.includes('No existing student found matching NIS "9199999"'),
        ),
      ).toBe(true);
    });

    it("commit: attaches only a health note to the matched student - no new Student is created", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const person = await StudentTest.create({
        email: "test_imp_rel_attach@millennia21.id",
        nis: "9100030",
      });

      const studentCountBefore = await prismaClient.student.count();

      const preview = await previewFileRelationAttach(accessToken, [
        relationRow({ nis: "9100030", healthInfo: "Needs monitoring" }),
      ]);
      expect(preview.data.rows[0].action).toBe("UPDATE");
      expect(preview.data.rows[0].errors).toEqual([]);
      expect(preview.data.mode).toBe("RELATION_ATTACH");

      const commitResponse = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      const commitBody = await commitResponse.json();
      logger.debug(commitBody);
      expect(commitResponse.status).toBe(200);
      expect(commitBody.data.status).toBe(ImportStatus.COMPLETED);

      // No new student - same count as before commit.
      const studentCountAfter = await prismaClient.student.count();
      expect(studentCountAfter).toBe(studentCountBefore);

      const student = await prismaClient.student.findUnique({
        where: { person_id: person.id },
      });
      const note = await prismaClient.healthNote.findFirst({
        where: { student_id: student!.id },
      });
      expect(note?.description).toBe("Needs monitoring");
    });

    it("commit + rollback: rollback removes the attached health note without touching the student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const person = await StudentTest.create({
        email: "test_imp_rel_rollback@millennia21.id",
        nis: "9100031",
      });

      const preview = await previewFileRelationAttach(accessToken, [
        relationRow({ nis: "9100031", healthInfo: "Needs monitoring" }),
      ]);
      await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );

      const rollbackResponse = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/rollback`,
        {},
        accessToken,
      );
      const rollbackBody = await rollbackResponse.json();
      logger.debug(rollbackBody);
      expect(rollbackResponse.status).toBe(200);
      expect(rollbackBody.data.summary.reverted_count).toBe(1);

      const student = await prismaClient.student.findUnique({
        where: { person_id: person.id },
      });
      expect(student).not.toBeNull(); // Student itself untouched.

      // HealthNoteService.remove() soft-deletes - rollback undoing the
      // relation means deleted_at gets set, not the row disappearing.
      const note = await prismaClient.healthNote.findFirst({
        where: { student_id: student!.id, deleted_at: null },
      });
      expect(note).toBeNull();
    });
  });

  describe("relation-attach: actual export-sheet shapes", () => {
    it("commits a Health Notes export row (Student NIS, Category, Description, Status, dates)", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await StudentTest.create({
        email: "test_imp_export_healthnote@millennia21.id",
        nis: "9100040",
      });

      const preview = await previewFileWithHeaders(
        accessToken,
        HEALTH_NOTE_EXPORT_HEADERS,
        [
          [
            "9100040",
            "Test Student",
            "HEALTH_INFO",
            "Seasonal allergy",
            "ACTIVE",
            "2026-01-10",
            "",
          ],
        ],
      );
      expect(preview.data.rows[0].errors).toEqual([]);

      const commitResponse = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      const commitBody = await commitResponse.json();
      logger.debug(commitBody);
      expect(commitResponse.status).toBe(200);
      expect(commitBody.data.status).toBe(ImportStatus.COMPLETED);

      const student = await prismaClient.person.findFirstOrThrow({
        where: { email: "test_imp_export_healthnote@millennia21.id" },
        include: { student: true },
      });
      const note = await prismaClient.healthNote.findFirstOrThrow({
        where: { student_id: student.student!.id },
      });
      expect(note.category).toBe("HEALTH_INFO");
      expect(note.description).toBe("Seasonal allergy");
      expect(note.status).toBe("ACTIVE");
      expect(note.noted_date?.toISOString().slice(0, 10)).toBe("2026-01-10");
    });

    it("commits a Vaccine Records export row (Student NIS, Vaccine Type, Received, Date)", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await StudentTest.create({
        email: "test_imp_export_vaccine@millennia21.id",
        nis: "9100041",
      });

      const preview = await previewFileWithHeaders(
        accessToken,
        VACCINE_RECORD_EXPORT_HEADERS,
        [["9100041", "Test Student", "MEASLES", "TRUE", "2026-02-01"]],
      );
      expect(preview.data.rows[0].errors).toEqual([]);

      const commitResponse = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      expect(commitResponse.status).toBe(200);

      const student = await prismaClient.person.findFirstOrThrow({
        where: { email: "test_imp_export_vaccine@millennia21.id" },
        include: { student: true },
      });
      const vaccine = await prismaClient.vaccineRecord.findFirstOrThrow({
        where: { student_id: student.student!.id },
      });
      expect(vaccine.vaccine_type).toBe("MEASLES");
      expect(vaccine.received).toBe(true);
    });

    it("commits a Parent Guardian export row and never uses its Email column as the student matcher", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await StudentTest.create({
        email: "test_imp_export_parent@millennia21.id",
        nis: "9100042",
      });

      const preview = await previewFileWithHeaders(
        accessToken,
        PARENT_GUARDIAN_EXPORT_HEADERS,
        [
          [
            "9100042",
            "Test Student",
            "MOTHER",
            "Sri Ibu",
            "082222222222",
            "sri.ibu@example.com",
            "Jl. Mawar No. 1",
            "TRUE",
          ],
        ],
      );
      expect(preview.data.rows[0].errors).toEqual([]);

      const commitResponse = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      expect(commitResponse.status).toBe(200);

      const student = await prismaClient.person.findFirstOrThrow({
        where: { email: "test_imp_export_parent@millennia21.id" },
        include: { student: true },
      });
      const parent = await prismaClient.parentGuardian.findFirstOrThrow({
        where: { student_id: student.student!.id },
      });
      expect(parent.type).toBe("MOTHER");
      expect(parent.full_name).toBe("Sri Ibu");
      expect(parent.email).toBe("sri.ibu@example.com");

      // Same Email column, but no NIS this time and no other student
      // carries "sri.ibu@example.com" as their own email - if Email were
      // (wrongly) used as the matcher, this would still resolve rather
      // than error.
      const noMatchPreview = await previewFileWithHeaders(
        accessToken,
        PARENT_GUARDIAN_EXPORT_HEADERS,
        [
          [
            "",
            "Test Student",
            "MOTHER",
            "Sri Ibu",
            "082222222222",
            "sri.ibu@example.com",
            "Jl. Mawar No. 1",
            "TRUE",
          ],
        ],
      );
      expect(noMatchPreview.data.rows[0].action).toBeNull();
      expect(
        noMatchPreview.data.rows[0].errors.some((e: string) =>
          e.includes("Either NIS or Email is required"),
        ),
      ).toBe(true);
    });

    it("matches a student by the explicit Student Email header when NIS is blank", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await StudentTest.create({
        email: "test_imp_export_studentemail@millennia21.id",
        nis: "9100043",
      });

      const preview = await previewFileWithHeaders(
        accessToken,
        ["Student Email", ...HEALTH_NOTE_EXPORT_HEADERS.slice(1)],
        [
          [
            "test_imp_export_studentemail@millennia21.id",
            "Test Student",
            "SPECIAL_NEEDS",
            "Needs extra time on tests",
            "ACTIVE",
            "",
            "",
          ],
        ],
      );

      expect(preview.data.rows[0].action).toBe("UPDATE");
      expect(preview.data.rows[0].errors).toEqual([]);
    });

    it("commits a Consent export row (Student NIS, Consent Type, Status, dates, Signed By)", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await StudentTest.create({
        email: "test_imp_export_consent@millennia21.id",
        nis: "9100044",
      });

      const preview = await previewFileWithHeaders(
        accessToken,
        CONSENT_EXPORT_HEADERS,
        [
          [
            "9100044",
            "Test Student",
            "MEDIA_CONSENT",
            "SIGNED",
            "2026-01-05",
            "Budi Bapak",
            "2027-01-05",
          ],
        ],
      );
      expect(preview.data.rows[0].errors).toEqual([]);

      const commitResponse = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      const commitBody = await commitResponse.json();
      logger.debug(commitBody);
      expect(commitResponse.status).toBe(200);

      const student = await prismaClient.person.findFirstOrThrow({
        where: { email: "test_imp_export_consent@millennia21.id" },
        include: { student: true },
      });
      const consent = await prismaClient.consentRecord.findFirstOrThrow({
        where: { student_id: student.student!.id },
      });
      expect(consent.consent_type).toBe("MEDIA_CONSENT");
      expect(consent.status).toBe("SIGNED");
      expect(consent.signed_by).toBe("Budi Bapak");
    });

    it("commits a PC Activity export row (Student NIS, Day, Activity, Academic Year ID)", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await StudentTest.create({
        email: "test_imp_export_pcactivity@millennia21.id",
        nis: "9100045",
      });
      const activeYearId = await StudentTest.resolveAcademicYearId();

      const preview = await previewFileWithHeaders(
        accessToken,
        PC_ACTIVITY_EXPORT_HEADERS,
        [
          [
            "9100045",
            "Test Student",
            "MONDAY",
            "Basketball",
            activeYearId,
          ],
        ],
      );
      expect(preview.data.rows[0].errors).toEqual([]);

      const commitResponse = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      const commitBody = await commitResponse.json();
      logger.debug(commitBody);
      expect(commitResponse.status).toBe(200);

      const student = await prismaClient.person.findFirstOrThrow({
        where: { email: "test_imp_export_pcactivity@millennia21.id" },
        include: { student: true },
      });
      const activity = await prismaClient.passionConnectionActivity.findFirstOrThrow({
        where: { student_id: student.student!.id },
      });
      expect(activity.day).toBe("MONDAY");
      expect(activity.academic_year_id).toBe(activeYearId);
    });
  });

  describe("Current Grade vs Join Grade consistency", () => {
    it("preview: rejects a row where Current Grade is behind Join Grade", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await ensureHigherGrade();

      const body = await previewFileWithJoinGrade(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_gradebehind@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601050",
          GRADE_NAME,
          "",
          "PSB",
          HIGHER_GRADE_NAME,
        ],
      ]);

      const row = body.data.rows[0];
      expect(
        row.errors.some((e: string) => e.includes("is behind Join Grade")),
      ).toBe(true);
    });

    it("preview: allows Current Grade ahead of Join Grade (student has moved on since joining)", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await ensureHigherGrade();

      const body = await previewFileWithJoinGrade(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_gradeahead@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601051",
          HIGHER_GRADE_NAME,
          "",
          "PSB",
          GRADE_NAME,
        ],
      ]);

      const row = body.data.rows[0];
      expect(
        row.errors.some((e: string) => e.includes("is behind Join Grade")),
      ).toBe(false);
    });

    it("commit: actually saves the Join Grade column instead of always mirroring Current Grade", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const joinGradeId = await ensureGradeAndYear();
      const higherGradeId = await ensureHigherGrade();
      // A later COMPLETED/ACTIVE academic year needs to exist for a current
      // grade one level ahead of the join grade to be accepted (see
      // StudentService.create's "current grade can't be further ahead than
      // elapsed years allow" check) - UPCOMING doesn't count, it hasn't
      // actually happened yet.
      await prismaClient.academicYear.create({
        data: {
          name: "TEST_IMPORT_LATER_YEAR",
          status: AcademicYearStatus.COMPLETED,
          start_date: new Date("2027-01-01"),
          end_date: new Date("2027-12-31"),
        },
      });

      const preview = await previewFileWithJoinGrade(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_joingrade_saved@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601052",
          HIGHER_GRADE_NAME,
          "",
          "PSB",
          GRADE_NAME,
        ],
      ]);
      expect(preview.data.rows[0].errors).toEqual([]);

      const commitResponse = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      const commitBody = await commitResponse.json();
      logger.debug(commitBody);
      expect(commitResponse.status).toBe(200);
      expect(commitBody.data.summary.create_count).toBe(1);

      const student = await prismaClient.student.findFirstOrThrow({
        where: {
          person: { email: "test_imp_joingrade_saved@millennia21.id" },
        },
      });
      expect(student.current_grade_id).toBe(higherGradeId);
      expect(student.join_grade_id).toBe(joinGradeId);
    });

    it("commit: defaults Join Grade to Current Grade when the column is blank", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const gradeId = await ensureGradeAndYear();

      const preview = await previewFile(accessToken, [
        [
          "Budi Santoso",
          "Budi",
          "test_imp_joingrade_blank@millennia21.id",
          "MALE",
          "ISLAM",
          "Jakarta, 2010-05-01",
          "2601053",
          GRADE_NAME,
          "",
          "PSB",
        ],
      ]);

      const commitResponse = await TestRequest.post(
        `/api/admin/students/import/${preview.data.job_id}/commit`,
        {},
        accessToken,
      );
      expect(commitResponse.status).toBe(200);

      const student = await prismaClient.student.findFirstOrThrow({
        where: {
          person: { email: "test_imp_joingrade_blank@millennia21.id" },
        },
      });
      expect(student.current_grade_id).toBe(gradeId);
      expect(student.join_grade_id).toBe(gradeId);
    });
  });
});
