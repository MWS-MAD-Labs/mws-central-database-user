import {
  AcademicYearStatus,
  AdminRole,
  AuditAction,
  AuditSource,
  ImportMode,
  ImportStatus,
  ImportType,
  StudentEntryType,
  StudentStatus,
  type AdminUser,
  type ImportJob,
} from "../generated/prisma/client";
import { ZodError } from "zod";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  UNKNOWN_LEGACY_GRADE_NAME,
  UNKNOWN_LEGACY_GRADE_LEVEL,
} from "../model/grade-model";
import {
  toImportJobResponse,
  toEmployeeImportJobResponse,
  normalizeGender,
  normalizeReligion,
  normalizeStudentStatus,
  parseBoolean,
  type CommitStudentImportResponse,
  type CommitEmployeeImportResponse,
  type EmployeeImportJobResponse,
  type ImportEmployeeFieldKey,
  type ImportJobResponse,
  type ImportStudentFieldKey,
  type ImportSummary,
  type PreviewEmployeeImportResponse,
  type PreviewStudentImportResponse,
  type RollbackEmployeeImportResponse,
  type RollbackStudentImportResponse,
  type RollbackSummary,
  type StagedConsent,
  type StagedEmployeeRow,
  type StagedHealthNote,
  type StagedHealthRecord,
  type StagedParentGuardian,
  type StagedPCActivity,
  type StagedRelationWrite,
  type StagedStudentRow,
  type StagedVaccineRecord,
  type StagedEnrollment,
} from "../model/import-model";
import type {
  CreateStudentRequest,
  UpdateStudentRequest,
} from "../model/student-model";
import type {
  CreateEmployeeRequest,
  UpdateEmployeeRequest,
} from "../model/employee-model";
import type {
  ConsentStatus,
  ConsentType,
  HealthNoteCategory,
  HealthNoteStatus,
  ParentType,
  PCDay,
  VaccineType,
} from "../generated/prisma/client";
import { AuditService } from "./audit-service";
import { StudentService } from "./student-service";
import { EmployeeService } from "./employee-service";
import { ParentGuardianService } from "./parent-guardian-service";
import { HealthRecordService } from "./health-record-service";
import { HealthNoteService } from "./health-note-service";
import { ConsentService } from "./consent-service";
import { PCActivityService } from "./pc-activity-service";
import { VaccineRecordService } from "./vaccine-record-service";
import { EnrollmentService } from "./enrollment-service";
import { TERMINAL_STUDENT_STATUS_TO_ENROLLMENT_STATUS } from "./student-service";
import { parseImportFile, type SheetSelector } from "../utils/import-file";
import { computeNisPrefix } from "../utils/nis-generator";
import { assertUnitJobLevelCompatible } from "../utils/employee-role-rules";
import { ImportValidation } from "../validation/import-validation";
import {
  NIS_REGEX,
  NISN_REGEX,
  StudentValidation,
} from "../validation/student-validation";
import { ParentGuardianValidation } from "../validation/parent-guardian-validation";
import { tooFarAheadMessage } from "./student-service";
import { NO_ACTIVE_ACADEMIC_YEAR_MESSAGE } from "./pc-activity-service";

// current_grade_id is a required FK, but a GRADUATED legacy row may have
// nothing on file for either Current Grade or Graduation Grade to derive it
// from - fall back to UNKNOWN_LEGACY_GRADE_NAME rather than blocking the
// whole row. Its level (0) must stay inside deriveUnitCode()'s known ranges
// (nis-generator.ts) - it's also read by the ordinary raw-NIS-prefix check
// every row with a sheet NIS goes through, not just fresh auto-generation,
// so a level that throws there breaks every row on this grade, not just the
// rare one that actually needs a new NIS generated. <=0 maps to the
// Kindergarten unit code, which is a harmless mislabel for that rare case
// (these rows almost always already carry a legacy_nis from the sheet
// instead).
type MappedRowInput = {
  row_number: number;
  mapped: Record<string, string>;
  source_raw?: Record<string, string>;
};

type ResolvedRows = {
  rows: StagedStudentRow[];
  gradeIdByName: Map<string, string>;
  academicYearIdByName: Map<string, string>;
  fallbackAcademicYearId: string | null;
  classIdByName: Map<string, string>;
};

async function recordUnauthorizedImportAction(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
): Promise<void> {
  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    new_values: { reason: `blocked student import ${action}` },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}
// SUPER_ADMIN-only for every step - preview echoes back raw staged data
// (birth dates, NIK/NPWP/bank, ...) verbatim, so a DATABASE_ADMIN could see
// it just by running someone else's file.
async function assertSuperAdminImport(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
): Promise<void> {
  if (admin.role !== AdminRole.SUPER_ADMIN) {
    await recordUnauthorizedImportAction(admin, action, context);
    throw new ResponseError(
      403,
      "Forbidden: Only Super Admin can use the import feature",
    );
  }
}

// English + Indonesian month names, e.g. "30 Maret 2023" or "30 March 2023".
const MONTH_NAME_TO_INDEX: Record<string, number> = {
  jan: 0,
  january: 0,
  januari: 0,
  feb: 1,
  february: 1,
  februari: 1,
  mar: 2,
  march: 2,
  maret: 2,
  apr: 3,
  april: 3,
  may: 4,
  mei: 4,
  jun: 5,
  june: 5,
  juni: 5,
  jul: 6,
  july: 6,
  juli: 6,
  aug: 7,
  august: 7,
  agustus: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  oktober: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
  desember: 11,
};

// Resolves religion_other for an import row. An explicit "Religion (Other)"
// column always wins when present - that's a sheet spelling out any detail
// directly, not limited to whatever aliases we happen to recognize.
// Otherwise falls back to auto-capturing the sheet's original Religion text
// when it resolves to OTHER via a known unofficial-religion alias
// (Baha'i/Sikh - a real, specific answer), so that's still distinguishable
// from a blank cell or a literal "Other" entry (mapRow() sets the sentinel
// to the literal string "OTHER" for a genuinely blank cell, indistinguishable
// from someone typing "Other" themselves - neither has more detail to
// capture).
function resolveReligionOtherDetail(
  rawReligion: string,
  explicitDetail?: string,
): string | undefined {
  const trimmedExplicit = explicitDetail?.trim();
  if (trimmedExplicit) return trimmedExplicit;

  if (!rawReligion) return undefined;
  const isLiterallyOther = rawReligion.trim().toLowerCase() === "other";
  if (isLiterallyOther) return undefined;
  return normalizeReligion(rawReligion) === "OTHER"
    ? rawReligion.trim()
    : undefined;
}

function parseFlexibleDate(dateStr: string): Date {
  if (!dateStr) throw new Error("Date string is required");

  const ddMMYYYYMatch = dateStr.match(
    /^(\d{1,2})[-.\/](\d{1,2})[-.\/](\d{4})$/,
  );
  if (ddMMYYYYMatch) {
    const [, day, month, year] = ddMMYYYYMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const ddMonthNameYYYYMatch = dateStr.match(
    /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/,
  );
  if (ddMonthNameYYYYMatch) {
    const [, day, monthStr, year] = ddMonthNameYYYYMatch;
    const monthIdx = MONTH_NAME_TO_INDEX[monthStr.toLowerCase()];
    if (monthIdx === undefined)
      throw new Error(`Unrecognized month name: ${monthStr}`);
    return new Date(Number(year), monthIdx, Number(day));
  }

  const ddMMMMatch = dateStr.match(/^(\d{1,2})[-.\/]([A-Za-z]{3})$/);
  if (ddMMMMatch) {
    const [, , monthStr] = ddMMMMatch;
    if (MONTH_NAME_TO_INDEX[monthStr.toLowerCase()] === undefined) {
      throw new Error(`Invalid month: ${monthStr}`);
    }
    throw new Error(
      `Date format missing year: "${dateStr}". Excel column may have hidden year. Unhide the column and re-export.`,
    );
  }

  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime()))
    throw new Error(`Invalid date format: ${dateStr}`);
  return parsed;
}

function buildRelationSubRows(
  mapped: Record<string, string>,
): Pick<
  StagedStudentRow,
  | "parents"
  | "health"
  | "health_notes"
  | "consents"
  | "pc_activities"
  | "vaccine_records"
  | "enrollment"
