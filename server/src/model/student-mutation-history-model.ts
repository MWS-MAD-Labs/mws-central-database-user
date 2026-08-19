import type {
  StudentMutationField,
  StudentMutationHistory,
  Grade,
  AcademicYear,
} from "../generated/prisma/client";

export type GetStudentMutationHistoryRequest = {
  student_id: string;
};

export type RollbackStudentMutationRequest = {
  student_id: string;
  history_id: string;
};

export type StudentMutationHistoryResponse = {
  id: string;
  field: StudentMutationField;
  // Display name for join_grade/join_academic_year, or the raw
  // StudentEntryType string for ENTRY_TYPE rows - always the one thing
  // that actually changed on this row.
  value: string;
  start_date: string;
  end_date: string | null;
  // Only true on the currently-active row (end_date: null) for its field,
  // and only when there's something to roll back to - the baseline row
  // seeded at create() has no previous_history_id.
  can_rollback: boolean;
  created_at: string;
};

export type StudentMutationHistoryWithRelations = StudentMutationHistory & {
  join_grade: Grade | null;
  join_academic_year: AcademicYear | null;
};

export function toStudentMutationHistoryResponse(
  row: StudentMutationHistoryWithRelations,
): StudentMutationHistoryResponse {
  const value =
    row.join_grade?.name ??
    row.join_academic_year?.name ??
    row.entry_type ??
    "";

  return {
    id: row.id,
    field: row.field,
    value,
    start_date: row.start_date.toISOString(),
    end_date: row.end_date ? row.end_date.toISOString() : null,
    can_rollback: row.end_date === null && row.previous_history_id !== null,
    created_at: row.created_at.toISOString(),
  };
}
