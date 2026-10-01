import type {
  MasterPCActivity,
  PassionConnectionActivity,
  PcActivityAssignmentStatus,
  PcActivityRoom,
  PCDay,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export const PC_ACTIVITY_MASTER_SORT_FIELDS = ["name", "created_at"] as const;
export type PCActivityMasterSortField =
  (typeof PC_ACTIVITY_MASTER_SORT_FIELDS)[number];

export type CreatePCActivityMasterRequest = {
  name: string;
};

export type UpdatePCActivityMasterRequest = {
  id: string;
  name?: string;
};

export type GetPCActivityMasterRequest = {
  id: string;
};

export type DeletePCActivityMasterRequest = {
  id: string;
};

export type SearchPCActivityMasterRequest = {
  page: number;
  size: number;
  search?: string;
  sort_by?: PCActivityMasterSortField;
  sort_order?: "asc" | "desc";
};

export type PCActivityMasterResponse = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export function toPCActivityMasterResponse(
  activity: MasterPCActivity,
): PCActivityMasterResponse {
  return {
    id: activity.id,
    name: activity.name,
    created_at: activity.created_at.toISOString(),
    updated_at: activity.updated_at.toISOString(),
  };
}
export function toPCActivityMasterAuditSnapshot(activity: {
  name: string;
}): AuditValue {
  return {
    name: activity.name,
  };
}

export type CreatePCActivityRequest = {
  student_id: string;
  day: PCDay;
  activity_id: string;
  academic_year_id?: string;
  // Set only when created through a room's bulk-assign flow.
  room_id?: string;
  start_date?: string;
};

export type UpdatePCActivityRequest = {
  id: string;
  student_id: string;
  activity_id?: string;
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

export type PCActivityMentorSummary = {
  id: string;
  name: string;
  type: "EMPLOYEE" | "INTERN";
};

export type PCActivityResponse = {
  id: string;
  student_id: string;
  day: PCDay;
  activity_id: string;
  activity: string;
  // A room can have more than one mentor - every currently active one.
  // Empty for legacy, unscoped rows with no room to resolve mentors from.
  mentors: PCActivityMentorSummary[];
  academic_year_id: string;
  // Null for legacy rows that predate rooms - never a class anymore.
  room_id: string | null;
  room_name: string | null;
  start_date: string;
  expires_at: string | null;
  end_date: string | null;
  status: PcActivityAssignmentStatus;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export function toPCActivityResponse(
  record: PassionConnectionActivity & {
    activity: MasterPCActivity;
    room?: PcActivityRoom | null;
  },
  mentors: PCActivityMentorSummary[] = [],
): PCActivityResponse {
  return {
    id: record.id,
    student_id: record.student_id,
    day: record.day,
    activity_id: record.activity_id,
    activity: record.activity.name,
    mentors,
    academic_year_id: record.academic_year_id,
    room_id: record.room?.id ?? null,
    room_name: record.room
      ? record.room.label
        ? `${record.activity.name} - ${record.room.label}`
        : record.activity.name
      : null,
    start_date: record.start_date.toISOString(),
    expires_at: record.expires_at ? record.expires_at.toISOString() : null,
    end_date: record.end_date ? record.end_date.toISOString() : null,
    status: record.status,
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
  studentFullName?: string,
): AuditValue {
  return {
    student_id: record.student_id,
    // Audit labels resolve from full_name.
    full_name: studentFullName ?? null,
    day: record.day,
    // id-stable, not the resolved name - stays correct even if the
    // master-data row's name is renamed later.
    activity_id: record.activity_id,
    academic_year_id: record.academic_year_id,
    deleted_at: record.deleted_at ? record.deleted_at.toISOString() : null,
  };
}