> {
  const parents: StagedParentGuardian[] = [];
  if (mapped.father_name) {
    parents.push({
      type: "FATHER",
      full_name: mapped.father_name,
      phone: mapped.father_phone || null,
      email: mapped.father_email || null,
      address: mapped.parent_address || null,
      errors: [],
      committed_id: null,
    });
  }
  if (mapped.mother_name) {
    parents.push({
      type: "MOTHER",
      full_name: mapped.mother_name,
      phone: mapped.mother_phone || null,
      email: mapped.mother_email || null,
      address: mapped.parent_address || null,
      errors: [],
      committed_id: null,
    });
  }
  // Parent Guardian export shape (Student NIS, Type, Parent/Guardian Name,
  // Phone, Email, Address, Is Primary) - one row per parent, Type-discriminated,
  // instead of the compose-new shape's fixed Father/Mother columns above.
  if (mapped.parent_type && mapped.parent_name) {
    parents.push({
      type: mapped.parent_type.trim().toUpperCase() as ParentType,
      full_name: mapped.parent_name,
      phone: mapped.parent_phone || null,
      email: mapped.parent_email || null,
      address: mapped.parent_address || null,
      is_primary: mapped.parent_is_primary
        ? parseBoolean(mapped.parent_is_primary)
        : undefined,
      errors: [],
      committed_id: null,
    });
  }

  const health: StagedHealthRecord | null =
    mapped.blood_type || mapped.special_needs
      ? {
          blood_type: mapped.blood_type || null,
          needs_assistance: Boolean(mapped.special_needs),
          errors: [],
          committed_id: null,
        }
      : null;

  const health_notes: StagedHealthNote[] = [];
  if (mapped.health_info) {
    health_notes.push({
      category: "HEALTH_INFO",
      description: mapped.health_info,
      errors: [],
      committed_id: null,
    });
  }
  if (mapped.special_needs) {
    health_notes.push({
      category: "SPECIAL_NEEDS",
      description: mapped.special_needs,
      errors: [],
      committed_id: null,
    });
  }
  // Health Notes export shape (Student NIS, Category, Description, Status,
  // Noted Date, Resolved Date) - one row per note, category/status carried
  // as explicit columns instead of the compose-new shape's fixed
  // Health Information/Special Needs columns above.
  if (mapped.note_category && mapped.note_description) {
    health_notes.push({
      category: mapped.note_category.trim().toUpperCase() as HealthNoteCategory,
      description: mapped.note_description,
      status: mapped.relation_status
        ? (mapped.relation_status.trim().toUpperCase() as HealthNoteStatus)
        : undefined,
      noted_date: mapped.noted_date || undefined,
      resolved_date: mapped.resolved_date || undefined,
      errors: [],
      committed_id: null,
    });
  }

  const consents: StagedConsent[] = [];
  if (mapped.media_consent_sign || mapped.media_consent_yes) {
    consents.push({
      consent_type: "MEDIA_CONSENT",
      signed_by: mapped.media_consent_sign || null,
      status:
        mapped.media_consent_yes?.trim().toUpperCase() === "YES"
          ? "SIGNED"
          : "PENDING",
      errors: [],
      committed_id: null,
    });
  }
  if (mapped.parent_consent_sign) {
    consents.push({
      consent_type: "PARENT_CONSENT",
      signed_by: mapped.parent_consent_sign,
      status: "SIGNED",
      errors: [],
      committed_id: null,
    });
  }
  // Consent export shape (Student NIS, Consent Type, Status, Consent Date,
  // Signed By, Validity Period) - one row per consent, consent_type carried
  // as an explicit column instead of the compose-new shape's fixed
  // Media/Parent Consent columns above.
  if (mapped.consent_type_value) {
    consents.push({
      consent_type: mapped.consent_type_value
        .trim()
        .toUpperCase() as ConsentType,
      signed_by: mapped.signed_by || null,
      status: mapped.relation_status
        ? (mapped.relation_status.trim().toUpperCase() as ConsentStatus)
        : "PENDING",
      consent_date: mapped.consent_date || undefined,
      validity_period: mapped.validity_period || undefined,
      errors: [],
      committed_id: null,
    });
  }

  const pcDayFields: [StagedPCActivity["day"], string, string][] = [
    ["MONDAY", "pc_monday", "pc_monday_mentor"],
    ["TUESDAY", "pc_tuesday", "pc_tuesday_mentor"],
    ["WEDNESDAY", "pc_wednesday", "pc_wednesday_mentor"],
    ["THURSDAY", "pc_thursday", "pc_thursday_mentor"],
  ];
  const pc_activities: StagedPCActivity[] = [];
  for (const [day, field, mentorField] of pcDayFields) {
    if (mapped[field]) {
      pc_activities.push({
        day,
        activity: mapped[field],
        mentor: mapped[mentorField] || undefined,
        errors: [],
        committed_id: null,
      });
    }
  }
  // PC Activity export shape (Student NIS, Day, Activity, Academic Year ID)
  // - one row per activity, day carried as an explicit column instead of
  // the compose-new shape's fixed PC Monday/Tuesday/... columns above.
  if (mapped.pc_day_value && mapped.pc_activity_name) {
    pc_activities.push({
      day: mapped.pc_day_value.trim().toUpperCase() as PCDay,
      activity: mapped.pc_activity_name,
      mentor: mapped.pc_mentor_email || undefined,
      academic_year_id: mapped.pc_academic_year_id || undefined,
      errors: [],
      committed_id: null,
    });
  }

  const vaccine_records: StagedVaccineRecord[] = [];
  if (mapped.vaccine_type) {
    vaccine_records.push({
      vaccine_type: mapped.vaccine_type,
      received:
        mapped.vaccine_received !== undefined
          ? parseBoolean(mapped.vaccine_received)
          : true,
      date: mapped.vaccine_date || null,
      errors: [],
      committed_id: null,
    });
  }

  const enrollment: StagedEnrollment | null = mapped.current_class
    ? {
        class_name: mapped.current_class,
        start_date: mapped.current_class_start_date || null,
        end_date: mapped.current_class_end_date || null,
        errors: [],
        committed_id: null,
      }
    : null;

  return {
    parents,
    health,
    health_notes,
    consents,
    pc_activities,
    vaccine_records,
    enrollment,
  };
}

function describeCommitError(error: unknown): string {
  if (error instanceof ResponseError) return error.message;
  if (error instanceof ZodError) {
    return error.issues.map((issue) => issue.message).join(", ");
  }
  return "unexpected error";
}

async function tryCreateRelation<T extends StagedRelationWrite>(
  item: T,
  rowErrors: string[],
  label: string,
  create: () => Promise<{ id: string }>,
): Promise<void> {
  try {
    const result = await create();
    item.committed_id = result.id;
  } catch (error) {
    const message = describeCommitError(error);
    item.errors.push(message);
    rowErrors.push(`${label} failed: ${message}`);
  }
}

async function tryRemoveRelation<T extends StagedRelationWrite>(
  item: T,
  rowErrors: string[],
  label: string,
  remove: () => Promise<unknown>,
): Promise<void> {
  if (!item.committed_id) return;
  try {
    await remove();
    item.committed_id = null;
  } catch (error) {
    rowErrors.push(
      `Rollback of ${label} failed: ${describeCommitError(error)}`,
    );
  }
}

function summarize(
  rows: { action: "CREATE" | "UPDATE" | null; errors: string[] }[],
): ImportSummary {
  const errorRows = rows.filter((row) => row.errors.length > 0);
  return {
    total_rows: rows.length,
    valid_rows: rows.length - errorRows.length,
    error_rows: errorRows.length,
    create_count: rows.filter(
      (row) => row.action === "CREATE" && row.errors.length === 0,
    ).length,
    update_count: rows.filter(
      (row) => row.action === "UPDATE" && row.errors.length === 0,
    ).length,
  };
}

function buildSourceRaw(
  headers: string[],
  values: string[],
): Record<string, string> {
  return Object.fromEntries(
    headers.map((header, index) => [header, (values[index] ?? "").trim()]),
  );
}

// parseImportFile already drops rows with literally nothing in any cell,
// but a real spreadsheet often has a checkbox/boolean column (SN, consent,
// pickup/drop, ...) whose formula got dragged down far past the last real
// row - that leaves a stray "FALSE"/"0" sitting in an otherwise-empty row,
// which is enough for that first-pass check to treat it as real data. Only
// fields that actually signal "this row represents a person" count here -
// deliberately excludes checkbox-style fields, which are exactly the ones
// prone to that drag-down leak.
function isPhantomRow(
  mapped: Record<string, string>,
  identityFields: string[],
): boolean {
  return identityFields.every((field) => !mapped[field]);
}

// PC Activity is now a master-data FK, but import sheets still carry free
// text - find-or-create by name so any value from a real sheet still works.
async function resolvePCActivityId(activityName: string): Promise<string> {
  const activity = await prismaClient.masterPCActivity.upsert({
    where: { name: activityName },
    update: {},
    create: { name: activityName },
  });
  return activity.id;
}

// Unlike resolvePCActivityId, a mentor is never auto-created from a name -
// it has to already be a real Employee. Throws (caught by
// tryCreateRelation, so it fails just this one PC activity, not the whole
// row) rather than silently dropping the mentor - a typo'd email is more
// likely a mistake worth surfacing than a legitimate "no mentor yet".
// PCActivityService.create()'s own assertMentorIsEligible() still covers
// active/teaching-role checks once resolved to an id.
async function resolveMentorId(email: string): Promise<string> {
  const employee = await prismaClient.employee.findFirst({
    where: { person: { email: email.trim() }, deleted_at: null },
  });
  if (!employee) {
    throw new ResponseError(400, `Mentor not found for email: ${email}`);
  }
  return employee.id;
}

