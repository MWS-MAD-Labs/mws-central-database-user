import { z } from "zod";

export const MAX_SUPPORT_CASELOAD = 20;

export class SupportCaseloadValidation {
  static readonly UPDATE = z.object({
    max_students: z
      .number({ message: "Maximum students must be a whole number" })
      .int("Maximum students must be a whole number")
      .min(1, "Maximum students must be at least 1")
      .max(MAX_SUPPORT_CASELOAD, `Maximum students can be at most ${MAX_SUPPORT_CASELOAD}`),
  });
}
