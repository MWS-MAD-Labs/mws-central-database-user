import type {
  MasterPCActivity,
  PassionConnectionActivity,
  PCDay,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export type CreatePCActivityRequest = {
  student_id: string;
  day: PCDay;
  activity_id: string;
  mentor_id?: string;
  academic_year_id?: string;
};

export type UpdatePCActivityRequest = {
  id: string;
  student_id: string;
  activity_id?: string;
  mentor_id?: string | null;
};

export type DeletePCActivityRequest = {
  id: string;
  student_id: string;
};

export type RestorePCActivityRequest = {
  id: string;
  student_id: string;
};

export type GetPCActivityListRequest = {
  student_id: string;
  is_deleted?: boolean;
};

export type PCActivityResponse = {
  id: string;
  student_id: string;
  day: PCDay;
  activity_id: string;
  activity: string;
  mentor_id: string | null;
  academic_year_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export function toPCActivityResponse(
  record: PassionConnectionActivity & { activity: MasterPCActivity },
): PCActivityResponse {
  return {
    id: record.id,
    student_id: record.student_id,
    day: record.day,
    activity_id: record.activity_id,
    activity: record.activity.name,
    mentor_id: record.mentor_id,
    academic_year_id: record.academic_year_id,
    created_at: record.created_at.toISOString(),
    updated_at: record.updated_at.toISOString(),
    deleted_at: record.deleted_at ? record.deleted_at.toISOString() : null,
  };
}

export type PCActivityExportRow = {
  student_nis: string;
  student_full_name: string;
  day: PCDay;
  activity: string;
  academic_year_id: string;
};

export function toPCActivityExportRow(
  response: PCActivityResponse,
  student: { nis: string | null; full_name: string },
): PCActivityExportRow {
  return {
    student_nis: student.nis ?? "",
    student_full_name: student.full_name,
    day: response.day,
    activity: response.activity,
    academic_year_id: response.academic_year_id,
  };
}

export function toPCActivityAuditSnapshot(
  record: PassionConnectionActivity,
): AuditValue {
  return {
    student_id: record.student_id,
    day: record.day,
    // id-stable, not the resolved name - stays correct even if the
    // master-data row's name is renamed later.
    activity_id: record.activity_id,
    mentor_id: record.mentor_id,
    academic_year_id: record.academic_year_id,
    deleted_at: record.deleted_at ? record.deleted_at.toISOString() : null,
  };
}

// Master-data catalog (Master Data > PC Activities) - the reusable activity
// names themselves, distinct from a per-student PassionConnectionActivity
// assignment above. default_mentor_id pre-fills a new assignment's
// mentor_id (see PCActivityService.create) but is always overridable there.
export type MasterPCActivityEntity = {
  id: string;
  name: string;
  default_mentor_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export type CreateMasterPCActivityRequest = {
  name: string;
  default_mentor_id?: string;
};

export type UpdateMasterPCActivityRequest = {
  id: string;
  name?: string;
  default_mentor_id?: string | null;
};

export type GetMasterPCActivityRequest = {
  id: string;
};

export type DeleteMasterPCActivityRequest = {
  id: string;
};

export const MASTER_PC_ACTIVITY_SORT_FIELDS = ["name", "created_at"] as const;
export type MasterPCActivitySortField =
  (typeof MASTER_PC_ACTIVITY_SORT_FIELDS)[number];

export type SearchMasterPCActivityRequest = {
  page: number;
  size: number;
  search?: string;
  sort_by?: MasterPCActivitySortField;
  sort_order?: "asc" | "desc";
};

export type MasterPCActivityResponse = {
  id: string;
  name: string;
  default_mentor_id: string | null;
  created_at: string;
  updated_at: string;
};

export function toMasterPCActivityResponse(
  entity: MasterPCActivityEntity,
): MasterPCActivityResponse {
  return {
    id: entity.id,
    name: entity.name,
    default_mentor_id: entity.default_mentor_id,
    created_at: entity.created_at.toISOString(),
    updated_at: entity.updated_at.toISOString(),
  };
}

export function toMasterPCActivityAuditSnapshot(
  entity: MasterPCActivityEntity,
): AuditValue {
  return {
    name: entity.name,
    default_mentor_id: entity.default_mentor_id,
  };
}
