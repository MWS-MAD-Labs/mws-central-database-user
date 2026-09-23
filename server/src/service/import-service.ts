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
  type BloodType,
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
  IMPORT_EMPLOYEE_FIELDS,
  normalizeBloodType,
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
import {
  assertJobPositionJobLevelCompatibleByIds,
  assertJobPositionUnitCompatibleByIds,
  assertUnitJobLevelCompatible,
  assertUnitJobLevelCompatibleByIds,
} from "../utils/employee-role-rules";
import { withLookupCache } from "../lib/lookup-cache";
import {
  ImportValidation,
  stripOrdinalSuffix,
} from "../validation/import-validation";
import {
  NIS_REGEX,
  NISN_REGEX,
  StudentValidation,
} from "../validation/student-validation";
import { ParentGuardianValidation } from "../validation/parent-guardian-validation";
import {
  indonesianPhone,
  normalizeIndonesianPhone,
  yearsBetweenDates,
} from "../validation/validation";
import {
  EmployeeValidation,
  normalizeAlphanumeric,
  normalizeDigits,
} from "../validation/employee-validation";
import { ageMismatchMessage, tooFarAheadMessage } from "./student-service";
import { NO_ACTIVE_ACADEMIC_YEAR_MESSAGE } from "./pc-activity-service";

// Terminal legacy rows without a grade use the level-zero sentinel.
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
// Every import step is Super Admin only because staged rows contain raw PII.
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

// Explicit religion detail wins; recognized aliases preserve their source text.
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

