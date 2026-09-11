import type {
  MasterJobPosition,
  MasterJobPositionUnit,
  MasterUnit,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export const JOB_POSITION_SORT_FIELDS = ["name", "created_at"] as const;
export type JobPositionSortField = (typeof JOB_POSITION_SORT_FIELDS)[number];

export type CreateJobPositionRequest = {
  name: string;
  is_teaching_position?: boolean;
  unit_ids?: string[];
};

export type UpdateJobPositionRequest = {
  id: string;
  name?: string;
  is_teaching_position?: boolean;
  unit_ids?: string[];
};

export type GetJobPositionRequest = {
  id: string;
};

export type DeleteJobPositionRequest = {
  id: string;
};

export type SearchJobPositionRequest = {
  page: number;
  size: number;
  search?: string;
  sort_by?: JobPositionSortField;
  sort_order?: "asc" | "desc";
};

export type PreviewJobPositionReassignmentRequest = {
  id: string;
  unit_ids: string[];
  page: number;
  size: number;
};

// One row per employee who'd end up outside the proposed unit_ids - shown
// before the admin commits a unit-scope narrowing, so they know exactly who
// to move first instead of just a blocking count.
export type JobPositionReassignmentPreviewItem = {
  employee_id: string;
  employee_number: string;
  full_name: string;
  unit_name: string;
};

export type JobPositionResponse = {
  id: string;
  name: string;
  is_teaching_position: boolean;
  units: { id: string; name: string }[];
  created_at: string;
  updated_at: string;
};

type JobPositionWithUnits = MasterJobPosition & {
  units: (MasterJobPositionUnit & { unit: MasterUnit })[];
};

export function toJobPositionResponse(
  jobPosition: JobPositionWithUnits,
): JobPositionResponse {
  return {
    id: jobPosition.id,
    name: jobPosition.name,
    is_teaching_position: jobPosition.is_teaching_position,
    units: jobPosition.units.map((u) => ({
      id: u.unit.id,
      name: u.unit.name,
    })),
    created_at: jobPosition.created_at.toISOString(),
    updated_at: jobPosition.updated_at.toISOString(),
  };
}

export function toJobPositionAuditSnapshot(jobPosition: {
  name: string;
  is_teaching_position: boolean;
  unit_ids: string[];
}): AuditValue {
  return {
    name: jobPosition.name,
    is_teaching_position: jobPosition.is_teaching_position,
    unit_ids: jobPosition.unit_ids,
  };
}