async function resolveStagedRows(
  inputs: MappedRowInput[],
): Promise<ResolvedRows> {
  const stillNeedsGradeForGraduated = inputs.some(
    ({ mapped }) =>
      !mapped.current_grade &&
      normalizeStudentStatus(mapped.status ?? "") === "GRADUATED",
  );
  if (stillNeedsGradeForGraduated) {
    const unknownGrade = await prismaClient.grade.upsert({
      where: { name: UNKNOWN_LEGACY_GRADE_NAME },
      create: {
        name: UNKNOWN_LEGACY_GRADE_NAME,
        level: UNKNOWN_LEGACY_GRADE_LEVEL,
      },
      update: { level: UNKNOWN_LEGACY_GRADE_LEVEL },
    });
    for (const { mapped } of inputs) {
      if (
        !mapped.current_grade &&
        normalizeStudentStatus(mapped.status ?? "") === "GRADUATED"
      ) {
        mapped.current_grade = unknownGrade.name;
      }
    }
  }

  const shapeErrors = new Map<number, string[]>();
  for (const { row_number, mapped } of inputs) {
    shapeErrors.set(
      row_number,
      ImportValidation.validateStudentRowShape(mapped),
    );
  }

  const nisValues = [
    ...new Set(inputs.map((r) => r.mapped.nis).filter(Boolean)),
  ];
  const emailValues = [
    ...new Set(inputs.map((r) => r.mapped.email).filter(Boolean)),
  ];
  const gradeNames = [
    ...new Set(
      inputs
        .flatMap((r) => [
          r.mapped.current_grade?.trim().toLowerCase(),
          r.mapped.join_grade?.trim().toLowerCase(),
        ])
        .filter(Boolean),
    ),
  ] as string[];
  const yearNames = [
    ...new Set(
      inputs
        .map((r) => r.mapped.join_academic_year?.trim().toLowerCase())
        .filter(Boolean),
    ),
  ] as string[];

  const [
    existingStudents,
    existingPersonsByEmail,
    grades,
    years,
    activeYear,
    classes,
  ] = await Promise.all([
    prismaClient.student.findMany({
      where: { nis: { in: nisValues } },
      include: { person: true },
    }),
    prismaClient.person.findMany({
      where: { email: { in: emailValues } },
      include: { student: true },
    }),
    prismaClient.grade.findMany(),
    prismaClient.academicYear.findMany(),
    prismaClient.academicYear.findFirst({
      where: { status: AcademicYearStatus.ACTIVE },
    }),
    prismaClient.class.findMany(),
  ]);

  const studentByNis = new Map(existingStudents.map((s) => [s.nis, s]));
  const personByEmail = new Map(
    existingPersonsByEmail.map((p) => [p.email, p]),
  );
  const gradeIdByName = new Map(
    grades
      .filter((g) => gradeNames.includes(g.name.trim().toLowerCase()))
      .map((g) => [g.name.trim().toLowerCase(), g.id]),
  );
  const gradeByName = new Map(
    grades.map((g) => [g.name.trim().toLowerCase(), g]),
  );
  const academicYearIdByName = new Map(
    years
      .filter((y) => yearNames.includes(y.name.trim().toLowerCase()))
      .map((y) => [y.name.trim().toLowerCase(), y.id]),
  );
  const academicYearByName = new Map(
    years.map((y) => [y.name.trim().toLowerCase(), y]),
  );
  // Class names are only unique per academic year (schema:
  // @@unique([name, academic_year_id])) - scope lookup to the active year,
  // matching "Current Class" semantics.
  const classIdByName = new Map(
    classes
      .filter((c) => c.academic_year_id === activeYear?.id)
      .map((c) => [c.name.trim().toLowerCase(), c.id]),
  );
  const nisCounts = new Map<string, number>();
  const emailCounts = new Map<string, number>();
  for (const { mapped } of inputs) {
    if (mapped.nis)
      nisCounts.set(mapped.nis, (nisCounts.get(mapped.nis) ?? 0) + 1);
    if (mapped.email)
      emailCounts.set(mapped.email, (emailCounts.get(mapped.email) ?? 0) + 1);
  }

  const rows: StagedStudentRow[] = inputs.map(
    ({ row_number, mapped, source_raw }) => {
      const errors = [...(shapeErrors.get(row_number) ?? [])];
      const warnings: string[] = [];

      if (mapped.nis && (nisCounts.get(mapped.nis) ?? 0) > 1) {
        errors.push(`Duplicate NIS within the file: ${mapped.nis}`);
      }
      if (mapped.email && (emailCounts.get(mapped.email) ?? 0) > 1) {
        errors.push(`Duplicate email within the file: ${mapped.email}`);
      }

      // A row's NIS can fail to match any existing student either because
      // it's blank, or because it's a non-conforming legacy value (DB nis
      // is always null or exactly 7 digits, so anything else can never
      // match) - fall back to email in both cases so a re-imported row for
      // an already-existing student resolves to UPDATE instead of colliding
      // with the email unique constraint and erroring as a duplicate CREATE.
      let matchedStudent:
        | { id: string; person_id: string; nis: string | null }
        | undefined = mapped.nis ? studentByNis.get(mapped.nis) : undefined;
      let matchedByEmailFallback = false;
      if (!matchedStudent && mapped.email) {
        matchedStudent = personByEmail.get(mapped.email)?.student ?? undefined;
        matchedByEmailFallback = Boolean(matchedStudent);
      }
      const action: StagedStudentRow["action"] = matchedStudent
        ? "UPDATE"
        : "CREATE";

      if (matchedByEmailFallback) {
        warnings.push(
          mapped.nis
            ? `This student already exists in the database (matched by email - sheet NIS "${mapped.nis}" didn't match the stored NIS "${matchedStudent!.nis ?? "none"}", which was left unchanged). Existing record will be updated instead of creating a duplicate.`
            : `This student already exists in the database (matched by email, no NIS in this row). Existing record will be updated instead of creating a duplicate.`,
        );
      }

      if (mapped.email) {
        const emailOwner = personByEmail.get(mapped.email);
        if (emailOwner && emailOwner.id !== matchedStudent?.person_id) {
          errors.push(
            `Email already registered to another person: ${mapped.email}`,
          );
        }
      }

      if (mapped.current_grade) {
        const gradeId = gradeIdByName.get(
          mapped.current_grade.trim().toLowerCase(),
        );
        if (!gradeId) {
          errors.push(`Grade not recognized: ${mapped.current_grade}`);
        }
      }

      if (mapped.join_grade) {
        const joinGradeId = gradeIdByName.get(
          mapped.join_grade.trim().toLowerCase(),
        );
        if (!joinGradeId) {
          errors.push(`Join grade not recognized: ${mapped.join_grade}`);
        }
      }

      // A student's current grade can only ever be the same as or ahead of
      // the grade they joined at - grade level only moves forward over
      // time (repeating a grade keeps it the same, it never jumps back
      // further than that). Blank Join Grade defaults to Current Grade in
      // buildCreateRequest(), so there's nothing to compare in that case.
      // UNKNOWN_LEGACY_GRADE_NAME means "we genuinely don't know" (level 0,
      // the lowest possible), not a real regression - comparing it against
      // a real Join Grade would always fail and isn't a meaningful check.
      if (
        mapped.current_grade &&
        mapped.join_grade &&
        mapped.current_grade.trim().toLowerCase() !==
          UNKNOWN_LEGACY_GRADE_NAME.toLowerCase()
      ) {
        const currentGrade = gradeByName.get(
          mapped.current_grade.trim().toLowerCase(),
        );
        const joinGrade = gradeByName.get(
          mapped.join_grade.trim().toLowerCase(),
        );
        if (currentGrade && joinGrade && currentGrade.level < joinGrade.level) {
          errors.push(
            `Current Grade "${mapped.current_grade}" is behind Join Grade "${mapped.join_grade}" - a student can't currently be in an earlier grade than the one they joined at`,
          );
        }
      }

      const hasResolvedCurrentClass = Boolean(
        mapped.current_class &&
        classIdByName.has(mapped.current_class.trim().toLowerCase()),
      );
      if (mapped.current_class && !hasResolvedCurrentClass) {
        warnings.push(
          !activeYear
            ? `Current Class "${mapped.current_class}" can't be assigned - there is no active academic year right now. Mark one academic year ACTIVE first, then re-import.`
            : `Class not recognized in the active academic year (${activeYear.name}): ${mapped.current_class} - it may exist under a different academic year. Student will still be created without a class assignment.`,
        );
      }

      if (mapped.join_academic_year) {
        const yearId = academicYearIdByName.get(
          mapped.join_academic_year.trim().toLowerCase(),
        );
        if (!yearId) {
          errors.push(
            `Academic year not recognized: ${mapped.join_academic_year}`,
          );
        }
      } else if (action === "CREATE" && !activeYear) {
        errors.push(
          "No active academic year to default to - map a Join Academic Year column or activate one first",
        );
      }

      // Leave Year is a free-text legacy field (see student-model.ts) with
      // no spec-defined ordering rule against Join Academic Year - a
      // genuine re-enrollment (left in 2022, rejoined in 2024/2025) is rare
      // but not impossible, so this is a warning to double-check, not a
      // hard error that would block an otherwise-legitimate row.
      if (mapped.leave_year && mapped.join_academic_year) {
        const leaveYearMatch = mapped.leave_year.match(/\d{4}/);
        const joinAcademicYear = academicYearByName.get(
          mapped.join_academic_year.trim().toLowerCase(),
        );
        if (leaveYearMatch && joinAcademicYear) {
          const leaveYear = Number(leaveYearMatch[0]);
          const joinYear = joinAcademicYear.start_date.getFullYear();
          if (leaveYear < joinYear) {
            warnings.push(
              `Leave Year (${leaveYear}) is before the Join Academic Year (${mapped.join_academic_year}) - double check these aren't from a mismatched column or a different student.`,
            );
          }
        }
      }

      if (action === "CREATE" && mapped.nis) {
        const entryTypeValue = mapped.entry_type?.trim().toUpperCase();
        const entryType =
          entryTypeValue && entryTypeValue in StudentEntryType
            ? (entryTypeValue as StudentEntryType)
            : undefined;
        if (mapped.entry_type && !entryType) {
          errors.push(`Entry type not recognized: ${mapped.entry_type}`);
        }

        const grade = mapped.current_grade
          ? gradeByName.get(mapped.current_grade.trim().toLowerCase())
          : undefined;
        const academicYear = mapped.join_academic_year
          ? academicYearByName.get(
              mapped.join_academic_year.trim().toLowerCase(),
            )
          : (activeYear ?? undefined);

        const rawNis = mapped.nis;
        let isCorrectPrefixForRow = false;

        // Only checked once grade/year/entry_type resolved cleanly, to avoid
        // stacking on an already-reported error.
        if (grade && academicYear && entryType) {
          try {
            const expectedPrefix = computeNisPrefix({
              academicYear,
              gradeLevel: grade.level,
              entryType,
            });
            isCorrectPrefixForRow = rawNis.startsWith(expectedPrefix);
          } catch (error) {
            errors.push(
              error instanceof ResponseError
                ? error.message
                : "Could not validate NIS pattern",
            );
          }
        }

        // A NIS that's both 7 digits AND has the right prefix for this
        // row's own year/grade/entry-type is genuinely valid new-format -
        // use it directly. Anything else (wrong format, right format but
        // wrong prefix, or context that couldn't be resolved to check) is
        // preserved as legacy_nis instead of hard-erroring - the real nis
        // gets backfilled later via StudentService.reissueNis().
        mapped.legacy_nis = rawNis;
        if (!(NIS_REGEX.test(rawNis) && isCorrectPrefixForRow)) {
          mapped.nis = "";
        }
      }

      if (
        action === "CREATE" &&
        mapped.status &&
        normalizeStudentStatus(mapped.status) === StudentStatus.ACTIVE
      ) {
        warnings.push(
          hasResolvedCurrentClass
            ? "Status ACTIVE ignored for a new student - created as REGISTERED, then activated automatically once the Current Class assignment commits."
            : "Status ACTIVE ignored for a new student - created as REGISTERED. Activate after assigning a class.",
        );
      }

      // A terminal status with no Current Class means this student will have
      // zero enrollment history - nothing to show where they joined or left
      // from. Not blocked (some legacy records genuinely don't have a known
      // class), but flagged so it's a deliberate choice, not a silent gap.
      const importedStatus = mapped.status
        ? normalizeStudentStatus(mapped.status)
        : undefined;
      if (
        importedStatus &&
        importedStatus in TERMINAL_STUDENT_STATUS_TO_ENROLLMENT_STATUS &&
        !mapped.current_class
      ) {
        warnings.push(
          `Status ${importedStatus} with no Current Class - this student will have no class history recorded at all. Fill in Current Class if the last class they attended is known.`,
        );
      }

      const relationSubRows =
        action === "CREATE"
          ? buildRelationSubRows(mapped)
          : {
              parents: [],
              health: null,
              health_notes: [],
              consents: [],
              pc_activities: [],
              vaccine_records: [],
              enrollment: null,
            };

      // Mirrors the exact checks StudentService.create()/update() run at
      // commit (same Zod schema, same too-far-ahead comparison) so preview
      // can't report 0 errors on a row that will actually fail once
      // committed. Only attempted once the row's own fields already
      // resolved cleanly - buildCreateRequest/buildUpdateRequest assume a
      // valid grade/year lookup, and an earlier error already explains why
      // they wouldn't.
      if (errors.length === 0) {
        try {
          const zodResult =
            action === "CREATE"
              ? StudentValidation.CREATE.safeParse(
                  buildCreateRequest(
                    { raw: mapped },
                    gradeIdByName,
                    academicYearIdByName,
                    activeYear?.id ?? null,
                  ),
                )
              : StudentValidation.UPDATE.safeParse(
                  buildUpdateRequest({
                    raw: mapped,
                    matched_student_id: matchedStudent!.id,
                  }),
                );
          if (!zodResult.success) {
            for (const issue of zodResult.error.issues) {
              errors.push(issue.message);
            }
          }
        } catch {
          // Best-effort - an earlier check already covers any shape problem
          // that would make the builders themselves throw.
        }

        const currentGradeForCheck = gradeByName.get(
          mapped.current_grade!.trim().toLowerCase(),
        );
        const joinGradeForCheck = mapped.join_grade
          ? gradeByName.get(mapped.join_grade.trim().toLowerCase())
          : currentGradeForCheck;
        const joinYearForCheck = mapped.join_academic_year
          ? academicYearByName.get(
              mapped.join_academic_year.trim().toLowerCase(),
            )
          : activeYear;
        if (
          currentGradeForCheck &&
          joinGradeForCheck &&
          joinYearForCheck?.start_date &&
          currentGradeForCheck.level > joinGradeForCheck.level
        ) {
          const laterAcademicYearCount = years.filter(
            (y) =>
              y.start_date &&
              y.start_date > joinYearForCheck.start_date! &&
              y.status !== AcademicYearStatus.UPCOMING,
          ).length;
          const tooFarAheadError = tooFarAheadMessage({
            currentGrade: currentGradeForCheck,
            joinGrade: joinGradeForCheck,
            joinAcademicYear: joinYearForCheck,
            laterAcademicYearCount,
          });
          if (tooFarAheadError) errors.push(tooFarAheadError);
        }
      }

      for (const parent of relationSubRows.parents) {
        const zodResult = ParentGuardianValidation.CREATE.safeParse({
          student_id: "preview",
          type: parent.type,
          full_name: parent.full_name,
          phone: parent.phone ?? undefined,
          email: parent.email ?? undefined,
          address: parent.address ?? undefined,
          is_primary: parent.is_primary,
        });
        if (!zodResult.success) {
          for (const issue of zodResult.error.issues) {
            errors.push(
              `Parent/guardian (${parent.type}) failed: ${issue.message}`,
            );
          }
        }
      }

      for (const activity of relationSubRows.pc_activities) {
        if (!activity.academic_year_id && !activeYear) {
          errors.push(
            `PC activity (${activity.day}) failed: ${NO_ACTIVE_ACADEMIC_YEAR_MESSAGE}`,
          );
        }
      }

      return {
        row_number,
        raw: mapped,
        source_raw: source_raw ?? mapped,
        action,
        matched_student_id: matchedStudent?.id ?? null,
        errors,
        warnings,
        committed_student_id: null,
        previous_values: null,
        ...relationSubRows,
      };
    },
  );

  return {
    rows,
    gradeIdByName,
    academicYearIdByName,
    fallbackAcademicYearId: activeYear?.id ?? null,
    classIdByName,
  };
}

