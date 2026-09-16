import {
  ConsentStatus,
  ConsentType,
  EducationLevel,
  EmployeeStatus,
  EmploymentType,
  Gender,
  HealthNoteCategory,
  HealthNoteStatus,
  MaritalStatus,
  ParentType,
  PCDay,
  Religion,
  StudentStatus,
} from "../generated/prisma/client";
import {
  BIRTH_PLACE_DATE_HEADER_ALIASES,
  DEFAULT_EMPLOYEE_HEADER_ALIASES,
  DEFAULT_RELATION_HEADER_ALIASES,
  DEFAULT_STUDENT_HEADER_ALIASES,
  IMPORT_EMPLOYEE_FIELDS,
  IMPORT_STUDENT_FIELDS,
  normalizeGender,
  normalizeReligion,
  normalizeStudentStatus,
  type ImportEmployeeFieldKey,
  type ImportRelationFieldKey,
  type ImportStudentFieldKey,
} from "../model/import-model";
import { normalizeAlphanumeric, normalizeDigits } from "./employee-validation";
import {
  isBirthDateNotFuture,
  isBirthDateNotTooOld,
  yearsBetweenDates,
} from "./validation";

const REQUIRED_STUDENT_FIELDS = IMPORT_STUDENT_FIELDS.filter(
  (f) => f.required,
).map((f) => f.key);
const REQUIRED_EMPLOYEE_FIELDS = IMPORT_EMPLOYEE_FIELDS.filter(
  (f) => f.required,
).map((f) => f.key);

