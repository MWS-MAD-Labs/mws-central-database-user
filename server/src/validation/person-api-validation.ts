import { z } from "zod";

export class PersonApiValidation {
  // Email is the only entry point for this endpoint - a caller that already
  // knows the person's type and internal ID should use the dedicated
  // /employees/lookup or /students/lookup id-based path instead, which skips
  // the cache for re-verification (see EmployeeApiService.lookup).
  static readonly LOOKUP = z.object({
    email: z.email("A valid email is required"),
  });
}
