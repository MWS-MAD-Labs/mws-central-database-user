import type {
  StudentMutationField,
  StudentMutationHistory,
  Grade,
  AcademicYear,
  Class,
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
  // Display value for the field changed by this row.
  value: string;
  start_date: string;
  end_date: string | null;
  // Rollback requires the active row to have a predecessor.
  // Always false for CURRENT_CLASS - rolling it back would need to touch
  // the enrollment table too, which this table doesn't own.
  can_rollback: boolean;
  created_at: string;
};

export type StudentMutationHistoryWithRelations = StudentMutationHistory & {
  join_grade: Grade | null;
  join_academic_year: AcademicYear | null;
  class: Class | null;
  current_grade: Grade | null;
};

export function toStudentMutationHistoryResponse(
  row: StudentMutationHistoryWithRelations,
): StudentMutationHistoryResponse {
  const value =
    row.join_grade?.name ??
    row.join_academic_year?.name ??
    row.class?.name ??
    row.current_grade?.name ??
    row.entry_type ??
    "";

  return {
    id: row.id,
    field: row.field,
    value,
    start_date: row.start_date.toISOString(),
    end_date: row.end_date ? row.end_date.toISOString() : null,
    can_rollback:
      row.field !== "CURRENT_CLASS" &&
      row.end_date === null &&
      row.previous_history_id !== null,
    created_at: row.created_at.toISOString(),
  };
}
