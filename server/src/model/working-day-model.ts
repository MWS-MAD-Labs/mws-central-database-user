import type { WorkingDayOverride } from "../generated/prisma/client";

export type CreateWorkingDayRequest = {
  date: string;
  reason?: string;
};

export type DeleteWorkingDayRequest = {
  id: string;
};

export type WorkingDayResponse = {
  id: string;
  date: string;
  reason: string | null;
  created_at: string;
};

export function toWorkingDayResponse(
  workingDay: WorkingDayOverride,
): WorkingDayResponse {
  return {
    id: workingDay.id,
    date: workingDay.date.toISOString(),
    reason: workingDay.reason,
    created_at: workingDay.created_at.toISOString(),
  };
}
