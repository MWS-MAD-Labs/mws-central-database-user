import type { Gender, Intern, InternStatus, MasterBuilding, MasterJobPosition, MasterUnit, Person } from "../generated/prisma/client";

export type InternLookupRequest = {
  // Intern.id.
  id?: string;
  // Person.id, the id space the Hub session and the entitlements use.
  person_id?: string;
  email?: string;
};

export type InternListRequest = {
  page: number;
  size: number;
  status?: InternStatus;
  unit_id?: string;
  job_position_id?: string;
  q?: string;
};

export type InternPerson = Person & {
  intern:
    | (Intern & { unit: MasterUnit; job_position: MasterJobPosition; building: MasterBuilding })
    | null;
};

// An intern has a unit and a job position. There is no employee ID, job level or employment type.
export type InternLookupResponse = {
  id: string;
  person_id: string;
  full_name: string;
  nick_name: string;
  email: string;
  gender: Gender;
  photo_url: string | null;
  unit: string;
  unit_id: string;
  job_position: string;
  job_position_id: string;
  building: string;
  status: InternStatus;
  join_date: string;
  end_date: string;
};

export function toInternLookupResponse(person: InternPerson): InternLookupResponse {
  const intern = person.intern!;
  return {
    id: intern.id,
    person_id: person.id,
    full_name: person.full_name,
    nick_name: person.nick_name,
    email: person.email,
    gender: person.gender,
    photo_url: person.photo_url,
    unit: intern.unit.name,
    unit_id: intern.unit_id,
    job_position: intern.job_position.name,
    job_position_id: intern.job_position_id,
    building: intern.building.name,
    status: intern.status,
    // Cache hits may return dates as ISO strings.
    join_date: new Date(intern.join_date).toISOString().slice(0, 10),
    end_date: new Date(intern.end_date).toISOString().slice(0, 10),
  };
}
