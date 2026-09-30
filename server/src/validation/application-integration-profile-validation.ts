import { z } from "zod";

const scopeNames = z
  .array(z.string().min(1, "Scope name cannot be empty"))
  .min(1, "At least one scope is required")
  .max(100);

export class ApplicationIntegrationProfileValidation {
  static readonly CREATE = z.object({
    code: z
      .string()
      .min(2, "Code is required")
      .max(50, "Code is too long")
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Code must be lowercase letters, numbers, and single hyphens",
      ),
    name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
    description: z.string().trim().max(255, "Description is too long").optional(),
    scope_names: scopeNames,
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "Profile ID is required"),
    name: z.string().trim().min(1, "Name is required").max(100, "Name is too long").optional(),
    description: z.string().trim().max(255, "Description is too long").nullable().optional(),
    status: z.enum(["ACTIVE", "DISABLED", "DEPRECATED"]).optional(),
    scope_names: scopeNames.optional(),
  });
}
