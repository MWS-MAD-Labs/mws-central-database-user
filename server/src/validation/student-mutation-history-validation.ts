import { z } from "zod";

export class StudentMutationHistoryValidation {
  static readonly GET = z.object({
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly ROLLBACK = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    history_id: z.string().min(1, "History ID is required"),
  });
}
