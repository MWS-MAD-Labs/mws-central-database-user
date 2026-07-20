import type {
  Person,
  Employee,
  MasterUnit,
  MasterJobPosition,
  MasterJobLevel,
  Gender,
  Religion,
  EmploymentType,
  EmployeeStatus,
  MaritalStatus,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export const EMPLOYEE_SORT_FIELDS = [
  "created_at",
  "full_name",
  "nick_name",
  "email",
  "employee_id",
  "status",
  "join_date",
  "building",
] as const;

export type EmployeeSortField = (typeof EMPLOYEE_SORT_FIELDS)[number];

export type CreateEmployeeRequest = {
  full_name: string;
  nick_name: string;
  email: string;
  gender: Gender;
  religion: Religion;
  birth_place: string;
  birth_date: string;
  photo_url?: string;

  employee_id: string;
  status: EmployeeStatus;
  employment_type: EmploymentType;
  unit_id: string;
  job_position_id: string;
  job_level_id: string;
  building: string;
  join_date: string;
  resignation_date?: string;
  last_working_date?: string;
  notes?: string;

  marital_status: MaritalStatus;
  mobile_phone?: string;
  residential_address?: string;
  nik?: string;
  npwp?: string;
  bank_account_number?: string;
  bpjs_number?: string;
};

export type UpdateEmployeeRequest = {
  id: string;

  full_name?: string;
  nick_name?: string;
  email?: string;
  gender?: Gender;
  religion?: Religion;
  birth_place?: string;
  birth_date?: string;
  photo_url?: string;

  employee_id?: string;
  employment_type?: EmploymentType;
  status?: EmployeeStatus;
  unit_id?: string;
  job_position_id?: string;
  job_level_id?: string;
  building?: string;
  join_date?: string;
  resignation_date?: string;
  last_working_date?: string;
  notes?: string;

  marital_status?: MaritalStatus;
  mobile_phone?: string;
  residential_address?: string;
  nik?: string;
  npwp?: string;
  bank_account_number?: string;
  bpjs_number?: string;
};

export type GetEmployeeRequest = {
  id: string;
};

export type RemoveEmployeeRequest = {
  id: string;
};

export type RestoreEmployeeRequest = {
  id: string;
};

export type SearchEmployeeRequest = {
  page: number;
  size: number;
  search?: string;

  status?: EmployeeStatus;
  unit_id?: string;
  job_position_id?: string;
  job_level_id?: string;
  building?: string;
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

  identity: {
    full_name: string;
    nick_name: string;
    email: string;
    mobile_phone: string | null;
    residential_address: string | null;
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
  };

  offboarding: {
    resignation_date: string | null;
    last_working_date: string | null;
    notes: string | null;
  };

  created_at: string;
};

export type EmployeeDetailResponse = Omit<EmployeeResponse, "identity"> & {
  identity: EmployeeResponse["identity"] & {
    gender: Gender;
    religion: Religion;
    birth_place: string;
    birth_date: string;
    marital_status: MaritalStatus;
    nik: string | null;
    npwp: string | null;
    bank_account_number: string | null;
    bpjs_number: string | null;
  };
};

export type PersonWithEmployee = Person & {
  employee:
    | (Employee & {
        unit: MasterUnit;
        job_position: MasterJobPosition;
        job_level: MasterJobLevel;
      })
    | null;
};

export function toEmployeeResponse(
  person: PersonWithEmployee,
): EmployeeResponse {
  const employee = person.employee!;

  return {
    id: employee.id,
    person_id: person.id,

    identity: {
      full_name: person.full_name,
      nick_name: person.nick_name,
      email: person.email,
      mobile_phone: employee.mobile_phone,
      residential_address: employee.residential_address,
    },

    employment: {
      employee_id: employee.employee_id,
      unit: employee.unit.name,
      job_position: employee.job_position.name,
      job_level: employee.job_level.name,
      building: employee.building,
      join_date: employee.join_date.toISOString(),
    },

    status_info: {
      status: employee.status,
      employment_type: employee.employment_type,
    },

    offboarding: {
      resignation_date: employee.resignation_date
        ? employee.resignation_date.toISOString()
        : null,
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
): EmployeeDetailResponse => {
  const baseResponse = toEmployeeResponse(person);
  const employee = person.employee!;

  return {
    ...baseResponse,
    identity: {
      ...baseResponse.identity,
      gender: person.gender,
      religion: person.religion,
      birth_place: person.birth_place,
      birth_date: person.birth_date.toISOString(),
      marital_status: employee.marital_status,
      nik: employee.nik,
      npwp: employee.npwp,
      bank_account_number: employee.bank_account_number,
      bpjs_number: employee.bpjs_number,
    },
  };
};

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
    building: employee.building,
    join_date: employee.join_date.toISOString(),
    resignation_date: employee.resignation_date
      ? employee.resignation_date.toISOString()
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
  };
}