type ResolvedRelationRows = {
  rows: StagedStudentRow[];
  classIdByName: Map<string, string>;
};

// Relation-attach mode: every row must resolve to an ALREADY-EXISTING
// student (matched by NIS or email) - unlike full-registration mode, a miss
// is a row error, never a fallback to CREATE.
async function resolveRelationStagedRows(
  inputs: MappedRowInput[],
): Promise<ResolvedRelationRows> {
  const shapeErrors = new Map<number, string[]>();
  for (const { row_number, mapped } of inputs) {
    shapeErrors.set(
      row_number,
      ImportValidation.validateRelationRowShape(mapped),
    );
  }

  const nisValues = [
    ...new Set(inputs.map((r) => r.mapped.nis).filter(Boolean)),
  ];
  const emailValues = [
    ...new Set(inputs.map((r) => r.mapped.email).filter(Boolean)),
  ];

  const [existingStudents, existingPersonsByEmail, activeYear, classes] =
    await Promise.all([
      prismaClient.student.findMany({
        where: { nis: { in: nisValues } },
        include: { person: true },
      }),
      prismaClient.person.findMany({
        where: { email: { in: emailValues } },
        include: { student: true },
      }),
      prismaClient.academicYear.findFirst({
        where: { status: AcademicYearStatus.ACTIVE },
      }),
      prismaClient.class.findMany(),
    ]);

  const studentByNis = new Map(existingStudents.map((s) => [s.nis, s]));
  const personByEmail = new Map(
    existingPersonsByEmail.map((p) => [p.email, p]),
  );
  const classIdByName = new Map(
    classes
      .filter((c) => c.academic_year_id === activeYear?.id)
      .map((c) => [c.name.trim().toLowerCase(), c.id]),
  );

  const rows: StagedStudentRow[] = inputs.map(
    ({ row_number, mapped, source_raw }) => {
      const errors = [...(shapeErrors.get(row_number) ?? [])];
      const warnings: string[] = [];

      let matchedStudent:
        | { id: string; person_id: string; nis: string | null }
        | undefined = mapped.nis ? studentByNis.get(mapped.nis) : undefined;
      if (!matchedStudent && mapped.email) {
        matchedStudent = personByEmail.get(mapped.email)?.student ?? undefined;
      }

      if (!matchedStudent && errors.length === 0) {
        errors.push(
          mapped.nis
            ? `No existing student found matching NIS "${mapped.nis}"`
            : `No existing student found matching email "${mapped.email}"`,
        );
      }

      const relationSubRows = matchedStudent
        ? buildRelationSubRows(mapped)
        : {
            parents: [],
            health: null,
            health_notes: [],
            consents: [],
            pc_activities: [],
            vaccine_records: [],
            enrollment: null,
          };

      return {
        row_number,
        raw: mapped,
        source_raw: source_raw ?? mapped,
        action: matchedStudent ? "UPDATE" : null,
        matched_student_id: matchedStudent?.id ?? null,
        errors,
        warnings,
        committed_student_id: null,
        previous_values: null,
        ...relationSubRows,
      } satisfies StagedStudentRow;
    },
  );

  return { rows, classIdByName };
}

// Shared between full-registration CREATE rows and relation-attach rows -
// both write the same set of sub-entities against an already-known
// studentId, they just differ in how that student was resolved.
async function writeRelationSubRows(
  admin: AdminUser,
  studentId: string,
  row: StagedStudentRow,
  classIdByName: Map<string, string>,
  context: AuditRequestContext,
  now: Date,
): Promise<void> {
  for (const parent of row.parents) {
    await tryCreateRelation(
      parent,
      row.errors,
      `Parent/guardian (${parent.type})`,
      () =>
        ParentGuardianService.create(
          admin,
          {
            student_id: studentId,
            type: parent.type as ParentType,
            full_name: parent.full_name,
            phone: parent.phone ?? undefined,
            email: parent.email ?? undefined,
            address: parent.address ?? undefined,
            is_primary: parent.is_primary,
          },
          context,
          now,
        ),
    );
  }

  if (row.health) {
    await tryCreateRelation(row.health, row.errors, "Health record", () =>
      HealthRecordService.create(
        admin,
        {
          student_id: studentId,
          blood_type: row.health!.blood_type ?? undefined,
          needs_assistance: row.health!.needs_assistance,
        },
        context,
        now,
      ),
    );
  }

  for (const note of row.health_notes) {
    await tryCreateRelation(
      note,
      row.errors,
      `Health note (${note.category})`,
      () =>
        HealthNoteService.create(
          admin,
          {
            student_id: studentId,
            category: note.category as HealthNoteCategory,
            description: note.description,
            status: note.status,
            noted_date: note.noted_date
              ? new Date(note.noted_date).toISOString()
              : undefined,
            resolved_date: note.resolved_date
              ? new Date(note.resolved_date).toISOString()
              : undefined,
          },
          context,
          now,
        ),
    );
  }

  for (const consent of row.consents) {
    await tryCreateRelation(
      consent,
      row.errors,
      `Consent (${consent.consent_type})`,
      () =>
        ConsentService.create(
          admin,
          {
            student_id: studentId,
            consent_type: consent.consent_type as ConsentType,
            status: consent.status as ConsentStatus,
            signed_by: consent.signed_by ?? undefined,
            consent_date: consent.consent_date
              ? new Date(consent.consent_date).toISOString()
              : undefined,
            validity_period: consent.validity_period
              ? new Date(consent.validity_period).toISOString()
              : undefined,
          },
          context,
          now,
        ),
    );
  }

  for (const activity of row.pc_activities) {
    await tryCreateRelation(
      activity,
      row.errors,
      `PC activity (${activity.day})`,
      async () => {
        const activityId = await resolvePCActivityId(activity.activity);
        const mentorId = activity.mentor
          ? await resolveMentorId(activity.mentor)
          : undefined;
        return PCActivityService.create(
          admin,
          {
            student_id: studentId,
            day: activity.day as PCDay,
            activity_id: activityId,
            mentor_id: mentorId,
            academic_year_id: activity.academic_year_id,
          },
          context,
          now,
        );
      },
    );
  }

  for (const vaccine of row.vaccine_records) {
    await tryCreateRelation(
      vaccine,
      row.errors,
      `Vaccine record (${vaccine.vaccine_type})`,
      () =>
        VaccineRecordService.create(
          admin,
          {
            student_id: studentId,
            vaccine_type: vaccine.vaccine_type as VaccineType,
            received: vaccine.received,
            date: vaccine.date
              ? new Date(vaccine.date).toISOString()
              : undefined,
          },
          context,
          now,
        ),
    );
  }

  if (row.enrollment) {
    await tryCreateRelation(
      row.enrollment,
      row.errors,
      `Class enrollment (${row.enrollment.class_name})`,
      async () => {
        const classId = classIdByName.get(
          row.enrollment!.class_name.trim().toLowerCase(),
        );
        if (!classId) {
          throw new ResponseError(
            400,
            `Class not recognized: ${row.enrollment!.class_name}`,
          );
        }
        const enrollmentResult = await EnrollmentService.create(
          admin,
          {
            student_id: studentId,
            class_id: classId,
            start_date: row.enrollment!.start_date
              ? new Date(row.enrollment!.start_date).toISOString()
              : undefined,
          },
          context,
          now,
        );

        // Re-importing historical data (e.g. an already-graduated student) -
        // close the freshly created enrollment right away instead of
        // leaving it ACTIVE, mirroring the auto-close StudentService.update()
        // does on a live status change.
        const importedStatus = row.raw.status?.trim().toUpperCase() as
          | StudentStatus
          | undefined;
        const closingStatus = importedStatus
          ? TERMINAL_STUDENT_STATUS_TO_ENROLLMENT_STATUS[importedStatus]
          : undefined;
        if (closingStatus) {
          const endDate = row.enrollment!.end_date
            ? new Date(row.enrollment!.end_date)
            : now;
          await prismaClient.studentClassEnrollment.update({
            where: { id: enrollmentResult.id },
            data: {
              enrollment_status: closingStatus,
              end_date: endDate,
            },
          });
          await prismaClient.student.update({
            where: { id: studentId },
            data: { current_class_id: null },
          });
          await AuditService.record({
            action: AuditAction.WITHDRAW_STUDENT_ENROLLMENT,
            source: AuditSource.UI,
            entity_type: "StudentClassEnrollment",
            entity_id: enrollmentResult.id,
            admin_id: admin.id,
            old_values: { enrollment_status: "ACTIVE" },
            new_values: {
              enrollment_status: closingStatus,
              end_date: endDate.toISOString(),
            },
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          });
        }

        return enrollmentResult;
      },
    );
  }
}

