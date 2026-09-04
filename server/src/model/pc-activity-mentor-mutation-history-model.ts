import type {
  Employee,
  MasterPCActivity,
  MasterUnit,
  PCActivityMentorMutationHistory,
  Person,
} from "../generated/prisma/client";

export type GetPCActivityMentorMutationHistoryRequest = {
  activity_id: string;
};

export type RollbackPCActivityMentorMutationRequest = {
  activity_id: string;
  history_id: string;
};

export type ListPCActivityMentorMutationHistoryForEmployeeRequest = {
  employee_id: string;
};

export type PCActivityMentorMutationHistoryResponse = {
  id: string;
  activity_id: string;
  activity_name: string;
  unit_id: string;
  unit_name: string;
  // Null means "no mentor" - see the model's own schema comment.
  mentor_id: string | null;
  mentor_name: string | null;
  start_date: string;
  end_date: string | null;
  // Only true on the currently-active row (end_date: null) for its unit,
  // and only when there's something to roll back to - the first-ever row
  // for a given (activity, unit) has no previous_history_id.
  can_rollback: boolean;
  created_at: string;
};

export type PCActivityMentorMutationHistoryWithRelations =
  PCActivityMentorMutationHistory & {
    activity: MasterPCActivity;
    unit: MasterUnit;
    mentor: (Employee & { person: Person }) | null;
  };

export function toPCActivityMentorMutationHistoryResponse(
  row: PCActivityMentorMutationHistoryWithRelations,
): PCActivityMentorMutationHistoryResponse {
  return {
    id: row.id,
    activity_id: row.activity_id,
    activity_name: row.activity.name,
    unit_id: row.unit_id,
    unit_name: row.unit.name,
    mentor_id: row.mentor_id,
    mentor_name: row.mentor?.person.full_name ?? null,
    start_date: row.start_date.toISOString(),
    end_date: row.end_date ? row.end_date.toISOString() : null,
    can_rollback: row.end_date === null && row.previous_history_id !== null,
    created_at: row.created_at.toISOString(),
  };
}
