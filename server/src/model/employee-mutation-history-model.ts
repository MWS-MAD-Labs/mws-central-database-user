import type {
  EmployeeMutationField,
  EmployeeMutationHistory,
  MasterBuilding,
  MasterJobLevel,
  MasterJobPosition,
  MasterUnit,
} from "../generated/prisma/client";

export type GetEmployeeMutationHistoryRequest = {
  employee_id: string;
};

export type RollbackEmployeeMutationRequest = {
  employee_id: string;
  history_id: string;
};

export type EmployeeMutationHistoryResponse = {
  id: string;
  field: EmployeeMutationField;
  // Display value for the field changed by this row.
  value: string;
  start_date: string;
  end_date: string | null;
  // Rollback requires the active row to have a predecessor.
  can_rollback: boolean;
  created_at: string;
};

export type EmployeeMutationHistoryWithRelations = EmployeeMutationHistory & {
  unit: MasterUnit | null;
  job_position: MasterJobPosition | null;
  job_level: MasterJobLevel | null;
  building: MasterBuilding | null;
};

export function toEmployeeMutationHistoryResponse(
  row: EmployeeMutationHistoryWithRelations,
): EmployeeMutationHistoryResponse {
  const value =
    row.unit?.name ??
    row.job_position?.name ??
    row.job_level?.name ??
    row.building?.name ??
    row.status ??
    row.employment_type ??
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