// Mirrors writeRelationSubRows in reverse - shared by the full-registration
// CREATE rollback and the relation-attach rollback, both undo the same set
// of sub-entities against an already-known studentId.
async function removeRelationSubRows(
  admin: AdminUser,
  studentId: string,
  row: StagedStudentRow,
  context: AuditRequestContext,
): Promise<void> {
  for (const parent of row.parents) {
    await tryRemoveRelation(
      parent,
      row.errors,
      `Parent/guardian (${parent.type})`,
      () =>
        ParentGuardianService.remove(
          admin,
          { id: parent.committed_id!, student_id: studentId },
          context,
        ),
    );
  }
  if (row.health) {
    await tryRemoveRelation(row.health, row.errors, "Health record", () =>
      HealthRecordService.remove(admin, { student_id: studentId }, context),
    );
  }
  for (const note of row.health_notes) {
    await tryRemoveRelation(
      note,
      row.errors,
      `Health note (${note.category})`,
      () =>
        HealthNoteService.remove(
          admin,
          { id: note.committed_id!, student_id: studentId },
          context,
        ),
    );
  }
  for (const consent of row.consents) {
    await tryRemoveRelation(
      consent,
      row.errors,
      `Consent (${consent.consent_type})`,
      () =>
        ConsentService.remove(
          admin,
          { id: consent.committed_id!, student_id: studentId },
          context,
        ),
    );
  }
  for (const activity of row.pc_activities) {
    await tryRemoveRelation(
      activity,
      row.errors,
      `PC activity (${activity.day})`,
      () =>
        PCActivityService.remove(
          admin,
          { id: activity.committed_id!, student_id: studentId },
          context,
        ),
    );
  }
  for (const vaccine of row.vaccine_records) {
    await tryRemoveRelation(
      vaccine,
      row.errors,
      `Vaccine record (${vaccine.vaccine_type})`,
      () =>
        VaccineRecordService.remove(
          admin,
          { id: vaccine.committed_id!, student_id: studentId },
          context,
        ),
    );
  }
  if (row.enrollment) {
    await tryRemoveRelation(
      row.enrollment,
      row.errors,
      `Class enrollment (${row.enrollment.class_name})`,
      () =>
        EnrollmentService.remove(
          admin,
          { id: row.enrollment!.committed_id!, student_id: studentId },
          context,
        ),
    );
  }
}

