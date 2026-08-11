import type { Grade, MasterUnit } from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export const GRADE_SORT_FIELDS = ["name", "level", "created_at"] as const;
export type GradeSortField = (typeof GRADE_SORT_FIELDS)[number];

export type CreateGradeRequest = {
  name: string;
  level: number;
  unit_id?: string | null;
};

export type UpdateGradeRequest = {
  id: string;
  name?: string;
  level?: number;
  unit_id?: string | null;
};

export type GetGradeRequest = {
  id: string;
};

export type DeleteGradeRequest = {
  id: string;
};

export type SearchGradeRequest = {
  page: number;
  size: number;
  search?: string;
  sort_by?: GradeSortField;
  sort_order?: "asc" | "desc";
};

export type GradeResponse = {
  id: string;
  name: string;
  level: number;
  unit_id: string | null;
  unit_name: string | null;
  created_at: string;
};

export function toGradeResponse(
  grade: Grade & { unit: MasterUnit | null },
): GradeResponse {
  return {
    id: grade.id,
    name: grade.name,
    level: grade.level,
    unit_id: grade.unit_id,
    unit_name: grade.unit?.name ?? null,
    created_at: grade.created_at.toISOString(),
  };
}

export function toGradeAuditSnapshot(grade: Grade): AuditValue {
  return {
    name: grade.name,
    level: grade.level,
    unit_id: grade.unit_id,
  };
}
