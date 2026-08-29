import type {
  ImportJob,
  ImportMode,
  ImportStatus,
  ImportType,
  ConsentStatus,
  ConsentType,
  HealthNoteCategory,
  HealthNoteStatus,
  ParentType,
  PCDay,
} from "../generated/prisma/client";

// Sheets abbreviate gender as M/F or Indonesian L/P instead of MALE/FEMALE.
// Shared between the validator and request builders so both agree.
const GENDER_VALUE_ALIASES: Record<string, "MALE" | "FEMALE"> = {
  m: "MALE",
  f: "FEMALE",
  l: "MALE",
  p: "FEMALE",
};

export function normalizeGender(value: string): string {
  const normalized = value.trim().toLowerCase();
  return GENDER_VALUE_ALIASES[normalized] ?? value.toUpperCase();
}

// Sheets write religion as free text with inconsistent spelling/typos, not
// exact enum labels. Exact aliases first for values that need a specific
// mapping (bare "Christian"/"Kristen" defaults to PROTESTANTISM - Indonesian
// forms treat unqualified "Kristen" as Protestant, Catholic is always called
// out separately), then a keyword fallback below for typo variants so new
// misspellings of the same 6 religions don't need a new exact-match entry
// every time one shows up in a real sheet.
const RELIGION_VALUE_ALIASES: Record<string, string> = {
  islam: "ISLAM",
  kristen: "PROTESTANTISM",
  christian: "PROTESTANTISM",
  christianity: "PROTESTANTISM",
  protestant: "PROTESTANTISM",
  protestan: "PROTESTANTISM",
  catholic: "CATHOLICISM",
  katolik: "CATHOLICISM",
  hindu: "HINDUISM",
  buddha: "BUDDHISM",
  budha: "BUDDHISM",
  buddhist: "BUDDHISM",
  konghucu: "CONFUCIANISM",
  confucian: "CONFUCIANISM",
  confucianism: "CONFUCIANISM",
  other: "OTHER",
  // Not one of the 6 religions officially recognized in Indonesia (the enum
  // above) - always intended to land in OTHER, not treated as unrecognized.
  "baha'i": "OTHER",
  "bahai": "OTHER",
  "sikhism": "OTHER",
  "sikh": "OTHER",
};

// Catholic checked before the Protestant/generic-Christian keyword so
// "Christianity - Chatholic"-style values (contain both "christ" and a
// catholic typo) resolve correctly. Order matters.
const RELIGION_KEYWORD_PATTERNS: [RegExp, string][] = [
  [/islam/, "ISLAM"],
  [/hindu/, "HINDUISM"],
  [/buddh|budh/, "BUDDHISM"],
  [/konghucu|confu/, "CONFUCIANISM"],
  [/cathol|chathol|chatol|katolik/, "CATHOLICISM"],
  [/protestan|kristen|christ/, "PROTESTANTISM"],
];

export function normalizeReligion(value: string): string {
  const normalized = value.trim().toLowerCase();
  const aliased = RELIGION_VALUE_ALIASES[normalized];
  if (aliased) return aliased;

  for (const [pattern, religion] of RELIGION_KEYWORD_PATTERNS) {
    if (pattern.test(normalized)) return religion;
  }

  return value.toUpperCase();
}

// Legacy sheets use free text for student status ("Left School") instead of
// the StudentStatus enum. Employee status has a different enum, so this is
// deliberately student-only rather than shared with gender/religion aliases.
const STUDENT_STATUS_VALUE_ALIASES: Record<string, string> = {
  "left school": "WITHDRAWN",
};

export function normalizeStudentStatus(value: string): string {
  const normalized = value.trim().toLowerCase();
  return STUDENT_STATUS_VALUE_ALIASES[normalized] ?? value.toUpperCase();
}

// TRUE/FALSE toggle fields - anything not exactly "true" (case-insensitive)
// counts as false, same style as media_consent_yes.
export function parseBoolean(value: string): boolean {
  return value.trim().toUpperCase() === "TRUE";
}

