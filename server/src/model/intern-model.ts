import {
  AdminRole,
  type Person,
  type Intern,
  type MasterUnit,
  type MasterJobPosition,
  type MasterBuilding,
  type Gender,
  type Religion,
  type InternStatus,
  type EducationLevel,
  type AdminUser,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export const INTERN_SORT_FIELDS = [
  "created_at",
  "full_name",
  "nick_name",
  "email",
  "status",
  "join_date",
  "end_date",
] as const;

export type InternSortField = (typeof INTERN_SORT_FIELDS)[number];

export type CreateInternRequest = {
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

  status?: InternStatus;
  unit_id: string;
  job_position_id: string;
  building_id: string;
  join_date: string;
  end_date: string;
  notes?: string;

  mobile_phone?: string;
  residential_address?: string;

  // Highest/current education - usually still studying, not yet graduated.
  education_level?: EducationLevel;
  institution_name?: string;
  major?: string;
  graduation_year?: number;
};

export type UpdateInternRequest = {
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

  status?: InternStatus;
  unit_id?: string;
  job_position_id?: string;
  building_id?: string;
  join_date?: string;
  end_date?: string;
  notes?: string;

  mobile_phone?: string;
  residential_address?: string;

  education_level?: EducationLevel;
  institution_name?: string;
  major?: string;
  graduation_year?: number;
};

export type GetInternRequest = {
  id: string;
};

export type RemoveInternRequest = {
  id: string;
};

export type RestoreInternRequest = {
  id: string;
};

export type SearchInternRequest = {
  page: number;
  size: number;
  search?: string;

  status?: InternStatus;
  unit_id?: string;
  job_position_id?: string;
  building_id?: string;
  gender?: Gender;
  religion?: Religion;
  join_date_start?: string;
  join_date_end?: string;

  is_deleted?: boolean;
  sort_by?: InternSortField;
  sort_order?: "asc" | "desc";
};

export type InternResponse = {
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
    unit: string;
    job_position: string;
    building: string;
    join_date: string;
    end_date: string;
  };

  status: InternStatus;
  notes: string | null;

  created_at: string;
};

export type InternDetailResponse = Omit<InternResponse, "identity"> & {
  identity: InternResponse["identity"] & {
    gender: Gender;
    religion: Religion;
    religion_other: string | null;
    birth_place: string;
    birth_date: string;
    photo_url: string | null;
    education_level: EducationLevel | null;
    institution_name: string | null;
    major: string | null;
    graduation_year: number | null;
  };
};

export type PersonWithIntern = Person & {
  intern:
    | (Intern & {
        unit: MasterUnit;
        job_position: MasterJobPosition;
        building: MasterBuilding;
      })
    | null;
};

export function toInternResponse(
  person: PersonWithIntern,
  admin: Pick<AdminUser, "role">,
): InternResponse {
  const intern = person.intern!;
  // Same posture as Employee - Viewer doesn't need personal contact details.
  const canViewContact = admin.role !== AdminRole.VIEWER;

  return {
    id: intern.id,
    person_id: person.id,
    unit_id: intern.unit_id,

    identity: {
      full_name: person.full_name,
      nick_name: person.nick_name,
      email: person.email,
      ...(canViewContact && {
        mobile_phone: intern.mobile_phone,
        residential_address: intern.residential_address,
      }),
    },

    employment: {
      unit: intern.unit.name,
      job_position: intern.job_position.name,
      building: intern.building.name,
      join_date: intern.join_date.toISOString(),
      end_date: intern.end_date.toISOString(),
    },

    status: intern.status,
    notes: intern.notes,

    created_at: intern.created_at.toISOString(),
  };
}

export const toInternDetailResponse = (
  person: PersonWithIntern,
  admin: Pick<AdminUser, "role">,
): InternDetailResponse => {
  const baseResponse = toInternResponse(person, admin);
  const intern = person.intern!;

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
      education_level: intern.education_level,
      institution_name: intern.institution_name,
      major: intern.major,
      graduation_year: intern.graduation_year,
    },
  };
};

// Raw-field snapshot for audit old_values/new_values - keeps underlying IDs
// rather than resolved display names, same reasoning as
// toEmployeeAuditSnapshot.
export function toInternAuditSnapshot(
  person: Person,
  intern: Intern,
): AuditValue {
  return {
    full_name: person.full_name,
    nick_name: person.nick_name,
    email: person.email,
    status: intern.status,
    unit_id: intern.unit_id,
    job_position_id: intern.job_position_id,
    building_id: intern.building_id,
    join_date: intern.join_date.toISOString(),
    end_date: intern.end_date.toISOString(),
    notes: intern.notes,
    mobile_phone: intern.mobile_phone,
    residential_address: intern.residential_address,
    education_level: intern.education_level,
    institution_name: intern.institution_name,
    major: intern.major,
    graduation_year: intern.graduation_year,
  };
}
