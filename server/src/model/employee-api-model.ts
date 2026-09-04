import type {
  EmployeeStatus,
  EmploymentType,
} from "../generated/prisma/client";
import type { PersonWithEmployee } from "./employee-model";

export type EmployeeLookupRequest = {
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
  unit_id: string;
  job_position: string;
  job_level: string;
  // Central's own authoritative "is this a teaching job level" flag - the
  // same field class-service.ts/pc-activity-service.ts/
  // student-support-assignment-service.ts already gate teacher/mentor
  // eligibility on. Consuming apps (e.g. MTSS) should use this instead of
  // re-guessing from job_position/job_level text.
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
    employee_id: employee.employee_id,
    full_name: person.full_name,
    nick_name: person.nick_name,
    email: person.email,
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