export const IMPORT_STUDENT_FIELDS = [
  { key: "full_name", label: "Full Name", required: true },
  { key: "nick_name", label: "Nick Name", required: true },
  { key: "email", label: "Email", required: true },
  { key: "gender", label: "Gender", required: true },
  { key: "religion", label: "Religion", required: true },
  // Explicit override for religion_other - only meaningful when Religion is
  // Other. Without this column, the value is only auto-captured when the
  // sheet's Religion cell itself matches a known unofficial-religion alias
  // (Baha'i, Sikh) - this lets a sheet spell out any detail directly
  // instead, without needing a new alias added for every new answer.
  { key: "religion_other", label: "Religion (Other)", required: false },
  { key: "birth_place", label: "Birth Place", required: true },
  { key: "birth_date", label: "Birth Date", required: true },
  { key: "nis", label: "NIS", required: false },
  { key: "nisn", label: "NISN", required: false },
  { key: "entry_type", label: "Entry Type", required: true },
  { key: "current_grade", label: "Current Grade", required: true },
  { key: "join_academic_year", label: "Join Academic Year", required: false },
  { key: "previous_school", label: "Previous School", required: false },
  { key: "status", label: "Status", required: false },
  { key: "photo_url", label: "Photo ID", required: false },
  { key: "leave_year", label: "Leave Year", required: false },
  { key: "sn", label: "SN", required: false },
  { key: "join_grade", label: "Join Grade", required: false },
  { key: "graduation_grade", label: "Graduation Grade", required: false },
  { key: "pickup_drop_service", label: "Pickup Drop Service", required: false },
  { key: "catering_service", label: "Catering Service", required: false },
  { key: "psb_guide", label: "PSB Guide", required: false },
  // Relation-target fields - only used to build parents/health/consents/pc
  // sub-rows, never written onto Student itself.
  { key: "father_name", label: "Father", required: false },
  { key: "father_phone", label: "Father's Phone", required: false },
  { key: "father_email", label: "Father's Email", required: false },
  { key: "mother_name", label: "Mother", required: false },
  { key: "mother_phone", label: "Mother's Phone", required: false },
  { key: "mother_email", label: "Mother's Email", required: false },
  { key: "parent_address", label: "Address", required: false },
  { key: "health_info", label: "Health Information", required: false },
  { key: "special_needs", label: "Special Needs", required: false },
  { key: "blood_type", label: "Blood Type", required: false },
  { key: "media_consent_sign", label: "Media Consent Sign", required: false },
  { key: "media_consent_yes", label: "Media Consent YES", required: false },
  { key: "parent_consent_sign", label: "Parent Consent Sign", required: false },
  { key: "pc_monday", label: "PC Monday", required: false },
  { key: "pc_tuesday", label: "PC Tuesday", required: false },
  { key: "pc_wednesday", label: "PC Wednesday", required: false },
  { key: "pc_thursday", label: "PC Thursday", required: false },
  { key: "vaccine_type", label: "Vaccine Type", required: false },
  { key: "vaccine_received", label: "Vaccine Received", required: false },
  { key: "vaccine_date", label: "Vaccine Date", required: false },
  { key: "current_class", label: "Current Class", required: false },
  {
    key: "current_class_start_date",
    label: "Class Start Date",
    required: false,
  },
  {
    key: "current_class_end_date",
    label: "Class End Date",
    required: false,
  },
] as const;

export type ImportStudentFieldKey =
  (typeof IMPORT_STUDENT_FIELDS)[number]["key"];

export const DEFAULT_STUDENT_HEADER_ALIASES: Record<
  string,
  ImportStudentFieldKey
