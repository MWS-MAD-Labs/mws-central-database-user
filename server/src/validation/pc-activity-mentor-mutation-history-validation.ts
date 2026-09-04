import { z } from "zod";

export class PCActivityMentorMutationHistoryValidation {
  static readonly GET = z.object({
    activity_id: z.string().min(1, "Activity ID is required"),
  });

  static readonly ROLLBACK = z.object({
    activity_id: z.string().min(1, "Activity ID is required"),
    history_id: z.string().min(1, "History ID is required"),
  });

  static readonly LIST_FOR_EMPLOYEE = z.object({
    employee_id: z.string().min(1, "Employee ID is required"),
  });
}
