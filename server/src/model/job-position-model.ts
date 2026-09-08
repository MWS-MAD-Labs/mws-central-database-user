import type { MasterJobPosition, MasterUnit } from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export const JOB_POSITION_SORT_FIELDS = ["name", "created_at"] as const;
export type JobPositionSortField = (typeof JOB_POSITION_SORT_FIELDS)[number];

export type CreateJobPositionRequest = {
  name: string;
  is_teaching_position?: boolean;
  unit_id?: string | null;
};

export type UpdateJobPositionRequest = {
  id: string;
  name?: string;
  is_teaching_position?: boolean;
  unit_id?: string | null;
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

export type JobPositionResponse = {
  id: string;
  name: string;
  is_teaching_position: boolean;
  unit_id: string | null;
  unit_name: string | null;
  created_at: string;
  updated_at: string;
};

export function toJobPositionResponse(
  jobPosition: MasterJobPosition & { unit: MasterUnit | null },
): JobPositionResponse {
  return {
    id: jobPosition.id,
    name: jobPosition.name,
    is_teaching_position: jobPosition.is_teaching_position,
    unit_id: jobPosition.unit_id,
    unit_name: jobPosition.unit?.name ?? null,
    created_at: jobPosition.created_at.toISOString(),
    updated_at: jobPosition.updated_at.toISOString(),
  };
}

export function toJobPositionAuditSnapshot(
  jobPosition: MasterJobPosition,
): AuditValue {
  return {
    name: jobPosition.name,
    is_teaching_position: jobPosition.is_teaching_position,
    unit_id: jobPosition.unit_id,
  };
}
