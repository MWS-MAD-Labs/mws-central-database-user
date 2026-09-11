import type {
  MasterJobLevel,
  MasterJobLevelUnit,
  MasterUnit,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export const JOB_LEVEL_SORT_FIELDS = ["name", "created_at"] as const;
export type JobLevelSortField = (typeof JOB_LEVEL_SORT_FIELDS)[number];

export type CreateJobLevelRequest = {
  name: string;
  is_teaching_role?: boolean;
  unit_ids?: string[];
};

export type UpdateJobLevelRequest = {
  id: string;
  name?: string;
  is_teaching_role?: boolean;
  unit_ids?: string[];
};

export type GetJobLevelRequest = {
  id: string;
};

export type DeleteJobLevelRequest = {
  id: string;
};

export type SearchJobLevelRequest = {
  page: number;
  size: number;
  search?: string;
  sort_by?: JobLevelSortField;
  sort_order?: "asc" | "desc";
};

export type PreviewJobLevelReassignmentRequest = {
  id: string;
  unit_ids: string[];
  page: number;
  size: number;
};

// One row per employee who'd end up outside the proposed unit_ids - shown
// before the admin commits a unit-scope narrowing, so they know exactly who
// to move first instead of just a blocking count.
export type JobLevelReassignmentPreviewItem = {
  employee_id: string;
  employee_number: string;
  full_name: string;
  unit_name: string;
};

export type JobLevelResponse = {
  id: string;
  name: string;
  is_teaching_role: boolean;
  units: { id: string; name: string }[];
  created_at: string;
  updated_at: string;
};

type JobLevelWithUnits = MasterJobLevel & {
  units: (MasterJobLevelUnit & { unit: MasterUnit })[];
};

export function toJobLevelResponse(
  jobLevel: JobLevelWithUnits,
): JobLevelResponse {
  return {
    id: jobLevel.id,
    name: jobLevel.name,
    is_teaching_role: jobLevel.is_teaching_role,
    units: jobLevel.units.map((u) => ({ id: u.unit.id, name: u.unit.name })),
    created_at: jobLevel.created_at.toISOString(),
    updated_at: jobLevel.updated_at.toISOString(),
  };
}

export function toJobLevelAuditSnapshot(jobLevel: {
  name: string;
  is_teaching_role: boolean;
  unit_ids: string[];
}): AuditValue {
  return {
    name: jobLevel.name,
    is_teaching_role: jobLevel.is_teaching_role,
    unit_ids: jobLevel.unit_ids,
  };
}
