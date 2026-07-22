import type {
  PassionConnectionActivity,
  PCDay,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export type CreatePCActivityRequest = {
  student_id: string;
  day: PCDay;
  activity: string;
  mentor_id?: string;
  academic_year_id?: string;
};

export type UpdatePCActivityRequest = {
  id: string;
  student_id: string;
  activity?: string;
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
  activity: string;
  mentor_id: string | null;
  academic_year_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export function toPCActivityResponse(
  record: PassionConnectionActivity,
): PCActivityResponse {
  return {
    id: record.id,
    student_id: record.student_id,
    day: record.day,
    activity: record.activity,
    mentor_id: record.mentor_id,
    academic_year_id: record.academic_year_id,
    created_at: record.created_at.toISOString(),
    updated_at: record.updated_at.toISOString(),
    deleted_at: record.deleted_at ? record.deleted_at.toISOString() : null,
  };
}

export function toPCActivityAuditSnapshot(
  record: PassionConnectionActivity,
): AuditValue {
  return {
    student_id: record.student_id,
    day: record.day,
    activity: record.activity,
    mentor_id: record.mentor_id,
    academic_year_id: record.academic_year_id,
    deleted_at: record.deleted_at ? record.deleted_at.toISOString() : null,
  };
}
