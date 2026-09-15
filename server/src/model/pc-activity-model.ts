import type {
  MasterPCActivity,
  MasterPCActivityUnit,
  MasterUnit,
  PassionConnectionActivity,
  PCDay,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export const PC_ACTIVITY_MASTER_SORT_FIELDS = ["name", "created_at"] as const;
export type PCActivityMasterSortField =
  (typeof PC_ACTIVITY_MASTER_SORT_FIELDS)[number];

// Master Data > PC Activities - the activity itself (e.g. "Chess Club"),
// distinct from PassionConnectionActivity (a student's assignment to one)
// and PCActivityDefaultMentor (a unit's default mentor for one). Mirrors
// JobPositionResponse/CreateJobPositionRequest/etc exactly - same
// "empty unit_ids = available to every unit" convention.
export type CreatePCActivityMasterRequest = {
  name: string;
  unit_ids?: string[];
};

export type UpdatePCActivityMasterRequest = {
  id: string;
  name?: string;
  unit_ids?: string[];
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

export type PreviewPCActivityReassignmentRequest = {
  id: string;
  unit_ids: string[];
  page: number;
  size: number;
};

// One row per student who'd end up outside the proposed unit_ids - shown
// before the admin commits a unit-scope narrowing, mirrors
// JobPositionReassignmentPreviewItem.
export type PCActivityReassignmentPreviewItem = {
  student_id: string;
  full_name: string;
  unit_name: string;
  day: PCDay;
};

export type PCActivityMasterResponse = {
  id: string;
  name: string;
  units: { id: string; name: string }[];
  created_at: string;
  updated_at: string;
};

type PCActivityMasterWithUnits = MasterPCActivity & {
  units: (MasterPCActivityUnit & { unit: MasterUnit })[];
};

export function toPCActivityMasterResponse(
  activity: PCActivityMasterWithUnits,
): PCActivityMasterResponse {
  return {
    id: activity.id,
    name: activity.name,
    units: activity.units.map((u) => ({ id: u.unit.id, name: u.unit.name })),
    created_at: activity.created_at.toISOString(),
    updated_at: activity.updated_at.toISOString(),
  };
}

export function toPCActivityMasterAuditSnapshot(activity: {
  name: string;
  unit_ids: string[];
}): AuditValue {
  return {
    name: activity.name,
    unit_ids: activity.unit_ids,
  };
}

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
  studentFullName?: string,
): AuditValue {
  return {
    student_id: record.student_id,
    // "full_name" (not "student_full_name") deliberately - matches the key
    // deriveEntityLabel() (audit-log-controller.ts) already looks for on
    // every audit snapshot, so the Entity column shows the student's name
    // instead of just "PassionConnectionActivity".
    full_name: studentFullName ?? null,
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
  // The mentor's own home unit - usually equal to unit_name above, but not
  // always: a mentor can be assigned to a different unit's activity (e.g. a
  // Kindergarten teacher set as the mentor for a Junior High activity).
  // Lets the frontend tell a DB Admin whose mentor picker is scoped to
  // their own unit's staff that the current mentor is a cross-unit
  // assignment, rather than showing a blank dropdown for a value that just
  // isn't in their scoped options list.
  mentor_unit_name: string;
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
  mentor: { person: { full_name: string }; unit: { name: string } };
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
    mentor_unit_name: record.mentor.unit.name,
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
