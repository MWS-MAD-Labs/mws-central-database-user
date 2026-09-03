import type { Grade, MasterUnit } from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export const GRADE_SORT_FIELDS = ["name", "level", "created_at"] as const;
export type GradeSortField = (typeof GRADE_SORT_FIELDS)[number];

// Sentinel grade the importer upserts for a GRADUATED legacy row with no
// current grade on the sheet. -9 is lower than every real grade (including
// Kindergarten Pre-K at -3), so anywhere grade "distance" gets math'd on
// (elapsed-years checks, NIS prefix derivation, current-vs-join comparisons)
// needs to know about this name and treat it as "no real reference point"
// rather than a literal lowest grade - never rely on the level value alone.
// Must match seed-master-lists.ts's GRADES entry for this name.
export const UNKNOWN_LEGACY_GRADE_NAME = "Unknown (Legacy Import)";
export const UNKNOWN_LEGACY_GRADE_LEVEL = -9;

export type CreateGradeRequest = {
  name: string;
  level: number;
  unit_id?: string | null;
  typical_age?: number | null;
};

export type UpdateGradeRequest = {
  id: string;
  name?: string;
  level?: number;
  unit_id?: string | null;
  typical_age?: number | null;
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
  typical_age: number | null;
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
    typical_age: grade.typical_age,
    created_at: grade.created_at.toISOString(),
  };
}

export function toGradeAuditSnapshot(grade: Grade): AuditValue {
  return {
    name: grade.name,
    level: grade.level,
    unit_id: grade.unit_id,
    typical_age: grade.typical_age,
  };
}
