import {
  AdminRole,
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
import {
  isBirthDateNotFuture,
  isBirthDateNotTooOld,
} from "../validation/validation";

// birth_date is optional for interns (HR doesn't require it on file) -
// no warning when it was never entered in the first place.
export function hasBirthDateWarning(birthDate: Date | null): boolean {
  if (!birthDate) return false;
  const iso = birthDate.toISOString();
  return !isBirthDateNotFuture(iso) || !isBirthDateNotTooOld(iso);
}

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
  // Not collected for interns the way it is for Student/Employee - HR
  // doesn't require these on file.
  birth_place?: string;
  birth_date?: string;

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
  unit_id: string;

  identity: {
    full_name: string;
    nick_name: string;
    email: string;
    mobile_phone?: string | null;
    residential_address?: string | null;
    // Never the raw birth_date here - it's sensitive (only in
    // InternDetailResponse) and this DTO is also what a restricted role's
    // single-record GET falls back to, not just the list. Just a signal
    // that InternsTable.jsx's "Dates" badge (getInternFlagBadges) can
    // render without exposing the actual date.
    has_birth_date_warning: boolean;
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
    birth_place: string | null;
    birth_date: string | null;
    education_level: EducationLevel | null;
    institution_name: string | null;
    major: string | null;
    graduation_year: number | null;
  };
};

export type InternWithRelations = Intern & {
  unit: MasterUnit;
  job_position: MasterJobPosition;
  building: MasterBuilding;
};

export function toInternResponse(
  intern: InternWithRelations,
  admin: Pick<AdminUser, "role">,
): InternResponse {
  // Same posture as Employee - Viewer doesn't need personal contact details.
  const canViewContact = admin.role !== AdminRole.VIEWER;

  return {
    id: intern.id,
    unit_id: intern.unit_id,

    identity: {
      full_name: intern.full_name,
      nick_name: intern.nick_name,
      email: intern.email,
      has_birth_date_warning: hasBirthDateWarning(intern.birth_date),
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
  intern: InternWithRelations,
  admin: Pick<AdminUser, "role">,
): InternDetailResponse => {
  const baseResponse = toInternResponse(intern, admin);

  return {
    ...baseResponse,
    identity: {
      ...baseResponse.identity,
      gender: intern.gender,
      religion: intern.religion,
      religion_other: intern.religion_other,
      birth_place: intern.birth_place,
      birth_date: intern.birth_date ? intern.birth_date.toISOString() : null,
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
export function toInternAuditSnapshot(intern: Intern): AuditValue {
  return {
    full_name: intern.full_name,
    nick_name: intern.nick_name,
    email: intern.email,
    gender: intern.gender,
    religion: intern.religion,
    religion_other: intern.religion_other,
    birth_place: intern.birth_place,
    birth_date: intern.birth_date ? intern.birth_date.toISOString() : null,
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
