import { z } from "zod";

export class InternMutationHistoryValidation {
  static readonly GET = z.object({
    intern_id: z.string().min(1, "Intern ID is required"),
  });

  static readonly ROLLBACK = z.object({
    intern_id: z.string().min(1, "Intern ID is required"),
    history_id: z.string().min(1, "History ID is required"),
  });
}