const MULTI_VALUE_EXEMPT_FIELDS = new Set([
  "previous_school",
  "health_info",
  "special_needs",
  "parent_address",
  "notes",
  "residential_address",
  // Free text, not a single structured value - a second phone number in the
  // same cell is normal parent-contact data, not a mistake, and Indonesian
  // names routinely carry a comma-separated academic/professional title
  // (e.g. "Budi Santoso, S.T., M.M.") that isn't a second person.
  "father_name",
  "mother_name",
  "father_phone",
  "mother_phone",
  // A NIS/NISN that doesn't fit the strict format (including a cell that
  // literally holds two historical identifiers, e.g. "2223K019, 23241011")
  // is preserved verbatim into legacy_nis/legacy_nisn instead of being
  // rejected - see the raw-NIS-prefix and NISN fallback checks in
  // import-service.ts.
  "nis",
  "nisn",
  // resolveStagedRows() runs a second time at commit against its own
  // already-processed output from preview/revalidate (see commitStudents()
  // reading job.staged_rows back in as its input) - by then legacy_nis/
  // legacy_nisn already hold whatever the raw nis/nisn cell had (that's
  // their whole purpose), so they need the same exemption nis/nisn have
  // above, or this check re-flags its own prior output as a fresh mistake.
  "legacy_nis",
  "legacy_nisn",
  // Internal-only fields the import pipeline writes onto `mapped` itself
  // (never present in an uploaded sheet) - both are legitimately
  // comma-bearing by design/nature, not a copy-paste mistake to flag.
  "import_defaulted_fields",
  "override_too_far_ahead_reason",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Mirrors employee-validation.ts's create/update schema - surfaced here too
// so a bad Employee ID shows up in the preview instead of only failing at
// commit.
const EMPLOYEE_ID_RE = /^\d{2}\.\d{2}\.\d{3}$/;

// Sanity floors, not precise business rules - loose enough to never trip on
// a genuine edge case, tight enough to catch an obviously wrong birth
// year/date typo (e.g. 2018 instead of 1980) before it reaches commit.
const MIN_EMPLOYEE_AGE_YEARS = 18;
const MIN_GRADUATION_AGE_YEARS = 12;

// Mirrors import-service.ts's MONTH_NAME_TO_INDEX - kept as a separate copy
// here (rather than imported) since that file already imports ImportValidation
// from this one, and importing back would be circular.
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

function parseDateDDMMYYYY(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{1,2})[-.\/](\d{1,2})[-.\/](\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.getFullYear() === Number(year) ? date : null;
}

// English + Indonesian month names, e.g. "30 Maret 2023" or "30 March 2023".
const MONTH_NAMES = new Set([
  "jan",
  "january",
  "januari",
  "feb",
  "february",
  "februari",
  "mar",
  "march",
  "maret",
  "apr",
  "april",
  "may",
  "mei",
  "jun",
  "june",
  "juni",
  "jul",
  "july",
  "juli",
  "aug",
  "august",
  "agustus",
  "sep",
  "sept",
  "september",
  "oct",
  "october",
  "oktober",
  "nov",
  "november",
  "dec",
  "december",
  "desember",
]);

function isDateWithMonthName(dateStr: string): boolean {
  const match = dateStr.match(/^\d{1,2}\s+([A-Za-z]+)\s+\d{4}$/);
  if (!match) return false;
  return MONTH_NAMES.has(match[1].toLowerCase());
}

// "29th"/"1st"/"2nd"/"3rd" -> "29"/"1"/"2"/"3" - an ordinal suffix on the
// day number (e.g. "July 29th 2009") otherwise fails every check below,
// including native Date.parse, even though the date itself is unambiguous.
export function stripOrdinalSuffix(dateStr: string): string {
  return dateStr.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1");
}

function isValidDateString(dateStr: string): boolean {
  if (!dateStr) return false;
  const normalized = stripOrdinalSuffix(dateStr);
  if (isDateWithMonthName(normalized)) return true;
  if (!Number.isNaN(Date.parse(normalized))) return true;
  return parseDateDDMMYYYY(normalized) !== null;
}

// Only ever called after isValidDateString() already confirmed the string
// parses cleanly - returns null instead of throwing on the rare shape it
// still can't place (mirrors import-service.ts's parseFlexibleDate, minus
// the throwing, since this is a soft sanity check, not the commit path).
function toAgeCheckDate(dateStr: string): Date | null {
  const normalized = stripOrdinalSuffix(dateStr);

  const ddmmyyyy = parseDateDDMMYYYY(normalized);
  if (ddmmyyyy) return ddmmyyyy;

  const monthNameMatch = normalized.match(
    /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/,
  );
  if (monthNameMatch) {
    const [, day, monthStr, year] = monthNameMatch;
    const monthIdx = MONTH_NAME_TO_INDEX[monthStr.toLowerCase()];
    if (monthIdx === undefined) return null;
    return new Date(Number(year), monthIdx, Number(day));
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

type MappingTarget<TKey extends string> = TKey | "__birth_place_date__";

function resolveMapping<TKey extends string>(
  headers: string[],
  aliases: Record<string, TKey>,
  override: Partial<Record<string, TKey>> | undefined,
): { mapping: Record<string, MappingTarget<TKey>>; unmappedHeaders: string[] } {
  const mapping: Record<string, MappingTarget<TKey>> = {};
  const unmapped: string[] = [];

  for (const header of headers) {
    if (!header) continue;
    const normalized = header.trim().toLowerCase();

    if (override?.[header]) {
      mapping[header] = override[header]!;
      continue;
    }
    if (BIRTH_PLACE_DATE_HEADER_ALIASES.has(normalized)) {
      mapping[header] = "__birth_place_date__";
      continue;
    }
    const aliased = aliases[normalized];
    if (aliased) {
      mapping[header] = aliased;
      continue;
    }
    unmapped.push(header);
  }

  return { mapping, unmappedHeaders: unmapped };
}

function mapRowValues<TKey extends string>(
  headers: string[],
  values: string[],
  mapping: Record<string, MappingTarget<TKey>>,
): Record<string, string> {
  const mapped: Record<string, string> = {};

  headers.forEach((header, index) => {
    const target = mapping[header];
    if (!target) return;
    const rawValue = (values[index] ?? "").trim();

    if (target === "__birth_place_date__") {
      const match = rawValue.match(/^([^,/]+)[,/]\s*(.+)$/);

      if (match) {
        mapped.birth_place = match[1].trim();
        mapped.birth_date = match[2].trim();
      } else {
        mapped.birth_place = rawValue;
        mapped.birth_date = "";
      }
      return;
    }

    mapped[target] = rawValue;
  });

  return mapped;
}

function humanizeFieldKey(key: string): string {
  return key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function checkMultiValueCells(
  mapped: Record<string, string>,
  fields: readonly { key: string; label: string }[] = [],
): string[] {
  const errors: string[] = [];
  for (const [field, value] of Object.entries(mapped)) {
    if (MULTI_VALUE_EXEMPT_FIELDS.has(field)) continue;
    if (/[,;\n]/.test(value)) {
      const label =
        fields.find((f) => f.key === field)?.label ?? humanizeFieldKey(field);
      errors.push(
        `${label} looks like it has multiple values in one cell: "${value}"`,
      );
    }
  }
  return errors;
}

export class ImportValidation {
  static resolveFieldMapping(
    headers: string[],
    override?: Partial<Record<string, ImportStudentFieldKey>>,
  ) {
    return resolveMapping(headers, DEFAULT_STUDENT_HEADER_ALIASES, override);
  }

  static mapRow(
    headers: string[],
    values: string[],
    mapping: Record<string, MappingTarget<ImportStudentFieldKey>>,
  ): Record<string, string> {
    const mapped = mapRowValues(headers, values, mapping);
    // Legacy sheets don't carry Entry Type (it's a new system-only field
    // that drives NIS digit 4). Default new legacy imports to PSB - admin
    // corrects individual rows to PRE_K/TRANSFER after the fact if needed.
    if (!mapped.entry_type) {
      mapped.entry_type = "PSB";
    }
    // A graduated student has no "current" grade in real life, but
    // current_grade_id is a required FK - sheets record what they graduated
    // from instead, so fall back to that column when Current Grade is blank.
    if (
      !mapped.current_grade &&
      mapped.graduation_grade &&
      normalizeStudentStatus(mapped.status ?? "") === "GRADUATED"
    ) {
      mapped.current_grade = mapped.graduation_grade;
    }
    // Same reasoning as the religion/birth_place/birth_date placeholders
    // below - a legacy graduated record genuinely missing these on the
    // sheet shouldn't block an otherwise-valid batch import. Findable later
    // via leave_year/graduation_grade = "Unknown".
    if (normalizeStudentStatus(mapped.status ?? "") === "GRADUATED") {
      if (!mapped.leave_year) {
        mapped.leave_year = "Unknown";
      }
      if (!mapped.graduation_grade) {
        mapped.graduation_grade = mapped.current_grade || "Unknown";
      }
    }
    // Some legacy rows list two religions in one cell (e.g. a stray comma
    // from copy-pasting two family members' data) - can't tell which one is
    // actually correct, so take the first rather than blocking the row. The
    // original text is still visible in the preview's raw sheet columns.
    if (mapped.religion && /[,;]/.test(mapped.religion)) {
      mapped.religion = mapped.religion.split(/[,;]/)[0]!.trim();
    }
    // Some historical records genuinely have nothing on file for these -
    // fill an obvious, greppable placeholder instead of blocking an
    // otherwise-valid batch import. Findable later for manual follow-up via
    // birth_date = 1900-01-01 / birth_place = "Unknown" / religion = OTHER.
    // The __defaulted_* markers let resolveStagedRows() surface a warning
    // for these specific rows instead of the placeholder silently looking
    // like real data - stripped before being used anywhere else (they're
    // not real ImportStudentFieldKeys, so nothing else reads them).
    if (!mapped.religion) {
      mapped.religion = "OTHER";
      mapped.__defaulted_religion = "1";
    }
    if (!mapped.birth_place) {
      mapped.birth_place = "Unknown";
      mapped.__defaulted_birth_place = "1";
    }
    if (!mapped.birth_date) {
      mapped.birth_date = "1900-01-01";
      mapped.__defaulted_birth_date = "1";
    }
    if (!mapped.status) {
      mapped.__defaulted_status = "1";
    }
    return mapped;
  }

  static validateStudentRowShape(mapped: Record<string, string>): string[] {
    const errors: string[] = [];

    for (const field of REQUIRED_STUDENT_FIELDS) {
      if (!mapped[field]) {
        const label =
          IMPORT_STUDENT_FIELDS.find((f) => f.key === field)?.label ?? field;
        errors.push(`${label} is required`);
      }
    }

    if (mapped.email && !EMAIL_RE.test(mapped.email)) {
      errors.push(`Invalid email: ${mapped.email}`);
    } else if (
      mapped.email &&
      !mapped.email.endsWith(`@${process.env.ALLOWED_DOMAIN}`)
    ) {
      // Matches emailWithAllowedDomain() in validation.ts (the check
      // StudentValidation.CREATE actually enforces at commit) - surfaced
      // here too so a domain typo shows up in preview instead of only
      // failing silently once you commit.
      errors.push(
        `Email must use an allowed organization domain: ${mapped.email}`,
      );
    }
    if (mapped.father_email && !EMAIL_RE.test(mapped.father_email)) {
      errors.push(`Invalid father's email: ${mapped.father_email}`);
    }
    if (mapped.mother_email && !EMAIL_RE.test(mapped.mother_email)) {
      errors.push(`Invalid mother's email: ${mapped.mother_email}`);
    }

    if (mapped.birth_date && !isValidDateString(mapped.birth_date)) {
      errors.push(`Invalid birth date format: ${mapped.birth_date}`);
    }

    if (mapped.gender && !(normalizeGender(mapped.gender) in Gender)) {
      errors.push(`Unrecognized gender: ${mapped.gender}`);
    }

    if (mapped.religion && !(normalizeReligion(mapped.religion) in Religion)) {
      errors.push(`Unrecognized religion: ${mapped.religion}`);
    }

    if (
      mapped.status &&
      !(normalizeStudentStatus(mapped.status) in StudentStatus)
    ) {
      errors.push(`Unrecognized status: ${mapped.status}`);
    }

    errors.push(...checkMultiValueCells(mapped, IMPORT_STUDENT_FIELDS));

    return errors;
  }

  // Recognizes both the "compose a new sheet" column shape (IMPORT_STUDENT_FIELDS
  // - Health Information, Father, PC Monday, ...) and the actual re-exported
  // sheet shape (export-service.ts's *_COLUMNS - Student NIS, Category,
  // Type, ...), since either can show up as an Attach-mode upload.
  static resolveRelationFieldMapping(
    headers: string[],
    override?: Partial<Record<string, ImportRelationFieldKey>>,
  ) {
    return resolveMapping(headers, DEFAULT_RELATION_HEADER_ALIASES, override);
  }

  static mapRelationRow(
    headers: string[],
    values: string[],
    mapping: Record<string, MappingTarget<ImportRelationFieldKey>>,
  ): Record<string, string> {
    // Unlike mapRow, no full-registration defaulting (entry_type,
    // religion/birth_place/birth_date placeholders) - a relation-attach row
    // targets an already-existing student, those fields are irrelevant here.
    return mapRowValues(headers, values, mapping);
  }

  // Relation-attach mode: row only needs enough to identify an existing
  // student (NIS or email) and any relation fields it's carrying. No
  // full-registration required-field check.
  static validateRelationRowShape(mapped: Record<string, string>): string[] {
    const errors: string[] = [];

    if (!mapped.nis && !mapped.email) {
      errors.push(
        "Either NIS or Email is required to attach relation data to an existing student",
      );
    }

    if (mapped.email && !EMAIL_RE.test(mapped.email)) {
      errors.push(`Invalid email: ${mapped.email}`);
    }
    if (mapped.father_email && !EMAIL_RE.test(mapped.father_email)) {
      errors.push(`Invalid father's email: ${mapped.father_email}`);
    }
    if (mapped.mother_email && !EMAIL_RE.test(mapped.mother_email)) {
      errors.push(`Invalid mother's email: ${mapped.mother_email}`);
    }
    if (mapped.parent_email && !EMAIL_RE.test(mapped.parent_email)) {
      errors.push(`Invalid email: ${mapped.parent_email}`);
    }

    if (
      mapped.note_category &&
      !(mapped.note_category.trim().toUpperCase() in HealthNoteCategory)
    ) {
      errors.push(`Unrecognized category: ${mapped.note_category}`);
    }
    // relation_status is shared between the Health Notes and Consent export
    // sheets - which enum applies depends on which sibling field is present
    // on this same row (a row never carries both).
    if (mapped.relation_status) {
      const normalizedStatus = mapped.relation_status.trim().toUpperCase();
      if (mapped.note_category) {
        if (!(normalizedStatus in HealthNoteStatus)) {
          errors.push(`Unrecognized status: ${mapped.relation_status}`);
        }
      } else if (mapped.consent_type_value) {
        if (!(normalizedStatus in ConsentStatus)) {
          errors.push(`Unrecognized status: ${mapped.relation_status}`);
        }
      }
    }
    if (mapped.noted_date && !isValidDateString(mapped.noted_date)) {
      errors.push(`Invalid noted date format: ${mapped.noted_date}`);
    }
    if (mapped.resolved_date && !isValidDateString(mapped.resolved_date)) {
      errors.push(`Invalid resolved date format: ${mapped.resolved_date}`);
    }

    if (
      mapped.parent_type &&
      !(mapped.parent_type.trim().toUpperCase() in ParentType)
    ) {
      errors.push(`Unrecognized parent type: ${mapped.parent_type}`);
    }

    if (
      mapped.consent_type_value &&
      !(mapped.consent_type_value.trim().toUpperCase() in ConsentType)
    ) {
      errors.push(`Unrecognized consent type: ${mapped.consent_type_value}`);
    }
    if (mapped.consent_date && !isValidDateString(mapped.consent_date)) {
      errors.push(`Invalid consent date format: ${mapped.consent_date}`);
    }
    if (
      mapped.validity_period &&
      !isValidDateString(mapped.validity_period)
    ) {
      errors.push(`Invalid validity period format: ${mapped.validity_period}`);
    }

    if (
      mapped.pc_day_value &&
      !(mapped.pc_day_value.trim().toUpperCase() in PCDay)
    ) {
      errors.push(`Unrecognized day: ${mapped.pc_day_value}`);
    }

    errors.push(...checkMultiValueCells(mapped, IMPORT_STUDENT_FIELDS));

    return errors;
  }

  static resolveEmployeeFieldMapping(
    headers: string[],
    override?: Partial<Record<string, ImportEmployeeFieldKey>>,
  ) {
    return resolveMapping(headers, DEFAULT_EMPLOYEE_HEADER_ALIASES, override);
  }

  static mapEmployeeRow(
    headers: string[],
    values: string[],
    mapping: Record<string, MappingTarget<ImportEmployeeFieldKey>>,
  ): Record<string, string> {
    return mapRowValues(headers, values, mapping);
  }

  static validateEmployeeRowShape(mapped: Record<string, string>): string[] {
    const errors: string[] = [];

    for (const field of REQUIRED_EMPLOYEE_FIELDS) {
      if (!mapped[field]) {
        const label =
          IMPORT_EMPLOYEE_FIELDS.find((f) => f.key === field)?.label ?? field;
        errors.push(`${label} is required`);
      }
    }

    if (mapped.employee_id && !EMPLOYEE_ID_RE.test(mapped.employee_id)) {
      errors.push(
        `Invalid Employee ID format: ${mapped.employee_id}. Example: 12.01.123`,
      );
    }

    if (mapped.email && !EMAIL_RE.test(mapped.email)) {
      errors.push(`Invalid email: ${mapped.email}`);
    } else if (
      mapped.email &&
      !mapped.email.endsWith(`@${process.env.ALLOWED_DOMAIN}`)
    ) {
      errors.push(
        `Email must use an allowed organization domain: ${mapped.email}`,
      );
    }

    if (mapped.birth_date && !isValidDateString(mapped.birth_date)) {
      errors.push(`Invalid birth date format: ${mapped.birth_date}`);
    } else if (mapped.birth_date) {
      // Mirrors employee-validation.ts's create/update schema (not-future,
      // not-too-old) plus a new minimum-age floor not enforced anywhere else
      // yet - surfaced here too so an implausible birth date (typo'd year,
      // e.g. 2018 instead of 1980) shows up in preview instead of only
      // failing at commit, or worse, silently importing a bogus age.
      const birthDate = toAgeCheckDate(mapped.birth_date);
      if (birthDate) {
        const iso = birthDate.toISOString();
        if (!isBirthDateNotFuture(iso)) {
          errors.push(`Birth date is in the future: ${mapped.birth_date}`);
        } else if (!isBirthDateNotTooOld(iso)) {
          errors.push(`Birth date is implausibly old: ${mapped.birth_date}`);
        } else {
          const age = yearsBetweenDates(iso, new Date().toISOString());
          if (age < MIN_EMPLOYEE_AGE_YEARS) {
            errors.push(
              `Employee is only ${age} years old based on this birth date (${mapped.birth_date}). Must be at least ${MIN_EMPLOYEE_AGE_YEARS}.`,
            );
          }
        }
      }
    }
    if (mapped.join_date && !isValidDateString(mapped.join_date)) {
      errors.push(`Invalid join date format: ${mapped.join_date}`);
    }
    if (
      mapped.last_working_date &&
      !isValidDateString(mapped.last_working_date)
    ) {
      errors.push(
        `Invalid last working date format: ${mapped.last_working_date}`,
      );
    }
    if (
      mapped.contract_end_date &&
      !isValidDateString(mapped.contract_end_date)
    ) {
      errors.push(
        `Invalid contract end date format: ${mapped.contract_end_date}`,
      );
    }
    // Mirrors employee-service.ts's create()/update() rule - surfaced here
    // too so it shows up in the preview instead of only failing at commit.
    if (
      mapped.contract_end_date &&
      mapped.employment_type?.toUpperCase() === "PERMANENT"
    ) {
      errors.push("Permanent employees cannot have a contract end date");
    }

    if (mapped.gender && !(normalizeGender(mapped.gender) in Gender)) {
      errors.push(`Unrecognized gender: ${mapped.gender}`);
    }
    if (mapped.religion && !(normalizeReligion(mapped.religion) in Religion)) {
      errors.push(`Unrecognized religion: ${mapped.religion}`);
    }
    if (mapped.status && !(mapped.status.toUpperCase() in EmployeeStatus)) {
      errors.push(`Unrecognized status: ${mapped.status}`);
    }
    if (
      mapped.employment_type &&
      !(mapped.employment_type.toUpperCase() in EmploymentType)
    ) {
      errors.push(`Unrecognized employment type: ${mapped.employment_type}`);
    }
    if (
      mapped.marital_status &&
      !(mapped.marital_status.toUpperCase() in MaritalStatus)
    ) {
      errors.push(`Unrecognized marital status: ${mapped.marital_status}`);
    }
    if (
      mapped.education_level &&
      !(mapped.education_level.toUpperCase() in EducationLevel)
    ) {
      errors.push(`Unrecognized education level: ${mapped.education_level}`);
    }
    if (mapped.graduation_year) {
      const year = Number(mapped.graduation_year);
      if (!Number.isInteger(year) || year < 1900 || year > 2100) {
        errors.push(`Invalid graduation year: ${mapped.graduation_year}`);
      } else if (mapped.birth_date && isValidDateString(mapped.birth_date)) {
        const birthDate = toAgeCheckDate(mapped.birth_date);
        if (birthDate) {
          const ageAtGraduation = year - birthDate.getFullYear();
          if (ageAtGraduation < MIN_GRADUATION_AGE_YEARS) {
            errors.push(
              `Graduation Year ${mapped.graduation_year} implies graduating at age ${ageAtGraduation} (born ${mapped.birth_date}) - too young to be plausible.`,
            );
          }
        }
      }
    }

    // Mirrors employee-validation.ts's create/update schema exactly (same
    // normalizeDigits/normalizeAlphanumeric + length checks) - surfaced
    // here too so a bad NIK/NPWP/bank/BPJS/KPJ number shows up in the
    // preview instead of only failing (with a more confusing message,
    // since the digits get silently stripped and re-counted first) at commit.
    if (mapped.nik && !/^\d{16}$/.test(normalizeDigits(mapped.nik))) {
      errors.push(`Invalid NIK: ${mapped.nik}. Must be exactly 16 digits.`);
    }
    if (mapped.npwp && !/^\d{15}$/.test(normalizeDigits(mapped.npwp))) {
      errors.push(
        `Invalid NPWP: ${mapped.npwp}. Must be exactly 15 digits (old format), e.g. 11.111.111.1-123.000.`,
      );
    }
    if (
      mapped.bank_account_number &&
      !/^\d{10}$/.test(normalizeDigits(mapped.bank_account_number))
    ) {
      errors.push(
        `Invalid Bank Account Number: ${mapped.bank_account_number}. Must be exactly 10 digits (BCA).`,
      );
    }
    if (
      mapped.bpjs_number &&
      !/^\d{13}$/.test(normalizeDigits(mapped.bpjs_number))
    ) {
      errors.push(
        `Invalid BPJS Kesehatan Number: ${mapped.bpjs_number}. Must be exactly 13 digits.`,
      );
    }
    if (
      mapped.bpjs_employment_number &&
      !/^\d{11}$/.test(normalizeDigits(mapped.bpjs_employment_number))
    ) {
      errors.push(
        `Invalid BPJS Ketenagakerjaan Number: ${mapped.bpjs_employment_number}. Must be exactly 11 digits.`,
      );
    }
    if (
      mapped.kpj_number &&
      !/^[A-Z0-9]{11}$/.test(normalizeAlphanumeric(mapped.kpj_number))
    ) {
      errors.push(
        `Invalid KPJ Number: ${mapped.kpj_number}. Must be exactly 11 letters/digits.`,
      );
    }

    errors.push(...checkMultiValueCells(mapped, IMPORT_EMPLOYEE_FIELDS));

    return errors;
  }
}