function parseFlexibleDate(rawDateStr: string): Date {
  if (!rawDateStr) throw new Error("Date string is required");
  // Strip ordinal suffixes before date parsing.
  const dateStr = stripOrdinalSuffix(rawDateStr);

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

function normalizedEq(a: string, b: string | undefined | null): boolean {
  return a.trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

// Read calendar parts in the sheet date's local timezone.
function localYMD(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// Same idea, for a Date read back from a Postgres DATE column via Prisma -
// those round-trip as UTC midnight of the real calendar date.
function utcYMD(date: Date): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}

// Blank import cells do not clear fields or count as changes.
function matchesExistingStudent(
  mapped: Record<string, string>,
  person: {
    full_name: string;
    nick_name: string;
    email: string;
    gender: string;
    religion: string;
    birth_place: string;
    birth_date: Date;
  },
  student: {
    status: string;
    current_grade: { name: string } | null;
    join_grade: { name: string } | null;
    join_academic_year: { name: string } | null;
  },
): boolean {
  const eq = (a: string, b: string | undefined | null) =>
    a.trim().toLowerCase() === (b ?? "").trim().toLowerCase();

  if (mapped.full_name && !eq(mapped.full_name, person.full_name))
    return false;
  if (mapped.nick_name && !eq(mapped.nick_name, person.nick_name))
    return false;
  if (mapped.email && !eq(mapped.email, person.email)) return false;
  if (mapped.gender && normalizeGender(mapped.gender) !== person.gender)
    return false;
  if (
    mapped.religion &&
    normalizeReligion(mapped.religion) !== person.religion
  )
    return false;
  if (mapped.birth_place && !eq(mapped.birth_place, person.birth_place))
    return false;
  if (mapped.birth_date) {
    try {
      // Compare sheet-local and database UTC dates by their represented calendar day.
      const mappedDate = parseFlexibleDate(mapped.birth_date);
      const mappedYMD = `${mappedDate.getFullYear()}-${mappedDate.getMonth()}-${mappedDate.getDate()}`;
      const existingYMD = `${person.birth_date.getUTCFullYear()}-${person.birth_date.getUTCMonth()}-${person.birth_date.getUTCDate()}`;
      if (mappedYMD !== existingYMD) return false;
    } catch {
      // An unparseable date is a different problem (already surfaced
      // elsewhere) - don't let it also block the identical-row check.
    }
  }
  if (mapped.status && normalizeStudentStatus(mapped.status) !== student.status)
    return false;
  if (
    mapped.current_grade &&
    !eq(mapped.current_grade, student.current_grade?.name)
  )
    return false;
  if (mapped.join_grade && !eq(mapped.join_grade, student.join_grade?.name))
    return false;
  if (
    mapped.join_academic_year &&
    !eq(mapped.join_academic_year, student.join_academic_year?.name)
  )
    return false;

  return true;
}

// Normalize one valid parent phone; preserve ambiguous values as legacy text.
function normalizePhoneOrLegacy(raw: string): {
  phone: string | null;
  legacy_phone: string | null;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { phone: null, legacy_phone: null };

  // More than one number in the cell - can't safely tell which is primary.
  if (/[/,]/.test(trimmed)) {
    return { phone: null, legacy_phone: trimmed };
  }

  let candidate = trimmed.replace(/[^\d+]/g, "");
  if (/^8\d{8,11}$/.test(candidate)) {
    candidate = `0${candidate}`;
  }

  return indonesianPhone().safeParse(candidate).success
    ? { phone: candidate, legacy_phone: null }
    : { phone: null, legacy_phone: trimmed };
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
    const fatherPhone = normalizePhoneOrLegacy(mapped.father_phone || "");
    parents.push({
      type: "FATHER",
      full_name: mapped.father_name,
      phone: fatherPhone.phone,
      legacy_phone: fatherPhone.legacy_phone,
      email: mapped.father_email || null,
      address: mapped.parent_address || null,
      errors: [],
      committed_id: null,
    });
  }
  if (mapped.mother_name) {
    const motherPhone = normalizePhoneOrLegacy(mapped.mother_phone || "");
    parents.push({
      type: "MOTHER",
      full_name: mapped.mother_name,
      phone: motherPhone.phone,
      legacy_phone: motherPhone.legacy_phone,
      email: mapped.mother_email || null,
      address: mapped.parent_address || null,
      errors: [],
      committed_id: null,
    });
  }
  // Parent export uses one type-discriminated row per contact.
  if (mapped.parent_type && mapped.parent_name) {
    const parentPhone = normalizePhoneOrLegacy(mapped.parent_phone || "");
    parents.push({
      type: mapped.parent_type.trim().toUpperCase() as ParentType,
      full_name: mapped.parent_name,
      phone: parentPhone.phone,
      legacy_phone: parentPhone.legacy_phone,
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
          blood_type: mapped.blood_type
            ? normalizeBloodType(mapped.blood_type)
            : null,
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
  // Health-note export uses one row per note.
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
  // Consent export uses one row per consent type.
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

  const pcDayFields: [StagedPCActivity["day"], string][] = [
    ["MONDAY", "pc_monday"],
    ["TUESDAY", "pc_tuesday"],
    ["WEDNESDAY", "pc_wednesday"],
    ["THURSDAY", "pc_thursday"],
  ];
  const pc_activities: StagedPCActivity[] = [];
  for (const [day, field] of pcDayFields) {
    if (mapped[field]) {
      pc_activities.push({
        day,
        activity: mapped[field],
        errors: [],
        committed_id: null,
      });
    }
  }
  // PC activity export uses one row per activity and day.
  if (mapped.pc_day_value && mapped.pc_activity_name) {
    pc_activities.push({
      day: mapped.pc_day_value.trim().toUpperCase() as PCDay,
      activity: mapped.pc_activity_name,
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
  const validRows = rows.length - errorRows.length;
  const createCount = rows.filter(
    (row) => row.action === "CREATE" && row.errors.length === 0,
  ).length;
  const updateCount = rows.filter(
    (row) => row.action === "UPDATE" && row.errors.length === 0,
  ).length;
  return {
    total_rows: rows.length,
    valid_rows: validRows,
    error_rows: errorRows.length,
    create_count: createCount,
    update_count: updateCount,
    skip_count: validRows - createCount - updateCount,
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

// Ignore rows containing only dragged-down checkbox or boolean values.
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

async function resolveStagedRows(
  inputs: MappedRowInput[],
): Promise<ResolvedRows> {
  // Terminal rows without a current grade use the unknown legacy sentinel.
  const stillNeedsGradeForTerminalStatus = inputs.some(
    ({ mapped }) =>
      !mapped.current_grade &&
      normalizeStudentStatus(mapped.status ?? "") in
        TERMINAL_STUDENT_STATUS_TO_ENROLLMENT_STATUS,
  );
  if (stillNeedsGradeForTerminalStatus) {
    const unknownGrade = await prismaClient.grade.upsert({
      where: { name: UNKNOWN_LEGACY_GRADE_NAME },
      create: {
        name: UNKNOWN_LEGACY_GRADE_NAME,
        level: UNKNOWN_LEGACY_GRADE_LEVEL,
        unit_id: "unit_unknown_legacy",
      },
      update: {
        level: UNKNOWN_LEGACY_GRADE_LEVEL,
        unit_id: "unit_unknown_legacy",
      },
    });
    for (const { mapped } of inputs) {
      if (
        !mapped.current_grade &&
        normalizeStudentStatus(mapped.status ?? "") in
          TERMINAL_STUDENT_STATUS_TO_ENROLLMENT_STATUS
      ) {
        mapped.current_grade = unknownGrade.name;
        // Mark the resolved sentinel as an import default.
        mapped.__defaulted_current_grade = "1";
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

  // Narrow possible duplicate checks by exact birth date.
  const birthDateValues = [
    ...new Map(
      inputs
        .map(({ mapped }) => {
          if (!mapped.birth_date) return null;
          try {
            const parsed = parseFlexibleDate(mapped.birth_date);
            return new Date(
              Date.UTC(
                parsed.getFullYear(),
                parsed.getMonth(),
                parsed.getDate(),
              ),
            );
          } catch {
            return null;
          }
        })
        .filter((value): value is Date => value !== null)
        .map((date) => [date.getTime(), date] as const),
    ).values(),
  ];

  const [
    existingStudents,
    existingPersonsByEmail,
    possibleDuplicateCandidates,
    grades,
    years,
    activeYear,
    classes,
  ] = await Promise.all([
    prismaClient.student.findMany({
      where: { nis: { in: nisValues } },
      include: {
        person: true,
        current_grade: true,
        join_grade: true,
        join_academic_year: true,
      },
    }),
    prismaClient.person.findMany({
      where: { email: { in: emailValues } },
      include: {
        student: {
          include: { current_grade: true, join_grade: true, join_academic_year: true },
        },
      },
    }),
    prismaClient.student.findMany({
      where: { person: { birth_date: { in: birthDateValues } } },
      include: {
        person: true,
        parents: { where: { deleted_at: null } },
      },
    }),
    prismaClient.grade.findMany(),
    prismaClient.academicYear.findMany(),
    prismaClient.academicYear.findFirst({
      where: { status: AcademicYearStatus.ACTIVE },
    }),
    prismaClient.class.findMany(),
  ]);

  // Grouped by birth date so the per-row check below is an O(1) lookup, not
  // a full scan of every candidate for every row.
  const duplicateCandidatesByBirthDate = new Map<
    string,
    typeof possibleDuplicateCandidates
  >();
  for (const candidate of possibleDuplicateCandidates) {
    const key = utcYMD(candidate.person.birth_date);
    const list = duplicateCandidatesByBirthDate.get(key) ?? [];
    list.push(candidate);
    duplicateCandidatesByBirthDate.set(key, list);
  }

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
  // Resolve current class names within the active academic year.
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
      const defaultedFieldKeys: string[] = [];

      if (mapped.__defaulted_religion) {
        warnings.push(
          "Religion was blank - defaulted to OTHER. Fill in the real value if known.",
        );
        defaultedFieldKeys.push("religion");
      }
      if (mapped.__defaulted_birth_place) {
        warnings.push(
          "Birth Place was blank - defaulted to \"Unknown\". Fill in the real value if known.",
        );
        defaultedFieldKeys.push("birth_place");
      }
      if (mapped.__defaulted_birth_date) {
        warnings.push(
          "Birth Date was blank - defaulted to 1900-01-01. Fill in the real value if known.",
        );
        defaultedFieldKeys.push("birth_date");
      }
      if (mapped.__defaulted_status) {
        warnings.push(
          "Status was blank - defaults to REGISTERED for a new student, or stays unchanged for an existing one. Fill in the real value if known.",
        );
        defaultedFieldKeys.push("status");
      }
      if (mapped.__defaulted_current_grade) {
        warnings.push(
          `Current Grade was blank - defaulted to "${UNKNOWN_LEGACY_GRADE_NAME}" (${mapped.status || "terminal status"} with no grade on file). Fill in the real value if known.`,
        );
        defaultedFieldKeys.push("current_grade");
      }
      // Strip internal markers from raw output but retain their field list.
      delete mapped.__defaulted_religion;
      delete mapped.__defaulted_birth_place;
      delete mapped.__defaulted_birth_date;
      delete mapped.__defaulted_status;
      delete mapped.__defaulted_current_grade;
      if (defaultedFieldKeys.length > 0) {
        mapped.import_defaulted_fields = defaultedFieldKeys.join(",");
      }

      if (mapped.nis && (nisCounts.get(mapped.nis) ?? 0) > 1) {
        errors.push(`Duplicate NIS within the file: ${mapped.nis}`);
      }
      if (mapped.email && (emailCounts.get(mapped.email) ?? 0) > 1) {
        errors.push(`Duplicate email within the file: ${mapped.email}`);
      }

      // Fall back to email when NIS is blank or nonconforming legacy data.
      let matchedStudent:
        | (typeof existingStudents)[number]
        | NonNullable<(typeof existingPersonsByEmail)[number]["student"]>
        | undefined = mapped.nis ? studentByNis.get(mapped.nis) : undefined;
      let matchedByEmailFallback = false;
      if (!matchedStudent && mapped.email) {
        matchedStudent = personByEmail.get(mapped.email)?.student ?? undefined;
        matchedByEmailFallback = Boolean(matchedStudent);
      }
      const action: StagedStudentRow["action"] = matchedStudent
        ? "UPDATE"
        : "CREATE";
      // Default blank status only for creates; updates preserve existing status.
      if (!mapped.status && action === "CREATE") {
        mapped.status = "REGISTERED";
      }

      if (matchedByEmailFallback) {
        warnings.push(
          mapped.nis
            ? `This student already exists in the database (matched by email - sheet NIS "${mapped.nis}" didn't match the stored NIS "${matchedStudent!.nis ?? "none"}", which was left unchanged). Existing record will be updated instead of creating a duplicate.`
            : `This student already exists in the database (matched by email, no NIS in this row). Existing record will be updated instead of creating a duplicate.`,
        );
      }

      // Ignore ACTIVE updates when the existing student has no active class.
      if (
        action === "UPDATE" &&
        mapped.status &&
        normalizeStudentStatus(mapped.status) === StudentStatus.ACTIVE &&
        !matchedStudent?.current_class_id
      ) {
        warnings.push(
          "Status ACTIVE in the sheet ignored for this update. The existing record has no active class enrollment, so committing this would fail. Existing status left unchanged. Activate after assigning a class.",
        );
        mapped.status = "";
      }

      const matchedPerson = matchedStudent
        ? matchedByEmailFallback
          ? personByEmail.get(mapped.email!)
          : "person" in matchedStudent
            ? matchedStudent.person
            : undefined
        : undefined;
      const noChanges =
        action === "UPDATE" &&
        matchedStudent &&
        matchedPerson &&
        matchesExistingStudent(mapped, matchedPerson, matchedStudent);
      if (noChanges) {
        warnings.push(
          "No changes, identical to the existing record. Recommended: uncheck this row, nothing to update.",
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

      // Current grade cannot precede a known join grade.
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
        if (
          currentGrade &&
          joinGrade &&
          currentGrade.level < joinGrade.level &&
          !mapped.override_too_far_ahead_reason
        ) {
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

      // A leave year before join year is a warning because re-enrollment is valid.
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

        // Preserve invalid or mismatched NIS values as legacy data.
        mapped.legacy_nis = rawNis;
        if (!(NIS_REGEX.test(rawNis) && isCorrectPrefixForRow)) {
          mapped.nis = "";
        }
      }

      // Move non-10-digit NISN values to legacy_nisn before strict validation.
      const rawNisn = String(mapped.nisn || "").trim();
      if (rawNisn && !NISN_REGEX.test(rawNisn)) {
        mapped.legacy_nisn = rawNisn;
        mapped.nisn = "";
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

      // Warn on matching identity details despite different names and identifiers.
      if (
        action === "CREATE" &&
        mapped.birth_date &&
        mapped.birth_place &&
        (mapped.father_name || mapped.mother_name)
      ) {
        try {
          const parsedBirthDate = parseFlexibleDate(mapped.birth_date);
          const candidates =
            duplicateCandidatesByBirthDate.get(localYMD(parsedBirthDate)) ??
            [];
          const duplicate = candidates.find((candidate) => {
            if (!normalizedEq(mapped.birth_place, candidate.person.birth_place))
              return false;
            return candidate.parents.some(
              (parent) =>
                (mapped.father_name &&
                  normalizedEq(mapped.father_name, parent.full_name)) ||
                (mapped.mother_name &&
                  normalizedEq(mapped.mother_name, parent.full_name)),
            );
          });
          if (duplicate) {
            warnings.push(
              `Possible duplicate of existing student "${duplicate.person.full_name}". Birth date, birth place, and a parent's name all match. Double check before creating a new record.`,
            );
          }
        } catch {
          // Unparseable birth_date is already surfaced elsewhere - skip
          // this check rather than blocking on it too.
        }
      }

      // Warn when terminal legacy rows would have no enrollment history.
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

      // Run commit validation during preview, without duplicating unresolved-grade errors.
      const currentGradeResolvedForZod =
        action === "UPDATE" ||
        Boolean(
          mapped.current_grade &&
            gradeIdByName.has(mapped.current_grade.trim().toLowerCase()),
        );
      if (currentGradeResolvedForZod) {
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
              // Deduplicate equivalent required-field errors case-insensitively.
              const alreadyReported = errors.some(
                (existing) =>
                  existing.toLowerCase() === issue.message.toLowerCase(),
              );
              if (!alreadyReported) errors.push(issue.message);
            }
          }
        } catch {
          // Best-effort - an earlier check already covers any other shape
          // problem that would make the builders themselves throw.
        }
      }

      const currentGradeForCheck = mapped.current_grade
        ? gradeByName.get(mapped.current_grade.trim().toLowerCase())
        : undefined;
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
        const gradeStepCount = grades.filter(
          (g) =>
            g.level > joinGradeForCheck!.level &&
            g.level <= currentGradeForCheck!.level,
        ).length;
        const tooFarAheadError = tooFarAheadMessage({
          currentGrade: currentGradeForCheck,
          joinGrade: joinGradeForCheck,
          joinAcademicYear: joinYearForCheck,
          gradeStepCount,
          laterAcademicYearCount,
        });
        // A valid override reason suppresses the preview error.
        if (tooFarAheadError && !mapped.override_too_far_ahead_reason) {
          errors.push(tooFarAheadError);
        }
      }

      // Preview the same overridable age-grade warning enforced at commit.
      if (mapped.birth_date && joinGradeForCheck && joinYearForCheck?.start_date) {
        try {
          const ageAtJoin = yearsBetweenDates(
            parseFlexibleDate(mapped.birth_date).toISOString(),
            joinYearForCheck.start_date.toISOString(),
          );
          const ageMismatchError = ageMismatchMessage({
            joinGrade: joinGradeForCheck,
            ageAtJoin,
          });
          if (ageMismatchError && !mapped.override_too_far_ahead_reason) {
            warnings.push(ageMismatchError);
          }
        } catch {
          // Unparseable birth_date is already surfaced elsewhere - skip
          // this check rather than blocking on it too.
        }
      }

      for (const parent of relationSubRows.parents) {
        const zodResult = ParentGuardianValidation.CREATE.safeParse({
          student_id: "preview",
          type: parent.type,
          full_name: parent.full_name,
          phone: parent.phone ?? undefined,
          legacy_phone: parent.legacy_phone ?? undefined,
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

// Relation imports require an existing student matched by NIS or email.
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

// Registration and relation imports write the same student sub-records.
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
            legacy_phone: parent.legacy_phone ?? undefined,
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
          blood_type: (row.health!.blood_type ?? undefined) as
            | BloodType
            | undefined,
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
        return PCActivityService.create(
          admin,
          {
            student_id: studentId,
            day: activity.day as PCDay,
            activity_id: activityId,
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

        // Close new enrollment history immediately for terminal imports.
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

// Registration and relation rollback remove the same student sub-records.
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
  // Blank join grade defaults to current grade.
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
    override_too_far_ahead_reason:
      mapped.override_too_far_ahead_reason || undefined,
    import_defaulted_fields: mapped.import_defaulted_fields
      ? mapped.import_defaulted_fields.split(",")
      : undefined,
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
  jobLevelUnitNamesByName: Map<string, string[]>;
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
    prismaClient.masterJobLevel.findMany({
      include: { units: { include: { unit: true } } },
    }),
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
  const jobLevelUnitNamesByName = new Map(
    jobLevels
      .filter((l) => jobLevelNames.includes(l.name.trim().toLowerCase()))
      .map((l) => [
        l.name.trim().toLowerCase(),
        l.units.map((u) => u.unit.name),
      ]),
  );
  const buildingIdByName = new Map(
    buildings
      .filter((b) => buildingNames.includes(b.name.trim().toLowerCase()))
      .map((b) => [b.name.trim().toLowerCase(), b.id]),
  );
  // Resolve current employee relation names for change descriptions.
  const unitNameById = new Map(units.map((u) => [u.id, u.name]));
  const jobPositionNameById = new Map(jobPositions.map((p) => [p.id, p.name]));
  const jobLevelNameById = new Map(jobLevels.map((l) => [l.id, l.name]));
  const buildingNameById = new Map(buildings.map((b) => [b.id, b.name]));

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

  // Compare normalized import fields to suppress no-op employee updates.
  function describeEmployeeChanges(
    mapped: Record<string, string>,
    matchedEmployee: (typeof existingEmployees)[number],
  ): { field: ImportEmployeeFieldKey; label: string; from: string; to: string }[] {
    const formatDate = (d: Date | null) =>
      d ? d.toISOString().slice(0, 10) : "";
    const currentValues: Partial<Record<ImportEmployeeFieldKey, string>> = {
      full_name: matchedEmployee.person.full_name,
      nick_name: matchedEmployee.person.nick_name,
      email: matchedEmployee.person.email,
      gender: matchedEmployee.person.gender,
      religion: matchedEmployee.person.religion,
      religion_other: matchedEmployee.person.religion_other ?? "",
      birth_place: matchedEmployee.person.birth_place,
      birth_date: formatDate(matchedEmployee.person.birth_date),
      unit: unitNameById.get(matchedEmployee.unit_id) ?? "",
      job_position:
        jobPositionNameById.get(matchedEmployee.job_position_id) ?? "",
      job_level: jobLevelNameById.get(matchedEmployee.job_level_id) ?? "",
      building: buildingNameById.get(matchedEmployee.building_id) ?? "",
      join_date: formatDate(matchedEmployee.join_date),
      employment_type: matchedEmployee.employment_type,
      contract_end_date: formatDate(matchedEmployee.contract_end_date),
      marital_status: matchedEmployee.marital_status,
      status: matchedEmployee.status,
      last_working_date: formatDate(matchedEmployee.last_working_date),
      notes: matchedEmployee.notes ?? "",
      mobile_phone: matchedEmployee.mobile_phone ?? "",
      residential_address: matchedEmployee.residential_address ?? "",
      nik: matchedEmployee.nik ?? "",
      npwp: matchedEmployee.npwp ?? "",
      bank_account_number: matchedEmployee.bank_account_number ?? "",
      bpjs_number: matchedEmployee.bpjs_number ?? "",
      bpjs_employment_number: matchedEmployee.bpjs_employment_number ?? "",
      kpj_number: matchedEmployee.kpj_number ?? "",
      education_level: matchedEmployee.education_level ?? "",
      institution_name: matchedEmployee.institution_name ?? "",
      major: matchedEmployee.major ?? "",
      graduation_year:
        matchedEmployee.graduation_year != null
          ? String(matchedEmployee.graduation_year)
          : "",
    };

    const comparableMappedValue = (
      field: ImportEmployeeFieldKey,
    ): string | undefined => {
      const raw = mapped[field];
      if (!raw) return undefined;
      switch (field) {
        case "gender":
          return normalizeGender(raw);
        case "religion":
          return normalizeReligion(raw);
        case "religion_other":
          return (
            resolveReligionOtherDetail(mapped.religion, mapped.religion_other) ??
            ""
          );
        case "birth_date":
        case "join_date":
        case "contract_end_date":
        case "last_working_date":
          try {
            return parseFlexibleDate(raw).toISOString().slice(0, 10);
          } catch {
            return raw.trim();
          }
        case "status":
        case "employment_type":
        case "marital_status":
        case "education_level":
          return raw.toUpperCase();
        case "graduation_year":
          return Number.isNaN(Number(raw)) ? raw.trim() : String(Number(raw));
        case "unit":
        case "job_position":
        case "job_level":
        case "building":
          return raw.trim().toLowerCase();
        // Match employee validation normalization before diffing.
        case "mobile_phone":
          return normalizeIndonesianPhone(raw);
        case "nik":
        case "npwp":
        case "bank_account_number":
        case "bpjs_number":
        case "bpjs_employment_number":
          return normalizeDigits(raw);
        case "kpj_number":
          return normalizeAlphanumeric(raw);
        default:
          return raw.trim();
      }
    };
    const comparableCurrentValue = (
      field: ImportEmployeeFieldKey,
    ): string | undefined => {
      const current = currentValues[field];
      if (current === undefined) return undefined;
      switch (field) {
        case "unit":
        case "job_position":
        case "job_level":
        case "building":
          return current.trim().toLowerCase();
        default:
          return current;
      }
    };

    const changes: {
      field: ImportEmployeeFieldKey;
      label: string;
      from: string;
      to: string;
    }[] = [];
    for (const { key, label } of IMPORT_EMPLOYEE_FIELDS) {
      if (currentValues[key] === undefined) continue; // not a diffable field (e.g. employee_id/photo_url)
      const mappedValue = comparableMappedValue(key);
      if (mappedValue === undefined) continue; // blank/unmapped in this file - not being changed
      if (mappedValue === comparableCurrentValue(key)) continue;
      changes.push({
        field: key,
        label,
        from: currentValues[key] || "",
        to: mapped[key]!.trim(),
      });
    }
    return changes;
  }

  const rows: StagedEmployeeRow[] = await Promise.all(
    inputs.map(async ({ row_number, mapped, source_raw }) => {
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
      let action: StagedEmployeeRow["action"] = !mapped.employee_id
        ? null
        : matchedEmployee
          ? "UPDATE"
          : "CREATE";

      if (action === "UPDATE" && matchedEmployee) {
        const changes = describeEmployeeChanges(mapped, matchedEmployee);
        if (changes.length === 0) {
          action = null;
          warnings.push(
            "No changes detected for this employee - already up to date.",
          );
        } else {
          for (const change of changes) {
            warnings.push(`${change.label}: "${change.from}" -> "${change.to}"`);
          }
        }
      }

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
          assertUnitJobLevelCompatible(
            mapped.unit,
            mapped.job_level,
            jobLevelUnitNamesByName.get(mapped.job_level.trim().toLowerCase()) ??
              [],
          );
        } catch (error) {
          errors.push(
            error instanceof ResponseError
              ? error.message
              : "Could not validate unit/job level compatibility",
          );
        }
      }

      const resultingUnitId = mapped.unit
        ? unitIdByName.get(mapped.unit.trim().toLowerCase())
        : matchedEmployee?.unit_id;
      const resultingPositionId = mapped.job_position
        ? jobPositionIdByName.get(mapped.job_position.trim().toLowerCase())
        : matchedEmployee?.job_position_id;
      const resultingLevelId = mapped.job_level
        ? jobLevelIdByName.get(mapped.job_level.trim().toLowerCase())
        : matchedEmployee?.job_level_id;
      if (
        action === "UPDATE" &&
        resultingUnitId &&
        resultingPositionId &&
        resultingLevelId
      ) {
        try {
          await assertUnitJobLevelCompatibleByIds(
            resultingUnitId,
            resultingLevelId,
          );
          await assertJobPositionJobLevelCompatibleByIds(
            resultingPositionId,
            resultingLevelId,
          );
          await assertJobPositionUnitCompatibleByIds(
            resultingPositionId,
            resultingUnitId,
          );
        } catch (error) {
          const message =
            error instanceof ResponseError
              ? error.message
              : "Could not validate the resulting employee role combination";
          if (!errors.includes(message)) errors.push(message);
        }
      }

      const stagedRow: StagedEmployeeRow = {
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

      // Preview with the same employee schema used at commit.
      if (action === "CREATE" || action === "UPDATE") {
        try {
          const zodResult =
            action === "CREATE"
              ? EmployeeValidation.CREATE.safeParse(
                  buildEmployeeCreateRequest(
                    stagedRow,
                    unitIdByName,
                    jobPositionIdByName,
                    jobLevelIdByName,
                    buildingIdByName,
                  ),
                )
              : EmployeeValidation.UPDATE.safeParse(
                  buildEmployeeUpdateRequest(
                    stagedRow,
                    unitIdByName,
                    jobPositionIdByName,
                    jobLevelIdByName,
                    buildingIdByName,
                  ),
                );
          if (!zodResult.success) {
            for (const issue of zodResult.error.issues) {
              const alreadyReported = errors.some(
                (existing) =>
                  existing.toLowerCase() === issue.message.toLowerCase(),
              );
              if (!alreadyReported) errors.push(issue.message);
            }
          }
        } catch {
          // Best-effort - an earlier check already covers any other shape
          // problem that would make the builders themselves throw.
        }
      }

      return stagedRow;
    }),
  );

  const limitedPositions = new Map(
    jobPositions
      .filter(
        (position) =>
          position.capacity_scope && position.max_active_holders,
      )
      .map((position) => [position.id, position]),
  );
  if (limitedPositions.size > 0) {
    const [occupyingEmployees, occupyingInterns] = await Promise.all([
      prismaClient.employee.findMany({
        where: {
          job_position_id: { in: [...limitedPositions.keys()] },
          status: { in: ["ACTIVE", "ON_LEAVE"] },
          deleted_at: null,
        },
        select: { id: true, job_position_id: true, unit_id: true },
      }),
      prismaClient.intern.findMany({
        where: {
          job_position_id: { in: [...limitedPositions.keys()] },
          status: "ACTIVE",
          end_date: { gt: new Date() },
          deleted_at: null,
        },
        select: { job_position_id: true, unit_id: true },
      }),
    ]);
    const occupancy = new Map<string, number>();
    const capacityKey = (positionId: string, unitId: string) => {
      const position = limitedPositions.get(positionId)!;
      return position.capacity_scope === "PER_UNIT"
        ? `${positionId}:${unitId}`
        : `${positionId}:global`;
    };
    for (const holder of [...occupyingEmployees, ...occupyingInterns]) {
      const key = capacityKey(holder.job_position_id, holder.unit_id);
      occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
    }

    for (const row of rows) {
      if (row.errors.length > 0 || !row.action) continue;
      const matchedEmployee = row.matched_employee_id
        ? existingEmployees.find((employee) => employee.id === row.matched_employee_id)
        : null;
      if (
        matchedEmployee &&
        limitedPositions.has(matchedEmployee.job_position_id) &&
        ["ACTIVE", "ON_LEAVE"].includes(matchedEmployee.status)
      ) {
        const oldKey = capacityKey(
          matchedEmployee.job_position_id,
          matchedEmployee.unit_id,
        );
        occupancy.set(oldKey, Math.max(0, (occupancy.get(oldKey) ?? 0) - 1));
      }

      const targetPositionId = row.raw.job_position
        ? jobPositionIdByName.get(row.raw.job_position.trim().toLowerCase())
        : matchedEmployee?.job_position_id;
      const targetUnitId = row.raw.unit
        ? unitIdByName.get(row.raw.unit.trim().toLowerCase())
        : matchedEmployee?.unit_id;
      const targetStatus = row.raw.status?.toUpperCase() || matchedEmployee?.status || "ACTIVE";
      const position = targetPositionId
        ? limitedPositions.get(targetPositionId)
        : null;
      if (
        position &&
        targetUnitId &&
        ["ACTIVE", "ON_LEAVE"].includes(targetStatus)
      ) {
        const key = capacityKey(position.id, targetUnitId);
        const nextCount = (occupancy.get(key) ?? 0) + 1;
        if (nextCount > position.max_active_holders!) {
          row.errors.push(
            `Job position "${position.name}" exceeds its ${position.capacity_scope === "PER_UNIT" ? "per-unit" : "global"} active holder limit of ${position.max_active_holders}.`,
          );
        } else {
          occupancy.set(key, nextCount);
        }
      }
    }
  }

  return {
    rows,
    unitIdByName,
    jobPositionIdByName,
    jobLevelIdByName,
    jobLevelUnitNamesByName,
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
    education_level:
      (mapped.education_level?.toUpperCase() as CreateEmployeeRequest["education_level"]) ||
      undefined,
    institution_name: mapped.institution_name || undefined,
    major: mapped.major || undefined,
    graduation_year: mapped.graduation_year
      ? Number(mapped.graduation_year)
      : undefined,
  };
}

function buildEmployeeUpdateRequest(
  row: StagedEmployeeRow,
  unitIdByName: Map<string, string>,
  jobPositionIdByName: Map<string, string>,
  jobLevelIdByName: Map<string, string>,
  buildingIdByName: Map<string, string>,
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
    unit_id: mapped.unit
      ? unitIdByName.get(mapped.unit.trim().toLowerCase())
      : undefined,
    job_position_id: mapped.job_position
      ? jobPositionIdByName.get(mapped.job_position.trim().toLowerCase())
      : undefined,
    job_level_id: mapped.job_level
      ? jobLevelIdByName.get(mapped.job_level.trim().toLowerCase())
      : undefined,
    building_id: mapped.building
      ? buildingIdByName.get(mapped.building.trim().toLowerCase())
      : undefined,
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
    education_level: mapped.education_level
      ? (mapped.education_level.toUpperCase() as UpdateEmployeeRequest["education_level"])
      : undefined,
    institution_name: mapped.institution_name || undefined,
    major: mapped.major || undefined,
    graduation_year: mapped.graduation_year
      ? Number(mapped.graduation_year)
      : undefined,
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
  if (mapped.unit) snapshot.unit_id = employee.unit_id;
  if (mapped.job_position) snapshot.job_position_id = employee.job_position_id;
  if (mapped.job_level) snapshot.job_level_id = employee.job_level_id;
  if (mapped.building) snapshot.building_id = employee.building_id;
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
  if (mapped.education_level) {
    snapshot.education_level = employee.education_level;
  }
  if (mapped.institution_name) {
    snapshot.institution_name = employee.institution_name;
  }
  if (mapped.major) snapshot.major = employee.major;
  if (mapped.graduation_year) {
    snapshot.graduation_year = employee.graduation_year;
  }

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
    unit_id: previous.unit_id as string | undefined,
    job_position_id: previous.job_position_id as string | undefined,
    job_level_id: previous.job_level_id as string | undefined,
    building_id: previous.building_id as string | undefined,
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
    education_level:
      (previous.education_level as UpdateEmployeeRequest["education_level"]) ??
      undefined,
    institution_name:
      (previous.institution_name as string | null) ?? undefined,
    major: (previous.major as string | null) ?? undefined,
    graduation_year: (previous.graduation_year as number | null) ?? undefined,
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
    // Relation imports use their re-export header aliases.
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
      // Keep invalid relation rows so their missing identifiers are reported.
      .filter(
        ({ mapped }) =>
          isRelationAttach ||
          !isPhantomRow(mapped, ["full_name", "email", "nis"]),
      )
      .map((input, index) => ({ ...input, row_number: index + 1 }));

    const { rows } = isRelationAttach
      ? await resolveRelationStagedRows(inputs)
      : await resolveStagedRows(inputs);

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
    // Only pending or processing jobs accept commit calls.
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
    // Omitted batch settings commit the entire job.
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

    // Preserve staged-row state outside the current batch.
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
        status:
          failedCount > 0 ? ImportStatus.PARTIAL : ImportStatus.ROLLED_BACK,
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

  // Reading staged student imports requires the same audited Super Admin gate.
  static async getJob(
    id: string,
    admin: AdminUser,
    context: AuditRequestContext = {},
  ): Promise<ImportJobResponse> {
    await assertSuperAdminImport(admin, "view job", context);

    const job = await prismaClient.importJob.findUnique({ where: { id } });
    if (!job || job.type !== ImportType.STUDENT) {
      throw new ResponseError(404, "Import job not found");
    }

    const { cached } = await withLookupCache(
      "import-job-pii-access",
      [admin.id, id],
      async () => true,
    );
    if (!cached) {
      await AuditService.record({
        action: AuditAction.ACCESS_HEALTH_DATA,
        source: AuditSource.UI,
        entity_type: "ImportJob",
        entity_id: id,
        admin_id: admin.id,
        new_values: { resource: "StudentImportJob", job_id: id },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });
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
            buildEmployeeUpdateRequest(
              row,
              unitIdByName,
              jobPositionIdByName,
              jobLevelIdByName,
              buildingIdByName,
            ),
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
    const rollbackStatus =
      failedCount > 0 ? ImportStatus.PARTIAL : ImportStatus.ROLLED_BACK;

    await prismaClient.importJob.update({
      where: { id: job.id },
      data: {
        status: rollbackStatus,
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
      status: rollbackStatus,
      summary,
      rows,
    };
  }

  // Reading staged employee imports requires an audited Super Admin gate.
  static async getEmployeeJob(
    id: string,
    admin: AdminUser,
    context: AuditRequestContext = {},
  ): Promise<EmployeeImportJobResponse> {
    await assertSuperAdminImport(admin, "view job", context);

    const job = await prismaClient.importJob.findUnique({ where: { id } });
    if (!job || job.type !== ImportType.EMPLOYEE) {
      throw new ResponseError(404, "Import job not found");
    }

    const { cached } = await withLookupCache(
      "import-job-pii-access",
      [admin.id, id],
      async () => true,
    );
    if (!cached) {
      await AuditService.record({
        action: AuditAction.ACCESS_EMPLOYEE_PII,
        source: AuditSource.UI,
        entity_type: "ImportJob",
        entity_id: id,
        admin_id: admin.id,
        new_values: { resource: "EmployeeImportJob", job_id: id },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });
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
