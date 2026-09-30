import {
  AdminRole,
  type Person,
  type Employee,
  type EmployeePcMentorUnit,
  type MasterUnit,
  type MasterJobPosition,
  type MasterJobLevel,
  type MasterBuilding,
  type Gender,
  type Religion,
  type EmploymentType,
  type EmployeeStatus,
  type MaritalStatus,
  type EducationLevel,
  type AdminUser,
  type DisciplinaryActionType,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";
import { maskSensitiveValue } from "../utils/sensitive-data";
import type { BulkActionResponse, BulkIdsRequest } from "./bulk-action-model";
import {
  isBirthDateNotFuture,
  isBirthDateNotTooOld,
} from "../validation/validation";

export function hasBirthDateWarning(birthDate: Date): boolean {
  const iso = birthDate.toISOString();
  return !isBirthDateNotFuture(iso) || !isBirthDateNotTooOld(iso);
}

export const EMPLOYEE_SORT_FIELDS = [
  "created_at",
  "full_name",
  "nick_name",
  "email",
  "employee_id",
  "status",
  "join_date",
] as const;

export type EmployeeSortField = (typeof EMPLOYEE_SORT_FIELDS)[number];

export type CreateEmployeeRequest = {
  full_name: string;
  nick_name: string;
  email: string;
  gender: Gender;
  religion: Religion;
  // Only meaningful when religion is OTHER.
  religion_other?: string | null;
  birth_place: string;
  birth_date: string;
  photo_url?: string;

  employee_id: string;
  status: EmployeeStatus;
  employment_type: EmploymentType;
  unit_id: string;
  job_position_id: string;
  job_level_id: string;
  building_id: string;
  join_date: string;
  contract_end_date?: string;
  last_working_date?: string;
  notes?: string;
  is_pc_mentor_eligible?: boolean;
  pc_mentor_unit_ids?: string[];

  marital_status: MaritalStatus;
  mobile_phone?: string;
  residential_address?: string;
  nik?: string;
  npwp?: string;
  bank_account_number?: string;
  bpjs_number?: string;
  bpjs_employment_number?: string;
  kpj_number?: string;

  // Highest or most recent education only.
  education_level?: EducationLevel;
  institution_name?: string;
  major?: string;
  graduation_year?: number;
};

export type UpdateEmployeeRequest = {
  id: string;

  full_name?: string;
  nick_name?: string;
  email?: string;
  gender?: Gender;
  religion?: Religion;
  religion_other?: string | null;
  birth_place?: string;
  birth_date?: string;
  photo_url?: string;

  employee_id?: string;
  employment_type?: EmploymentType;
  status?: EmployeeStatus;
  unit_id?: string;
  job_position_id?: string;
  job_level_id?: string;
  building_id?: string;
  join_date?: string;
  // Null clears the date when changing to permanent employment.
  contract_end_date?: string | null;
  last_working_date?: string;
  notes?: string;
  is_pc_mentor_eligible?: boolean;
  pc_mentor_unit_ids?: string[];

  marital_status?: MaritalStatus;
  mobile_phone?: string;
  residential_address?: string;
  nik?: string;
  npwp?: string;
  bank_account_number?: string;
  bpjs_number?: string;
  bpjs_employment_number?: string;
  kpj_number?: string;

  education_level?: EducationLevel;
  institution_name?: string;
  major?: string;
  graduation_year?: number;

  // Backdates mutation history created by this update.
  effective_date?: string;
};

export type GetEmployeeRequest = {
  id: string;
};

export type ExtendEmployeeContractRequest = {
  id: string;
  contract_end_date: string;
};

export type RemoveEmployeeRequest = {
  id: string;
};

export type RestoreEmployeeRequest = {
  id: string;
};

export type BulkEmployeeRequest = BulkIdsRequest;

export type BulkUpdateEmployeeRequest = BulkIdsRequest & {
  employment_type?: EmploymentType;
  status?: EmployeeStatus;
  unit_id?: string;
  job_position_id?: string;
  job_level_id?: string;
  building_id?: string;
  // Backdates mutation history for the whole batch.
  effective_date?: string;
  // Per-employee dates for mixed contract and resignation updates.
  contract_end_date_overrides?: { id: string; contract_end_date: string }[];
  last_working_date_overrides?: { id: string; last_working_date: string }[];
};

export type BulkExtendEmployeeContractRequest = BulkIdsRequest & {
  duration_months?: number;
  contract_end_date?: string;
  baseline_overrides?: { id: string; baseline_date: string }[];
};

export type BulkEmployeeResponse = BulkActionResponse<
  EmployeeResponse | boolean
>;

// Existing education values are suggestions, not fixed choices.
export type EmployeeEducationSuggestionsResponse = {
  institution_names: string[];
  majors: string[];
};

// One row is returned per mismatched employee field.
export type UnitConsistencyIssue = {
  employee_id: string;
  employee_number: string;
  employee_name: string;
  unit_name: string;
  job_position_name: string | null;
  job_level_name: string | null;
  reason: string;
};

export type SearchEmployeeRequest = {
  page: number;
  size: number;
  search?: string;

  status?: EmployeeStatus;
  employment_type?: EmploymentType;
  unit_id?: string;
  job_position_id?: string;
  job_level_id?: string;
  building_id?: string;
  gender?: Gender;
  religion?: Religion;
  join_date_start?: string;
  join_date_end?: string;

  is_deleted?: boolean;
  sort_by?: EmployeeSortField;
  sort_order?: "asc" | "desc";
};

export type GetEmployeeVersionRequest = Omit<
  SearchEmployeeRequest,
  "page" | "size" | "sort_by" | "sort_order"
>;

export type EmployeeResponse = {
  id: string;
  person_id: string;
  unit_id: string;

  identity: {
    full_name: string;
    nick_name: string;
    email: string;
    mobile_phone?: string | null;
    residential_address?: string | null;
    // Expose only the warning, not the sensitive birth date.
    has_birth_date_warning: boolean;
  };

  employment: {
    employee_id: string;
    unit: string;
    job_position: string;
    job_position_id: string;
    job_level: string;
    job_level_id: string;
    // Authoritative teaching-role flag.
    is_teaching_role: boolean;
    // Independent of is_teaching_role - PC Activity room mentor eligibility.
    is_pc_mentor_eligible: boolean;
    // Empty means "their own unit only" - see EmployeePcMentorUnit.
    pc_mentor_units: { id: string; name: string }[];
    building: string;
    join_date: string;
  };

  status_info: {
    status: EmployeeStatus;
    employment_type: EmploymentType;
    contract_end_date: string | null;
  };

  offboarding: {
    last_working_date: string | null;
    notes: string | null;
  };

  created_at: string;

  // Search-only summary of the current disciplinary flag.
  disciplinary_flag?: {
    type: DisciplinaryActionType;
    level: number;
  } | null;
};

export type EmployeeDetailResponse = Omit<EmployeeResponse, "identity"> & {
  identity: EmployeeResponse["identity"] & {
    gender: Gender;
    religion: Religion;
    religion_other: string | null;
    birth_place: string;
    birth_date: string;
    photo_url: string | null;
    marital_status: MaritalStatus;
    nik: string | null;
    npwp: string | null;
    bank_account_number: string | null;
    bpjs_number: string | null;
    bpjs_employment_number: string | null;
    kpj_number: string | null;
    // Per-field timestamps enforce each identifier's edit window.
    nik_set_at: string | null;
    npwp_set_at: string | null;
    bank_account_number_set_at: string | null;
    bpjs_number_set_at: string | null;
    bpjs_employment_number_set_at: string | null;
    kpj_number_set_at: string | null;
    education_level: EducationLevel | null;
    institution_name: string | null;
    major: string | null;
    graduation_year: number | null;
    // Derived server-side from the viewer's person ID.
    is_self: boolean;
  };
};

export type PersonWithEmployee = Person & {
  employee:
    | (Employee & {
        unit: MasterUnit;
        job_position: MasterJobPosition;
        job_level: MasterJobLevel;
        building: MasterBuilding;
        // Optional - only populated by queries that opt into this include
        // (detail/create/update responses). List/search responses omit it
        // and toEmployeeResponse falls back to an empty array.
        pc_mentor_units?: (EmployeePcMentorUnit & { unit: MasterUnit })[];
      })
    | null;
};

export function toEmployeeResponse(
  person: PersonWithEmployee,
  admin: Pick<AdminUser, "role">,
): EmployeeResponse {
  const employee = person.employee!;
  // Viewers cannot access personal contact details.
  const canViewContact = admin.role !== AdminRole.VIEWER;

  return {
    id: employee.id,
    person_id: person.id,
    unit_id: employee.unit_id,

    identity: {
      full_name: person.full_name,
      nick_name: person.nick_name,
      email: person.email,
      has_birth_date_warning: hasBirthDateWarning(person.birth_date),
      ...(canViewContact && {
        mobile_phone: employee.mobile_phone,
        residential_address: employee.residential_address,
      }),
    },

    employment: {
      employee_id: employee.employee_id,
      unit: employee.unit.name,
      job_position: employee.job_position.name,
      job_position_id: employee.job_position_id,
      job_level: employee.job_level.name,
      job_level_id: employee.job_level_id,
      is_teaching_role: employee.job_level.is_teaching_role,
      is_pc_mentor_eligible: employee.is_pc_mentor_eligible,
      pc_mentor_units: (employee.pc_mentor_units ?? []).map((row) => ({
        id: row.unit_id,
        name: row.unit.name,
      })),
      building: employee.building.name,
      join_date: employee.join_date.toISOString(),
    },

    status_info: {
      status: employee.status,
      employment_type: employee.employment_type,
      contract_end_date: employee.contract_end_date
        ? employee.contract_end_date.toISOString()
        : null,
    },

    offboarding: {
      last_working_date: employee.last_working_date
        ? employee.last_working_date.toISOString()
        : null,
      notes: employee.notes,
    },

    created_at: employee.created_at.toISOString(),
  };
}

export const toEmployeeDetailResponse = (
  person: PersonWithEmployee,
  admin: Pick<AdminUser, "role">,
): EmployeeDetailResponse => {
  const baseResponse = toEmployeeResponse(person, admin);
  const employee = person.employee!;

  return {
    ...baseResponse,
    identity: {
      ...baseResponse.identity,
      gender: person.gender,
      religion: person.religion,
      religion_other: person.religion_other,
      birth_place: person.birth_place,
      birth_date: person.birth_date.toISOString(),
      photo_url: person.photo_url,
      marital_status: employee.marital_status,
      nik: employee.nik,
      npwp: employee.npwp,
      bank_account_number: employee.bank_account_number,
      bpjs_number: employee.bpjs_number,
      bpjs_employment_number: employee.bpjs_employment_number,
      kpj_number: employee.kpj_number,
      nik_set_at: employee.nik_set_at
        ? employee.nik_set_at.toISOString()
        : null,
      npwp_set_at: employee.npwp_set_at
        ? employee.npwp_set_at.toISOString()
        : null,
      bank_account_number_set_at: employee.bank_account_number_set_at
        ? employee.bank_account_number_set_at.toISOString()
        : null,
      bpjs_number_set_at: employee.bpjs_number_set_at
        ? employee.bpjs_number_set_at.toISOString()
        : null,
      bpjs_employment_number_set_at: employee.bpjs_employment_number_set_at
        ? employee.bpjs_employment_number_set_at.toISOString()
        : null,
      kpj_number_set_at: employee.kpj_number_set_at
        ? employee.kpj_number_set_at.toISOString()
        : null,
      education_level: employee.education_level,
      institution_name: employee.institution_name,
      major: employee.major,
      graduation_year: employee.graduation_year,
      // The service sets this after comparing the viewer's person ID.
      is_self: false,
    },
  };
};

// Export from the already-authorized response DTO.
export type EmployeeExportRow = {
  id: string;
  employee_id: string;
  full_name: string;
  nick_name: string;
  email: string;
  mobile_phone: string | null;
  residential_address: string | null;
  unit: string;
  job_position: string;
  job_level: string;
  building: string;
  join_date: string;
  status: EmployeeStatus;
  employment_type: EmploymentType;
  contract_end_date: string | null;
  last_working_date: string | null;
  created_at: string;
  gender: Gender | null;
  religion: Religion | null;
  religion_other: string | null;
  birth_place: string | null;
  birth_date: string | null;
  marital_status: MaritalStatus | null;
  nik: string | null;
  npwp: string | null;
  bank_account_number: string | null;
  bpjs_number: string | null;
  bpjs_employment_number: string | null;
  kpj_number: string | null;
  education_level: EducationLevel | null;
  institution_name: string | null;
  major: string | null;
  graduation_year: number | null;
};

export function toEmployeeExportRow(
  response: EmployeeResponse | EmployeeDetailResponse,
): EmployeeExportRow {
  const detail = "birth_date" in response.identity ? response.identity : null;

  return {
    id: response.id,
    employee_id: response.employment.employee_id,
    full_name: response.identity.full_name,
    nick_name: response.identity.nick_name,
    email: response.identity.email,
    mobile_phone: response.identity.mobile_phone ?? null,
    residential_address: response.identity.residential_address ?? null,
    unit: response.employment.unit,
    job_position: response.employment.job_position,
    job_level: response.employment.job_level,
    building: response.employment.building,
    join_date: response.employment.join_date,
    status: response.status_info.status,
    employment_type: response.status_info.employment_type,
    contract_end_date: response.status_info.contract_end_date?.slice(0, 10) ?? null,
    last_working_date: response.offboarding.last_working_date?.slice(0, 10) ?? null,
    created_at: response.created_at,
    marital_status: detail?.marital_status ?? null,
    gender: detail?.gender ?? null,
    religion: detail?.religion ?? null,
    religion_other: detail?.religion_other ?? null,
    birth_place: detail?.birth_place ?? null,
    birth_date: detail?.birth_date ?? null,
    nik: detail?.nik ?? null,
    npwp: detail?.npwp ?? null,
    bank_account_number: detail?.bank_account_number ?? null,
    bpjs_number: detail?.bpjs_number ?? null,
    bpjs_employment_number: detail?.bpjs_employment_number ?? null,
    kpj_number: detail?.kpj_number ?? null,
    education_level: detail?.education_level ?? null,
    institution_name: detail?.institution_name ?? null,
    major: detail?.major ?? null,
    graduation_year: detail?.graduation_year ?? null,
  };
}

// Keep raw IDs in audit snapshots so later renames do not change history.
export function toEmployeeAuditSnapshot(
  person: Person,
  employee: Employee,
): AuditValue {
  return {
    employee_id: employee.employee_id,
    full_name: person.full_name,
    nick_name: person.nick_name,
    email: person.email,
    status: employee.status,
    employment_type: employee.employment_type,
    unit_id: employee.unit_id,
    job_position_id: employee.job_position_id,
    job_level_id: employee.job_level_id,
    building_id: employee.building_id,
    join_date: employee.join_date.toISOString(),
    contract_end_date: employee.contract_end_date
      ? employee.contract_end_date.toISOString()
      : null,
    last_working_date: employee.last_working_date
      ? employee.last_working_date.toISOString()
      : null,
    notes: employee.notes,
    marital_status: employee.marital_status,
    mobile_phone: employee.mobile_phone,
    residential_address: employee.residential_address,
    // Audit snapshots expose only masked identifiers.
    nik: maskSensitiveValue(employee.nik),
    npwp: maskSensitiveValue(employee.npwp),
    bank_account_number: maskSensitiveValue(employee.bank_account_number),
    bpjs_number: maskSensitiveValue(employee.bpjs_number),
    bpjs_employment_number: maskSensitiveValue(
      employee.bpjs_employment_number,
    ),
    kpj_number: maskSensitiveValue(employee.kpj_number),
    education_level: employee.education_level,
    institution_name: employee.institution_name,
    major: employee.major,
    graduation_year: employee.graduation_year,
  };
}
