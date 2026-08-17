import { z } from "zod";

export class EmployeeMutationHistoryValidation {
  static readonly GET = z.object({
    employee_id: z.string().min(1, "Employee ID is required"),
  });

  static readonly ROLLBACK = z.object({
    employee_id: z.string().min(1, "Employee ID is required"),
    history_id: z.string().min(1, "History ID is required"),
  });
}