> = {
  "full name": "full_name",
  "nama lengkap": "full_name",
  "nick name": "nick_name",
  nickname: "nick_name",
  "nama panggilan": "nick_name",
  email: "email",
  "student mws email": "email",
  gender: "gender",
  "jenis kelamin": "gender",
  religion: "religion",
  agama: "religion",
  "religion (other)": "religion_other",
  "religion other": "religion_other",
  "religion detail": "religion_other",
  "birth place": "birth_place",
  "tempat lahir": "birth_place",
  "birth date": "birth_date",
  "tanggal lahir": "birth_date",
  nis: "nis",
  nisn: "nisn",
  "entry type": "entry_type",
  "current grade": "current_grade",
  "current grade (if active)": "current_grade",
  grade: "current_grade",
  "join academic year": "join_academic_year",
  "previous school": "previous_school",
  status: "status",
  "current status": "status",
  "photo id": "photo_url",
  "leave year": "leave_year",
  "leave year (if graduated)": "leave_year",
  sn: "sn",
  "join grade": "join_grade",
  "graduation grade": "graduation_grade",
  "pickup drop service": "pickup_drop_service",
  "catering service": "catering_service",
  "psb guide": "psb_guide",
  father: "father_name",
  "father's phone": "father_phone",
  mother: "mother_name",
  "mother's phone": "mother_phone",
  address: "parent_address",
  "health information": "health_info",
  "special needs, psychological / physical": "special_needs",
  "blood type": "blood_type",
  "media consent sign": "media_consent_sign",
  "media consent yes": "media_consent_yes",
  "parent consent sign": "parent_consent_sign",
  "pc monday": "pc_monday",
  "pc tuesday": "pc_tuesday",
  "pc wednesday": "pc_wednesday",
  "pc thursday": "pc_thursday",
  "vaccine type": "vaccine_type",
  "vaccine received": "vaccine_received",
  "vaccine date": "vaccine_date",
  "current class": "current_class",
  "class start date": "current_class_start_date",
  "class end date": "current_class_end_date",
  // "Emails" deliberately not aliased - source sheet is inconsistent about
  // which parent it belongs to, must be assigned per-file.
};

// Relation-attach mode reads a re-exported sheet (export-service.ts's
// HEALTH_NOTE_COLUMNS/VACCINE_RECORD_COLUMNS/PARENT_GUARDIAN_COLUMNS/
// CONSENT_COLUMNS/PC_ACTIVITY_COLUMNS), which has its own column names and
// its own meaning for "Email" - kept as a separate alias table rather than
// merged into DEFAULT_STUDENT_HEADER_ALIASES so the two don't fight over
// what a bare "Status"/"Email" header means.
export type ImportRelationFieldKey =
  | "nis"
  | "email"
  | "note_category"
  | "note_description"
  | "relation_status"
  | "noted_date"
  | "resolved_date"
  | "vaccine_type"
  | "vaccine_received"
  | "vaccine_date"
  | "parent_type"
  | "parent_name"
  | "parent_phone"
  | "parent_email"
  | "parent_address"
  | "parent_is_primary"
  | "consent_type_value"
  | "consent_date"
  | "signed_by"
  | "validity_period"
  | "pc_day_value"
  | "pc_activity_name"
  | "pc_academic_year_id"
  // Also recognize the compose-a-new-sheet relation-target columns
  // (same keys IMPORT_STUDENT_FIELDS uses) - a hand-built Attach sheet
  // (Health Information/Father/PC Monday/...) is just as valid an upload
  // as a re-exported one, and both need to resolve here.
  | "health_info"
  | "special_needs"
  | "blood_type"
  | "father_name"
  | "father_phone"
  | "mother_name"
  | "mother_phone"
  | "media_consent_sign"
  | "media_consent_yes"
  | "parent_consent_sign"
  | "pc_monday"
  | "pc_tuesday"
  | "pc_wednesday"
  | "pc_thursday"
  | "current_class"
  | "current_class_start_date"
  | "current_class_end_date";

export const DEFAULT_RELATION_HEADER_ALIASES: Record<
  string,
  ImportRelationFieldKey
