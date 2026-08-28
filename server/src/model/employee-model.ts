import {
  AdminRole,
  type Person,
  type Employee,
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
import type { BulkActionResponse, BulkIdsRequest } from "./bulk-action-model";

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

  marital_status: MaritalStatus;
  mobile_phone?: string;
  residential_address?: string;
  nik?: string;
  npwp?: string;
  bank_account_number?: string;
  bpjs_number?: string;
  bpjs_employment_number?: string;
  kpj_number?: string;

  // Highest/most recent education only - not a history of every degree held.
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
  // Explicit null clears it (only valid combined with employment_type going
  // to PERMANENT, which can't carry a contract end date) - omitted leaves it
  // untouched.
  contract_end_date?: string | null;
  last_working_date?: string;
  notes?: string;

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

  // Backdates mutation history row(s) this update creates - see EmployeeMutationHistory.
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
  // Backdates the mutation history row(s) this creates - same meaning as
  // UpdateEmployeeRequest.effective_date, applied uniformly to every
  // employee in the batch.
  effective_date?: string;
  // Per-employee overrides for fields that can't share one value across a
  // mixed selection. contract_end_date_overrides only matters when
  // employment_type is set to a non-PERMANENT type (each employee gets
  // their own duration); ignored (and cleared) when employment_type is set
  // to PERMANENT. last_working_date_overrides only matters when status is
  // set to RESIGNED (each employee's own last day).
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

// Distinct values already on record, offered as suggestions on the
// Institution/Major fields so admins reuse the same spelling instead of
// drifting ("Computer Science" vs "Komputer Science") - not a fixed enum,
// typing something new is still allowed.
export type EmployeeEducationSuggestionsResponse = {
  institution_names: string[];
  majors: string[];
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
  };

  employment: {
    employee_id: string;
    unit: string;
    job_position: string;
    job_level: string;
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

  // Set only by the list/search path (EmployeeService.search batches one
  // query for the whole page) - undefined elsewhere, not the employee's
  // full history, just enough for EmployeesTable.jsx to flag the row.
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
    education_level: EducationLevel | null;
    institution_name: string | null;
    major: string | null;
    graduation_year: number | null;
  };
};

export type PersonWithEmployee = Person & {
  employee:
    | (Employee & {
        unit: MasterUnit;
        job_position: MasterJobPosition;
        job_level: MasterJobLevel;
        building: MasterBuilding;
      })
    | null;
};

export function toEmployeeResponse(
  person: PersonWithEmployee,
  admin: Pick<AdminUser, "role">,
): EmployeeResponse {
  const employee = person.employee!;
  // Contact details are hidden from Viewer - read-only access doesn't need
  // to extend to personal phone/address, unlike Database Admin who may need
  // it for day-to-day unit management.
  const canViewContact = admin.role !== AdminRole.VIEWER;

  return {
    id: employee.id,
    person_id: person.id,
    unit_id: employee.unit_id,

    identity: {
      full_name: person.full_name,
      nick_name: person.nick_name,
      email: person.email,
      ...(canViewContact && {
        mobile_phone: employee.mobile_phone,
        residential_address: employee.residential_address,
      }),
    },

    employment: {
      employee_id: employee.employee_id,
      unit: employee.unit.name,
      job_position: employee.job_position.name,
      job_level: employee.job_level.name,
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
      education_level: employee.education_level,
      institution_name: employee.institution_name,
      major: employee.major,
      graduation_year: employee.graduation_year,
    },
  };
};

// Flat row for CSV/Excel export. Built from whichever DTO the caller already
// resolved (toEmployeeResponse vs toEmployeeDetailResponse) so the
// SUPER_ADMIN-only sensitive gate stays in one place (ExportService).
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

// Raw-field snapshot for audit old_values/new_values. Deliberately not
// toEmployeeResponse: that DTO resolves unit/job_position/job_level to
// display names for the API, but audit trails should keep the underlying
// IDs so a diff stays meaningful even if a name changes later.
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
    nik: employee.nik,
    npwp: employee.npwp,
    bank_account_number: employee.bank_account_number,
    bpjs_number: employee.bpjs_number,
    bpjs_employment_number: employee.bpjs_employment_number,
    kpj_number: employee.kpj_number,
    education_level: employee.education_level,
    institution_name: employee.institution_name,
    major: employee.major,
    graduation_year: employee.graduation_year,
  };
}
