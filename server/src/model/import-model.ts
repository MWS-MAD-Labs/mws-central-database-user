import type {
  ImportJob,
  ImportStatus,
  ImportType,
} from "../generated/prisma/client";
export const IMPORT_STUDENT_FIELDS = [
  { key: "full_name", label: "Full Name", required: true },
  { key: "nick_name", label: "Nick Name", required: true },
  { key: "email", label: "Email", required: true },
  { key: "gender", label: "Gender", required: true },
  { key: "religion", label: "Religion", required: true },
  { key: "birth_place", label: "Birth Place", required: true },
  { key: "birth_date", label: "Birth Date", required: true },
  { key: "nis", label: "NIS", required: true },
  { key: "nisn", label: "NISN", required: false },
  { key: "current_grade", label: "Current Grade", required: true },
  { key: "join_academic_year", label: "Join Academic Year", required: false },
  { key: "previous_school", label: "Previous School", required: false },
  { key: "status", label: "Status", required: false },
  { key: "photo_url", label: "Photo ID", required: false },
  { key: "leave_year", label: "Leave Year", required: false },
  { key: "sn", label: "SN", required: false },
  { key: "join_grade", label: "Join Grade", required: false },
  { key: "graduation_grade", label: "Graduation Grade", required: false },
  // Relation-target fields - only used to build parents/health/consents/pc
  // sub-rows (see resolveStagedRows), never written onto Student itself.
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
  nis: "nis",
  nisn: "nisn",
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
  // "Emails" is deliberately NOT aliased - the source sheet is inconsistent
  // about which parent it belongs to, so it's left unmapped and must be
  // assigned explicitly per-file to father_email or mother_email.
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
  type: "FATHER" | "MOTHER";
  full_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
};

export type StagedHealthRecord = StagedRelationWrite & {
  blood_type: string | null;
  needs_assistance: boolean;
};

export type StagedHealthNote = StagedRelationWrite & {
  category: "HEALTH_INFO" | "SPECIAL_NEEDS";
  description: string;
};

export type StagedConsent = StagedRelationWrite & {
  consent_type: "MEDIA_CONSENT" | "PARENT_CONSENT";
  signed_by: string | null;
  status: "PENDING" | "SIGNED";
};

export type StagedPCActivity = StagedRelationWrite & {
  day: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY";
  activity: string;
};

export type StagedStudentRow = {
  row_number: number;
  raw: Record<string, string>;
  action: StagedRowAction | null;
  matched_student_id: string | null;
  errors: string[];
  warnings: string[];
  committed_student_id: string | null;
  previous_values: Record<string, string | number | boolean | null> | null;
  // Relation sub-rows - only populated/written for CREATE rows (§ scope
  // note in import-service.ts: re-importing an existing student via UPDATE
  // doesn't touch relations, since those are expected to be managed live
  // in the app afterward, not repeatedly overwritten by re-import).
  parents: StagedParentGuardian[];
  health: StagedHealthRecord | null;
  health_notes: StagedHealthNote[];
  consents: StagedConsent[];
  pc_activities: StagedPCActivity[];
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
};

export type PreviewStudentImportResponse = {
  job_id: string;
  status: ImportStatus;
  type: ImportType;
  field_mapping: Record<string, ImportStudentFieldKey>;
  unmapped_headers: string[];
  summary: ImportSummary;
  rows: StagedStudentRow[];
  sheet_name: string;
  // Other sheets in the same file that were NOT imported - surfaced so an
  // admin uploading a multi-sheet workbook notices data sitting in a sheet
  // that got skipped, instead of it silently never being imported.
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

// ---------------------------------------------------------------------
// Employee import - same shape/flow as Student, but no relation sub-rows:
// Employee has no ParentGuardian/HealthRecord/Consent/PCActivity equivalent,
// it's one flat write (Employee + Person) per row.
// ---------------------------------------------------------------------

export const IMPORT_EMPLOYEE_FIELDS = [
  { key: "employee_id", label: "Employee ID", required: true },
  { key: "full_name", label: "Full Name", required: true },
  { key: "nick_name", label: "Nick", required: true },
  { key: "email", label: "Email", required: true },
  { key: "gender", label: "Gender", required: true },
  { key: "religion", label: "Religion", required: true },
  { key: "birth_place", label: "Birth Place", required: true },
  { key: "birth_date", label: "Birth Date", required: true },
  { key: "unit", label: "Unit", required: true },
  { key: "job_position", label: "Job Position", required: true },
  { key: "job_level", label: "Job Level", required: true },
  { key: "building", label: "Building", required: true },
  { key: "join_date", label: "Join Date", required: true },
  { key: "employment_type", label: "Employment Type", required: true },
  { key: "marital_status", label: "Marital Status", required: true },
  { key: "status", label: "Status", required: false },
  { key: "resignation_date", label: "Resignation Date", required: false },
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
  { key: "bpjs_number", label: "BPJS Number", required: false },
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
  "birth place": "birth_place",
  "birth date": "birth_date",
  unit: "unit",
  "job position": "job_position",
  "job level": "job_level",
  building: "building",
  "join date": "join_date",
  "employment type": "employment_type",
  // "Status Employee" (word order flipped) is the sheet's label for
  // employment_type (Permanent/Contract/Probation/...), not the
  // ACTIVE/INACTIVE status field below - don't confuse it with "employment
  // status", which despite the similar name maps to "status".
  "status employee": "employment_type",
  "marital status": "marital_status",
  status: "status",
  // §8.2 D lists "Employment Status" alongside Resignation Date/Last
  // Working Date/Notes - that's the same ACTIVE/INACTIVE/... field as
  // "Status" in §8.2 C, not a second status field.
  "employment status": "status",
  "resignation date": "resignation_date",
  "last working date": "last_working_date",
  notes: "notes",
  "photo id": "photo_url",
  "mobile phone": "mobile_phone",
  "residential address": "residential_address",
  nik: "nik",
  npwp: "npwp",
  "bank account number": "bank_account_number",
  "bpjs number": "bpjs_number",
};

export type StagedEmployeeRow = {
  row_number: number;
  raw: Record<string, string>;
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