> = {
  nis: "nis",
  "student nis": "nis",
  // Bare "email" is deliberately the relation's own email (e.g. a parent's)
  // - matching the student by email in this mode requires the distinct
  // "Student Email" header, since none of the 5 export sheets carry a
  // student-email column of their own.
  "student email": "email",
  category: "note_category",
  description: "note_description",
  status: "relation_status",
  "noted date": "noted_date",
  "resolved date": "resolved_date",
  "vaccine type": "vaccine_type",
  received: "vaccine_received",
  date: "vaccine_date",
  type: "parent_type",
  "parent/guardian name": "parent_name",
  phone: "parent_phone",
  email: "parent_email",
  address: "parent_address",
  "is primary": "parent_is_primary",
  "consent type": "consent_type_value",
  "consent date": "consent_date",
  "signed by": "signed_by",
  "validity period": "validity_period",
  day: "pc_day_value",
  activity: "pc_activity_name",
  "academic year id": "pc_academic_year_id",
  // Compose-a-new-sheet shape - mirrors the relevant entries in
  // DEFAULT_STUDENT_HEADER_ALIASES.
  father: "father_name",
  "father's phone": "father_phone",
  mother: "mother_name",
  "mother's phone": "mother_phone",
  "health information": "health_info",
  "special needs, psychological / physical": "special_needs",
  "blood type": "blood_type",
  "media consent sign": "media_consent_sign",
  "media consent yes": "media_consent_yes",
  "parent consent sign": "parent_consent_sign",
  "pc monday": "pc_monday",
  "pc tuesday": "pc_tuesday",
  "pc wednesday": "pc_wednesday",
  "pc thursday": "pc_thursday",
  "vaccine received": "vaccine_received",
  "vaccine date": "vaccine_date",
  "current class": "current_class",
  "class start date": "current_class_start_date",
  "class end date": "current_class_end_date",
};

export const BIRTH_PLACE_DATE_HEADER_ALIASES = new Set([
  "place, date of birth",
  "place date of birth",
  "tempat, tanggal lahir",
]);

export type StagedRowAction = "CREATE" | "UPDATE";

export type StagedRelationWrite = {
  errors: string[];
  committed_id: string | null;
};

export type StagedParentGuardian = StagedRelationWrite & {
  type: ParentType;
  full_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_primary?: boolean;
};

export type StagedHealthRecord = StagedRelationWrite & {
  blood_type: string | null;
  needs_assistance: boolean;
};

export type StagedHealthNote = StagedRelationWrite & {
  category: HealthNoteCategory;
  description: string;
  status?: HealthNoteStatus;
  noted_date?: string;
  resolved_date?: string;
};

export type StagedConsent = StagedRelationWrite & {
  consent_type: ConsentType;
  signed_by: string | null;
  status: ConsentStatus;
  consent_date?: string;
  validity_period?: string;
};

export type StagedPCActivity = StagedRelationWrite & {
  day: PCDay;
  activity: string;
  academic_year_id?: string;
};

export type StagedVaccineRecord = StagedRelationWrite & {
  vaccine_type: string;
  received: boolean;
  date: string | null;
};

export type StagedEnrollment = StagedRelationWrite & {
  class_name: string;
  start_date: string | null;
  end_date: string | null;
};

export type StagedStudentRow = {
  row_number: number;
  raw: Record<string, string>;
  source_raw?: Record<string, string>;
  action: StagedRowAction | null;
  matched_student_id: string | null;
  errors: string[];
  warnings: string[];
  committed_student_id: string | null;
  previous_values: Record<string, string | number | boolean | null> | null;
  // Relation sub-rows - only populated for CREATE rows. UPDATE doesn't
  // touch relations; those are managed live in the app afterward.
  parents: StagedParentGuardian[];
  health: StagedHealthRecord | null;
  health_notes: StagedHealthNote[];
  consents: StagedConsent[];
  pc_activities: StagedPCActivity[];
  vaccine_records: StagedVaccineRecord[];
  enrollment: StagedEnrollment | null;
};

export type ImportSummary = {
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  create_count: number;
  update_count: number;
};

export type PreviewStudentImportRequest = {
  mapping?: Partial<Record<string, ImportStudentFieldKey>>;
  sheet_name?: string;
  sheet_index?: number;
  // Defaults to FULL_REGISTRATION - RELATION_ATTACH skips the full-student
  // required fields and only attaches relation data (health, parents, PC
  // activities, consents, vaccines) to a student matched by NIS or email.
  import_mode?: ImportMode;
};

