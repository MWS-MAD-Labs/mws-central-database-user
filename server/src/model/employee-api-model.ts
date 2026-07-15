import type {
  EmployeeStatus,
  EmploymentType,
} from "../generated/prisma/client";
import type { PersonWithEmployee } from "./employee-model";

export type EmployeeLookupRequest = {
  email: string;
};

// Deliberately leaner than the admin-facing EmployeeResponse: only what a
// consuming app needs to provision an account / render a login profile.
// No gender, religion, birth date, building, offboarding, etc.
export type EmployeeLookupResponse = {
  id: string;
  employee_id: string;
  full_name: string;
  nick_name: string;
  email: string;
  photo_url: string | null;
  unit: string;
  job_position: string;
  status: EmployeeStatus;
  employment_type: EmploymentType;
};

export function toEmployeeLookupResponse(
  person: PersonWithEmployee,
): EmployeeLookupResponse {
  const employee = person.employee!;

  return {
    id: employee.id,
    employee_id: employee.employee_id,
    full_name: person.full_name,
    nick_name: person.nick_name,
    email: person.email,
    photo_url: person.photo_url,
    unit: employee.unit.name,
    job_position: employee.job_position.name,
    status: employee.status,
    employment_type: employee.employment_type,
  };
}
