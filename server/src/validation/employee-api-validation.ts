import { z } from "zod";

export class EmployeeApiValidation {
  static readonly LOOKUP = z.object({
    email: z
      .email("A valid email is required")
      .min(1, "Email is required")
      .max(50, "Email is too long"),
  });
}