export type PreviewStudentImportResponse = {
  job_id: string;
  status: ImportStatus;
  type: ImportType;
  mode: ImportMode;
  field_mapping: Record<string, ImportStudentFieldKey>;
  unmapped_headers: string[];
  summary: ImportSummary;
  rows: StagedStudentRow[];
  sheet_name: string;
  source_headers: string[];
  // Other sheets in the file that were NOT imported - surfaced so a skipped
  // sheet doesn't go unnoticed.
  other_sheets: string[];
};

export type CommitStudentImportRequest = {
  job_id: string;
};

export type CommitStudentImportResponse = {
  job_id: string;
  status: ImportStatus;
  summary: ImportSummary;
  rows: StagedStudentRow[];
};

export type RollbackSummary = {
  reverted_count: number;
  failed_count: number;
};

export type RollbackStudentImportResponse = {
  job_id: string;
  status: ImportStatus;
  summary: RollbackSummary;
  rows: StagedStudentRow[];
};

export type GetImportJobRequest = {
  id: string;
};

export type ImportJobResponse = {
  id: string;
  type: ImportType;
  mode: ImportMode;
  status: ImportStatus;
  file_name: string | null;
  field_mapping: Record<string, ImportStudentFieldKey> | null;
  summary: ImportSummary | null;
  rows: StagedStudentRow[];
  created_by: string;
  created_at: string;
  completed_at: string | null;
};

export function toImportJobResponse(job: ImportJob): ImportJobResponse {
  return {
    id: job.id,
    type: job.type,
    mode: job.mode,
    status: job.status,
    file_name: job.file_name,
    field_mapping:
      (job.field_mapping as Record<string, ImportStudentFieldKey> | null) ??
      null,
    summary: (job.result_summary as ImportSummary | null) ?? null,
    rows: (job.staged_rows as StagedStudentRow[] | null) ?? [],
    created_by: job.created_by,
    created_at: job.created_at.toISOString(),
    completed_at: job.completed_at ? job.completed_at.toISOString() : null,
  };
}

// Employee import - same flow as Student, no relation sub-rows: one flat
// write (Employee + Person) per row.

export const IMPORT_EMPLOYEE_FIELDS = [
  { key: "employee_id", label: "Employee ID", required: true },
  { key: "full_name", label: "Full Name", required: true },
  { key: "nick_name", label: "Nick", required: true },
  { key: "email", label: "Email", required: true },
  { key: "gender", label: "Gender", required: true },
  { key: "religion", label: "Religion", required: true },
  { key: "religion_other", label: "Religion (Other)", required: false },
  { key: "birth_place", label: "Birth Place", required: true },
  { key: "birth_date", label: "Birth Date", required: true },
  { key: "unit", label: "Unit", required: true },
  { key: "job_position", label: "Job Position", required: true },
  { key: "job_level", label: "Job Level", required: true },
  { key: "building", label: "Building", required: true },
  { key: "join_date", label: "Join Date", required: true },
  { key: "employment_type", label: "Employment Type", required: true },
  // Only meaningful when employment_type isn't PERMANENT - mirrors
  // employee-service.ts's own "Permanent employees cannot have a contract
  // end date" rule (validateEmployeeRowShape enforces it at preview time too).
  { key: "contract_end_date", label: "Contract End Date", required: false },
  { key: "marital_status", label: "Marital Status", required: true },
  { key: "status", label: "Status", required: false },
  { key: "last_working_date", label: "Last Working Date", required: false },
  { key: "notes", label: "Notes", required: false },
  { key: "photo_url", label: "Photo ID", required: false },
  // Sensitive tier (hard SUPER_ADMIN-only, see toEmployeeDetailResponse).
  { key: "mobile_phone", label: "Mobile Phone", required: false },
  {
    key: "residential_address",
    label: "Residential Address",
    required: false,
  },
  { key: "nik", label: "NIK", required: false },
  { key: "npwp", label: "NPWP", required: false },
  {
    key: "bank_account_number",
    label: "Bank Account Number",
    required: false,
  },
  { key: "bpjs_number", label: "BPJS Kesehatan Number", required: false },
  {
    key: "bpjs_employment_number",
    label: "BPJS Ketenagakerjaan Number",
    required: false,
  },
  { key: "kpj_number", label: "KPJ Number", required: false },
] as const;

