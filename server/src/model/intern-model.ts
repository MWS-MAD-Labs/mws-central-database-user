import {
  AdminRole,
  type Intern,
  type InternPcMentorUnit,
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
import type { BulkActionResponse, BulkIdsRequest } from "./bulk-action-model";
import {
  isBirthDateNotFuture,
  isBirthDateNotTooOld,
} from "../validation/validation";

// Missing optional birth dates do not produce warnings.
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
  // These identity fields are optional for interns.
  birth_place?: string;
  birth_date?: string;

  status?: InternStatus;
  unit_id: string;
  job_position_id: string;
  building_id: string;
  join_date: string;
  end_date: string;
  notes?: string;
  is_pc_mentor_eligible?: boolean;
  pc_mentor_unit_ids?: string[];

  mobile_phone?: string;
  residential_address?: string;

  // Highest or current education.
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
  is_pc_mentor_eligible?: boolean;
  pc_mentor_unit_ids?: string[];

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

export type BulkInternRequest = BulkIdsRequest;
export type BulkInternResponse = BulkActionResponse<InternResponse | boolean>;

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

export type GetInternVersionRequest = Omit<
  SearchInternRequest,
  "page" | "size" | "sort_by" | "sort_order"
>;

export type InternResponse = {
  id: string;
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
    unit_id: string;
    unit: string;
    job_position: string;
    is_teaching_position: boolean;
    // Independent of is_teaching_position - PC Activity room mentor eligibility.
    is_pc_mentor_eligible: boolean;
    // Empty means "their own unit only" - see InternPcMentorUnit.
    pc_mentor_units: { id: string; name: string }[];
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

// Identity fields left out of GET /interns/:id; released only by the audited reveal.
export const INTERN_REVEALED_IDENTITY_FIELDS = [
  "gender",
  "religion",
  "religion_other",
  "birth_place",
  "birth_date",
] as const;

export type InternRevealedIdentity = Pick<
  InternDetailResponse["identity"],
  (typeof INTERN_REVEALED_IDENTITY_FIELDS)[number]
>;

export type RedactedInternDetailResponse = Omit<InternDetailResponse, "identity"> & {
  identity: Omit<
    InternDetailResponse["identity"],
    (typeof INTERN_REVEALED_IDENTITY_FIELDS)[number]
  > & {
    // Tells the UI this viewer may ask for the hidden fields.
    can_view_pii: true;
  };
};

export function splitInternDetailIdentity(detail: InternDetailResponse): {
  redacted: RedactedInternDetailResponse;
  revealed: InternRevealedIdentity;
} {
  const revealed = {} as Record<string, unknown>;
  const identity = { ...detail.identity } as Record<string, unknown>;
  for (const field of INTERN_REVEALED_IDENTITY_FIELDS) {
    revealed[field] = identity[field];
    delete identity[field];
  }
  return {
    redacted: {
      ...detail,
      identity: { ...identity, can_view_pii: true },
    } as RedactedInternDetailResponse,
    revealed: revealed as InternRevealedIdentity,
  };
}

export type InternWithRelations = Intern & {
  unit: MasterUnit;
  job_position: MasterJobPosition;
  building: MasterBuilding;
  // Optional - only populated by queries that opt into this include.
  pc_mentor_units?: (InternPcMentorUnit & { unit: MasterUnit })[];
};

export function toInternResponse(
  intern: InternWithRelations,
  admin: Pick<AdminUser, "role" | "can_view_employee_pii">,
): InternResponse {
  const canViewContact =
    admin.role === AdminRole.SUPER_ADMIN || admin.can_view_employee_pii;

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
      unit_id: intern.unit_id,
      unit: intern.unit.name,
      job_position: intern.job_position.name,
      is_teaching_position: intern.job_position.is_teaching_position,
      is_pc_mentor_eligible: intern.is_pc_mentor_eligible,
      pc_mentor_units: (intern.pc_mentor_units ?? []).map((row) => ({
        id: row.unit_id,
        name: row.unit.name,
      })),
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
  admin: Pick<AdminUser, "role" | "can_view_employee_pii">,
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

// Keep raw IDs in audit snapshots so later renames do not change history.
export function toInternAuditSnapshot(
  intern: Intern,
  pcMentorUnitIds: string[] = [],
): AuditValue {
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
    is_pc_mentor_eligible: intern.is_pc_mentor_eligible,
    pc_mentor_unit_ids: pcMentorUnitIds,
    mobile_phone: intern.mobile_phone,
    residential_address: intern.residential_address,
    education_level: intern.education_level,
    institution_name: intern.institution_name,
    major: intern.major,
    graduation_year: intern.graduation_year,
  };
}
