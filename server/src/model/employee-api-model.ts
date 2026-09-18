import type {
  EmployeeStatus,
  EmploymentType,
  Gender,
} from "../generated/prisma/client";
import type { PersonWithEmployee } from "./employee-model";

export type EmployeeLookupRequest = {
  id?: string;
  employee_id?: string;
  email?: string;
};

export type EmployeeListRequest = {
  page: number;
  size: number;
  status?: EmployeeStatus;
  unit_id?: string;
  job_position_id?: string;
};

// Minimal employee profile for external consumers.
export type EmployeeLookupResponse = {
  id: string;
  // Person.id - the one id space shared with the student side, stable
  // across a role change (e.g. student -> employee) in a way Employee.id
  // itself never needs to be, since it's a different table's row entirely.
  // Callers minting a portable identity elsewhere (e.g. mws-hub's SSO relay
  // token `sub`) should prefer this over `id` for that reason.
  person_id: string;
  employee_id: string;
  full_name: string;
  nick_name: string;
  birth_date: string;
  email: string;
  gender: Gender;
  photo_url: string | null;
  unit: string;
  unit_id: string;
  job_position: string;
  job_level: string;
  // Authoritative teacher and mentor eligibility flag.
  is_teaching_role: boolean;
  status: EmployeeStatus;
  employment_type: EmploymentType;
};

export function toEmployeeLookupResponse(
  person: PersonWithEmployee,
): EmployeeLookupResponse {
  const employee = person.employee!;

  return {
    id: employee.id,
    person_id: person.id,
    employee_id: employee.employee_id,
    full_name: person.full_name,
    nick_name: person.nick_name,
    // Cache hits may return dates as ISO strings.
    birth_date: new Date(person.birth_date).toISOString().slice(0, 10),
    email: person.email,
    gender: person.gender,
    photo_url: person.photo_url,
    unit: employee.unit.name,
    unit_id: employee.unit_id,
    job_position: employee.job_position.name,
    job_level: employee.job_level.name,
    is_teaching_role: employee.job_level.is_teaching_role,
    status: employee.status,
    employment_type: employee.employment_type,
  };
}
