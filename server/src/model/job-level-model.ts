import type { MasterJobLevel } from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export const JOB_LEVEL_SORT_FIELDS = ["name", "created_at"] as const;
export type JobLevelSortField = (typeof JOB_LEVEL_SORT_FIELDS)[number];

export type CreateJobLevelRequest = {
  name: string;
  is_teaching_role?: boolean;
};

export type UpdateJobLevelRequest = {
  id: string;
  name?: string;
  is_teaching_role?: boolean;
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

export type JobLevelResponse = {
  id: string;
  name: string;
  is_teaching_role: boolean;
  created_at: string;
  updated_at: string;
};

export function toJobLevelResponse(
  jobLevel: MasterJobLevel,
): JobLevelResponse {
  return {
    id: jobLevel.id,
    name: jobLevel.name,
    is_teaching_role: jobLevel.is_teaching_role,
    created_at: jobLevel.created_at.toISOString(),
    updated_at: jobLevel.updated_at.toISOString(),
  };
}

export function toJobLevelAuditSnapshot(
  jobLevel: MasterJobLevel,
): AuditValue {
  return {
    name: jobLevel.name,
    is_teaching_role: jobLevel.is_teaching_role,
  };
}
