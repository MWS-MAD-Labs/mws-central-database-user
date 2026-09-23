import type {
  InternMutationField,
  InternMutationHistory,
  MasterBuilding,
  MasterJobPosition,
  MasterUnit,
} from "../generated/prisma/client";

export type GetInternMutationHistoryRequest = { intern_id: string };
export type RollbackInternMutationRequest = {
  intern_id: string;
  history_id: string;
};

export type InternMutationHistoryResponse = {
  id: string;
  field: InternMutationField;
  value: string;
  start_date: string;
  end_date: string | null;
  can_rollback: boolean;
  created_at: string;
};

export type InternMutationHistoryWithRelations = InternMutationHistory & {
  unit: MasterUnit | null;
  job_position: MasterJobPosition | null;
  building: MasterBuilding | null;
};

export function toInternMutationHistoryResponse(
  row: InternMutationHistoryWithRelations,
): InternMutationHistoryResponse {
  return {
    id: row.id,
    field: row.field,
    value:
      row.unit?.name ??
      row.job_position?.name ??
      row.building?.name ??
      row.status ??
      "",
    start_date: row.start_date.toISOString(),
    end_date: row.end_date ? row.end_date.toISOString() : null,
    can_rollback: row.end_date === null && row.previous_history_id !== null,
    created_at: row.created_at.toISOString(),
  };
}