export type ImportEmployeeFieldKey =
  (typeof IMPORT_EMPLOYEE_FIELDS)[number]["key"];

export const DEFAULT_EMPLOYEE_HEADER_ALIASES: Record<
  string,
  ImportEmployeeFieldKey
> = {
  "employee id": "employee_id",
  "full name": "full_name",
  "nama lengkap": "full_name",
  nick: "nick_name",
  "nick name": "nick_name",
  nickname: "nick_name",
  email: "email",
  gender: "gender",
  "jenis kelamin": "gender",
  religion: "religion",
  agama: "religion",
  "religion (other)": "religion_other",
  "religion other": "religion_other",
  "religion detail": "religion_other",
  "birth place": "birth_place",
  "birth date": "birth_date",
  unit: "unit",
  "job position": "job_position",
  "job level": "job_level",
  building: "building",
  "join date": "join_date",
  "employment type": "employment_type",
  // "Status Employee" (flipped word order) is the sheet's label for
  // employment_type, not the ACTIVE/INACTIVE status field below.
  "status employee": "employment_type",
  "contract end date": "contract_end_date",
  "contract expiry": "contract_end_date",
  "contract expiry date": "contract_end_date",
  "marital status": "marital_status",
  status: "status",
  // §8.2 D's "Employment Status" is the same ACTIVE/INACTIVE field as
  // §8.2 C's "Status", not a second field.
  "employment status": "status",
  "last working date": "last_working_date",
  notes: "notes",
  "photo id": "photo_url",
  "mobile phone": "mobile_phone",
  "residential address": "residential_address",
  nik: "nik",
  npwp: "npwp",
  "bank account number": "bank_account_number",
  "bpjs number": "bpjs_number",
  "bpjs ketenagakerjaan number": "bpjs_employment_number",
  "kpj number": "kpj_number",
};

export type StagedEmployeeRow = {
  row_number: number;
  raw: Record<string, string>;
  source_raw?: Record<string, string>;
  action: StagedRowAction | null;
  matched_employee_id: string | null;
  errors: string[];
  warnings: string[];
  committed_employee_id: string | null;
  previous_values: Record<string, string | number | boolean | null> | null;
};

export type PreviewEmployeeImportRequest = {
  mapping?: Partial<Record<string, ImportEmployeeFieldKey>>;
  sheet_name?: string;
  sheet_index?: number;
};

export type PreviewEmployeeImportResponse = {
  job_id: string;
  status: ImportStatus;
  type: ImportType;
  field_mapping: Record<string, ImportEmployeeFieldKey>;
  unmapped_headers: string[];
  summary: ImportSummary;
  rows: StagedEmployeeRow[];
  sheet_name: string;
  source_headers: string[];
  other_sheets: string[];
};

export type CommitEmployeeImportResponse = {
  job_id: string;
  status: ImportStatus;
  summary: ImportSummary;
  rows: StagedEmployeeRow[];
};

export type RollbackEmployeeImportResponse = {
  job_id: string;
  status: ImportStatus;
  summary: RollbackSummary;
  rows: StagedEmployeeRow[];
};

export type EmployeeImportJobResponse = {
  id: string;
  type: ImportType;
  status: ImportStatus;
  file_name: string | null;
  field_mapping: Record<string, ImportEmployeeFieldKey> | null;
  summary: ImportSummary | null;
  rows: StagedEmployeeRow[];
  created_by: string;
  created_at: string;
  completed_at: string | null;
};

export function toEmployeeImportJobResponse(
  job: ImportJob,
): EmployeeImportJobResponse {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    file_name: job.file_name,
    field_mapping:
      (job.field_mapping as Record<string, ImportEmployeeFieldKey> | null) ??
      null,
    summary: (job.result_summary as ImportSummary | null) ?? null,
    rows: (job.staged_rows as StagedEmployeeRow[] | null) ?? [],
    created_by: job.created_by,
    created_at: job.created_at.toISOString(),
    completed_at: job.completed_at ? job.completed_at.toISOString() : null,
  };
}
