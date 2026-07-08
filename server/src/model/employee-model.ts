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
} from "../generated/prisma/client";

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
  assigned_class?: string;
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
  assigned_class?: string;
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
  assigned_class?: string;

  is_deleted?: boolean;
  sort_by?: string;
  sort_order?: "asc" | "desc";
};

export type EmployeeResponse = {
  id: string;
  person_id: string;
  employee_id: string;
  full_name: string;
  nick_name: string;
  email: string;
  status: EmployeeStatus;
  employment_type: EmploymentType;
  unit: string;
  job_position: string;
  job_level: string;
  building: string;
  assigned_class: string | null;
  join_date: string;
  created_at: string;
};

export type EmployeeDetailResponse = EmployeeResponse & {
  religion: Religion;
  birth_place: string;
  birth_date: string;
};

type PersonWithEmployee = Person & {
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
    employee_id: employee.employee_id,
    full_name: person.full_name,
    nick_name: person.nick_name,
    email: person.email,
    status: employee.status,
    employment_type: employee.employment_type,

    unit: employee.unit.name,
    job_position: employee.job_position.name,
    job_level: employee.job_level.name,

    building: employee.building,
    assigned_class: employee.assigned_class,

    join_date: employee.join_date.toISOString(),
    created_at: employee.created_at.toISOString(),
  };
}

export const toEmployeeDetailResponse = (
  person: PersonWithEmployee,
): EmployeeDetailResponse => {
  return {
    ...toEmployeeResponse(person),

    religion: person.religion,
    birth_place: person.birth_place,
    birth_date: person.birth_date.toISOString(),
  };
};
