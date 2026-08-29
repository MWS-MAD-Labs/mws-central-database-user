import {
  ConsentStatus,
  ConsentType,
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
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function isValidDateString(dateStr: string): boolean {
  if (!dateStr) return false;
  if (isDateWithMonthName(dateStr)) return true;
  if (!Number.isNaN(Date.parse(dateStr))) return true;
  return parseDateDDMMYYYY(dateStr) !== null;
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

function checkMultiValueCells(mapped: Record<string, string>): string[] {
  const errors: string[] = [];
  for (const [field, value] of Object.entries(mapped)) {
    if (MULTI_VALUE_EXEMPT_FIELDS.has(field)) continue;
    if (/[,;\n]/.test(value)) {
      errors.push(
        `${field} looks like it has multiple values in one cell: "${value}"`,
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
    if (!mapped.religion) {
      mapped.religion = "OTHER";
    }
    if (!mapped.birth_place) {
      mapped.birth_place = "Unknown";
    }
    if (!mapped.birth_date) {
      mapped.birth_date = "1900-01-01";
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

    errors.push(...checkMultiValueCells(mapped));

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

    errors.push(...checkMultiValueCells(mapped));

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

    errors.push(...checkMultiValueCells(mapped));

    return errors;
  }
}