async function commitRelationAttachRows(
  admin: AdminUser,
  job: ImportJob,
  context: AuditRequestContext,
  now: Date,
): Promise<CommitStudentImportResponse> {
  const stagedRows = (job.staged_rows as StagedStudentRow[] | null) ?? [];
  const inputs: MappedRowInput[] = stagedRows.map((row) => ({
    row_number: row.row_number,
    mapped: row.raw,
    source_raw: row.source_raw,
  }));

  const { rows, classIdByName } = await resolveRelationStagedRows(inputs);

  for (const row of rows) {
    if (row.errors.length > 0 || row.action === null) continue;

    try {
      const studentId = row.matched_student_id!;
      await writeRelationSubRows(
        admin,
        studentId,
        row,
        classIdByName,
        context,
        now,
      );
      row.committed_student_id = studentId;
    } catch (error) {
      row.errors.push(describeCommitError(error));
    }
  }

  const summary = summarize(rows);
  const status =
    summary.error_rows === 0
      ? ImportStatus.COMPLETED
      : summary.valid_rows === 0
        ? ImportStatus.FAILED
        : ImportStatus.PARTIAL;

  await prismaClient.importJob.update({
    where: { id: job.id },
    data: {
      status,
      valid_rows: summary.valid_rows,
      error_rows: summary.error_rows,
      staged_rows: rows,
      result_summary: summary,
      completed_at: now,
    },
  });

  await AuditService.record({
    action: AuditAction.IMPORT_DATA,
    source: AuditSource.UI,
    admin_id: admin.id,
    new_values: {
      entity: "Student",
      phase: "commit",
      mode: "relation_attach",
      job_id: job.id,
      ...summary,
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });

  return { job_id: job.id, status, summary, rows, has_more: false };
}

function buildCreateRequest(
  row: Pick<StagedStudentRow, "raw">,
  gradeIdByName: Map<string, string>,
  academicYearIdByName: Map<string, string>,
  fallbackAcademicYearId: string | null,
): CreateStudentRequest {
  const mapped = row.raw;
  const gradeId = gradeIdByName.get(
    mapped.current_grade!.trim().toLowerCase(),
  )!;
  // Blank Join Grade defaults to the current grade (a student who joined
  // and hasn't moved since) - resolveStagedRows already rejected an
  // unrecognized non-blank value, so a miss here only ever means blank.
  const joinGradeId = mapped.join_grade
    ? (gradeIdByName.get(mapped.join_grade.trim().toLowerCase()) ?? gradeId)
    : gradeId;
  const statusIsActive =
    normalizeStudentStatus(mapped.status ?? "") === StudentStatus.ACTIVE;

  return {
    full_name: mapped.full_name,
    nick_name: mapped.nick_name,
    email: mapped.email,
    gender: normalizeGender(mapped.gender) as CreateStudentRequest["gender"],
    religion: normalizeReligion(
      mapped.religion,
    ) as CreateStudentRequest["religion"],
    religion_other: resolveReligionOtherDetail(
      mapped.religion,
      mapped.religion_other,
    ),
    birth_place: mapped.birth_place,
    birth_date: parseFlexibleDate(mapped.birth_date).toISOString(),
    nis: mapped.nis || undefined,
    legacy_nis: mapped.legacy_nis || undefined,
    nisn: mapped.nisn || undefined,
    legacy_nisn: mapped.legacy_nisn || undefined,
    status: statusIsActive
      ? StudentStatus.REGISTERED
      : ((mapped.status
          ? normalizeStudentStatus(mapped.status)
          : undefined) as CreateStudentRequest["status"]),
    current_grade_id: gradeId,
    join_academic_year_id:
      (mapped.join_academic_year &&
        academicYearIdByName.get(
          mapped.join_academic_year.trim().toLowerCase(),
        )) ||
      fallbackAcademicYearId!,
    join_grade_id: joinGradeId,
    previous_school: mapped.previous_school || undefined,
    pickup_drop_service: parseBoolean(mapped.pickup_drop_service ?? ""),
    catering_service: parseBoolean(mapped.catering_service ?? ""),
    psb_guide: parseBoolean(mapped.psb_guide ?? ""),
    entry_type: mapped.entry_type
      ?.trim()
      .toUpperCase() as CreateStudentRequest["entry_type"],
    graduation_grade: mapped.graduation_grade || undefined,
    leave_year: mapped.leave_year || undefined,
    sn: mapped.sn ? parseBoolean(mapped.sn) : undefined,
  };
}

function buildUpdateRequest(
  row: Pick<StagedStudentRow, "raw" | "matched_student_id">,
): UpdateStudentRequest {
  const mapped = row.raw;
  return {
    id: row.matched_student_id!,
    full_name: mapped.full_name || undefined,
    nick_name: mapped.nick_name || undefined,
    email: mapped.email || undefined,
    gender: mapped.gender
      ? (normalizeGender(mapped.gender) as UpdateStudentRequest["gender"])
      : undefined,
    religion: mapped.religion
      ? (normalizeReligion(mapped.religion) as UpdateStudentRequest["religion"])
      : undefined,
    religion_other: resolveReligionOtherDetail(
      mapped.religion,
      mapped.religion_other,
    ),
    birth_place: mapped.birth_place || undefined,
    birth_date: mapped.birth_date
      ? parseFlexibleDate(mapped.birth_date).toISOString()
      : undefined,
    status: mapped.status
      ? (normalizeStudentStatus(
          mapped.status,
        ) as UpdateStudentRequest["status"])
      : undefined,
    previous_school: mapped.previous_school || undefined,
    nisn: mapped.nisn || undefined,
    legacy_nisn: mapped.legacy_nisn || undefined,
    graduation_grade: mapped.graduation_grade || undefined,
    leave_year: mapped.leave_year || undefined,
    // Old sheet's "SN" is a checkbox (TRUE/FALSE), not free text - matches
    // pickup_drop_service etc below.
    sn: mapped.sn ? parseBoolean(mapped.sn) : undefined,
    entry_type: mapped.entry_type
      ? (mapped.entry_type
          .trim()
          .toUpperCase() as UpdateStudentRequest["entry_type"])
      : undefined,
    pickup_drop_service: mapped.pickup_drop_service
      ? parseBoolean(mapped.pickup_drop_service)
      : undefined,
    catering_service: mapped.catering_service
      ? parseBoolean(mapped.catering_service)
      : undefined,
    psb_guide: mapped.psb_guide ? parseBoolean(mapped.psb_guide) : undefined,
  };
}

async function captureUpdateSnapshot(
  studentId: string,
  mapped: Record<string, string>,
): Promise<Record<string, string | number | boolean | null> | null> {
  const student = await prismaClient.student.findUnique({
    where: { id: studentId },
    include: { person: true },
  });
  if (!student) return null;

  const snapshot: Record<string, string | number | boolean | null> = {};
  if (mapped.full_name) snapshot.full_name = student.person.full_name;
  if (mapped.nick_name) snapshot.nick_name = student.person.nick_name;
  if (mapped.email) snapshot.email = student.person.email;
  if (mapped.gender) snapshot.gender = student.person.gender;
  if (mapped.religion) snapshot.religion = student.person.religion;
  if (mapped.birth_place) snapshot.birth_place = student.person.birth_place;
  if (mapped.birth_date) {
    snapshot.birth_date = student.person.birth_date.toISOString();
  }
  if (mapped.status) snapshot.status = student.status;
  if (mapped.previous_school) {
    snapshot.previous_school = student.previous_school;
  }
  if (mapped.pickup_drop_service) {
    snapshot.pickup_drop_service = student.pickup_drop_service;
  }
  if (mapped.catering_service) {
    snapshot.catering_service = student.catering_service;
  }
  if (mapped.psb_guide) snapshot.psb_guide = student.psb_guide;

  return snapshot;
}

function buildRevertRequest(row: StagedStudentRow): UpdateStudentRequest {
  const previous = row.previous_values!;
  return {
    id: row.committed_student_id!,
    full_name: previous.full_name as string,
    nick_name: previous.nick_name as string,
    email: previous.email as string,
    gender: previous.gender as UpdateStudentRequest["gender"],
    religion: previous.religion as UpdateStudentRequest["religion"],
    birth_place: previous.birth_place as string,
    birth_date: previous.birth_date as string,
    status: previous.status as UpdateStudentRequest["status"],
    previous_school: (previous.previous_school as string | null) ?? undefined,
    pickup_drop_service: previous.pickup_drop_service as boolean | undefined,
    catering_service: previous.catering_service as boolean | undefined,
    psb_guide: previous.psb_guide as boolean | undefined,
  };
}
type ResolvedEmployeeRows = {
  rows: StagedEmployeeRow[];
  unitIdByName: Map<string, string>;
  jobPositionIdByName: Map<string, string>;
  jobLevelIdByName: Map<string, string>;
  buildingIdByName: Map<string, string>;
};

async function resolveEmployeeStagedRows(
  inputs: MappedRowInput[],
): Promise<ResolvedEmployeeRows> {
  const shapeErrors = new Map<number, string[]>();
  for (const { row_number, mapped } of inputs) {
    shapeErrors.set(
      row_number,
      ImportValidation.validateEmployeeRowShape(mapped),
    );
  }

  const employeeIdValues = [
    ...new Set(inputs.map((r) => r.mapped.employee_id).filter(Boolean)),
  ];
  const emailValues = [
    ...new Set(inputs.map((r) => r.mapped.email).filter(Boolean)),
  ];
  const unitNames = [
    ...new Set(
      inputs.map((r) => r.mapped.unit?.trim().toLowerCase()).filter(Boolean),
    ),
  ] as string[];
  const jobPositionNames = [
    ...new Set(
      inputs
        .map((r) => r.mapped.job_position?.trim().toLowerCase())
        .filter(Boolean),
    ),
  ] as string[];
  const jobLevelNames = [
    ...new Set(
      inputs
        .map((r) => r.mapped.job_level?.trim().toLowerCase())
        .filter(Boolean),
    ),
  ] as string[];
  const buildingNames = [
    ...new Set(
      inputs
        .map((r) => r.mapped.building?.trim().toLowerCase())
        .filter(Boolean),
    ),
  ] as string[];

  const [
    existingEmployees,
    existingPersonsByEmail,
    units,
    jobPositions,
    jobLevels,
    buildings,
  ] = await Promise.all([
    prismaClient.employee.findMany({
      where: { employee_id: { in: employeeIdValues } },
      include: { person: true },
    }),
    prismaClient.person.findMany({
      where: { email: { in: emailValues } },
      include: { employee: true },
    }),
    prismaClient.masterUnit.findMany(),
    prismaClient.masterJobPosition.findMany(),
    prismaClient.masterJobLevel.findMany(),
    prismaClient.masterBuilding.findMany(),
  ]);

  const employeeByEmployeeId = new Map(
    existingEmployees.map((e) => [e.employee_id, e]),
  );
  const personByEmail = new Map(
    existingPersonsByEmail.map((p) => [p.email, p]),
  );
  const unitIdByName = new Map(
    units
      .filter((u) => unitNames.includes(u.name.trim().toLowerCase()))
      .map((u) => [u.name.trim().toLowerCase(), u.id]),
  );
  const jobPositionIdByName = new Map(
    jobPositions
      .filter((p) => jobPositionNames.includes(p.name.trim().toLowerCase()))
      .map((p) => [p.name.trim().toLowerCase(), p.id]),
  );
  const jobLevelIdByName = new Map(
    jobLevels
      .filter((l) => jobLevelNames.includes(l.name.trim().toLowerCase()))
      .map((l) => [l.name.trim().toLowerCase(), l.id]),
  );
  const buildingIdByName = new Map(
    buildings
      .filter((b) => buildingNames.includes(b.name.trim().toLowerCase()))
      .map((b) => [b.name.trim().toLowerCase(), b.id]),
  );

  const employeeIdCounts = new Map<string, number>();
  const emailCounts = new Map<string, number>();
  for (const { mapped } of inputs) {
    if (mapped.employee_id) {
      employeeIdCounts.set(
        mapped.employee_id,
        (employeeIdCounts.get(mapped.employee_id) ?? 0) + 1,
      );
    }
    if (mapped.email) {
      emailCounts.set(mapped.email, (emailCounts.get(mapped.email) ?? 0) + 1);
    }
  }

  const rows: StagedEmployeeRow[] = inputs.map(
    ({ row_number, mapped, source_raw }) => {
      const errors = [...(shapeErrors.get(row_number) ?? [])];
      const warnings: string[] = [];

      if (
        mapped.employee_id &&
        (employeeIdCounts.get(mapped.employee_id) ?? 0) > 1
      ) {
        errors.push(
          `Duplicate Employee ID within the file: ${mapped.employee_id}`,
        );
      }
      if (mapped.email && (emailCounts.get(mapped.email) ?? 0) > 1) {
        errors.push(`Duplicate email within the file: ${mapped.email}`);
      }

      const matchedEmployee = mapped.employee_id
        ? employeeByEmployeeId.get(mapped.employee_id)
        : undefined;
      const action: StagedEmployeeRow["action"] = !mapped.employee_id
        ? null
        : matchedEmployee
          ? "UPDATE"
          : "CREATE";

      if (mapped.email) {
        const emailOwner = personByEmail.get(mapped.email);
        if (emailOwner && emailOwner.id !== matchedEmployee?.person_id) {
          errors.push(
            `Email already registered to another person: ${mapped.email}`,
          );
        }
      }

      if (mapped.unit && !unitIdByName.get(mapped.unit.trim().toLowerCase())) {
        errors.push(`Unit not recognized: ${mapped.unit}`);
      }
      if (
        mapped.job_position &&
        !jobPositionIdByName.get(mapped.job_position.trim().toLowerCase())
      ) {
        errors.push(`Job position not recognized: ${mapped.job_position}`);
      }
      if (
        mapped.job_level &&
        !jobLevelIdByName.get(mapped.job_level.trim().toLowerCase())
      ) {
        errors.push(`Job level not recognized: ${mapped.job_level}`);
      }
      if (
        mapped.building &&
        !buildingIdByName.get(mapped.building.trim().toLowerCase())
      ) {
        errors.push(`Building not recognized: ${mapped.building}`);
      }

      // Only checked once unit/job_level resolved cleanly, to avoid stacking
      // on an already-reported error.
      if (
        mapped.unit &&
        mapped.job_level &&
        unitIdByName.get(mapped.unit.trim().toLowerCase()) &&
        jobLevelIdByName.get(mapped.job_level.trim().toLowerCase())
      ) {
        try {
          assertUnitJobLevelCompatible(mapped.unit, mapped.job_level);
        } catch (error) {
          errors.push(
            error instanceof ResponseError
              ? error.message
              : "Could not validate unit/job level compatibility",
          );
        }
      }

      return {
        row_number,
        raw: mapped,
        source_raw: source_raw ?? mapped,
        action,
        matched_employee_id: matchedEmployee?.id ?? null,
        errors,
        warnings,
        committed_employee_id: null,
        previous_values: null,
      };
    },
  );

  return {
    rows,
    unitIdByName,
    jobPositionIdByName,
    jobLevelIdByName,
    buildingIdByName,
  };
}

function buildEmployeeCreateRequest(
  row: StagedEmployeeRow,
  unitIdByName: Map<string, string>,
  jobPositionIdByName: Map<string, string>,
  jobLevelIdByName: Map<string, string>,
  buildingIdByName: Map<string, string>,
): CreateEmployeeRequest {
  const mapped = row.raw;
  return {
    full_name: mapped.full_name,
    nick_name: mapped.nick_name,
    email: mapped.email,
    gender: normalizeGender(mapped.gender) as CreateEmployeeRequest["gender"],
    religion: normalizeReligion(
      mapped.religion,
    ) as CreateEmployeeRequest["religion"],
    religion_other: resolveReligionOtherDetail(
      mapped.religion,
      mapped.religion_other,
    ),
    birth_place: mapped.birth_place,
    birth_date: parseFlexibleDate(mapped.birth_date).toISOString(),
    photo_url: mapped.photo_url || undefined,
    employee_id: mapped.employee_id,
    status:
      (mapped.status?.toUpperCase() as CreateEmployeeRequest["status"]) ||
      "ACTIVE",
    employment_type:
      mapped.employment_type.toUpperCase() as CreateEmployeeRequest["employment_type"],
    contract_end_date: mapped.contract_end_date
      ? parseFlexibleDate(mapped.contract_end_date).toISOString()
      : undefined,
    unit_id: unitIdByName.get(mapped.unit.trim().toLowerCase())!,
    job_position_id: jobPositionIdByName.get(
      mapped.job_position.trim().toLowerCase(),
    )!,
    job_level_id: jobLevelIdByName.get(mapped.job_level.trim().toLowerCase())!,
    building_id: buildingIdByName.get(mapped.building.trim().toLowerCase())!,
    join_date: parseFlexibleDate(mapped.join_date).toISOString(),
    last_working_date: mapped.last_working_date
      ? parseFlexibleDate(mapped.last_working_date).toISOString()
      : undefined,
    notes: mapped.notes || undefined,
    marital_status:
      mapped.marital_status.toUpperCase() as CreateEmployeeRequest["marital_status"],
    mobile_phone: mapped.mobile_phone || undefined,
    residential_address: mapped.residential_address || undefined,
    nik: mapped.nik || undefined,
    npwp: mapped.npwp || undefined,
    bank_account_number: mapped.bank_account_number || undefined,
    bpjs_number: mapped.bpjs_number || undefined,
    bpjs_employment_number: mapped.bpjs_employment_number || undefined,
    kpj_number: mapped.kpj_number || undefined,
  };
}

function buildEmployeeUpdateRequest(
  row: StagedEmployeeRow,
): UpdateEmployeeRequest {
  const mapped = row.raw;
  return {
    id: row.matched_employee_id!,
    full_name: mapped.full_name || undefined,
    nick_name: mapped.nick_name || undefined,
    email: mapped.email || undefined,
    gender: mapped.gender
      ? (normalizeGender(mapped.gender) as UpdateEmployeeRequest["gender"])
      : undefined,
    religion: mapped.religion
      ? (normalizeReligion(
          mapped.religion,
        ) as UpdateEmployeeRequest["religion"])
      : undefined,
    religion_other: resolveReligionOtherDetail(
      mapped.religion,
      mapped.religion_other,
    ),
    birth_place: mapped.birth_place || undefined,
    birth_date: mapped.birth_date
      ? parseFlexibleDate(mapped.birth_date).toISOString()
      : undefined,
    status:
      (mapped.status?.toUpperCase() as UpdateEmployeeRequest["status"]) ||
      undefined,
    employment_type:
      (mapped.employment_type?.toUpperCase() as UpdateEmployeeRequest["employment_type"]) ||
      undefined,
    contract_end_date: mapped.contract_end_date
      ? parseFlexibleDate(mapped.contract_end_date).toISOString()
      : undefined,
    join_date: mapped.join_date
      ? new Date(mapped.join_date).toISOString()
      : undefined,
    last_working_date: mapped.last_working_date
      ? new Date(mapped.last_working_date).toISOString()
      : undefined,
    notes: mapped.notes || undefined,
    marital_status:
      (mapped.marital_status?.toUpperCase() as UpdateEmployeeRequest["marital_status"]) ||
      undefined,
    mobile_phone: mapped.mobile_phone || undefined,
    residential_address: mapped.residential_address || undefined,
    nik: mapped.nik || undefined,
    npwp: mapped.npwp || undefined,
    bank_account_number: mapped.bank_account_number || undefined,
    bpjs_number: mapped.bpjs_number || undefined,
    bpjs_employment_number: mapped.bpjs_employment_number || undefined,
    kpj_number: mapped.kpj_number || undefined,
  };
}

async function captureEmployeeUpdateSnapshot(
  employeeId: string,
  mapped: Record<string, string>,
): Promise<Record<string, string | number | boolean | null> | null> {
  const employee = await prismaClient.employee.findUnique({
    where: { id: employeeId },
    include: { person: true },
  });
  if (!employee) return null;

  const snapshot: Record<string, string | number | boolean | null> = {};
  if (mapped.full_name) snapshot.full_name = employee.person.full_name;
  if (mapped.nick_name) snapshot.nick_name = employee.person.nick_name;
  if (mapped.email) snapshot.email = employee.person.email;
  if (mapped.gender) snapshot.gender = employee.person.gender;
  if (mapped.religion) snapshot.religion = employee.person.religion;
  if (mapped.birth_place) snapshot.birth_place = employee.person.birth_place;
  if (mapped.birth_date) {
    snapshot.birth_date = employee.person.birth_date.toISOString();
  }
  if (mapped.status) snapshot.status = employee.status;
  if (mapped.employment_type) {
    snapshot.employment_type = employee.employment_type;
  }
  if (mapped.join_date) snapshot.join_date = employee.join_date.toISOString();
  if (mapped.last_working_date) {
    snapshot.last_working_date = employee.last_working_date
      ? employee.last_working_date.toISOString()
      : null;
  }
  if (mapped.notes) snapshot.notes = employee.notes;
  if (mapped.marital_status) snapshot.marital_status = employee.marital_status;
  if (mapped.mobile_phone) snapshot.mobile_phone = employee.mobile_phone;
  if (mapped.residential_address) {
    snapshot.residential_address = employee.residential_address;
  }
  if (mapped.nik) snapshot.nik = employee.nik;
  if (mapped.npwp) snapshot.npwp = employee.npwp;
  if (mapped.bank_account_number) {
    snapshot.bank_account_number = employee.bank_account_number;
  }
  if (mapped.bpjs_number) snapshot.bpjs_number = employee.bpjs_number;
  if (mapped.bpjs_employment_number) {
    snapshot.bpjs_employment_number = employee.bpjs_employment_number;
  }
  if (mapped.kpj_number) snapshot.kpj_number = employee.kpj_number;

  return snapshot;
}

function buildEmployeeRevertRequest(
  row: StagedEmployeeRow,
): UpdateEmployeeRequest {
  const previous = row.previous_values!;
  return {
    id: row.committed_employee_id!,
    full_name: previous.full_name as string | undefined,
    nick_name: previous.nick_name as string | undefined,
    email: previous.email as string | undefined,
    gender: previous.gender as UpdateEmployeeRequest["gender"],
    religion: previous.religion as UpdateEmployeeRequest["religion"],
    birth_place: previous.birth_place as string | undefined,
    birth_date: previous.birth_date as string | undefined,
    status: previous.status as UpdateEmployeeRequest["status"],
    employment_type:
      previous.employment_type as UpdateEmployeeRequest["employment_type"],
    join_date: previous.join_date as string | undefined,
    last_working_date:
      (previous.last_working_date as string | null) ?? undefined,
    notes: (previous.notes as string | null) ?? undefined,
    marital_status:
      previous.marital_status as UpdateEmployeeRequest["marital_status"],
    mobile_phone: (previous.mobile_phone as string | null) ?? undefined,
    residential_address:
      (previous.residential_address as string | null) ?? undefined,
    nik: (previous.nik as string | null) ?? undefined,
    npwp: (previous.npwp as string | null) ?? undefined,
    bank_account_number:
      (previous.bank_account_number as string | null) ?? undefined,
    bpjs_number: (previous.bpjs_number as string | null) ?? undefined,
    bpjs_employment_number:
      (previous.bpjs_employment_number as string | null) ?? undefined,
    kpj_number: (previous.kpj_number as string | null) ?? undefined,
  };
}

export class ImportService {
  static async previewStudents(
    admin: AdminUser,
    file: File,
    mapping: Partial<Record<string, ImportStudentFieldKey>> | undefined,
    sheet: SheetSelector | undefined,
    mode: ImportMode = ImportMode.FULL_REGISTRATION,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<PreviewStudentImportResponse> {
    await assertSuperAdminImport(admin, "preview", context);

    const {
      headers,
      rows: rawRows,
      sheet_name,
      other_sheets,
    } = await parseImportFile(file, sheet);
    const isRelationAttach = mode === ImportMode.RELATION_ATTACH;
    // Relation-attach reads a different header set (the actual re-exported
    // sheet shape) than full-registration, so it resolves against its own
    // alias table - see DEFAULT_RELATION_HEADER_ALIASES.
    const { mapping: resolvedMapping, unmappedHeaders } = isRelationAttach
      ? ImportValidation.resolveRelationFieldMapping(headers)
      : ImportValidation.resolveFieldMapping(headers, mapping);

    const inputs: MappedRowInput[] = rawRows
      .map((values) => ({
        mapped: isRelationAttach
          ? ImportValidation.mapRelationRow(
              headers,
              values,
              resolvedMapping as Parameters<
                typeof ImportValidation.mapRelationRow
              >[2],
            )
          : ImportValidation.mapRow(
              headers,
              values,
              resolvedMapping as Parameters<typeof ImportValidation.mapRow>[2],
            ),
        source_raw: buildSourceRaw(headers, values),
      }))
      // Relation-attach is left alone - a row missing nis/email there is a
      // real, intentional error (see validateRelationRowShape), not a
      // phantom row, since it might still carry other relation data (health/
      // parent/etc) worth surfacing for the admin to fix.
      .filter(
        ({ mapped }) =>
          isRelationAttach ||
          !isPhantomRow(mapped, ["full_name", "email", "nis"]),
      )
      .map((input, index) => ({ ...input, row_number: index + 1 }));

    const { rows } = isRelationAttach
      ? await resolveRelationStagedRows(inputs)
      : await resolveStagedRows(inputs);

    if (!isRelationAttach) {
      for (const row of rows) {
        // Same reasoning as nis/legacy_nis - a legacy NISN that isn't
        // exactly 10 digits (older Dapodik records commonly ran 9) is
        // preserved as legacy_nisn instead of blocking the row.
        const rawNisn = String(row.raw.nisn || "").trim();
        if (rawNisn && !NISN_REGEX.test(rawNisn)) {
          row.raw.legacy_nisn = rawNisn;
          row.raw.nisn = "";
        }
      }
    }

    const summary = summarize(rows);

    const job = await prismaClient.importJob.create({
      data: {
        type: ImportType.STUDENT,
        mode,
        status: ImportStatus.PENDING,
        file_name: file.name,
        total_rows: summary.total_rows,
        valid_rows: summary.valid_rows,
        error_rows: summary.error_rows,
        field_mapping: resolvedMapping,
        staged_rows: rows,
        result_summary: summary,
        created_by: admin.id,
      },
    });

    await AuditService.record({
      action: AuditAction.IMPORT_DATA,
      source: AuditSource.UI,
      admin_id: admin.id,
      new_values: {
        entity: "Student",
        phase: "preview",
        mode,
        job_id: job.id,
        file_name: file.name,
        sheet_name,
        ...summary,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return {
      job_id: job.id,
      status: job.status,
      type: job.type,
      mode: job.mode,
      field_mapping: resolvedMapping as Record<string, ImportStudentFieldKey>,
      unmapped_headers: unmappedHeaders,
      summary,
      rows,
      sheet_name,
      source_headers: headers,
      other_sheets,
    };
  }

  static async commitStudents(
    admin: AdminUser,
    jobId: string,
    context: AuditRequestContext = {},
    now: Date = new Date(),
    batch?: { offset: number; limit: number },
  ): Promise<CommitStudentImportResponse> {
    await assertSuperAdminImport(admin, "commit", context);

    const job = await prismaClient.importJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.type !== ImportType.STUDENT) {
      throw new ResponseError(404, "Import job not found");
    }
    // PROCESSING is a job mid-way through a batched commit (see `batch`
    // below) - only that and the initial PENDING can still accept a commit
    // call, everything else already finished one way or another.
    if (
      job.status !== ImportStatus.PENDING &&
      job.status !== ImportStatus.PROCESSING
    ) {
      throw new ResponseError(
        400,
        `Import job already ${job.status.toLowerCase()} - it can only be committed once`,
      );
    }

    if (job.mode === ImportMode.RELATION_ATTACH) {
      return commitRelationAttachRows(admin, job, context, now);
    }

    const stagedRows = (job.staged_rows as StagedStudentRow[] | null) ?? [];
    // Unbatched (no `batch` passed) commits everything in one call, same as
    // before - a caller only needs to pass offset/limit for a large job it
    // wants broken into chunks (see the client's importCommitManager.js).
    const batchStart = batch ? Math.max(batch.offset, 0) : 0;
    const batchEnd = batch
      ? Math.min(batch.offset + batch.limit, stagedRows.length)
      : stagedRows.length;
    const hasMore = batchEnd < stagedRows.length;

    const batchInputs: MappedRowInput[] = stagedRows
      .slice(batchStart, batchEnd)
      .map((row) => ({
        row_number: row.row_number,
        mapped: row.raw,
        source_raw: row.source_raw,
      }));

    const {
      rows: batchRows,
      gradeIdByName,
      academicYearIdByName,
      fallbackAcademicYearId,
      classIdByName,
    } = await resolveStagedRows(batchInputs);

    for (const row of batchRows) {
      const rawNisn = String(row.raw.nisn || "").trim();
      if (rawNisn && !NISN_REGEX.test(rawNisn)) {
        row.raw.legacy_nisn = rawNisn;
        row.raw.nisn = "";
      }
    }

    for (const row of batchRows) {
      if (row.errors.length > 0 || row.action === null) continue;

      try {
        if (row.action === "CREATE") {
          const created = await StudentService.create(
            admin,
            buildCreateRequest(
              row,
              gradeIdByName,
              academicYearIdByName,
              fallbackAcademicYearId,
            ),
            context,
            now,
            { disableAutoGenerateNis: true },
          );
          row.committed_student_id = created.id;

          await writeRelationSubRows(
            admin,
            created.id,
            row,
            classIdByName,
            context,
            now,
          );
        } else {
          row.previous_values = await captureUpdateSnapshot(
            row.matched_student_id!,
            row.raw,
          );
          await StudentService.update(
            admin,
            buildUpdateRequest(row),
            context,
            now,
          );
          row.committed_student_id = row.matched_student_id;
        }
      } catch (error) {
        row.errors.push(describeCommitError(error));
      }
    }

    // Only the rows this batch actually touched change - everything else
    // keeps whatever an earlier batch already left there (or, for rows not
    // reached yet, their original preview-time state).
    const mergedRows = stagedRows.slice();
    for (let i = 0; i < batchRows.length; i++) {
      mergedRows[batchStart + i] = batchRows[i];
    }

    const summary = summarize(mergedRows);
    const status = hasMore
      ? ImportStatus.PROCESSING
      : summary.error_rows === 0
        ? ImportStatus.COMPLETED
        : summary.valid_rows === 0
          ? ImportStatus.FAILED
          : ImportStatus.PARTIAL;

    await prismaClient.importJob.update({
      where: { id: job.id },
      data: {
        status,
        valid_rows: summary.valid_rows,
        error_rows: summary.error_rows,
        staged_rows: mergedRows,
        result_summary: summary,
        completed_at: hasMore ? null : now,
      },
    });

    await AuditService.record({
      action: AuditAction.IMPORT_DATA,
      source: AuditSource.UI,
      admin_id: admin.id,
      new_values: {
        entity: "Student",
        phase: "commit",
        job_id: job.id,
        batch_offset: batchStart,
        batch_size: batchRows.length,
        has_more: hasMore,
        ...summary,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return {
      job_id: job.id,
      status,
      summary,
      rows: batchRows,
      has_more: hasMore,
    };
  }

  static async rollbackStudents(
    admin: AdminUser,
    jobId: string,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<RollbackStudentImportResponse> {
    await assertSuperAdminImport(admin, "rollback", context);

    const job = await prismaClient.importJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.type !== ImportType.STUDENT) {
      throw new ResponseError(404, "Import job not found");
    }
    if (
      job.status !== ImportStatus.COMPLETED &&
      job.status !== ImportStatus.PARTIAL
    ) {
      throw new ResponseError(
        400,
        `Import job is ${job.status.toLowerCase()} - only a COMPLETED or PARTIAL job can be rolled back`,
      );
    }

    const rows = (job.staged_rows as StagedStudentRow[] | null) ?? [];
    let revertedCount = 0;
    let failedCount = 0;

    for (const row of rows) {
      if (!row.committed_student_id) continue;

      try {
        if (row.action === "CREATE") {
          const studentId = row.committed_student_id;
          await removeRelationSubRows(admin, studentId, row, context);
          await StudentService.remove(admin, { id: studentId }, context);
        } else if (
          row.action === "UPDATE" &&
          job.mode === ImportMode.RELATION_ATTACH
        ) {
          // Relation-attach never touched the student's own fields - only
          // the sub-entities this row wrote need undoing.
          const studentId = row.committed_student_id;
          await removeRelationSubRows(admin, studentId, row, context);
        } else if (row.action === "UPDATE" && row.previous_values) {
          await StudentService.update(
            admin,
            buildRevertRequest(row),
            context,
            now,
          );
        }
        row.committed_student_id = null;
        revertedCount++;
      } catch (error) {
        row.errors.push(`Rollback failed: ${describeCommitError(error)}`);
        failedCount++;
      }
    }

    const summary: RollbackSummary = {
      reverted_count: revertedCount,
      failed_count: failedCount,
    };

    await prismaClient.importJob.update({
      where: { id: job.id },
      data: {
        status: ImportStatus.ROLLED_BACK,
        staged_rows: rows,
        result_summary: {
          ...(job.result_summary as Record<string, unknown> | null),
          rollback: summary,
        },
      },
    });

    await AuditService.record({
      action: AuditAction.ROLLBACK_IMPORT,
      source: AuditSource.UI,
      admin_id: admin.id,
      new_values: {
        entity: "Student",
        job_id: job.id,
        ...summary,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return {
      job_id: job.id,
      status: ImportStatus.ROLLED_BACK,
      summary,
      rows,
    };
  }

  static async getJob(id: string): Promise<ImportJobResponse> {
    const job = await prismaClient.importJob.findUnique({ where: { id } });
    if (!job || job.type !== ImportType.STUDENT) {
      throw new ResponseError(404, "Import job not found");
    }
    return toImportJobResponse(job);
  }

  static async previewEmployees(
    admin: AdminUser,
    file: File,
    mapping: Partial<Record<string, ImportEmployeeFieldKey>> | undefined,
    sheet: SheetSelector | undefined,
    context: AuditRequestContext = {},
  ): Promise<PreviewEmployeeImportResponse> {
    await assertSuperAdminImport(admin, "preview", context);

    const {
      headers,
      rows: rawRows,
      sheet_name,
      other_sheets,
    } = await parseImportFile(file, sheet);
    const { mapping: resolvedMapping, unmappedHeaders } =
      ImportValidation.resolveEmployeeFieldMapping(headers, mapping);

    const inputs: MappedRowInput[] = rawRows
      .map((values) => ({
        mapped: ImportValidation.mapEmployeeRow(
          headers,
          values,
          resolvedMapping,
        ),
        source_raw: buildSourceRaw(headers, values),
      }))
      .filter(
        ({ mapped }) =>
          !isPhantomRow(mapped, ["full_name", "email", "employee_id"]),
      )
      .map((input, index) => ({ ...input, row_number: index + 1 }));

    const { rows } = await resolveEmployeeStagedRows(inputs);
    const summary = summarize(rows);

    const job = await prismaClient.importJob.create({
      data: {
        type: ImportType.EMPLOYEE,
        status: ImportStatus.PENDING,
        file_name: file.name,
        total_rows: summary.total_rows,
        valid_rows: summary.valid_rows,
        error_rows: summary.error_rows,
        field_mapping: resolvedMapping,
        staged_rows: rows,
        result_summary: summary,
        created_by: admin.id,
      },
    });

    // Same as previewStudents - response echoes sensitive fields
    // (NIK/NPWP/bank/BPJS), audited like any other read of that data.
    await AuditService.record({
      action: AuditAction.IMPORT_DATA,
      source: AuditSource.UI,
      admin_id: admin.id,
      new_values: {
        entity: "Employee",
        phase: "preview",
        job_id: job.id,
        file_name: file.name,
        sheet_name,
        ...summary,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return {
      job_id: job.id,
      status: job.status,
      type: job.type,
      field_mapping: resolvedMapping as Record<string, ImportEmployeeFieldKey>,
      unmapped_headers: unmappedHeaders,
      summary,
      rows,
      sheet_name,
      source_headers: headers,
      other_sheets,
    };
  }

  static async commitEmployees(
    admin: AdminUser,
    jobId: string,
    context: AuditRequestContext = {},
    now: Date = new Date(),
    batch?: { offset: number; limit: number },
  ): Promise<CommitEmployeeImportResponse> {
    await assertSuperAdminImport(admin, "commit", context);

    const job = await prismaClient.importJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.type !== ImportType.EMPLOYEE) {
      throw new ResponseError(404, "Import job not found");
    }
    if (
      job.status !== ImportStatus.PENDING &&
      job.status !== ImportStatus.PROCESSING
    ) {
      throw new ResponseError(
        400,
        `Import job already ${job.status.toLowerCase()} - it can only be committed once`,
      );
    }

    const stagedRows = (job.staged_rows as StagedEmployeeRow[] | null) ?? [];
    const batchStart = batch ? Math.max(batch.offset, 0) : 0;
    const batchEnd = batch
      ? Math.min(batch.offset + batch.limit, stagedRows.length)
      : stagedRows.length;
    const hasMore = batchEnd < stagedRows.length;

    const batchInputs: MappedRowInput[] = stagedRows
      .slice(batchStart, batchEnd)
      .map((row) => ({
        row_number: row.row_number,
        mapped: row.raw,
        source_raw: row.source_raw,
      }));

    const {
      rows: batchRows,
      unitIdByName,
      jobPositionIdByName,
      jobLevelIdByName,
      buildingIdByName,
    } = await resolveEmployeeStagedRows(batchInputs);

    for (const row of batchRows) {
      if (row.errors.length > 0 || row.action === null) continue;

      try {
        if (row.action === "CREATE") {
          const created = await EmployeeService.create(
            admin,
            buildEmployeeCreateRequest(
              row,
              unitIdByName,
              jobPositionIdByName,
              jobLevelIdByName,
              buildingIdByName,
            ),
            context,
            now,
          );
          row.committed_employee_id = created.id;
        } else {
          row.previous_values = await captureEmployeeUpdateSnapshot(
            row.matched_employee_id!,
            row.raw,
          );
          await EmployeeService.update(
            admin,
            buildEmployeeUpdateRequest(row),
            context,
            now,
          );
          row.committed_employee_id = row.matched_employee_id;
        }
      } catch (error) {
        row.errors.push(describeCommitError(error));
      }
    }

    const mergedRows = stagedRows.slice();
    for (let i = 0; i < batchRows.length; i++) {
      mergedRows[batchStart + i] = batchRows[i];
    }

    const summary = summarize(mergedRows);
    const status = hasMore
      ? ImportStatus.PROCESSING
      : summary.error_rows === 0
        ? ImportStatus.COMPLETED
        : summary.valid_rows === 0
          ? ImportStatus.FAILED
          : ImportStatus.PARTIAL;

    await prismaClient.importJob.update({
      where: { id: job.id },
      data: {
        status,
        valid_rows: summary.valid_rows,
        error_rows: summary.error_rows,
        staged_rows: mergedRows,
        result_summary: summary,
        completed_at: hasMore ? null : now,
      },
    });

    await AuditService.record({
      action: AuditAction.IMPORT_DATA,
      source: AuditSource.UI,
      admin_id: admin.id,
      new_values: {
        entity: "Employee",
        phase: "commit",
        job_id: job.id,
        batch_offset: batchStart,
        batch_size: batchRows.length,
        has_more: hasMore,
        ...summary,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return {
      job_id: job.id,
      status,
      summary,
      rows: batchRows,
      has_more: hasMore,
    };
  }

  // Same tier as rollbackStudents - EmployeeService.remove() is already
  // SUPER_ADMIN-only, so this doesn't grant anything new.
  static async rollbackEmployees(
    admin: AdminUser,
    jobId: string,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<RollbackEmployeeImportResponse> {
    await assertSuperAdminImport(admin, "rollback", context);

    const job = await prismaClient.importJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.type !== ImportType.EMPLOYEE) {
      throw new ResponseError(404, "Import job not found");
    }
    if (
      job.status !== ImportStatus.COMPLETED &&
      job.status !== ImportStatus.PARTIAL
    ) {
      throw new ResponseError(
        400,
        `Import job is ${job.status.toLowerCase()} - only a COMPLETED or PARTIAL job can be rolled back`,
      );
    }

    const rows = (job.staged_rows as StagedEmployeeRow[] | null) ?? [];
    let revertedCount = 0;
    let failedCount = 0;

    for (const row of rows) {
      if (!row.committed_employee_id) continue;

      try {
        if (row.action === "CREATE") {
          await EmployeeService.remove(
            admin,
            { id: row.committed_employee_id },
            context,
          );
        } else if (row.action === "UPDATE" && row.previous_values) {
          await EmployeeService.update(
            admin,
            buildEmployeeRevertRequest(row),
            context,
            now,
          );
        }
        row.committed_employee_id = null;
        revertedCount++;
      } catch (error) {
        row.errors.push(`Rollback failed: ${describeCommitError(error)}`);
        failedCount++;
      }
    }

    const summary: RollbackSummary = {
      reverted_count: revertedCount,
      failed_count: failedCount,
    };

    await prismaClient.importJob.update({
      where: { id: job.id },
      data: {
        status: ImportStatus.ROLLED_BACK,
        staged_rows: rows,
        result_summary: {
          ...(job.result_summary as Record<string, unknown> | null),
          rollback: summary,
        },
      },
    });

    await AuditService.record({
      action: AuditAction.ROLLBACK_IMPORT,
      source: AuditSource.UI,
      admin_id: admin.id,
      new_values: {
        entity: "Employee",
        job_id: job.id,
        ...summary,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return {
      job_id: job.id,
      status: ImportStatus.ROLLED_BACK,
      summary,
      rows,
    };
  }

  static async getEmployeeJob(id: string): Promise<EmployeeImportJobResponse> {
    const job = await prismaClient.importJob.findUnique({ where: { id } });
    if (!job || job.type !== ImportType.EMPLOYEE) {
      throw new ResponseError(404, "Import job not found");
    }
    return toEmployeeImportJobResponse(job);
  }

  static async cleanupJobs(
    admin: AdminUser,
    olderThanDays: number,
    context: AuditRequestContext = {},
  ): Promise<{ deleted_count: number }> {
    await assertSuperAdminImport(admin, "cleanup", context);

    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const result = await prismaClient.importJob.deleteMany({
      where: { status: ImportStatus.PENDING, created_at: { lt: cutoff } },
    });

    return { deleted_count: result.count };
  }
}
