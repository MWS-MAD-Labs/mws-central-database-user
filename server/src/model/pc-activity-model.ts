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
  academic_year_id?: string;
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

export type PCActivityResponse = {
  id: string;
  student_id: string;
  day: PCDay;
  activity_id: string;
  activity: string;
  // Not stored on the row - resolved live from PCActivityDefaultMentor for
  // (activity_id, student's current unit). See
  // PCActivityService.resolveMentorForActivity.
  mentor_id: string | null;
  mentor_name: string | null;
  academic_year_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export function toPCActivityResponse(
  record: PassionConnectionActivity & { activity: MasterPCActivity },
  mentor: { id: string; name: string } | null = null,
): PCActivityResponse {
  return {
    id: record.id,
    student_id: record.student_id,
    day: record.day,
    activity_id: record.activity_id,
    activity: record.activity.name,
    mentor_id: mentor?.id ?? null,
    mentor_name: mentor?.name ?? null,
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
    academic_year_id: record.academic_year_id,
    deleted_at: record.deleted_at ? record.deleted_at.toISOString() : null,
  };
}

// Per-unit default mentor (Master Data > PC Activities > Manage Mentors) -
// one row per (activity, unit) that actually has a default, so the same
// activity name can suggest a different mentor per unit. Pre-fills
// PassionConnectionActivity.mentor_id when a student is assigned this
// activity and no mentor is explicitly chosen (see PCActivityService.create)
// - resolved from the student's current_grade.unit_id, always overridable.
export type PCActivityDefaultMentorResponse = {
  id: string;
  activity_id: string;
  activity_name: string;
  unit_id: string;
  unit_name: string;
  mentor_id: string;
  mentor_name: string;
  created_at: string;
  updated_at: string;
};

export function toPCActivityDefaultMentorResponse(record: {
  id: string;
  activity_id: string;
  activity: { name: string };
  unit_id: string;
  unit: { name: string };
  mentor_id: string;
  mentor: { person: { full_name: string } };
  created_at: Date;
  updated_at: Date;
}): PCActivityDefaultMentorResponse {
  return {
    id: record.id,
    activity_id: record.activity_id,
    activity_name: record.activity.name,
    unit_id: record.unit_id,
    unit_name: record.unit.name,
    mentor_id: record.mentor_id,
    mentor_name: record.mentor.person.full_name,
    created_at: record.created_at.toISOString(),
    updated_at: record.updated_at.toISOString(),
  };
}

export type ListPCActivityDefaultMentorsRequest = {
  activity_id: string;
};

export type ListPCActivityDefaultMentorsBatchRequest = {
  activity_ids: string[];
};

export type ListPCActivityDefaultMentorsForEmployeeRequest = {
  employee_id: string;
};

export type SetPCActivityDefaultMentorRequest = {
  activity_id: string;
  unit_id: string;
  mentor_id: string;
};

export type ClearPCActivityDefaultMentorRequest = {
  activity_id: string;
  unit_id: string;
};

export function toPCActivityDefaultMentorAuditSnapshot(record: {
  activity_id: string;
  unit_id: string;
  mentor_id: string;
}): AuditValue {
  return {
    activity_id: record.activity_id,
    unit_id: record.unit_id,
    mentor_id: record.mentor_id,
  };
}
