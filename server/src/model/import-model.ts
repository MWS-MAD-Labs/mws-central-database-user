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

// Accept common English and Indonesian gender abbreviations.
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

// Normalize common religion labels and spelling variants.
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
  // Known values outside the enum map to OTHER.
  "baha'i": "OTHER",
  "bahai": "OTHER",
  "sikhism": "OTHER",
  "sikh": "OTHER",
};

// Catholic must precede the generic Christian pattern.
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

// Ignore case and rhesus factor because the enum stores only ABO group.
const BLOOD_TYPE_VALUE_ALIASES: Record<string, string> = {
  a: "A",
  "a+": "A",
  "a-": "A",
  b: "B",
  "b+": "B",
  "b-": "B",
  ab: "AB",
  "ab+": "AB",
  "ab-": "AB",
  o: "O",
  "o+": "O",
  "o-": "O",
  "tidak diketahui": "UNKNOWN",
  "-": "UNKNOWN",
};

export function normalizeBloodType(value: string): string {
  const normalized = value.trim().toLowerCase();
  return BLOOD_TYPE_VALUE_ALIASES[normalized] ?? value.toUpperCase();
}

// Student status aliases are separate from employee statuses.
const STUDENT_STATUS_VALUE_ALIASES: Record<string, string> = {
  "left school": "WITHDRAWN",
};

export function normalizeStudentStatus(value: string): string {
  const normalized = value.trim().toLowerCase();
  return STUDENT_STATUS_VALUE_ALIASES[normalized] ?? value.toUpperCase();
}

export function parseBoolean(value: string): boolean {
  return value.trim().toUpperCase() === "TRUE";
}

export const IMPORT_STUDENT_FIELDS = [
  { key: "full_name", label: "Full Name", required: true },
  { key: "nick_name", label: "Nick Name", required: true },
  { key: "email", label: "Email", required: true },
  { key: "gender", label: "Gender", required: true },
  { key: "religion", label: "Religion", required: true },
  // Explicit detail for rows whose religion maps to OTHER.
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
  // Super Admin override entered during preview and recorded in audit history.
  {
    key: "override_too_far_ahead_reason",
    label: "Grade Consistency Override Reason (Super Admin)",
    required: false,
  },
  { key: "pickup_drop_service", label: "Pickup Drop Service", required: false },
  { key: "catering_service", label: "Catering Service", required: false },
  { key: "psb_guide", label: "PSB Guide", required: false },
  // These fields create related records, not Student columns.
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
  "grade consistency override reason (super admin)":
    "override_too_far_ahead_reason",
  // Keep the old label for in-flight import previews.
  "grade skip override reason (super admin)": "override_too_far_ahead_reason",
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
  // Ambiguous parent email headers require explicit mapping.
};

// Relation imports use separate aliases because shared headers have different meanings.
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
  // Also accept relation columns from hand-built student sheets.
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
  // Bare email belongs to the relation; student matching needs Student Email.
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
  legacy_phone: string | null;
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
  // Only CREATE rows include related records.
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
  // Valid rows with no write are counted as skipped.
  skip_count: number;
};

export type PreviewStudentImportRequest = {
  mapping?: Partial<Record<string, ImportStudentFieldKey>>;
  sheet_name?: string;
  sheet_index?: number;
  // Relation mode attaches sub-records to a student matched by NIS or email.
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
  // Report sheets not selected for import.
  other_sheets: string[];
};

export type CommitStudentImportRequest = {
  job_id: string;
};

export type CommitStudentImportResponse = {
  job_id: string;
  status: ImportStatus;
  summary: ImportSummary;
  // Rows touched by this batch only.
  rows: StagedStudentRow[];
  // Continue committing batches while true.
  has_more: boolean;
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
  // Required unless Employment Type is Permanent, which cannot have one.
  { key: "contract_end_date", label: "Contract End Date", required: false },
  { key: "marital_status", label: "Marital Status", required: true },
  { key: "status", label: "Status", required: false },
  { key: "last_working_date", label: "Last Working Date", required: false },
  { key: "notes", label: "Notes", required: false },
  { key: "photo_url", label: "Photo ID", required: false },
  // Sensitive fields are restricted to Super Admin.
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
  { key: "education_level", label: "Education Level", required: false },
  { key: "institution_name", label: "Institution Name", required: false },
  { key: "major", label: "Major", required: false },
  { key: "graduation_year", label: "Graduation Year", required: false },
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
  // "Status Employee" maps to employment type.
  "status employee": "employment_type",
  "contract end date": "contract_end_date",
  "contract expiry": "contract_end_date",
  "contract expiry date": "contract_end_date",
  "marital status": "marital_status",
  status: "status",
  // "Employment Status" maps to active or inactive status.
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
  // Accept the exported BPJS Kesehatan label on re-import.
  "bpjs kesehatan number": "bpjs_number",
  "bpjs ketenagakerjaan number": "bpjs_employment_number",
  "kpj number": "kpj_number",
  "education level": "education_level",
  "institution name": "institution_name",
  major: "major",
  "graduation year": "graduation_year",
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
  // Rows are batch-local; the summary remains cumulative.
  rows: StagedEmployeeRow[];
  // Continue committing batches while true.
  has_more: boolean;
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
