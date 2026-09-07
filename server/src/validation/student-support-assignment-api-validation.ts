import { z } from "zod";

export class StudentSupportAssignmentApiValidation {
  static readonly LIST = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
  });
}
