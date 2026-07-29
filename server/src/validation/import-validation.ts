import {
  EmployeeStatus,
  EmploymentType,
  Gender,
  MaritalStatus,
  Religion,
  StudentStatus,
} from "../generated/prisma/client";
import {
  BIRTH_PLACE_DATE_HEADER_ALIASES,
  DEFAULT_EMPLOYEE_HEADER_ALIASES,
  DEFAULT_STUDENT_HEADER_ALIASES,
  IMPORT_EMPLOYEE_FIELDS,
  IMPORT_STUDENT_FIELDS,
  normalizeGender,
  normalizeReligion,
  type ImportEmployeeFieldKey,
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
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type MappingTarget<TKey extends string> = TKey | "__birth_place_date__";

function resolveMapping<TKey extends string>(
  headers: string[],
  aliases: Record<string, TKey>,
  override: Partial<Record<string, TKey>> | undefined,
): { mapping: Record<string, MappingTarget<TKey>>; unmappedHeaders: string[] } {
  const mapping: Record<string, MappingTarget<TKey>> = {};
  const unmapped: string[] = [];

  for (const header of headers) {
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
      const [place, ...dateParts] = rawValue.split(",");
      mapped.birth_place = (place ?? "").trim();
      mapped.birth_date = dateParts.join(",").trim();
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
    return mapRowValues(headers, values, mapping);
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
    }
    if (mapped.father_email && !EMAIL_RE.test(mapped.father_email)) {
      errors.push(`Invalid father's email: ${mapped.father_email}`);
    }
    if (mapped.mother_email && !EMAIL_RE.test(mapped.mother_email)) {
      errors.push(`Invalid mother's email: ${mapped.mother_email}`);
    }

    if (mapped.birth_date && Number.isNaN(Date.parse(mapped.birth_date))) {
      errors.push(`Invalid birth date format: ${mapped.birth_date}`);
    }

    if (mapped.gender && !(normalizeGender(mapped.gender) in Gender)) {
      errors.push(`Unrecognized gender: ${mapped.gender}`);
    }

    if (mapped.religion && !(normalizeReligion(mapped.religion) in Religion)) {
      errors.push(`Unrecognized religion: ${mapped.religion}`);
    }

    if (mapped.status && !(mapped.status.toUpperCase() in StudentStatus)) {
      errors.push(`Unrecognized status: ${mapped.status}`);
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
    }

    if (mapped.birth_date && Number.isNaN(Date.parse(mapped.birth_date))) {
      errors.push(`Invalid birth date format: ${mapped.birth_date}`);
    }
    if (mapped.join_date && Number.isNaN(Date.parse(mapped.join_date))) {
      errors.push(`Invalid join date format: ${mapped.join_date}`);
    }
    if (
      mapped.resignation_date &&
      Number.isNaN(Date.parse(mapped.resignation_date))
    ) {
      errors.push(
        `Invalid resignation date format: ${mapped.resignation_date}`,
      );
    }
    if (
      mapped.last_working_date &&
      Number.isNaN(Date.parse(mapped.last_working_date))
    ) {
      errors.push(
        `Invalid last working date format: ${mapped.last_working_date}`,
      );
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
