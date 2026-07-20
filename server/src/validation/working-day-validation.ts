import { z } from "zod";

export class WorkingDayValidation {
  static readonly CREATE = z.object({
    date: z.iso.datetime("Date must be a valid ISO-8601 datetime string"),
    reason: z.string().max(200, "Reason is too long").optional(),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "Working day ID is required"),
  });
}
